import { BrowserWindow } from 'electron'
import { getDatabase } from '../database'
import { queryDiscogs } from '../queries/discogs'
import { queryEbay } from '../queries/ebay'
import { queryKojima } from '../queries/kojima'
import { queryHmv } from '../queries/hmv'
import { normalizeCatalogNumber } from '../../shared/utils'
import { QueryEvents } from '../../shared/events'
import type { QueryResult, BatchQueryProgress, BatchQueryResult } from '../../shared/types'

const MAX_CONCURRENT_CATALOGS = 3
const MAX_CATALOG_NUMBERS = 10

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

async function queryAllPlatforms(catalogNumber: string, signal: AbortSignal, includeKojima = true): Promise<QueryResult[]> {
  if (signal.aborted) {
    throw new Error('Aborted')
  }

  emitProgress(QueryEvents.START, { catalogNumber, platform: 'all', status: 'loading' })

  const platforms: Array<{ name: string; query: () => Promise<QueryResult> }> = [
    { name: 'discogs', query: () => queryDiscogs(catalogNumber) },
    { name: 'ebay', query: () => queryEbay(catalogNumber) },
    ...(includeKojima ? [{ name: 'kojima' as const, query: () => queryKojima(catalogNumber) }] : []),
    { name: 'hmv', query: () => queryHmv(catalogNumber) }
  ]

  const results: QueryResult[] = []

  for (const { name, query } of platforms) {
    if (signal.aborted) {
      emitProgress(QueryEvents.CANCELLED, { catalogNumber, platform: name, status: 'error' })
      throw new Error('Aborted')
    }

    emitProgress(QueryEvents.PROGRESS, { catalogNumber, platform: name, status: 'loading' })
    try {
      const result = await query()
      emitProgress(QueryEvents.PROGRESS, { catalogNumber, platform: name, status: result.status === 'found' ? 'complete' : result.status })
      results.push(result)
      emitProgress(QueryEvents.RESULT, { catalogNumber, platform: name, status: result.status, results: [result] })
    } catch (err) {
      if (signal.aborted) {
        emitProgress(QueryEvents.CANCELLED, { catalogNumber, platform: name, status: 'error' })
        throw new Error('Aborted')
      }
      const message = err instanceof Error ? err.message : 'Unknown error'
      emitProgress(QueryEvents.ERROR, { catalogNumber, platform: name, status: 'error' })
      const errorResult = { platform: name as QueryResult['platform'], name: null, artist: null, priceMin: null, priceMax: null, coverUrl: null, link: null, status: 'error' as const, error: message }
      results.push(errorResult)
      emitProgress(QueryEvents.RESULT, { catalogNumber, platform: name, status: 'error', results: [errorResult] })
    }
  }

  if (!signal.aborted) {
    saveResults(catalogNumber, results)
    emitProgress(QueryEvents.COMPLETE, { catalogNumber, platform: 'all', status: 'complete' })
  }

  return results
}

export function cancelBatchQuery(): void {
  if (abortController) {
    abortController.abort()
    abortController = null
  }
}

export async function executeBatchQuery(catalogNumbers: string[], includeKojima = true): Promise<BatchQueryResult[]> {
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

  const results: BatchQueryResult[] = new Array(trimmed.length)
  let currentIndex = 0

  async function processNext(): Promise<void> {
    while (currentIndex < trimmed.length) {
      if (signal.aborted) {
        return
      }
      const idx = currentIndex++
      const catalogNumber = trimmed[idx]!
      try {
        const queryResults = await queryAllPlatforms(catalogNumber, signal, includeKojima)
        results[idx] = { catalogNumber, results: queryResults }
      } catch {
        return
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(MAX_CONCURRENT_CATALOGS, trimmed.length) },
    () => processNext()
  )

  await Promise.all(workers)

  if (abortController?.signal === signal) {
    abortController = null
  }

  if (signal.aborted) {
    emitProgress(QueryEvents.BATCH_CANCELLED, { catalogNumber: '', platform: 'all', status: 'error' })
  }

  return results.filter(r => r !== undefined)
}
