import * as core from '@actions/core'
import {readFileSync, addDelay} from './mockables'
import * as github from '@actions/github'
import * as httpm from '@actions/http-client'
import mustache from 'mustache'
import {Buffer} from 'buffer'
import {Octokit} from '@octokit/rest'
import {
  getReleaseTagName,
  getVersion,
  getFilename,
  calculateSHA,
  safeEscape
} from './helpers'
import type {
  MustacheView,
  ResolvedInputs,
  Manifest,
  ReleaseRequest
} from './types'

const RELEASE_BOT_WEBHOOK_URL = 'https://spin-plugin-releaser.fermyon.app'
const DEFAULT_INDENT = '6'

const token = core.getInput('github_token')
const octokit = (() => {
  return token ? new Octokit({auth: token}) : new Octokit()
})()

const encode = (str: string): string =>
  Buffer.from(str, 'binary').toString('base64')

function parseActionsInput(): ResolvedInputs {
  return {
    repo: github.context.repo.repo,
    owner: github.context.repo.owner,
    actor: github.context.actor,
    releaseTagName: getReleaseTagName(github.context.ref),
    version: getVersion(getReleaseTagName(github.context.ref)),
    releaseWebhookURL:
      core.getInput('release_webhook_url') || RELEASE_BOT_WEBHOOK_URL,
    indent: parseInt(core.getInput('indent') || DEFAULT_INDENT),
    templateFile:
      core.getInput('template_file', {trimWhitespace: true}) ||
      '.spin-plugin.json.tmpl',
    uploadChecksums:
      core
        .getInput('upload_checksums', {trimWhitespace: true})
        .toLowerCase() === 'true' || false
  }
}

export async function run(): Promise<void> {
  const context = parseActionsInput()
  const releaseMap = await getReleaseAssetsSha256sumMap(context)
  const releaseId = await getReleaseId(context)

  // upload checksums file if enabled
  if (context.uploadChecksums) {
    const checksums: string[] = []
    for (const [key, value] of releaseMap) {
      if (!key.endsWith('.tar.gz')) {
        continue
      }

      checksums.push(`${value}  ${getFilename(key)}`)
    }

    core.info(`checksums file is ${checksums}`)
    await octokit.rest.repos.uploadReleaseAsset({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      release_id: releaseId,
      name: `checksums-${context.releaseTagName}.txt`,
      data: checksums.join('\n')
    })
  }

  const rawManifest = parseTemplateIntoManifest(context, releaseMap)
  const manifest: Manifest = JSON.parse(rawManifest)

  core.info('uploading plugin json file as an asset to release')
  await octokit.rest.repos.uploadReleaseAsset({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    release_id: releaseId,
    name: `${manifest.name}.json`,
    data: rawManifest
  })

  core.info(
    `added ${manifest.name}.json file to release ${context.releaseTagName}`
  )
  if (context.releaseTagName === 'canary') {
    return
  }

  const releaseReq: ReleaseRequest = {
    tagName: context.releaseTagName,
    pluginName: manifest.name,
    pluginRepo: context.repo,
    pluginOwner: context.owner,
    pluginReleaseActor: github.context.actor,
    processedTemplate: encode(rawManifest)
  }

  const rawBody = JSON.stringify(releaseReq)
  core.info(`making webhook request to create PR ${rawBody}`)
  await new httpm.HttpClient('spin-plugins-releaser').post(
    context.releaseWebhookURL,
    rawBody,
    {connection: 'close'}
  )
}

async function getReleaseId(context: ResolvedInputs): Promise<number> {
  const params = {
    owner: context.owner,
    repo: context.repo
  }
  const iter = octokit.paginate.iterator(
    octokit.rest.repos.listReleases,
    params
  )
  for await (const releases of iter) {
    const release = releases.data.find(
      item => item.tag_name === context.releaseTagName
    )
    if (release) return release.id
  }

  throw new Error(`no release found with tag name ${context.releaseTagName}`)
}

export function parseTemplateIntoManifest(
  context: ResolvedInputs,
  releaseMap: Map<string, string>
): string {
  // do a second pass which also renders the sha256sum
  const fullview: MustacheView = {
    TagName: () => context.releaseTagName,
    Version: () => context.version,
    addURLAndSha: renderURLWithSha256(releaseMap, context.indent)
  }

  return render(context.templateFile, fullview)
}

export async function getReleaseAssetsSha256sumMap(
  context: ResolvedInputs
): Promise<Map<string, string>> {
  try {
    core.info(`inputs:\n${JSON.stringify(context, null, 2)}`)

    // sometimes release assets are not available right away
    // TODO: retry instead of sleep
    await addDelay(10 * 1000)

    // In the first pass, only populate the URL. This is done this way
    // so that we can read the rendered manifest and then iterate through
    // the asset urls to download and calculate the sha256sum of those assets.
    // we could do this in one go within the render function, but that would be slow
    // as it would download and calculate the sha256sum sequentially.
    const view: MustacheView = {
      TagName: () => context.releaseTagName,
      Version: () => context.version,
      addURLAndSha: renderOnlyURL()
    }
    const rendered = render(context.templateFile, view)
    const releaseMap = new Map()
    const manifest: Manifest = JSON.parse(rendered)
    await Promise.all(
      manifest.packages.map(async pkg => {
        const sha = await calculateSHA(pkg.url, token)
        releaseMap.set(pkg.url, sha)
      })
    )

    return releaseMap
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }

  throw new Error(`failed to create asseturl -> sha256sum map`)
}

// This function only renders the URL.
export function renderOnlyURL(): () => (
  text: string,
  render: (arg: string) => string
) => void {
  return function (): (text: string, render: (arg: string) => string) => void {
    return function (text: string, render: (arg: string) => string): string {
      const url = render(text)
      return `"url": "${url}"`
    }
  }
}

// This function renders the url, and finds the sha256sum from the provided releaseMap.
// It then populates both the url and sha256sum in the template file
function renderURLWithSha256(
  sha256sumMap: Map<string, string>,
  indent: number
): () => (text: string, render: (arg: string) => string) => void {
  return function (): (text: string, render: (arg: string) => string) => void {
    return function (text: string, render: (arg: string) => string): string {
      const url = render(text)
      return (
        `"url": "${url}",` +
        '\n' +
        `${' '.repeat(indent)}"sha256": "${sha256sumMap.get(url.toLowerCase())}"`
      )
    }
  }
}

function render(templateFile: string, view: MustacheView): string {
  const templ = readFileSync(templateFile, 'utf8')
  return mustache.render(templ.toString(), view, undefined, {
    escape: safeEscape
  })
}
