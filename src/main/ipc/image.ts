import { ipcMain } from 'electron'
import { downloadImage } from '../image'
import { isPrivateNetworkUrl, isSafeExternalUrl } from '../security/urls'

export function registerImageIpc(): void {
  ipcMain.handle('fetchImage', async (_event, url: string, size?: number) => {
    if (!isSafeExternalUrl(url) || isPrivateNetworkUrl(url)) return null
    return downloadImage(url, size, false)
  })
}
