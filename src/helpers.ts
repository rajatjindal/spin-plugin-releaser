import * as crypto from 'crypto'
import {readFileSync} from './mockables'
import * as fs from 'fs-extra'
import * as tc from '@actions/tool-cache'
import toml from 'toml'
import semver from 'semver'

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
      const cargoToml = toml.parse(
        readFileSync('Cargo.toml', 'utf-8').toString()
      )
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

export function getFilename(url: string): string {
  const name = url.split('/').pop()
  if (name) {
    return name
  }

  throw new Error('failed to find filename from asset url')
}

function extractSemver(input: string): string | null {
  const version = semver.coerce(input)
  return version ? version.version : null
}

// mustache escape function rewrites plugin/v0.0.4 as plugin&#x2F;v0.0.4
// The following functions tells mustache to leave `/` alone.
export function safeEscape(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;') // must come first
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function calculateSHA(
  url: string,
  token: string
): Promise<string> {
  const downloadPath = await tc.downloadTool(
    url,
    undefined,
    token ? `token ${token}` : undefined,
    {
      accept: 'application/octet-stream'
    }
  )

  const buffer = readFileSync(downloadPath)
  return crypto.createHash('sha256').update(buffer).digest('hex')
}
