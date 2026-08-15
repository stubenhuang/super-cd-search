import { BrowserWindow } from 'electron'
import { queryDiscogs } from '../queries/discogs'
import { queryEbay } from '../queries/ebay'
import { queryKojima } from '../queries/kojima'
import { queryHmv } from '../queries/hmv'
import { queryYahoo } from '../queries/yahoo'
import { queryCdjapan } from '../queries/cdjapan'
import { queryTower } from '../queries/tower'
import { querySurugaya } from '../queries/surugaya'
import { queryZenmarket } from '../queries/zenmarket'
import { normalizeCatalogNumber } from '../../shared/utils'
import { PLATFORMS } from '../../shared/platforms'
import { QueryEvents } from '../../shared/events'
import { logger } from '../logger'
import type { QueryResult, BatchQueryProgress, BatchQueryResult, Platform } from '../../shared/types'

const MAX_CONCURRENT_CATALOGS = 3
const MAX_CATALOG_NUMBERS = 10

export type { BatchQueryProgress, BatchQueryResult }

let abortController: AbortController | null = null

function emitProgress(event: string, data: BatchQueryProgress): void {
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    win.webContents.send('query:progress', { event, ...data })
  }
}

async function queryAllPlatforms(catalogNumber: string, signal: AbortSignal, enabledPlatforms: Platform[]): Promise<QueryResult[]> {
  const catalogStartedAt = Date.now()
  if (signal.aborted) {
    logger.debug('orchestrator', 'query aborted before start', { catalogNumber })
    throw new Error('Aborted')
  }

  logger.debug('orchestrator', 'query all platforms start', { catalogNumber, platforms: enabledPlatforms })
  emitProgress(QueryEvents.START, { catalogNumber, platform: 'all', status: 'loading' })

  // Full registry in canonical order; filter down to the user's selection.
  const registry: Array<{ name: Platform; query: () => Promise<QueryResult> }> = [
    { name: 'discogs', query: () => queryDiscogs(catalogNumber) },
    { name: 'ebay', query: () => queryEbay(catalogNumber) },
    { name: 'kojima', query: () => queryKojima(catalogNumber) },
    { name: 'hmv', query: () => queryHmv(catalogNumber) },
    { name: 'yahoo', query: () => queryYahoo(catalogNumber) },
    { name: 'cdjapan', query: () => queryCdjapan(catalogNumber) },
    { name: 'tower', query: () => queryTower(catalogNumber) },
    { name: 'surugaya', query: () => querySurugaya(catalogNumber) },
    { name: 'zenmarket', query: () => queryZenmarket(catalogNumber) }
  ]

  const platforms = registry.filter(p => enabledPlatforms.includes(p.name))

  // Run every platform concurrently; the browser pool and per-domain throttles
  // act as natural concurrency limits.
  const settled = await Promise.allSettled(
    platforms.map(async ({ name, query }) => {
      const platformStartedAt = Date.now()
      if (signal.aborted) {
        logger.debug('orchestrator', 'platform query aborted', { catalogNumber, platform: name })
        emitProgress(QueryEvents.CANCELLED, { catalogNumber, platform: name, status: 'error' })
        throw new Error('Aborted')
      }

      logger.debug('orchestrator', 'platform query start', { catalogNumber, platform: name })
      emitProgress(QueryEvents.PROGRESS, { catalogNumber, platform: name, status: 'loading' })
      try {
        const result = await query()
        if (signal.aborted) {
          logger.debug('orchestrator', 'platform query aborted after completion', { catalogNumber, platform: name })
          emitProgress(QueryEvents.CANCELLED, { catalogNumber, platform: name, status: 'error' })
          throw new Error('Aborted')
        }
        logger.debug('orchestrator', 'platform query done', {
          catalogNumber,
          platform: name,
          status: result.status,
          durationMs: Date.now() - platformStartedAt,
          hasName: !!result.name,
          hasPrice: result.priceMin !== null
        })
        emitProgress(QueryEvents.PROGRESS, { catalogNumber, platform: name, status: result.status === 'found' ? 'complete' : result.status })
        emitProgress(QueryEvents.RESULT, { catalogNumber, platform: name, status: result.status, results: [result] })
        return result
      } catch (err) {
        if (signal.aborted) {
          emitProgress(QueryEvents.CANCELLED, { catalogNumber, platform: name, status: 'error' })
          throw new Error('Aborted')
        }
        const message = err instanceof Error ? err.message : 'Unknown error'
        logger.warn('orchestrator', 'platform query threw', { catalogNumber, platform: name, error: message, durationMs: Date.now() - platformStartedAt })
        emitProgress(QueryEvents.ERROR, { catalogNumber, platform: name, status: 'error' })
        const errorResult: QueryResult = { platform: name, name: null, artist: null, priceMin: null, priceMax: null, coverUrl: null, link: null, status: 'error', error: message }
        emitProgress(QueryEvents.RESULT, { catalogNumber, platform: name, status: 'error', results: [errorResult] })
        return errorResult
      }
    })
  )

  if (signal.aborted) {
    logger.debug('orchestrator', 'query all platforms aborted', { catalogNumber, durationMs: Date.now() - catalogStartedAt })
    throw new Error('Aborted')
  }

  // Keep results in the canonical platform order regardless of completion order.
  const results: QueryResult[] = platforms.map((platform, index) => {
    const outcome = settled[index]
    if (outcome && outcome.status === 'fulfilled') {
      return outcome.value
    }
    const message = outcome && 'reason' in outcome
      ? (outcome.reason instanceof Error ? outcome.reason.message : 'Unknown error')
      : 'Unknown error'
    return { platform: platform.name, name: null, artist: null, priceMin: null, priceMax: null, coverUrl: null, link: null, status: 'error', error: message }
  })

  logger.debug('orchestrator', 'query all platforms complete', {
    catalogNumber,
    durationMs: Date.now() - catalogStartedAt,
    statuses: results.map(r => `${r.platform}:${r.status}`)
  })
  emitProgress(QueryEvents.COMPLETE, { catalogNumber, platform: 'all', status: 'complete' })

  return results
}

export function cancelBatchQuery(): void {
  if (abortController) {
    logger.debug('orchestrator', 'cancel batch query requested')
    abortController.abort()
    abortController = null
  }
}

export async function executeBatchQuery(catalogNumbers: string[], platforms: Platform[] = PLATFORMS): Promise<BatchQueryResult[]> {
  const batchStartedAt = Date.now()
  logger.debug('orchestrator', 'execute batch query start', { requestedCatalogNumbers: catalogNumbers, platforms })
  if (abortController) {
    logger.debug('orchestrator', 'aborting previous batch query before starting a new one')
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

  if (platforms.length === 0) {
    throw new Error('No platforms selected')
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
        const queryResults = await queryAllPlatforms(catalogNumber, signal, platforms)
        results[idx] = { catalogNumber, results: queryResults }
      } catch {
        // Continue processing next catalog even if this one failed
        if (signal.aborted) {
          return
        }
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
    logger.debug('orchestrator', 'batch query cancelled', { durationMs: Date.now() - batchStartedAt })
    emitProgress(QueryEvents.BATCH_CANCELLED, { catalogNumber: '', platform: 'all', status: 'error' })
  }

  const completed = results.filter(r => r !== undefined)
  logger.debug('orchestrator', 'execute batch query complete', {
    catalogCount: completed.length,
    durationMs: Date.now() - batchStartedAt,
    cancelled: signal.aborted
  })
  return completed
}
