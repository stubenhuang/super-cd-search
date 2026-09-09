import { ipcMain } from 'electron'
import {
  startLogin,
  cancelLogin,
  getLoginStatus,
  closeLoginSession
} from '../login'
import type { LoginPlatform } from '../../shared/types'

export function registerLoginIpc(): void {
  ipcMain.handle('login:start', async (_event, platform: LoginPlatform) => {
    return startLogin(platform)
  })

  ipcMain.handle('login:cancel', async () => {
    cancelLogin()
  })

  ipcMain.handle('login:status', async (_event, platform: LoginPlatform) => {
    return getLoginStatus(platform)
  })

  ipcMain.handle('login:close', async () => {
    await closeLoginSession()
  })
}
