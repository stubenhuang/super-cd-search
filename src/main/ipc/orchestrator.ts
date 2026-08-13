import { ipcMain } from 'electron'
import { executeBatchQuery, cancelBatchQuery } from '../orchestrator'
import type { Platform } from '../../shared/types'

export function registerOrchestratorIpc(): void {
  ipcMain.handle('executeBatchQuery', async (_event, catalogNumbers: string[], platforms?: Platform[]) => {
    return executeBatchQuery(catalogNumbers, platforms)
  })

  ipcMain.handle('cancelBatchQuery', async () => {
    cancelBatchQuery()
  })
}
