import { ipcMain } from 'electron'
import { getSettings, getSetting, setSetting, updateSettings, deleteSetting, type Settings } from '../settings'
import { clearSearchCache } from '../queries/cache'
import { clearReleaseCache, clearDiscogsBarcodeCache } from '../queries/discogs'
import { clearItemDetailsCache } from '../queries/ebay'
import { clearBarcodeResolutionCache } from '../barcode/resolver'

const PUBLIC_SETTING_KEYS = new Set<keyof Settings>([
  'discogsToken', 'ebayClientId', 'ebayClientSecret',
  'proxyEnabled', 'proxyHost', 'proxyPort', 'llm',
  'standardPlatforms', 'deepPlatforms', 'fastMode', 'displayCurrency',
  'theme', 'language', 'lanEnabled', 'lanHost', 'lanPort',
  'barcodeProviders', 'lastExportDirectory'
])

function assertPublicSettingKey(key: string): asserts key is keyof Settings {
  if (!PUBLIC_SETTING_KEYS.has(key as keyof Settings)) throw new Error('Invalid settings key')
}

export function registerSettingsIpc(): void {
  ipcMain.handle('getSettings', () => {
    return getSettings()
  })

  ipcMain.handle('getSetting', (_event, key: string) => {
    assertPublicSettingKey(key)
    return getSetting(key)
  })

  ipcMain.handle('setSetting', (_event, key: string, value: Settings[keyof Settings]) => {
    assertPublicSettingKey(key)
    setSetting(key, value)
  })

  ipcMain.handle('updateSettings', (_event, values: Partial<Settings>) => {
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Invalid settings payload')
    for (const key of Object.keys(values)) assertPublicSettingKey(key)
    updateSettings(values)
  })

  ipcMain.handle('deleteSetting', (_event, key: string) => {
    assertPublicSettingKey(key)
    deleteSetting(key)
  })

  ipcMain.handle('clearSearchCache', () => {
    clearSearchCache()
    clearReleaseCache()
    clearDiscogsBarcodeCache()
    clearBarcodeResolutionCache()
    clearItemDetailsCache()
  })
}
