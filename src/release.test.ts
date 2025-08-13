import {describe, it, expect, vi} from 'vitest'
import {getVersion, getReleaseTagName} from './release'

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
