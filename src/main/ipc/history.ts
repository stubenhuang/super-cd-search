import { ipcMain } from 'electron'
import { getHistory, getHistoryEntry, deleteHistoryEntry, clearAllHistory } from '../database/queries'

export function registerHistoryIpc(): void {
  ipcMain.handle('getHistory', () => {
    return getHistory()
  })

  ipcMain.handle('getHistoryEntry', (_event, queryId: number) => {
    return getHistoryEntry(queryId)
  })

  ipcMain.handle('deleteHistoryEntry', (_event, queryId: number) => {
    deleteHistoryEntry(queryId)
  })

  ipcMain.handle('clearAllHistory', () => {
    clearAllHistory()
  })
}
