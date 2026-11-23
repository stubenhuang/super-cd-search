import type { ApifySettings } from '../../shared/types'
import { DEFAULT_APIFY_SETTINGS } from '../../shared/apify'
import { getSetting } from '../settings'
import { createAbortError, throwIfAborted, abortableDelay, withTimeout } from '../browser/abort'
import { logger } from '../logger'

const APIFY_API_BASE = 'https://api.apify.com/v2'
const REQUEST_TIMEOUT_MS = 60_000
const SYNC_TIMEOUT_SECONDS = 60
/** Client deadline for the sync call, slightly above the Actor-side timeout. */
const SYNC_REQUEST_TIMEOUT_MS = (SYNC_TIMEOUT_SECONDS + 5) * 1000
const POLL_INTERVAL_MS = 2_000
const XIANYU_DETAIL_LEVEL = 'summary'
/** Rank visual matches by similarity so the first item is the closest match. */
const XIANYU_SORT_BY = 'relevance'

/** A single listing returned by either image-search actor, normalized. */
export interface ApifyListing {
  title: string | null
  /** Price in CNY; null when the actor did not return a usable price. */
  priceCNY: number | null
  url: string | null
  coverUrl: string | null
}

export type ApifyErrorCode = 'missing_token' | 'http' | 'run_failed' | 'invalid_response'

export class ApifyClientError extends Error {
  readonly code: ApifyErrorCode

  constructor(message: string, code: ApifyErrorCode) {
    super(message)
    this.name = 'ApifyClientError'
    this.code = code
  }
}

interface ApifyFetchOptions {
  method: 'GET' | 'POST'
  body?: Record<string, unknown>
  signal?: AbortSignal
  timeoutMs?: number
}

/**
 * One call to the Apify REST API. The token travels only in the Authorization
 * header — never in the URL — so it cannot leak into logs. A private controller
 * combines the per-request deadline with the caller's (batch) signal.
 */
async function apifyFetch<T>(path: string, token: string, options: ApifyFetchOptions): Promise<T> {
  const { method, body, signal, timeoutMs = REQUEST_TIMEOUT_MS } = options
  const startedAt = Date.now()
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  const onExternalAbort = () => controller.abort()
  signal?.addEventListener('abort', onExternalAbort, { once: true })

  try {
    throwIfAborted(signal)
    const response = await fetch(`${APIFY_API_BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    })

    logger.debug('apify', 'request response', { path, method, status: response.status, durationMs: Date.now() - startedAt })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      if (response.status === 401 || response.status === 403) {
        throw new ApifyClientError('Apify Token 无效或已过期，请在设置中检查', 'http')
      }
      if (response.status === 429) {
        throw new ApifyClientError('Apify 请求过于频繁，请稍后重试', 'http')
      }
      throw new ApifyClientError(`Apify API ${response.status}: ${errorText.slice(0, 200)}`, 'http')
    }

    try {
      return await response.json() as T
    } catch {
      throw new ApifyClientError('Apify 返回了无效的 JSON 响应', 'invalid_response')
    }
  } catch (err) {
    if (signal?.aborted) throw createAbortError()
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApifyClientError('Apify 请求超时，请稍后重试', 'http')
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
    signal?.removeEventListener('abort', onExternalAbort)
  }
}

/** Read the stored config, filling in defaults for keys never saved. */
function apifySettings(): ApifySettings {
  return { ...DEFAULT_APIFY_SETTINGS, ...(getSetting('apify') as ApifySettings | undefined) }
}

function requireToken(settings: ApifySettings): string {
  const token = settings.token?.trim()
  if (!token) {
    throw new ApifyClientError('请先在设置的「Apify」分区配置 Token，才能使用以图搜物', 'missing_token')
  }
  return token
}

/** Apify actor ids use `~` in the REST path; accept the slash form too. */
function actorPath(actorId: string): string {
  return encodeURIComponent(actorId.trim().replace(/\//g, '~'))
}

/** Accept bare rows, a wrapper object with products/items/data, or a single row. */
function toRows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (!raw || typeof raw !== 'object') return []
  const obj = raw as Record<string, unknown>
  for (const key of ['products', 'items', 'data']) {
    if (Array.isArray(obj[key])) return obj[key] as unknown[]
  }
  return [obj]
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** Prices arrive as numbers or strings like `¥1,234` / `88元`. */
export function parsePriceCNY(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null
  if (typeof value !== 'string') return null
  const parsed = parseFloat(value.replace(/[¥￥,\s元]/g, ''))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function normalizeHttpUrl(value: unknown): string | null {
  const raw = readString(value)
  if (!raw) return null
  if (raw.startsWith('//')) return `https:${raw}`
  if (raw.startsWith('http://')) return `https://${raw.slice('http://'.length)}`
  return raw
}

/**
 * Flatten the two actors' differently-shaped outputs into one ordered list.
 * The actor's own ordering is treated as the match ranking, so `listings[0]`
 * is the best match.
 */
export function normalizeListings(raw: unknown): ApifyListing[] {
  const listings: ApifyListing[] = []
  for (const row of toRows(raw)) {
    if (!row || typeof row !== 'object') continue
    const obj = row as Record<string, unknown>
    const images = Array.isArray(obj.images) ? obj.images : Array.isArray(obj.imageGallery) ? obj.imageGallery : []
    const coverCandidate = obj.imageUrl ?? obj.coverUrl ?? images[0] ?? null
    const title = readString(obj.title)
    const priceCNY = parsePriceCNY(obj.price ?? obj.priceText)
    const url = normalizeHttpUrl(obj.productUrl ?? obj.itemUrl ?? obj.url ?? obj.link)
    const coverUrl = normalizeHttpUrl(coverCandidate)
    if (!title && priceCNY === null && !url) continue
    listings.push({ title, priceCNY, url, coverUrl })
  }
  return listings
}

interface ActorRun {
  data?: {
    id?: string
    defaultDatasetId?: string
    status?: string
    statusMessage?: string
  }
}

/**
 * Taobao actor is fast enough for a synchronous run: one POST returns the
 * default dataset items directly. The cover image is supplied as raw base64.
 */
export async function searchTaobaoByImage(imageBase64: string, signal?: AbortSignal): Promise<ApifyListing[]> {
  const settings = apifySettings()
  const token = requireToken(settings)
  const path = `/acts/${actorPath(settings.taobaoActor)}/run-sync-get-dataset-items?timeout=${SYNC_TIMEOUT_SECONDS}`
  logger.debug('apify', 'taobao image search start', { actor: settings.taobaoActor })
  const raw = await apifyFetch<unknown>(path, token, {
    method: 'POST',
    body: { imageBase64, num: settings.num },
    signal,
    timeoutMs: SYNC_REQUEST_TIMEOUT_MS
  })
  const listings = normalizeListings(raw)
  logger.debug('apify', 'taobao image search complete', { actor: settings.taobaoActor, count: listings.length })
  return listings
}

/**
 * Xianyu actor often runs longer than the synchronous endpoint allows: start
 * a run, poll its status, then read the default dataset. The whole chain is
 * bounded by one wall-clock timeout and stays abortable so cancelling a batch
 * stops both polling and billing.
 */
export async function searchXianyuByImage(imageBase64: string, signal?: AbortSignal): Promise<ApifyListing[]> {
  const settings = apifySettings()
  const token = requireToken(settings)
  const actorPathSegment = actorPath(settings.xianyuActor)

  return withTimeout(
    async (runSignal) => {
      const started = await apifyFetch<ActorRun>(`/acts/${actorPathSegment}/runs`, token, {
        method: 'POST',
        body: {
          imageBase64,
          maxItems: settings.maxItems,
          detailLevel: XIANYU_DETAIL_LEVEL,
          sortBy: XIANYU_SORT_BY
        },
        signal: runSignal
      })
      const runId = started.data?.id
      const datasetId = started.data?.defaultDatasetId
      if (!runId || !datasetId) {
        throw new ApifyClientError('闲鱼图搜未返回有效的运行 ID', 'invalid_response')
      }

      logger.debug('apify', 'xianyu run started', { actor: settings.xianyuActor, runId })
      let status = started.data?.status ?? 'READY'
      let statusMessage = ''
      while (status !== 'SUCCEEDED' && status !== 'FAILED' && status !== 'ABORTED' && status !== 'TIMED-OUT') {
        await abortableDelay(POLL_INTERVAL_MS, runSignal)
        throwIfAborted(runSignal)
        const run = await apifyFetch<ActorRun>(`/actor-runs/${encodeURIComponent(runId)}`, token, {
          method: 'GET',
          signal: runSignal
        })
        status = run.data?.status ?? status
        statusMessage = run.data?.statusMessage ?? ''
        logger.debug('apify', 'xianyu run poll', { runId, status })
      }

      const itemsPath = `/datasets/${encodeURIComponent(datasetId)}/items`
      if (status === 'FAILED') {
        throw new ApifyClientError(`闲鱼图搜运行失败：${statusMessage || 'FAILED'}`, 'run_failed')
      }
      // TIMED-OUT / ABORTED runs can still hold partial rows; surface them.
      const raw = await apifyFetch<unknown>(itemsPath, token, { method: 'GET', signal: runSignal })
      const listings = normalizeListings(raw)
      logger.debug('apify', 'xianyu image search complete', { runId, status, count: listings.length })
      if (listings.length === 0 && status !== 'SUCCEEDED') {
        throw new ApifyClientError(`闲鱼图搜运行${status}，未返回可用结果`, 'run_failed')
      }
      return listings
    },
    settings.timeoutMs,
    `闲鱼图搜超过 ${Math.round(settings.timeoutMs / 1000)} 秒未完成，请稍后重试`,
    signal
  )
}
