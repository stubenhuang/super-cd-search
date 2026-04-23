import { ipcMain } from 'electron'
import { exportToExcel } from '../export'
import type { BatchQueryResult } from '../../renderer/src/electron-api'

export function registerExportIpc(): void {
  ipcMain.handle('exportToExcel', async (_event, results: BatchQueryResult[]) => {
    return exportToExcel(results)
  })
}
