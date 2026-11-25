import type { ApifySettings } from '../../shared/types'
import { resolveApifySettings } from '../../shared/apify'
import { getSetting } from '../settings'
import { createAbortError, throwIfAborted, abortableDelay, withTimeout } from '../browser/abort'
import { logger } from '../logger'

const APIFY_API_BASE = 'https://api.apify.com/v2'
const REQUEST_TIMEOUT_MS = 60_000
const POLL_INTERVAL_MS = 2_000
/** Idempotent reads may be retried; a POST /runs must never be (paid duplicate run). */
const MAX_NETWORK_ATTEMPTS = 3
const NETWORK_RETRY_BACKOFF_MS = 500
const XIANYU_DETAIL_LEVEL = 'summary'
/** Rank visual matches by similarity so the first item is the closest match. */
const XIANYU_SORT_BY = 'relevance'

const ACTOR_LABELS = { taobao: '淘宝', xianyu: '闲鱼' } as const

/** A single listing returned by either image-search actor, normalized. */
export interface ApifyListing {
  title: string | null
  /** Price in CNY; null when the actor did not return a usable price. */
  priceCNY: number | null
  url: string | null
  coverUrl: string | null
}

export type ApifyErrorCode = 'missing_token' | 'http' | 'run_failed' | 'invalid_response' | 'network'

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
  /** Source name used to make permission errors actionable. */
  actorLabel?: string
}

interface ApifyErrorPayload {
  error?: {
    type?: unknown
    message?: unknown
    data?: { approvalUrl?: unknown }
  }
}

/**
 * Apify reports failures as `{ error: { type, message, data } }`. The 403 for
 * a full-permission Actor that has not been approved carries a Console URL —
 * keep it so the error can explain what the user must actually do instead of
 * blaming the token.
 */
function parseApifyError(text: string): { type: string | null; message: string | null; approvalUrl: string | null } {
  try {
    const error = (JSON.parse(text) as ApifyErrorPayload)?.error
    const str = (value: unknown): string | null =>
      typeof value === 'string' && value.trim() ? value.trim() : null
    return {
      type: str(error?.type),
      message: str(error?.message),
      approvalUrl: str(error?.data?.approvalUrl)
    }
  } catch {
    return { type: null, message: null, approvalUrl: null }
  }
}

/**
 * undici reports transport-level failures as `TypeError: fetch failed`, with
 * the real reason (ECONNRESET / UND_ERR_SOCKET / ENOTFOUND / ...) in `cause`.
 * Returning null means "not a retryable transport error".
 */
function networkCause(err: unknown): string | null {
  if (!(err instanceof TypeError) || !/fetch failed/i.test(err.message)) return null
  const cause = (err as Error & { cause?: unknown }).cause as
    | (Error & { code?: string; errors?: unknown[] })
    | undefined
  if (!cause) return 'fetch failed'
  if (cause.code) return `${cause.code}: ${cause.message}`
  if (Array.isArray(cause.errors)) {
    const codes = cause.errors
      .map(item => (item as NodeJS.ErrnoException | undefined)?.code)
      .filter((code): code is string => Boolean(code))
    if (codes.length) return codes.join(', ')
  }
  return (cause.message || String(cause)).slice(0, 120)
}

/**
 * A single HTTP attempt. The token travels only in the Authorization header —
 * never in the URL — so it cannot leak into logs. A private controller combines
 * the per-request deadline with the caller's (batch) signal.
 */
async function apifyFetchOnce<T>(path: string, token: string, options: ApifyFetchOptions): Promise<T> {
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
      let errorText = ''
      try {
        errorText = await response.text()
      } catch (err) {
        // A dropped connection (or a cancelled read) while reading the error
        // body is not a plain status code — let the caller retry / classify it.
        if (networkCause(err) || (err instanceof Error && err.name === 'AbortError')) throw err
      }
      const apiError = parseApifyError(errorText)
      const detail = (apiError.message ?? errorText).trim().slice(0, 200)
      logger.debug('apify', 'request failed', { path, method, status: response.status, errorType: apiError.type })

      // 401 really is a bad token; 403 is actor-level (approval/subscription)
      // and must not be reported as an invalid token when other sources work.
      if (response.status === 401) {
        throw new ApifyClientError('Apify Token 无效或已过期，请在设置中检查', 'http')
      }
      if (response.status === 403) {
        const source = options.actorLabel ? `${options.actorLabel}图搜的 Apify Actor` : '该 Apify Actor'
        if (apiError.type === 'full-permission-actor-not-approved') {
          const approvalUrl = apiError.approvalUrl ?? 'https://console.apify.com/actors/?approvePermissions=true'
          throw new ApifyClientError(
            `${source} 需要「完整权限」，Apify 要求先在控制台批准一次（仅首次）：${approvalUrl}`,
            'http'
          )
        }
        throw new ApifyClientError(
          `${source}没有运行权限：${detail || '403 Forbidden'}。请在 Apify 控制台检查是否已订阅/授权该 Actor`,
          'http'
        )
      }
      if (response.status === 429) {
        throw new ApifyClientError('Apify 请求过于频繁，请稍后重试', 'http')
      }
      throw new ApifyClientError(`Apify API ${response.status}: ${detail}`, 'http')
    }

    try {
      return await response.json() as T
    } catch (err) {
      // A connection reset (or cancellation) mid-body is not malformed JSON.
      if (networkCause(err) || (err instanceof Error && err.name === 'AbortError')) throw err
      throw new ApifyClientError('Apify 返回了无效的 JSON 响应', 'invalid_response')
    }
  } finally {
    clearTimeout(timeoutId)
    signal?.removeEventListener('abort', onExternalAbort)
  }
}

/**
 * Reads (run-status polls, dataset items) are idempotent, so a transient
 * `fetch failed` is retried a few times — one dropped poll would otherwise
 * abort an entire paid actor run. The run-start POST is never retried: a lost
 * response could already have started a run and a retry would start a second.
 */
async function apifyFetch<T>(path: string, token: string, options: ApifyFetchOptions): Promise<T> {
  const { method, signal } = options
  const maxAttempts = method === 'GET' ? MAX_NETWORK_ATTEMPTS : 1

  for (let attempt = 1; ; attempt++) {
    try {
      return await apifyFetchOnce<T>(path, token, options)
    } catch (err) {
      const cause = networkCause(err)
      if (signal?.aborted) throw createAbortError()
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ApifyClientError('Apify 请求超时，请稍后重试', 'http')
      }
      if (cause) {
        if (attempt < maxAttempts) {
          logger.warn('apify', 'network error, retrying', { path, method, attempt, cause })
          await abortableDelay(NETWORK_RETRY_BACKOFF_MS * attempt, signal)
          throwIfAborted(signal)
          continue
        }
        logger.warn('apify', 'network request failed', { path, method, cause })
        throw new ApifyClientError(`Apify 网络连接失败（${cause}），请检查网络或代理后重试`, 'network')
      }
      throw err
    }
  }
}

/** Read the stored config, filling in defaults for keys never saved. */
function apifySettings(): ApifySettings {
  return resolveApifySettings(getSetting('apify') as ApifySettings | undefined)
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

/** Accept bare rows, a wrapper object with products/items/data/results, or a single row. */
function toRows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (!raw || typeof raw !== 'object') return []
  const obj = raw as Record<string, unknown>
  for (const key of ['products', 'items', 'data', 'results']) {
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

/** Galleries are string arrays (Taobao) or objects carrying `url` (Xianyu). */
function firstImageUrl(images: unknown[]): unknown {
  const first = images[0]
  if (first && typeof first === 'object') {
    return (first as Record<string, unknown>).url
  }
  return first
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
    const coverCandidate = obj.imageUrl ?? obj.coverUrl ?? obj.pictureUrl ?? firstImageUrl(images)
    const title = readString(obj.title)
    const priceCNY = parsePriceCNY(obj.price ?? obj.priceText ?? obj.priceCny)
    const url = normalizeHttpUrl(obj.productUrl ?? obj.itemUrl ?? obj.url ?? obj.link)
    const coverUrl = normalizeHttpUrl(coverCandidate)
    if (!title && priceCNY === null && !url) continue
    listings.push({ title, priceCNY, url, coverUrl })
  }
  return listings
}

/**
 * The 1688 actor writes SUMMARY / ERRORS diagnostics as rows that have no
 * product identity. They used to be discarded, so a message like "see ERRORS"
 * was a dead end — pull the human-readable reasons out instead.
 */
function datasetDiagnostics(raw: unknown): string | null {
  const parts: string[] = []
  for (const row of toRows(raw)) {
    if (!row || typeof row !== 'object') continue
    const obj = row as Record<string, unknown>
    if (obj.title || obj.price !== undefined || obj.priceCny !== undefined || obj.productUrl || obj.url) continue
    for (const key of ['message', 'error', 'statusMessage', 'errorCode', 'code', 'reason']) {
      const value = obj[key]
      if (typeof value === 'string' && value.trim()) parts.push(value.trim())
    }
    if (obj.success === false) parts.push('success: false')
    const status = obj.status
    if (typeof status === 'string' && /FAILED|INVALID_INPUT|ERROR/i.test(status)) parts.push(status)
  }
  return parts.length ? [...new Set(parts)].join(' | ').slice(0, 400) : null
}

/** SUMMARY / ERRORS are also exposed as records in the run's default KV store. */
async function keyValueDiagnostics(
  kvStoreId: string | undefined,
  token: string,
  signal: AbortSignal
): Promise<string | null> {
  if (!kvStoreId) return null
  const parts: string[] = []
  for (const key of ['ERRORS', 'SUMMARY']) {
    try {
      const record = await apifyFetch<unknown>(
        `/key-value-stores/${encodeURIComponent(kvStoreId)}/records/${key}`,
        token,
        { method: 'GET', signal }
      )
      if (record) parts.push(`${key}: ${JSON.stringify(record).slice(0, 300)}`)
    } catch {
      // Best-effort only: a missing record must not mask the original failure.
    }
  }
  return parts.length ? parts.join(' | ').slice(0, 500) : null
}

function appendDiagnostics(message: string, diagnostics: string | null): string {
  return diagnostics
    ? `${message}（${diagnostics}）`
    : `${message}（详情见 Apify Console 该次运行的 SUMMARY / ERRORS）`
}

interface ActorRun {
  data?: {
    id?: string
    defaultDatasetId?: string
    defaultKeyValueStoreId?: string
    status?: string
    statusMessage?: string
  }
}

/**
 * Both image-search actors run longer than the synchronous endpoint allows:
 * start a run, poll its status, then read the default dataset. The whole chain
 * is bounded by one wall-clock timeout and stays abortable so cancelling a
 * batch stops both polling and billing.
 */
async function runActorImageSearch(
  settings: ApifySettings,
  token: string,
  actorId: string,
  input: Record<string, unknown>,
  logTag: keyof typeof ACTOR_LABELS,
  signal?: AbortSignal
): Promise<ApifyListing[]> {
  const label = ACTOR_LABELS[logTag]
  const actorPathSegment = actorPath(actorId)

  return withTimeout(
    async (runSignal) => {
      const started = await apifyFetch<ActorRun>(`/acts/${actorPathSegment}/runs`, token, {
        method: 'POST',
        body: input,
        signal: runSignal,
        actorLabel: label
      })
      const runId = started.data?.id
      const datasetId = started.data?.defaultDatasetId
      if (!runId || !datasetId) {
        throw new ApifyClientError(`${label}图搜未返回有效的运行 ID`, 'invalid_response')
      }

      logger.debug('apify', `${logTag} run started`, { actor: actorId, runId })
      let status = started.data?.status ?? 'READY'
      // A run can already be FAILED in the start response; keep its message too.
      let statusMessage = started.data?.statusMessage ?? ''
      while (status !== 'SUCCEEDED' && status !== 'FAILED' && status !== 'ABORTED' && status !== 'TIMED-OUT') {
        await abortableDelay(POLL_INTERVAL_MS, runSignal)
        throwIfAborted(runSignal)
        const run = await apifyFetch<ActorRun>(`/actor-runs/${encodeURIComponent(runId)}`, token, {
          method: 'GET',
          signal: runSignal
        })
        status = run.data?.status ?? status
        statusMessage = run.data?.statusMessage ?? ''
        logger.debug('apify', `${logTag} run poll`, { runId, status })
      }

      const itemsPath = `/datasets/${encodeURIComponent(datasetId)}/items`
      const kvStoreId = started.data?.defaultKeyValueStoreId
      if (status === 'FAILED') {
        const diagnostics = await keyValueDiagnostics(kvStoreId, token, runSignal)
        if (diagnostics) logger.warn('apify', `${logTag} run diagnostics`, { runId, status, diagnostics })
        throw new ApifyClientError(
          appendDiagnostics(`${label}图搜运行失败：${statusMessage || 'FAILED'}`, diagnostics),
          'run_failed'
        )
      }
      // TIMED-OUT / ABORTED runs can still hold partial rows; surface them.
      const raw = await apifyFetch<unknown>(itemsPath, token, { method: 'GET', signal: runSignal })
      const listings = normalizeListings(raw)
      logger.debug('apify', `${logTag} image search complete`, { runId, status, count: listings.length })
      if (listings.length === 0) {
        const datasetDiag = datasetDiagnostics(raw)
        // Zero products plus any diagnostic row means the actor reported why —
        // surface it instead of silently showing "not found".
        const failed = status !== 'SUCCEEDED' || datasetDiag !== null
        const kvDiag = failed ? await keyValueDiagnostics(kvStoreId, token, runSignal) : null
        const diagnostics = [datasetDiag, kvDiag].filter((part): part is string => Boolean(part)).join(' | ') || null
        if (diagnostics) logger.warn('apify', `${logTag} run diagnostics`, { runId, status, diagnostics })
        if (failed) {
          throw new ApifyClientError(
            appendDiagnostics(`${label}图搜运行${status}，未返回可用结果`, diagnostics),
            'run_failed'
          )
        }
      }
      return listings
    },
    settings.timeoutMs,
    `${label}图搜超过 ${Math.round(settings.timeoutMs / 1000)} 秒未完成，请稍后重试`,
    signal
  )
}

/**
 * Taobao/Tmall photo search via the dedicated actor. It takes a single raw
 * base64 string plus a 1-50 result count; only image bytes leave the app.
 * The async run/poll/dataset path below waits for SUCCEEDED (older code used a
 * 60s synchronous endpoint, which could return an empty dataset).
 */
export async function searchTaobaoByImage(imageBase64: string, signal?: AbortSignal): Promise<ApifyListing[]> {
  const settings = apifySettings()
  const token = requireToken(settings)
  logger.debug('apify', 'taobao image search start', { actor: settings.taobaoActor })
  return runActorImageSearch(settings, token, settings.taobaoActor, {
    imageBase64,
    num: Math.min(50, Math.max(1, settings.num))
  }, 'taobao', signal)
}

/** Xianyu (Goofish) visual search; the first item is the closest match. */
export async function searchXianyuByImage(imageBase64: string, signal?: AbortSignal): Promise<ApifyListing[]> {
  const settings = apifySettings()
  const token = requireToken(settings)
  return runActorImageSearch(settings, token, settings.xianyuActor, {
    imageBase64,
    maxItems: settings.maxItems,
    detailLevel: XIANYU_DETAIL_LEVEL,
    sortBy: XIANYU_SORT_BY
  }, 'xianyu', signal)
}
