import type { FeishuSettings } from '../../shared/types'
import {
  DEFAULT_FEISHU_SETTINGS,
  FEISHU_FIELDS,
  FEISHU_FIELD_TYPE_TEXT,
  FEISHU_PRIMARY_FIELD,
  type FeishuTestResult
} from '../../shared/feishu'
import { errorMessage } from '../../shared/utils'
import { createAbortError, throwIfAborted } from '../browser/abort'
import { logger } from '../logger'
import { getSetting } from '../settings'

const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis'
const REQUEST_TIMEOUT_MS = 30_000
/** Refresh a cached token this long before its advertised expiry. */
const TOKEN_REFRESH_MARGIN_MS = 300_000
const INVALID_TOKEN_CODES = new Set([99991661, 99991663])

export type FeishuErrorCode = 'auth' | 'http' | 'api' | 'invalid_response' | 'timeout'

export class FeishuClientError extends Error {
  readonly code: FeishuErrorCode
  readonly status?: number
  readonly apiCode?: number

  constructor(message: string, code: FeishuErrorCode, options?: { status?: number; apiCode?: number }) {
    super(message)
    this.name = 'FeishuClientError'
    this.code = code
    this.status = options?.status
    this.apiCode = options?.apiCode
  }
}

interface TokenCache {
  token: string
  expiresAt: number
  appId: string
  appSecret: string
}

let tokenCache: TokenCache | null = null
let fieldsEnsuredKey: string | null = null

/** Test hook: drop the in-memory token and field caches between cases. */
export function resetFeishuClientState(): void {
  tokenCache = null
  fieldsEnsuredKey = null
}

/** Read the stored config, filling in defaults for keys never saved. */
export function readFeishuSettings(): FeishuSettings {
  return { ...DEFAULT_FEISHU_SETTINGS, ...(getSetting('feishu') as FeishuSettings | undefined) }
}

export function isFeishuConfigured(settings: FeishuSettings): boolean {
  return [settings.appId, settings.appSecret, settings.appToken, settings.tableId]
    .every(value => typeof value === 'string' && value.trim().length > 0)
}

/** Trim the four credentials so stray whitespace never produces a bad request. */
export function normalizeFeishuSettings(settings: FeishuSettings): FeishuSettings {
  return {
    enabled: settings.enabled,
    appId: settings.appId.trim(),
    appSecret: settings.appSecret.trim(),
    appToken: settings.appToken.trim(),
    tableId: settings.tableId.trim()
  }
}

interface TokenResponse {
  code?: number
  msg?: string
  tenant_access_token?: string
  expire?: number
}

interface ApiEnvelope {
  code?: number
  msg?: string
}

interface FieldsResponse extends ApiEnvelope {
  data?: {
    items?: Array<{ field_name?: string }>
    has_more?: boolean
    page_token?: string
  }
}

interface RecordsResponse extends ApiEnvelope {
  data?: {
    items?: Array<{ record_id?: string; fields?: Record<string, unknown> }>
    has_more?: boolean
    page_token?: string
  }
}

interface BatchResponse extends ApiEnvelope {
  data?: { records?: unknown[] }
}

interface FetchOptions {
  method: 'GET' | 'POST'
  body?: Record<string, unknown>
  token?: string
  signal?: AbortSignal
  timeoutMs?: number
}

/**
 * One call to the Feishu open API. The tenant access token travels only in the
 * Authorization header — never in the URL — so it cannot leak into logs. A
 * private controller combines the per-request deadline with the caller's
 * signal, following the Apify client's pattern.
 */
async function rawFetch<T>(path: string, options: FetchOptions): Promise<T> {
  const { method, body, token, signal, timeoutMs = REQUEST_TIMEOUT_MS } = options
  const startedAt = Date.now()
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  const onExternalAbort = () => controller.abort()
  signal?.addEventListener('abort', onExternalAbort, { once: true })

  try {
    throwIfAborted(signal)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`
    const response = await fetch(`${FEISHU_API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    })

    logger.debug('feishu', 'request response', { path, method, status: response.status, durationMs: Date.now() - startedAt })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      if (response.status === 401 || response.status === 403) {
        throw new FeishuClientError('飞书访问令牌无效或应用权限不足', 'auth', { status: response.status })
      }
      if (response.status === 429) {
        throw new FeishuClientError('飞书请求过于频繁，请稍后重试', 'http', { status: 429 })
      }
      throw new FeishuClientError(`飞书 API ${response.status}: ${errorText.slice(0, 200)}`, 'http', { status: response.status })
    }

    try {
      return await response.json() as T
    } catch {
      throw new FeishuClientError('飞书返回了无效的 JSON 响应', 'invalid_response')
    }
  } catch (err) {
    if (signal?.aborted) throw createAbortError()
    if (err instanceof Error && err.name === 'AbortError') {
      throw new FeishuClientError('飞书请求超时，请稍后重试', 'timeout')
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
    signal?.removeEventListener('abort', onExternalAbort)
  }
}

async function getTenantAccessToken(settings: FeishuSettings, signal?: AbortSignal, force = false): Promise<string> {
  const sameApp = tokenCache &&
    tokenCache.appId === settings.appId &&
    tokenCache.appSecret === settings.appSecret
  if (!force && sameApp && Date.now() < tokenCache!.expiresAt) {
    return tokenCache!.token
  }

  const body = await rawFetch<TokenResponse>('/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    body: { app_id: settings.appId, app_secret: settings.appSecret },
    signal
  })
  if (body.code !== 0 || !body.tenant_access_token) {
    throw new FeishuClientError(`飞书鉴权失败 ${body.code ?? '?'}: ${body.msg ?? ''}`, 'auth', { apiCode: body.code })
  }

  const expireSeconds = typeof body.expire === 'number' && body.expire > 0 ? body.expire : 7200
  tokenCache = {
    token: body.tenant_access_token,
    expiresAt: Date.now() + expireSeconds * 1000 - TOKEN_REFRESH_MARGIN_MS,
    appId: settings.appId,
    appSecret: settings.appSecret
  }
  return body.tenant_access_token
}

interface ApiOptions {
  method: 'GET' | 'POST'
  body?: Record<string, unknown>
  signal?: AbortSignal
}

/**
 * Authenticated API call with a single token-refresh retry. Feishu reports an
 * expired token either as HTTP 401 or as a business code in a 200 response.
 */
async function callApi<T extends ApiEnvelope>(
  settings: FeishuSettings,
  path: string,
  options: ApiOptions,
  forceRefresh = false
): Promise<T> {
  const token = await getTenantAccessToken(settings, options.signal, forceRefresh)
  let body: T
  try {
    body = await rawFetch<T>(path, { method: options.method, body: options.body, token, signal: options.signal })
  } catch (err) {
    if (!forceRefresh && err instanceof FeishuClientError && err.code === 'auth' && err.status === 401) {
      return callApi<T>(settings, path, options, true)
    }
    throw err
  }

  if ((body.code ?? 0) !== 0) {
    const apiCode = body.code ?? -1
    if (!forceRefresh && INVALID_TOKEN_CODES.has(apiCode)) {
      return callApi<T>(settings, path, options, true)
    }
    throw new FeishuClientError(`飞书 API ${apiCode}: ${body.msg ?? ''}`, 'api', { apiCode })
  }
  return body
}

function tablePath(settings: FeishuSettings, suffix: string): string {
  return `/bitable/v1/apps/${encodeURIComponent(settings.appToken)}/tables/${encodeURIComponent(settings.tableId)}/${suffix}`
}

/** Read every existing field name (paged) so we can add only the missing ones. */
async function listFieldNames(settings: FeishuSettings, signal?: AbortSignal): Promise<string[]> {
  const names: string[] = []
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({ page_size: '100' })
    if (pageToken) params.set('page_token', pageToken)
    const body = await callApi<FieldsResponse>(settings, `${tablePath(settings, 'fields')}?${params}`, { method: 'GET', signal })
    for (const item of body.data?.items ?? []) {
      if (item.field_name) names.push(item.field_name)
    }
    pageToken = body.data?.has_more ? body.data?.page_token : undefined
  } while (pageToken)
  return names
}

async function createField(settings: FeishuSettings, fieldName: string, signal?: AbortSignal): Promise<void> {
  await callApi<ApiEnvelope>(settings, tablePath(settings, 'fields'), {
    method: 'POST',
    body: { field_name: fieldName, type: FEISHU_FIELD_TYPE_TEXT },
    signal
  })
}

/**
 * Create any of the twelve columns that are missing. Cached per
 * app_token/table_id pair; a failed run leaves the cache unset so the next
 * sync retries. All columns are multi-line text so URLs, JSON strings and
 * empty values never hit numeric/URL write validation.
 */
export async function ensureFields(settings: FeishuSettings, signal?: AbortSignal): Promise<void> {
  const key = `${settings.appToken}:${settings.tableId}`
  if (fieldsEnsuredKey === key) return

  const existing = new Set(await listFieldNames(settings, signal))
  let created = 0
  for (const name of FEISHU_FIELDS) {
    if (!existing.has(name)) {
      await createField(settings, name, signal)
      created++
    }
  }
  fieldsEnsuredKey = key
  logger.debug('feishu', 'fields ensured', { created })
}

/** Find existing record ids for the batch's catalog numbers in one query. */
export async function findRecordIds(
  settings: FeishuSettings,
  catalogNumbers: string[],
  signal?: AbortSignal
): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  if (catalogNumbers.length === 0) return result

  const conditions = catalogNumbers.map(catalogNumber => ({
    field_name: FEISHU_PRIMARY_FIELD,
    operator: 'is',
    value: [catalogNumber]
  }))
  let pageToken: string | undefined
  do {
    const payload: Record<string, unknown> = {
      filter: { conjunction: 'or', conditions },
      field_names: [FEISHU_PRIMARY_FIELD],
      page_size: 100,
      ...(pageToken ? { page_token: pageToken } : {})
    }
    const body = await callApi<RecordsResponse>(settings, tablePath(settings, 'records/search'), { method: 'POST', body: payload, signal })
    for (const item of body.data?.items ?? []) {
      const raw = item.fields?.[FEISHU_PRIMARY_FIELD]
      const value = typeof raw === 'string' ? raw : Array.isArray(raw) ? String(raw[0] ?? '') : ''
      if (item.record_id && value) result.set(value, item.record_id)
    }
    pageToken = body.data?.has_more ? body.data?.page_token : undefined
  } while (pageToken)
  return result
}

export async function batchCreate(
  settings: FeishuSettings,
  records: Array<Record<string, string>>,
  signal?: AbortSignal
): Promise<number> {
  if (records.length === 0) return 0
  const body = await callApi<BatchResponse>(settings, tablePath(settings, 'records/batch_create'), {
    method: 'POST',
    body: { records: records.map(fields => ({ fields })) },
    signal
  })
  return body.data?.records?.length ?? records.length
}

export async function batchUpdate(
  settings: FeishuSettings,
  updates: Array<{ record_id: string; fields: Record<string, string> }>,
  signal?: AbortSignal
): Promise<number> {
  if (updates.length === 0) return 0
  const body = await callApi<BatchResponse>(settings, tablePath(settings, 'records/batch_update'), {
    method: 'POST',
    body: { records: updates },
    signal
  })
  return body.data?.records?.length ?? updates.length
}

/** Read-only probe used by the settings "测试连接" button; never rejects. */
export async function testFeishuConnection(settings: FeishuSettings): Promise<FeishuTestResult> {
  try {
    await getTenantAccessToken(settings)
    const names = await listFieldNames(settings)
    return { ok: true, message: `连接成功，当前表格共有 ${names.length} 个字段` }
  } catch (err) {
    return { ok: false, message: errorMessage(err) }
  }
}
