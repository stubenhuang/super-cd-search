import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getSettings,
  getSetting,
  setSetting,
  deleteSetting
} from '../src/main/settings'
import { DEFAULT_STANDARD_PLATFORMS, DEFAULT_DEEP_PLATFORMS } from '../src/shared/platforms'

beforeEach(() => {
  deleteSetting('discogsToken')
  deleteSetting('ebayClientId')
  deleteSetting('ebayClientSecret')
  deleteSetting('cookies')
  deleteSetting('proxyEnabled')
  deleteSetting('proxyHost')
  deleteSetting('proxyPort')
  deleteSetting('standardPlatforms')
  deleteSetting('deepPlatforms')
  deleteSetting('fastMode')
  deleteSetting('displayCurrency')
  deleteSetting('theme')
  deleteSetting('language')
  deleteSetting('llm')
})

describe('settings', () => {
  it('returns undefined for unset settings and defaults for search platforms', () => {
    expect(getSettings()).toEqual({
      discogsToken: undefined,
      ebayClientId: undefined,
      ebayClientSecret: undefined,
      cookies: undefined,
      proxyEnabled: undefined,
      proxyHost: undefined,
      proxyPort: undefined,
      llm: undefined,
      standardPlatforms: DEFAULT_STANDARD_PLATFORMS,
      deepPlatforms: DEFAULT_DEEP_PLATFORMS,
      fastMode: undefined,
      displayCurrency: 'USD',
      theme: 'light',
      language: 'zh'
    })
    expect(getSetting('discogsToken')).toBeUndefined()
  })

  it('round-trips search platform lists', () => {
    setSetting('standardPlatforms', ['discogs', 'tower'])
    setSetting('deepPlatforms', ['discogs', 'ebay', 'hmv'])

    expect(getSetting('standardPlatforms')).toEqual(['discogs', 'tower'])
    expect(getSetting('deepPlatforms')).toEqual(['discogs', 'ebay', 'hmv'])
    expect(getSettings().standardPlatforms).toEqual(['discogs', 'tower'])
    expect(getSettings().deepPlatforms).toEqual(['discogs', 'ebay', 'hmv'])
  })

  it('round-trips scalar settings', () => {
    setSetting('discogsToken', 'token-123')
    setSetting('proxyEnabled', true)
    setSetting('proxyHost', '127.0.0.1')
    setSetting('proxyPort', 8080)

    expect(getSetting('discogsToken')).toBe('token-123')
    expect(getSetting('proxyEnabled')).toBe(true)
    expect(getSetting('proxyHost')).toBe('127.0.0.1')
    expect(getSetting('proxyPort')).toBe(8080)
    expect(getSettings().discogsToken).toBe('token-123')
  })

  it('round-trips nested object settings', () => {
    const cookies = { discogs: 'abc', ebay: 'def' }
    const llm = {
      enabled: true,
      apiBaseUrl: 'https://api.example.com/v1',
      apiKey: 'k',
      model: 'm',
      temperature: 0.2,
      platformEnabled: {
        discogs: true,
        ebay: false,
        kojima: true,
        hmv: true,
        yahoo: true,
        cdjapan: true,
        tower: true
      }
    }

    setSetting('cookies', cookies)
    setSetting('llm', llm)

    expect(getSetting('cookies')).toEqual(cookies)
    expect(getSetting('llm')).toEqual(llm)
    expect(getSettings().llm?.platformEnabled.ebay).toBe(false)
  })

  it('round-trips the theme setting and defaults to light', () => {
    expect(getSetting('theme')).toBeUndefined()
    expect(getSettings().theme).toBe('light')

    setSetting('theme', 'dark')
    expect(getSetting('theme')).toBe('dark')
    expect(getSettings().theme).toBe('dark')

    setSetting('theme', 'system')
    expect(getSettings().theme).toBe('system')
  })

  it('round-trips the language setting and defaults to Chinese', () => {
    expect(getSetting('language')).toBeUndefined()
    expect(getSettings().language).toBe('zh')

    setSetting('language', 'en')
    expect(getSetting('language')).toBe('en')
    expect(getSettings().language).toBe('en')
  })

  it('deletes settings', () => {
    setSetting('discogsToken', 'token-123')
    deleteSetting('discogsToken')
    expect(getSetting('discogsToken')).toBeUndefined()
    expect(getSettings().discogsToken).toBeUndefined()
  })

  it('allows setting and clearing empty strings', () => {
    setSetting('discogsToken', '')
    expect(getSetting('discogsToken')).toBe('')
  })

  it('uses SETTINGS_ENCRYPTION_KEY from the environment without crashing', () => {
    vi.stubEnv('SETTINGS_ENCRYPTION_KEY', 'b'.repeat(32))
    expect(() => setSetting('ebayClientId', 'x')).not.toThrow()
    expect(getSetting('ebayClientId')).toBe('x')
    vi.unstubAllEnvs()
  })
})
