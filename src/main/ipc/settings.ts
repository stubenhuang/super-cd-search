import { ipcMain } from 'electron'
import { getSettings, getSetting, setSetting, deleteSetting, type Settings } from '../settings'

export function registerSettingsIpc(): void {
  ipcMain.handle('getSettings', () => {
    return getSettings()
  })

  ipcMain.handle('getSetting', (_event, key: string) => {
    return getSetting(key as keyof Settings)
  })

  ipcMain.handle('setSetting', (_event, key: string, value: Settings[keyof Settings]) => {
    setSetting(key as keyof Settings, value)
  })

  ipcMain.handle('deleteSetting', (_event, key: string) => {
    deleteSetting(key as keyof Settings)
  })
}
