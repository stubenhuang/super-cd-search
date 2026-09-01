import { ipcMain } from 'electron'
import { getSettings, getSetting, setSetting, updateSettings, deleteSetting, PUBLIC_SETTING_KEYS, type Settings } from '../settings'
import { clearSearchCache } from '../queries/cache'
import { clearReleaseCache, clearDiscogsBarcodeCache } from '../queries/discogs'
import { clearItemDetailsCache } from '../queries/ebay'
import { clearBarcodeResolutionCache } from '../barcode/resolver'
import { exportSettingsBackup, importSettingsBackup } from '../settings/backup'

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

  ipcMain.handle('settings:export-backup', async (_event, password: string) => {
    if (typeof password !== 'string' || password.length === 0) {
      return { status: 'error', errorCode: 'weak_password', message: 'invalid password' }
    }
    return exportSettingsBackup(password)
  })

  ipcMain.handle('settings:import-backup', async (_event, password: string) => {
    if (typeof password !== 'string' || password.length === 0) {
      return { status: 'error', errorCode: 'weak_password', message: 'invalid password' }
    }
    return importSettingsBackup(password)
  })
}
