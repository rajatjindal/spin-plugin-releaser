import * as core from '@actions/core'
import * as crypto from 'crypto'
import * as fs from 'fs-extra'
import * as github from '@actions/github'
import * as httpm from '@actions/http-client'
import * as mustache from 'mustache'
import * as tc from '@actions/tool-cache'
import {Buffer} from 'buffer'
import {Octokit} from '@octokit/rest'
import toml from 'toml'
import semver from 'semver'

const RELEASE_BOT_WEBHOOK_URL = 'https://spin-plugin-releaser.fermyon.app'

interface MustacheView {
  TagName: string
  Version: string
  addURLAndSha: () => (text: string, render: (text2: string) => string) => void
}

interface Manifest {
  name: string
  version: string
}

interface ReleaseRequest {
  tagName: string
  pluginName: string
  pluginRepo: string
  pluginOwner: string
  pluginReleaseActor: string
  processedTemplate: string
}

const DEFAULT_INDENT = '6'
const token = core.getInput('github_token')
const octokit = (() => {
  return token ? new Octokit({auth: token}) : new Octokit()
})()

const encode = (str: string): string =>
  Buffer.from(str, 'binary').toString('base64')

async function run(): Promise<void> {
  try {
    const releaseTagName = getReleaseTagName(github.context.ref)
    const version = getVersion(releaseTagName)
    const indent = parseInt(core.getInput('indent') || DEFAULT_INDENT)
    const release_webhook_url =
      core.getInput('release_webhook_url') || RELEASE_BOT_WEBHOOK_URL

    core.info(`webhook url is ${release_webhook_url}`)

    //sometimes github assets are not available right away
    //TODO: retry instead of sleep
    await addDelay(10 * 1000)

    //TODO(rajatjindal): support navigation
    const allReleases = await octokit.rest.repos.listReleases({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo
    })

    const release = allReleases.data.find(
      item => item.tag_name === releaseTagName
    )
    if (!release) {
      throw new Error(`no release found with tag ${releaseTagName}`)
    }

    // use the tag from the release
    const tagName = release.tag_name
    const releaseMap: Record<string, string> = {}
    for (const asset of release?.assets || []) {
      core.info(`calculating sha of ${asset.browser_download_url}`)
      const downloadPath = await tc.downloadTool(
        asset.url,
        undefined,
        token ? `token ${token}` : undefined,
        {
          accept: 'application/octet-stream'
        }
      )

      const buffer = fs.readFileSync(downloadPath)
      releaseMap[asset.browser_download_url.toLowerCase()] = crypto
        .createHash('sha256')
        .update(buffer)
        .digest('hex')
    }

    core.info(`release map is ${JSON.stringify(releaseMap)}`)

    const view: MustacheView = {
      TagName: tagName,
      Version: version,
      addURLAndSha: renderTemplate(releaseMap, indent)
    }

    const templateFile =
      core.getInput('template_file', {trimWhitespace: true}) ||
      '.spin-plugin.json.tmpl'

    const templ = fs.readFileSync(templateFile, 'utf8')
    const rendered = mustache.render(templ, view)
    const renderedBase64 = encode(rendered)

    const manifest: Manifest = JSON.parse(rendered)
    const releaseReq: ReleaseRequest = {
      tagName,
      pluginName: manifest.name,
      pluginRepo: github.context.repo.repo,
      pluginOwner: github.context.repo.owner,
      pluginReleaseActor: github.context.actor,
      processedTemplate: renderedBase64
    }

    const httpclient = new httpm.HttpClient('spin-plugins-releaser')

    core.info(JSON.stringify(releaseReq, null, '\t'))

    // create checksums-<tagname>.txt
    const uploadChecksums =
      core
        .getInput('upload_checksums', {trimWhitespace: true})
        .toLowerCase() === 'true' || false

    if (uploadChecksums) {
      const checksums: string[] = []
      for (const [key, value] of Object.entries(releaseMap)) {
        if (!key.endsWith('.tar.gz')) {
          continue
        }

        checksums.push(`${value}  ${getFilename(key)}`)
      }

      core.info(`checksums file is ${checksums}`)
      await octokit.rest.repos.uploadReleaseAsset({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        release_id: release.id,
        name: `checksums-${tagName}.txt`,
        data: checksums.join('\n')
      })
    }

    core.info('uploading plugin json file as an asset to release')
    await octokit.rest.repos.uploadReleaseAsset({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      release_id: release.id,
      name: `${manifest.name}.json`,
      data: rendered
    })

    core.info(`added ${manifest.name}.json file to release ${tagName}`)
    if (tagName === 'canary') {
      return
    }

    const rawBody = JSON.stringify(releaseReq)
    core.info(`making webhook request to create PR ${rawBody}`)
    await httpclient.post(release_webhook_url, rawBody)
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

function renderTemplate(
  sha256sumMap: Record<string, string>,
  indent: number
): () => (text: string, render: (arg: string) => string) => void {
  return function (): (text: string, render: (arg: string) => string) => void {
    return function (text: string, render: (arg: string) => string): string {
      const url = render(text)
      return (
        `"url": "${url}",` +
        '\n' +
        `${' '.repeat(indent)}"sha256": "${sha256sumMap[url.toLowerCase()]}"`
      )
    }
  }
}

// getReleaseTagName returns the tagName from the github ref
export function getReleaseTagName(input: string): string {
  if (input.startsWith('refs/tags/')) {
    return input.replace('refs/tags/', '')
  }

  if (input === 'refs/heads/main') {
    return 'canary'
  }

  throw new Error(`failed to parse releaseTagName from ref '${input}'`)
}

// getVersion is suppose to return the version
// that will be populated in "version" field in
// the plugin manifest.
export function getVersion(tagName: string): string {
  if (tagName === 'canary') {
    if (fs.existsSync('Cargo.toml')) {
      const cargoToml = toml.parse(fs.readFileSync('Cargo.toml', 'utf-8'))
      return `${cargoToml.package.version}post.${getEpochTime()}`
    }

    return `canary.${getEpochTime()}`
  }

  const semversion = extractSemver(tagName)
  if (!semversion) {
    throw new Error(`unable to extract semver from tag '${tagName}'`)
  }

  return semversion
}

function getEpochTime(): number {
  return Math.floor(new Date().getTime() / 1000)
}

function getFilename(url: string): string {
  const name = url.split('/').pop()
  if (name) {
    return name
  }

  throw new Error('failed to find filename from asset url')
}

async function addDelay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function extractSemver(input: string): string | null {
  const version = semver.coerce(input)
  return version ? version.version : null
}

run()
