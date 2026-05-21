import { BrowserWindow } from 'electron'
import { getDatabase } from '../database'
import { queryDiscogs } from '../queries/discogs'
import { queryEbay } from '../queries/ebay'
import { queryKojima } from '../queries/kojima'
import type { QueryResult, BatchQueryProgress, BatchQueryResult } from '../../shared/types'

const MAX_CONCURRENT_CATALOGS = 3
const MAX_CATALOG_NUMBERS = 10

/**
 * Normalize catalog number by inserting hyphen between letters and numbers if missing.
 * E.g., "UCCG90530" -> "UCCG-90530"
 */
function normalizeCatalogNumber(catalogNumber: string): string {
  const trimmed = catalogNumber.trim().toUpperCase()
  // Match: letters followed directly by numbers (no hyphen)
  // Insert hyphen between them
  return trimmed.replace(/^([A-Z]+)(\d+)$/, '$1-$2')
}

export type { BatchQueryProgress, BatchQueryResult }

let abortController: AbortController | null = null

function saveResults(catalogNumber: string, results: QueryResult[]): void {
  const db = getDatabase()

  const insertQuery = db.prepare('INSERT INTO queries (catalog_number) VALUES (?)')
  const insertResult = db.prepare(`
    INSERT INTO results (query_id, platform, name, artist, price_min, price_max, cover_url, link, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const transaction = db.transaction(() => {
    const info = insertQuery.run(catalogNumber)
    const queryId = info.lastInsertRowid

    for (const result of results) {
      insertResult.run(
        queryId,
        result.platform,
        result.name,
        result.artist,
        result.priceMin,
        result.priceMax,
        result.coverUrl,
        result.link,
        result.status
      )
    }
  })

  transaction()
}

function emitProgress(event: string, data: BatchQueryProgress): void {
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    win.webContents.send('query:progress', { event, ...data })
  }
}

async function queryAllPlatforms(catalogNumber: string, signal: AbortSignal): Promise<QueryResult[]> {
  if (signal.aborted) {
    throw new Error('Aborted')
  }

  emitProgress('query:start', { catalogNumber, platform: 'all', status: 'loading' })

  const platforms: Array<{ name: string; query: () => Promise<QueryResult> }> = [
    { name: 'discogs', query: () => queryDiscogs(catalogNumber) },
    { name: 'ebay', query: () => queryEbay(catalogNumber) },
    { name: 'kojima', query: () => queryKojima(catalogNumber) }
  ]

  const results: QueryResult[] = []

  for (const { name, query } of platforms) {
    if (signal.aborted) {
      emitProgress('query:cancelled', { catalogNumber, platform: name, status: 'error' })
      throw new Error('Aborted')
    }

    emitProgress('query:progress', { catalogNumber, platform: name, status: 'loading' })
    try {
      const result = await query()
      emitProgress('query:progress', { catalogNumber, platform: name, status: result.status === 'found' ? 'complete' : result.status })
      results.push(result)
    } catch (err) {
      if (signal.aborted) {
        emitProgress('query:cancelled', { catalogNumber, platform: name, status: 'error' })
        throw new Error('Aborted')
      }
      const message = err instanceof Error ? err.message : 'Unknown error'
      emitProgress('query:error', { catalogNumber, platform: name, status: 'error' })
      results.push({ platform: name as QueryResult['platform'], name: null, artist: null, priceMin: null, priceMax: null, coverUrl: null, link: null, status: 'error' as const, error: message })
    }
  }

  if (!signal.aborted) {
    saveResults(catalogNumber, results)
    emitProgress('query:complete', { catalogNumber, platform: 'all', status: 'complete' })
  }

  return results
}

export function cancelBatchQuery(): void {
  if (abortController) {
    abortController.abort()
    abortController = null
  }
}

export async function executeBatchQuery(catalogNumbers: string[]): Promise<BatchQueryResult[]> {
  if (abortController) {
    abortController.abort()
  }
  abortController = new AbortController()
  const signal = abortController.signal

  const trimmed = catalogNumbers.map(c => normalizeCatalogNumber(c)).filter(c => c.length > 0)

  if (trimmed.length === 0) {
    throw new Error('No catalog numbers provided')
  }

  if (trimmed.length > MAX_CATALOG_NUMBERS) {
    throw new Error(`Maximum ${MAX_CATALOG_NUMBERS} catalog numbers allowed`)
  }

  const results: BatchQueryResult[] = []
  let currentIndex = 0

  async function processNext(): Promise<void> {
    while (currentIndex < trimmed.length) {
      if (signal.aborted) {
        throw new Error('Aborted')
      }
      const idx = currentIndex++
      const catalogNumber = trimmed[idx]!
      const queryResults = await queryAllPlatforms(catalogNumber, signal)
      results.push({ catalogNumber, results: queryResults })
    }
  }

  const workers = Array.from(
    { length: Math.min(MAX_CONCURRENT_CATALOGS, trimmed.length) },
    () => processNext()
  )

  try {
    await Promise.all(workers)
  } catch (err) {
    if (signal.aborted) {
      emitProgress('query:batch-cancelled', { catalogNumber: '', platform: 'all', status: 'error' })
    }
    throw err
  } finally {
    if (abortController?.signal === signal) {
      abortController = null
    }
  }

  return results
}
