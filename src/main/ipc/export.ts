import { ipcMain } from 'electron'
import { exportToExcel } from '../export'
import { downloadImage } from '../image'
import type { BatchQueryResult } from '../../shared/types'

export function registerExportIpc(): void {
  ipcMain.handle('exportToExcel', async (_event, results: BatchQueryResult[]) => {
    return exportToExcel(results)
  })

  ipcMain.handle('fetchImage', async (_event, url: string, size?: number) => {
    return downloadImage(url, size)
  })
}
