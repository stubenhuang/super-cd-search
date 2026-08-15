import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getSettings,
  getSetting,
  setSetting,
  deleteSetting,
  getLanToken,
  setLanToken
} from '../src/main/settings'
import { DEFAULT_STANDARD_PLATFORMS, DEFAULT_DEEP_PLATFORMS, DEFAULT_BARCODE_PROVIDERS } from '../src/shared/platforms'

beforeEach(() => {
  deleteSetting('discogsToken')
  deleteSetting('ebayClientId')
  deleteSetting('ebayClientSecret')
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
  deleteSetting('lanEnabled')
  deleteSetting('lanHost')
  deleteSetting('lanPort')
  deleteSetting('barcodeProviders')
  deleteSetting('lastExportDirectory')
  setLanToken('')
})

describe('settings', () => {
  it('returns undefined for unset settings and defaults for search platforms', () => {
    expect(getSettings()).toEqual({
      discogsToken: undefined,
      ebayClientId: undefined,
      ebayClientSecret: undefined,
      proxyEnabled: undefined,
      proxyHost: undefined,
      proxyPort: undefined,
      llm: undefined,
      standardPlatforms: DEFAULT_STANDARD_PLATFORMS,
      deepPlatforms: DEFAULT_DEEP_PLATFORMS,
      fastMode: undefined,
      displayCurrency: 'USD',
      theme: 'light',
      language: 'zh',
      lanEnabled: undefined,
      lanHost: undefined,
      lanPort: undefined,
      barcodeProviders: DEFAULT_BARCODE_PROVIDERS,
      lastExportDirectory: undefined
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

  it('round-trips LAN settings without exposing the access token in getSettings', () => {
    setSetting('lanEnabled', true)
    setSetting('lanHost', '192.168.1.5')
    setSetting('lanPort', 9000)
    setLanToken('secret-token')

    expect(getSetting('lanEnabled')).toBe(true)
    expect(getSetting('lanHost')).toBe('192.168.1.5')
    expect(getSetting('lanPort')).toBe(9000)
    expect(getSettings()).toMatchObject({ lanEnabled: true, lanHost: '192.168.1.5', lanPort: 9000 })
    expect('lanToken' in getSettings()).toBe(false)
    expect(getLanToken()).toBe('secret-token')
  })

  it('round-trips the last export directory', () => {
    setSetting('lastExportDirectory', '/Users/me/Exports')
    expect(getSetting('lastExportDirectory')).toBe('/Users/me/Exports')
    expect(getSettings().lastExportDirectory).toBe('/Users/me/Exports')
  })

  it('round-trips the barcode provider order', () => {
    setSetting('barcodeProviders', ['tower', 'discogs', 'surugaya'])

    expect(getSetting('barcodeProviders')).toEqual(['tower', 'discogs', 'surugaya'])
    expect(getSettings().barcodeProviders).toEqual(['tower', 'discogs', 'surugaya'])
  })

  it('round-trips nested object settings', () => {
    const llm = {
      enabled: true,
      apiBaseUrl: 'https://api.example.com/v1',
      apiKey: 'k',
      model: 'm',
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

    setSetting('llm', llm)

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
