import { ipcMain } from 'electron'
import { downloadImage } from '../image'

export function registerImageIpc(): void {
  ipcMain.handle('fetchImage', async (_event, url: string, size?: number) => {
    return downloadImage(url, size)
  })
}
