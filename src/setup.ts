import * as core from '@actions/core'
import * as crypto from 'crypto'
import * as fs from 'fs-extra'
import * as github from '@actions/github'
import * as httpm from '@actions/http-client'
import * as mustache from 'mustache'
import * as tc from '@actions/tool-cache'
import {Octokit} from '@octokit/rest'

interface MustacheView {
  TagName: string
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

async function run(): Promise<void> {
  try {
    const tagName = core.getInput('tagName', {required: true})
    const indent = parseInt(core.getInput('indent') || DEFAULT_INDENT)
    const allReleases = await octokit.rest.repos.listReleases({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo
    })

    const release = allReleases.data.find(item => item.tag_name === tagName)
    const releaseMap = new Map<string, string>()
    for (const asset of release?.assets || []) {
      const downloadPath = await tc.downloadTool(asset.browser_download_url)
      const buffer = fs.readFileSync(downloadPath)
      releaseMap.set(
        asset.browser_download_url,
        crypto.createHash('sha256').update(buffer).digest('hex')
      )
    }

    const view: MustacheView = {
      TagName: tagName,
      addURLAndSha: renderTemplate(releaseMap, indent)
    }

    const templ = fs.readFileSync('.spin-plugin.json.tmpl', 'utf8')
    const output = mustache.render(templ, view)
    core.debug(output)

    const manifest: Manifest = JSON.parse(output)
    const rr: ReleaseRequest = {
      tagName,
      pluginName: manifest.name, //todo: get from manifest
      pluginRepo: github.context.repo.repo,
      pluginOwner: github.context.repo.owner,
      pluginReleaseActor: github.context.action,
      processedTemplate: output
    }

    core.info('creating client')
    const httpclient = new httpm.HttpClient('spin-plugins-release-bot', [], {
      headers: {
        Authorization: `Bearer token`
      }
    })

    await httpclient.post(
      'https://spin-plugin-release-bot-tjqim16y.fermyon.app',
      JSON.stringify(rr)
    )
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

function renderTemplate(
  inp: Map<string, string>,
  indent: number
): () => (text: string, render: (arg: string) => string) => void {
  return function (): (text: string, render: (arg: string) => string) => void {
    return function (text: string, render: (arg: string) => string): string {
      const url = render(text)
      return `"url": "${url}",\n${' '.repeat(indent)}"sha256": "${inp.get(
        url
      )}"`
    }
  }
}

run()
