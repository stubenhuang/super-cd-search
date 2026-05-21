import { ipcMain } from 'electron'
import { executeBatchQuery, cancelBatchQuery } from '../orchestrator'

export function registerOrchestratorIpc(): void {
  ipcMain.handle('executeBatchQuery', async (_event, catalogNumbers: string[]) => {
    return executeBatchQuery(catalogNumbers)
  })

  ipcMain.handle('cancelBatchQuery', async () => {
    cancelBatchQuery()
  })
}
