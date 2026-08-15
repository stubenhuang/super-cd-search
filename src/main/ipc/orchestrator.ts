import { ipcMain } from 'electron'
import { executeBatchQuery, cancelBatchQuery } from '../orchestrator'
import { logger } from '../logger'
import type { Platform } from '../../shared/types'

export function registerOrchestratorIpc(): void {
  ipcMain.handle('executeBatchQuery', async (_event, catalogNumbers: string[], platforms?: Platform[]) => {
    const startedAt = Date.now()
    logger.debug('ipc.orchestrator', 'executeBatchQuery invoked', { catalogCount: catalogNumbers?.length ?? 0, platforms })
    const result = await executeBatchQuery(catalogNumbers, platforms)
    logger.debug('ipc.orchestrator', 'executeBatchQuery returned', { durationMs: Date.now() - startedAt, resultCount: result.length })
    return result
  })

  ipcMain.handle('cancelBatchQuery', async () => {
    logger.debug('ipc.orchestrator', 'cancelBatchQuery invoked')
    cancelBatchQuery()
  })
}
