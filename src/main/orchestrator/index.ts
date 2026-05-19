import { BrowserWindow } from 'electron'
import { getDatabase } from '../database'
import { queryDiscogs } from '../queries/discogs'
import { queryEbay } from '../queries/ebay'
import { queryKojima } from '../queries/kojima'
import type { QueryResult, BatchQueryProgress, BatchQueryResult } from '../../shared/types'

const MAX_CONCURRENT_CATALOGS = 3
const MAX_CATALOG_NUMBERS = 10

export type { BatchQueryProgress, BatchQueryResult }

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

async function queryAllPlatforms(catalogNumber: string): Promise<QueryResult[]> {
  emitProgress('query:start', { catalogNumber, platform: 'all', status: 'loading' })

  const platforms: Array<{ name: string; query: () => Promise<QueryResult> }> = [
    { name: 'discogs', query: () => queryDiscogs(catalogNumber) },
    { name: 'ebay', query: () => queryEbay(catalogNumber) },
    { name: 'kojima', query: () => queryKojima(catalogNumber) }
  ]

  const results = await Promise.all(
    platforms.map(async ({ name, query }) => {
      emitProgress('query:progress', { catalogNumber, platform: name, status: 'loading' })
      try {
        const result = await query()
        emitProgress('query:progress', { catalogNumber, platform: name, status: result.status === 'found' ? 'complete' : result.status })
        return result
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        emitProgress('query:error', { catalogNumber, platform: name, status: 'error' })
        return { platform: name as QueryResult['platform'], name: null, artist: null, priceMin: null, priceMax: null, coverUrl: null, link: null, status: 'error' as const, error: message }
      }
    })
  )

  saveResults(catalogNumber, results)
  emitProgress('query:complete', { catalogNumber, platform: 'all', status: 'complete' })

  return results
}

export async function executeBatchQuery(catalogNumbers: string[]): Promise<BatchQueryResult[]> {
  const trimmed = catalogNumbers.map(c => c.trim()).filter(c => c.length > 0)

  if (trimmed.length === 0) {
    throw new Error('No catalog numbers provided')
  }

  if (trimmed.length > MAX_CATALOG_NUMBERS) {
    throw new Error(`Maximum ${MAX_CATALOG_NUMBERS} catalog numbers allowed`)
  }

  const results: BatchQueryResult[] = []

  const queue = [...trimmed]

  async function processNext(): Promise<void> {
    while (queue.length > 0) {
      const catalogNumber = queue.shift()!
      const queryResults = await queryAllPlatforms(catalogNumber)
      results.push({ catalogNumber, results: queryResults })
    }
  }

  const workers = Array.from(
    { length: Math.min(MAX_CONCURRENT_CATALOGS, trimmed.length) },
    () => processNext()
  )

  await Promise.all(workers)

  return results
}
