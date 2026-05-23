import { ipcMain } from 'electron'
import { executeBatchQuery, cancelBatchQuery } from '../orchestrator'

export function registerOrchestratorIpc(): void {
  ipcMain.handle('executeBatchQuery', async (_event, catalogNumbers: string[], includeKojima?: boolean) => {
    return executeBatchQuery(catalogNumbers, includeKojima)
  })

  ipcMain.handle('cancelBatchQuery', async () => {
    cancelBatchQuery()
  })
}
