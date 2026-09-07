import { ipcMain } from 'electron'
import { checkForUpdates, downloadUpdate, getUpdateState, installUpdate } from '../updater'
import type { UpdateState } from '../../shared/updater'

export function registerUpdaterIpc(): void {
  ipcMain.handle('updater:getState', (): UpdateState => getUpdateState())

  ipcMain.handle('updater:check', async (): Promise<UpdateState> => checkForUpdates(true))

  ipcMain.handle('updater:download', async (): Promise<UpdateState> => downloadUpdate())

  ipcMain.handle('updater:install', (): boolean => {
    installUpdate()
    return true
  })
}
