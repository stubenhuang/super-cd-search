import { queryDiscogs } from '../queries/discogs'
import { queryEbay } from '../queries/ebay'
import { queryKojima } from '../queries/kojima'
import { queryHmv } from '../queries/hmv'
import { queryYahoo } from '../queries/yahoo'
import { queryCdjapan } from '../queries/cdjapan'
import { queryTower } from '../queries/tower'
import { queryXianyu } from '../queries/xianyu'
import { queryTaobao } from '../queries/taobao'
import { notFound } from '../queries/types'
import { normalizeCatalogNumber } from '../../shared/utils'
import { PLATFORMS, IMAGE_PLATFORMS, DEFAULT_DEEP_PLATFORMS } from '../../shared/platforms'
import { QueryEvents } from '../../shared/events'
import { logger } from '../logger'
import { downloadImage } from '../image'
import { broadcastToWindows } from '../window-broadcast'
import { flushPlatformTables } from '../feishu/platform-tables'
import { loadArchivedFoundResults } from '../feishu/archived'
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
  broadcastToWindows('query:progress', { event, ...data })
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

/** First cover URL from the text platforms, used as the image-search input. */
function resolveImageSearchCover(results: QueryResult[]): string | null {
  for (const result of results) {
    // Each source already produces an absolute URL via normalizeCoverUrl; this
    // is a final guard so a relative/placeholder URL never reaches Apify.
    if (result.coverUrl && /^https?:\/\//.test(result.coverUrl)) return result.coverUrl
  }
  return null
}

/**
 * Taobao's keyword comes from the phase-one results, in canonical platform
 * order: the first found result's artist/name as "{artist} {name}". Whichever
 * part exists is used; null means no usable identity, so the caller skips the
 * paid search instead of falling back to the (near-useless) catalog number.
 */
function resolveTaobaoKeyword(results: QueryResult[]): string | null {
  const primary = results.find(r => r.status === 'found' && r.name?.trim()) ??
    results.find(r => r.status === 'found')
  const name = primary?.name?.trim() ?? ''
  const artist = primary?.artist?.trim() ?? ''
  const parts: string[] = []
  if (artist && artist !== name) parts.push(artist)
  if (name) parts.push(name)
  return parts.length > 0 ? parts.join(' ') : null
}

/** Build the generic "unknown error" placeholder for one platform. */
function errorResult(platform: Platform, message: string): QueryResult {
  return { platform, name: null, artist: null, priceMin: null, priceMax: null, coverUrl: null, link: null, status: 'error', error: message }
}

/**
 * When Feishu already has a `found` result for this (catalog, platform), return
 * it instead of running the live query. The orchestrator's runPlatformQuery
 * wrapper still emits the usual progress/result events, so a skipped channel is
 * indistinguishable from a freshly completed one in the UI.
 */
function queryOrArchived(
  catalogNumber: string,
  platform: Platform,
  archived: Map<Platform, QueryResult>,
  query: () => Promise<QueryResult>
): () => Promise<QueryResult> {
  const hit = archived.get(platform)
  if (!hit) return query
  logger.debug('orchestrator', 'reusing archived result', { catalogNumber, platform })
  return () => Promise.resolve(hit)
}

async function queryAllPlatforms(
  catalogNumber: string,
  signal: AbortSignal,
  enabledPlatforms: Platform[],
  archived: Map<Platform, QueryResult> = new Map()
): Promise<QueryResult[]> {
  const catalogStartedAt = Date.now()
  if (signal.aborted) {
    logger.debug('orchestrator', 'query aborted before start', { catalogNumber })
    throw new Error('Aborted')
  }

  logger.debug('orchestrator', 'query all platforms start', { catalogNumber, platforms: enabledPlatforms })
  emitProgress(QueryEvents.START, { catalogNumber, platform: 'all', status: 'loading' })

  // Full text registry in canonical order; filter down to the user's selection.
  const registry: Array<{ name: Platform; query: () => Promise<QueryResult> }> = [
    { name: 'discogs', query: () => queryDiscogs(catalogNumber, signal) },
    { name: 'ebay', query: () => queryEbay(catalogNumber, signal) },
    { name: 'kojima', query: () => queryKojima(catalogNumber, signal) },
    { name: 'hmv', query: () => queryHmv(catalogNumber, signal) },
    { name: 'yahoo', query: () => queryYahoo(catalogNumber, signal) },
    { name: 'cdjapan', query: () => queryCdjapan(catalogNumber, signal) },
    { name: 'tower', query: () => queryTower(catalogNumber, signal) }
  ]

  const enabledText = registry.filter(p => enabledPlatforms.includes(p.name))
  const enabledImages = IMAGE_PLATFORMS.filter(p => enabledPlatforms.includes(p))
  // Taobao needs the album/artist from phase one, so it also runs in phase two.
  const enabledTaobao = enabledPlatforms.includes('taobao')

  // Phase one: run every text platform concurrently; the browser pool and
  // per-domain throttles act as natural concurrency limits.
  const settled = await Promise.allSettled(
    enabledText.map(({ name, query }) =>
      runPlatformQuery(catalogNumber, signal, name, queryOrArchived(catalogNumber, name, archived, query))
    )
  )

  if (signal.aborted) {
    logger.debug('orchestrator', 'query all platforms aborted', { catalogNumber, durationMs: Date.now() - catalogStartedAt })
    throw new Error('Aborted')
  }

  const textResults: QueryResult[] = enabledText.map((platform, index) => {
    const outcome = settled[index]
    if (outcome && outcome.status === 'fulfilled') {
      return outcome.value
    }
    const message = outcome && 'reason' in outcome
      ? (outcome.reason instanceof Error ? outcome.reason.message : 'Unknown error')
      : 'Unknown error'
    return errorResult(platform.name, message)
  })

  // Phase two: Xianyu needs a cover image and Taobao needs the album/artist,
  // both collected from the phase-one results above (which may themselves be
  // archived results). They run concurrently and abort-aware. A channel already
  // found in Feishu skips its prerequisite entirely; a missing prerequisite
  // produces an uncached not_found result so a transient gap never sticks.
  let phaseTwoResults: QueryResult[] = []
  if ((enabledImages.length > 0 || enabledTaobao) && !signal.aborted) {
    // Only download a cover / resolve a keyword for channels we must query.
    const needCover = enabledImages.some(name => !archived.has(name))
    const coverUrl = needCover ? resolveImageSearchCover(textResults) : null
    const downloaded = coverUrl ? await downloadImage(coverUrl, 1000) : null
    if (signal.aborted) {
      logger.debug('orchestrator', 'query aborted while downloading cover', { catalogNumber, durationMs: Date.now() - catalogStartedAt })
      throw new Error('Aborted')
    }
    const imageBase64 = downloaded?.base64 ?? null
    const keyword = enabledTaobao && !archived.has('taobao')
      ? resolveTaobaoKeyword(textResults)
      : null

    const entries: Array<{ name: Platform; query: () => Promise<QueryResult> }> = []
    for (const name of enabledImages) {
      const hit = archived.get(name)
      if (hit) {
        // Still routed through runPlatformQuery so the UI gets progress events.
        entries.push({ name, query: () => Promise.resolve(hit) })
        continue
      }
      if (!imageBase64) {
        const error = coverUrl ? '封面图下载失败，无法执行以图搜物' : '无可用封面图，无法执行以图搜物'
        phaseTwoResults.push({ ...notFound(name), error })
        continue
      }
      const base64 = imageBase64
      entries.push({ name, query: () => queryXianyu(catalogNumber, base64, signal) })
    }
    if (enabledTaobao) {
      const hit = archived.get('taobao')
      if (hit) {
        entries.push({ name: 'taobao', query: () => Promise.resolve(hit) })
      } else if (!keyword) {
        phaseTwoResults.push({ ...notFound('taobao'), error: '无可用专辑信息，无法执行淘宝搜索' })
      } else {
        const kw = keyword
        entries.push({ name: 'taobao', query: () => queryTaobao(catalogNumber, kw, signal) })
      }
    }

    const settled = await Promise.allSettled(
      entries.map(({ name, query }) => runPlatformQuery(catalogNumber, signal, name, query))
    )
    phaseTwoResults.push(...entries.map(({ name }, index) => {
      const outcome = settled[index]
      if (outcome && outcome.status === 'fulfilled') return outcome.value
      const message = outcome && 'reason' in outcome
        ? (outcome.reason instanceof Error ? outcome.reason.message : 'Unknown error')
        : 'Unknown error'
      return errorResult(name, message)
    }))
  }

  if (signal.aborted) {
    logger.debug('orchestrator', 'query all platforms aborted', { catalogNumber, durationMs: Date.now() - catalogStartedAt })
    throw new Error('Aborted')
  }

  // Keep results in the canonical platform order regardless of completion order.
  const byPlatform = new Map<Platform, QueryResult>()
  for (const result of [...textResults, ...phaseTwoResults]) byPlatform.set(result.platform, result)
  const results: QueryResult[] = PLATFORMS
    .filter(p => enabledPlatforms.includes(p))
    .map(p => byPlatform.get(p) ?? errorResult(p, 'Unknown error'))

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

// Default to the free text platforms. Taobao is a paid Apify source and must
// stay opt-in even though it is now a text/catalog-number platform.
export async function executeBatchQuery(catalogNumbers: string[], platforms: Platform[] = DEFAULT_DEEP_PLATFORMS): Promise<BatchQueryResult[]> {
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

    // One batch-level Feishu read before any network query starts. Only `found`
    // channels come back; a disabled/failed/offline Feishu returns an empty map
    // and the batch falls back to the ordinary live-query path.
    const archivedFound = await loadArchivedFoundResults(trimmed, signal)
    logger.debug('orchestrator', 'archived lookup done', {
      catalogsWithArchive: archivedFound.size,
      durationMs: Date.now() - batchStartedAt
    })

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
          const queryResults = await queryAllPlatforms(
            catalogNumber,
            signal,
            platforms,
            archivedFound.get(catalogNumber)
          )
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
    // A cancelled batch writes nothing; the flush is fire-and-forget and never
    // blocks this return. Only raw items from completed catalogs are archived.
    if (!signal.aborted) flushPlatformTables(completed)
    return completed
  } finally {
    batchQueryRunning = false
    if (abortController?.signal === signal) {
      abortController = null
    }
  }
}
