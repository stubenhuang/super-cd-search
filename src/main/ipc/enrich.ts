import { ipcMain } from 'electron'
import type { CDDetails, QueryResult } from '../../shared/types'
import { enrichDetails } from '../llm/enrich'

export function registerEnrichmentIpc(): void {
  ipcMain.handle(
    'detail:enrich',
    (_event, catalogNumber: string, existingResults: QueryResult[] = [], knownDetails?: CDDetails | null) => {
      return enrichDetails(catalogNumber, existingResults, knownDetails)
    }
  )
}
