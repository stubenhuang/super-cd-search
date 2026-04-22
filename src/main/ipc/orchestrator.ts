import { ipcMain } from 'electron'
import { executeBatchQuery } from '../orchestrator'

export function registerOrchestratorIpc(): void {
  ipcMain.handle('executeBatchQuery', async (_event, catalogNumbers: string[]) => {
    return executeBatchQuery(catalogNumbers)
  })
}
