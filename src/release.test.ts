import {describe, it, expect, vi} from 'vitest'
import {
  parseTemplateIntoManifest,
  getReleaseAssetsSha256sumMap
} from './release'
import {getVersion, getReleaseTagName} from './helpers'
import type {ResolvedInputs} from './types'

import {readFileSync} from './mockables'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import * as fs from 'fs-extra'

// returns a fake filepath
vi.mock('@actions/tool-cache', () => ({
  downloadTool: vi.fn(async (url: string) => {
    return `/fake/path/${url.split('/').pop()}`
  })
}))

// This function returns the filepath as content if filepath starts with /fake
// otherwise it just returns the actual content of the file
vi.mock('./mockables', async importOriginal => {
  const actual = await importOriginal<typeof import('./mockables')>()
  console.log(actual)
  return {
    ...actual,
    readFileSync: vi.fn((filePath: string, encoding?: BufferEncoding) => {
      if (filePath.startsWith('/fake/path/')) {
        return filePath
      }

      if (filePath.startsWith('/invalid-path')) {
        throw new Error(`invalid path ${filePath}`)
      }

      return actual.readFileSync(filePath, encoding)
    }),
    addDelay: vi.fn((ms: number) => {})
  }
})

describe('verify mocks works as expected', () => {
  it('readFileSync is mocked but others remain real', () => {
    const content = readFileSync('/fake/path/foo.txt', 'utf-8')
    expect(content).toBe('/fake/path/foo.txt')

    // This still works — original existsSync is intact
    expect(typeof fs.existsSync).toBe('function')

    const __filename = fileURLToPath(import.meta.url)
    const __dirname = join(__filename, '..')
    const templateFile = join(__dirname, 'testdata/not-a-fake-file.txt')

    const otherContent = readFileSync(templateFile, 'utf-8')
    expect(otherContent).toBe('told you. it is not a fake file.')
  })
})

describe('getVersion', () => {
  it('should return timestamp appended for canary releases', () => {
    const fixedDate = new Date('2000-01-01T00:00:00.000Z')
    // Use fake timers and set system time
    vi.useFakeTimers()
    vi.setSystemTime(fixedDate)

    const result = getVersion('canary')
    expect(result).toBe('canary.946684800')
  })

  it('should return version tag without `v` prefix for tagged releases', () => {
    const result = getVersion('v2.4.6')
    expect(result).toBe('2.4.6')
  })

  it('should return version tag without any prefix for tagged releases', () => {
    const result = getVersion('plugin/v2.4.6')
    expect(result).toBe('2.4.6')
  })
})

describe('getReleaseTagName', () => {
  it('should return canary for main', () => {
    const result = getReleaseTagName('refs/heads/main')
    expect(result).toBe('canary')
  })

  it('should return the tag for tagged releases', () => {
    const result = getReleaseTagName('refs/tags/v2.4.6')
    expect(result).toBe('v2.4.6')
  })

  it('should return version tag without any prefix for tagged releases', () => {
    const result = getReleaseTagName('refs/tags/plugin/v2.4.6')
    expect(result).toBe('plugin/v2.4.6')
  })
})

describe('parseTemplateIntoManifest test', () => {
  it('should parse and generate manifest correctly', async () => {
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = join(__filename, '..')
    const templateFile = join(__dirname, 'testdata/spin-plugin.json.tmpl')
    const expectedFile = join(__dirname, 'testdata/expected_output.json')

    const context: ResolvedInputs = {
      repo: 'spin-plugin-releasetest',
      owner: 'rajatjindal',
      actor: 'rajatjindal',
      releaseTagName: 'plugin/v0.0.8',
      version: '0.0.8',
      releaseWebhookURL: 'https://spin-plugin-releaser-staging.fermyon.app',
      uploadChecksums: false,
      indent: 6,
      templateFile: templateFile,
      uploadPluginManifest: true
    }

    // process.env.RUNNER_TEMP="/Users/rajatjindal/go/src/github.com/rajatjindal/spin-plugin-releaser/tmp"
    const releaseMap = await getReleaseAssetsSha256sumMap(context)
    const rendered = parseTemplateIntoManifest(context, releaseMap)
    const expectedManifest = readFileSync(expectedFile)

    expect(rendered).toBe(expectedManifest.toString())
  })
})
