import { ipcMain } from 'electron'
import {
  startCloudflareChallenge,
  cancelCloudflareChallenge,
  getCloudflareStatus,
  closeCloudflareChrome
} from '../cloudflare'
import type { CloudflarePlatform } from '../../shared/types'

export function registerCloudflareIpc(): void {
  ipcMain.handle('cloudflare:startChallenge', async (_event, platform: CloudflarePlatform) => {
    return startCloudflareChallenge(platform)
  })

  ipcMain.handle('cloudflare:cancelChallenge', async () => {
    cancelCloudflareChallenge()
  })

  ipcMain.handle('cloudflare:getStatus', async (_event, platform: CloudflarePlatform) => {
    return getCloudflareStatus(platform)
  })

  ipcMain.handle('cloudflare:close', async () => {
    await closeCloudflareChrome()
  })
}
