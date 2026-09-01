import { ipcMain } from 'electron'
import type { CDDetails, QueryResult } from '../../shared/types'
import { cancelEnrichment, enrichDetails, isEnrichmentRunning } from '../llm/enrich'
import { logger } from '../logger'

export function registerEnrichmentIpc(): void {
  ipcMain.handle(
    'detail:enrich',
    async (_event, catalogNumber: string, existingResults: QueryResult[] = [], knownDetails?: CDDetails | null) => {
      const startedAt = Date.now()
      logger.debug('ipc.enrich', 'detail:enrich invoked', { catalogNumber, existingSourceCount: existingResults.length })
      const result = await enrichDetails(catalogNumber, existingResults, knownDetails)
      logger.debug('ipc.enrich', 'detail:enrich returned', { catalogNumber, status: result.status, durationMs: Date.now() - startedAt })
      return result
    }
  )

  ipcMain.handle('detail:enrich-cancel', () => {
    logger.debug('ipc.enrich', 'detail:enrich-cancel invoked', { running: isEnrichmentRunning() })
    cancelEnrichment()
  })
}
