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
import { queryXianyu } from '../queries/xianyu'
import { queryTaobaoImage } from '../queries/taobao'
import { notFound } from '../queries/types'
import { getEmbeddedLibraryImage } from '../library'
import { downloadImage } from '../image'
import { throwIfAborted } from '../browser/abort'
import { normalizeCatalogNumber } from '../../shared/utils'
import { SEARCH_PLATFORMS } from '../../shared/platforms'
import { QueryEvents } from '../../shared/events'
import { logger } from '../logger'
import type { QueryResult, BatchQueryProgress, BatchQueryResult, Platform } from '../../shared/types'

const MAX_CONCURRENT_CATALOGS = 3
const MAX_CATALOG_NUMBERS = 10

export type { BatchQueryProgress, BatchQueryResult }

let abortController: AbortController | null = null
let batchQueryRunning = false

/** Whether a batch query is currently executing in the main process. */
export function isBatchQueryRunning(): boolean {
  return batchQueryRunning
}

function emitProgress(event: string, data: BatchQueryProgress): void {
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    win.webContents.send('query:progress', { event, ...data })
  }
}

/**
 * Shared per-platform wrapper: progress events, abort checks and error
 * containment so one platform's failure never takes down the batch.
 */
async function runPlatformQuery(
  catalogNumber: string,
  signal: AbortSignal,
  name: Platform,
  query: () => Promise<QueryResult>
): Promise<QueryResult> {
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
}

/**
 * Cover art for the Taobao image-search channel: the library's embedded cover
 * wins; otherwise fall back to the first cover URL returned by the text
 * platforms (downloaded and resized through the image cache).
 */
async function resolveTaobaoSearchImage(
  catalogNumber: string,
  textResults: QueryResult[],
  signal: AbortSignal
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  throwIfAborted(signal)
  const embedded = getEmbeddedLibraryImage(catalogNumber)
  if (embedded) {
    logger.debug('orchestrator', 'taobao image source: library', { catalogNumber })
    return { buffer: embedded.buffer, mimeType: embedded.mimeType }
  }
  for (const result of textResults) {
    if (!result.coverUrl) continue
    const downloaded = await downloadImage(result.coverUrl, 500, true)
    if (!downloaded) continue
    logger.debug('orchestrator', 'taobao image source: search cover', { catalogNumber, platform: result.platform })
    return { buffer: Buffer.from(downloaded.base64, 'base64'), mimeType: downloaded.mimeType }
  }
  logger.debug('orchestrator', 'taobao image source: none', { catalogNumber })
  return null
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
    { name: 'discogs', query: () => queryDiscogs(catalogNumber, signal) },
    { name: 'ebay', query: () => queryEbay(catalogNumber, signal) },
    { name: 'kojima', query: () => queryKojima(catalogNumber, signal) },
    { name: 'hmv', query: () => queryHmv(catalogNumber, signal) },
    { name: 'yahoo', query: () => queryYahoo(catalogNumber, signal) },
    { name: 'cdjapan', query: () => queryCdjapan(catalogNumber, signal) },
    { name: 'tower', query: () => queryTower(catalogNumber, signal) },
    { name: 'surugaya', query: () => querySurugaya(catalogNumber, signal) },
    { name: 'zenmarket', query: () => queryZenmarket(catalogNumber, signal) },
    { name: 'xianyu', query: () => queryXianyu(catalogNumber, signal) }
  ]

  const platforms = registry.filter(p => enabledPlatforms.includes(p.name))

  // Run every platform concurrently; the browser pool and per-domain throttles
  // act as natural concurrency limits.
  const settled = await Promise.allSettled(
    platforms.map(({ name, query }) => runPlatformQuery(catalogNumber, signal, name, query))
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

  // Phase two: the Taobao image-search channel needs the cover art collected
  // by the text platforms above, so it runs after them, still abort-aware.
  if (enabledPlatforms.includes('taobao')) {
    const taobaoResult = await runPlatformQuery(catalogNumber, signal, 'taobao', async () => {
      const image = await resolveTaobaoSearchImage(catalogNumber, results, signal)
      if (!image) {
        return { ...notFound('taobao'), error: '无可用封面图，无法执行淘宝图搜' }
      }
      return queryTaobaoImage(catalogNumber, image, signal)
    })
    results.push(taobaoResult)
  }

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

export async function executeBatchQuery(catalogNumbers: string[], platforms: Platform[] = SEARCH_PLATFORMS): Promise<BatchQueryResult[]> {
  const batchStartedAt = Date.now()
  logger.debug('orchestrator', 'execute batch query start', { requestedCatalogNumbers: catalogNumbers, platforms })
  if (abortController) {
    logger.debug('orchestrator', 'aborting previous batch query before starting a new one')
    abortController.abort()
  }
  abortController = new AbortController()
  const signal = abortController.signal

  batchQueryRunning = true
  try {
    const trimmed = [...new Set(
      catalogNumbers.map(c => normalizeCatalogNumber(c)).filter(c => c.length > 0)
    )]

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
  } finally {
    batchQueryRunning = false
    if (abortController?.signal === signal) {
      abortController = null
    }
  }
}
