import type { FeishuSettings } from '../../shared/types'
import {
  DEFAULT_FEISHU_SETTINGS,
  FEISHU_AUTO_FIELDS,
  FEISHU_FIELD_TYPE_TEXT,
  FEISHU_PRIMARY_FIELD,
  type FeishuRecordFields,
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

/** Test hook: drop the cached tenant token between cases. */
export function resetFeishuClientState(): void {
  tokenCache = null
}

/** Read the stored config, filling in defaults for keys never saved. */
export function readFeishuSettings(): FeishuSettings {
  return { ...DEFAULT_FEISHU_SETTINGS, ...(getSetting('feishu') as FeishuSettings | undefined) }
}

export function isFeishuConfigured(settings: FeishuSettings): boolean {
  return [settings.appId, settings.appSecret, settings.appToken, settings.tableId]
    .every(value => typeof value === 'string' && value.trim().length > 0)
}

/** Trim the credentials so stray whitespace never produces a bad request. */
export function normalizeFeishuSettings(settings: FeishuSettings): FeishuSettings {
  return {
    enabled: settings.enabled,
    appId: settings.appId.trim(),
    appSecret: settings.appSecret.trim(),
    appToken: settings.appToken.trim(),
    tableId: settings.tableId.trim(),
    mappingTableId: (settings.mappingTableId ?? '').trim(),
    syncImages: settings.syncImages === true
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
    items?: Array<{ field_name?: string; is_primary?: boolean; type?: number; field_id?: string }>
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

interface MediaUploadResponse extends ApiEnvelope {
  data?: { file_token?: string }
}

interface CreateTableResponse extends ApiEnvelope {
  data?: { table_id?: string }
}

interface TablesResponse extends ApiEnvelope {
  data?: {
    items?: Array<{ table_id?: string; name?: string }>
    has_more?: boolean
    page_token?: string
  }
}

/** One record as returned by GET /records, with its raw (unflattened) field values. */
export interface FeishuRecord {
  record_id: string
  fields: Record<string, unknown>
}

interface FetchOptions {
  method: 'GET' | 'POST'
  body?: Record<string, unknown>
  /** Factory so a 401 retry rebuilds a fresh FormData + Blob. */
  form?: () => FormData
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
  const { method, body, form, token, signal, timeoutMs = REQUEST_TIMEOUT_MS } = options
  const startedAt = Date.now()
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  const onExternalAbort = () => controller.abort()
  signal?.addEventListener('abort', onExternalAbort, { once: true })

  try {
    throwIfAborted(signal)
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    // Multipart uploads must NOT set Content-Type: undici appends the boundary.
    // A factory (not an instance) keeps the body reusable across 401 retries.
    let payload: string | FormData | undefined
    if (form) {
      payload = form()
    } else if (body) {
      headers['Content-Type'] = 'application/json'
      payload = JSON.stringify(body)
    }
    const response = await fetch(`${FEISHU_API_BASE}${path}`, {
      method,
      headers,
      body: payload,
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
  form?: () => FormData
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
    body = await rawFetch<T>(path, {
      method: options.method,
      body: options.body,
      form: options.form,
      token,
      signal: options.signal
    })
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

/** App-scoped path (no table id) — used for creating/listing data tables. */
export function appPath(settings: FeishuSettings, suffix: string): string {
  return `/bitable/v1/apps/${encodeURIComponent(settings.appToken)}/${suffix}`
}

export interface CreateTableOptions {
  /** Per-column type overrides; columns not listed default to multi-line text. */
  fieldTypes?: Record<string, number>
  signal?: AbortSignal
}

/**
 * Create a data table with the given columns. Feishu makes the FIRST field the
 * primary/index field, so callers must put 编号 first (type 1). Returns the new
 * table_id.
 */
export async function createTable(
  settings: FeishuSettings,
  name: string,
  fieldNames: readonly string[],
  options: CreateTableOptions = {}
): Promise<string> {
  const body = await callApi<CreateTableResponse>(settings, appPath(settings, 'tables'), {
    method: 'POST',
    body: {
      table: {
        name,
        fields: fieldNames.map(fieldName => ({
          field_name: fieldName,
          type: options.fieldTypes?.[fieldName] ?? FEISHU_FIELD_TYPE_TEXT
        }))
      }
    },
    signal: options.signal
  })
  const tableId = body.data?.table_id
  if (!tableId) throw new Error('飞书新建数据表成功但未返回 table_id')
  return tableId
}

/** List the tables of one Bitable app (paged), used to recover from 1254013. */
export async function listTables(
  settings: FeishuSettings,
  signal?: AbortSignal
): Promise<Array<{ tableId: string; name: string }>> {
  const tables: Array<{ tableId: string; name: string }> = []
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({ page_size: '100' })
    if (pageToken) params.set('page_token', pageToken)
    const body = await callApi<TablesResponse>(settings, `${appPath(settings, 'tables')}?${params}`, { method: 'GET', signal })
    for (const item of body.data?.items ?? []) {
      if (item.table_id && item.name) tables.push({ tableId: item.table_id, name: item.name })
    }
    pageToken = body.data?.has_more ? body.data?.page_token : undefined
  } while (pageToken)
  return tables
}

/** List all records of a table (paged). Paging is a URL query param, not a body field. */
export async function listRecords(settings: FeishuSettings, signal?: AbortSignal): Promise<FeishuRecord[]> {
  const records: FeishuRecord[] = []
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({ page_size: '100' })
    if (pageToken) params.set('page_token', pageToken)
    const body = await callApi<RecordsResponse>(settings, `${tablePath(settings, 'records')}?${params}`, { method: 'GET', signal })
    for (const item of body.data?.items ?? []) {
      if (item.record_id) records.push({ record_id: item.record_id, fields: item.fields ?? {} })
    }
    pageToken = body.data?.has_more ? body.data?.page_token : undefined
  } while (pageToken)
  return records
}

export interface FieldInfo {
  field_name: string
  is_primary: boolean
  /** Feishu field type (1 = text, 17 = attachment). */
  type: number
  field_id?: string
}

/** Read every field (paged) with its primary/index flag and type. */
export async function listFields(settings: FeishuSettings, signal?: AbortSignal): Promise<FieldInfo[]> {
  const fields: FieldInfo[] = []
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({ page_size: '100' })
    if (pageToken) params.set('page_token', pageToken)
    const body = await callApi<FieldsResponse>(settings, `${tablePath(settings, 'fields')}?${params}`, { method: 'GET', signal })
    for (const item of body.data?.items ?? []) {
      if (item.field_name) {
        fields.push({
          field_name: item.field_name,
          is_primary: item.is_primary === true,
          type: item.type ?? FEISHU_FIELD_TYPE_TEXT,
          ...(item.field_id ? { field_id: item.field_id } : {})
        })
      }
    }
    pageToken = body.data?.has_more ? body.data?.page_token : undefined
  } while (pageToken)
  return fields
}

/**
 * Feishu always returns exactly one primary field. Fall back to the first
 * column for responses that omit the flag — the primary field is always first.
 */
export function primaryFieldName(fields: FieldInfo[]): string {
  return (fields.find(field => field.is_primary) ?? fields[0])?.field_name ?? ''
}

/**
 * The business key must be the table's primary (first) column. Feishu cannot
 * change which field is primary through the API, so all we can do is fail with
 * actionable guidance instead of silently creating a second 编号 column.
 */
function assertPrimaryField(fields: FieldInfo[]): void {
  const name = primaryFieldName(fields)
  if (name !== FEISHU_PRIMARY_FIELD) {
    throw new Error(
      `飞书多维表格的主字段（首列）必须命名为「${FEISHU_PRIMARY_FIELD}」，当前为「${name || '（无）'}」；请在飞书表格中把第一列重命名为「${FEISHU_PRIMARY_FIELD}」后重试。`
    )
  }
}

export interface CreateFieldOptions {
  type?: number
  signal?: AbortSignal
}

export async function createField(
  settings: FeishuSettings,
  fieldName: string,
  options: CreateFieldOptions = {}
): Promise<void> {
  await callApi<ApiEnvelope>(settings, tablePath(settings, 'fields'), {
    method: 'POST',
    body: { field_name: fieldName, type: options.type ?? FEISHU_FIELD_TYPE_TEXT },
    signal: options.signal
  })
}

export interface EnsureFieldsOptions {
  /** Type overrides for columns that need creating; existing columns keep their type. */
  fieldTypes?: Record<string, number>
  signal?: AbortSignal
}

/**
 * Create the non-primary columns that are missing; 编号 must already be the
 * table's primary (first) column. Returns the ACTUAL type of every column so
 * callers only write attachment values into columns that really are type 17.
 * No cache: the user may convert a column to 附件 in the Feishu UI at any time,
 * and a stale type would make us write a URL string into an attachment field.
 */
export async function ensureFields(
  settings: FeishuSettings,
  fieldNames: readonly string[] = FEISHU_AUTO_FIELDS,
  options: EnsureFieldsOptions = {}
): Promise<Map<string, number>> {
  const fields = await listFields(settings, options.signal)
  assertPrimaryField(fields)
  const types = new Map(fields.map(field => [field.field_name, field.type]))
  let created = 0
  for (const name of fieldNames) {
    if (!types.has(name)) {
      const type = options.fieldTypes?.[name] ?? FEISHU_FIELD_TYPE_TEXT
      await createField(settings, name, { type, signal: options.signal })
      types.set(name, type)
      created++
    }
  }
  logger.debug('feishu', 'fields ensured', { created })
  return types
}

/**
 * A type-1 text field is written as a plain string but read back as an array
 * of `{ text, type }` segments (sometimes a string / string[]). Flatten it so
 * the primary field can be used as a lookup key.
 */
export function parsePrimaryFieldText(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim()
  if (!Array.isArray(raw)) return ''
  return raw
    .map(segment => {
      if (typeof segment === 'string') return segment
      if (segment && typeof segment === 'object') {
        const text = (segment as Record<string, unknown>).text
        return typeof text === 'string' ? text : ''
      }
      return ''
    })
    .join('')
    .trim()
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
    // records/search takes paging as query params, not body fields.
    const params = new URLSearchParams({ page_size: '100' })
    if (pageToken) params.set('page_token', pageToken)
    const payload: Record<string, unknown> = {
      filter: { conjunction: 'or', conditions },
      field_names: [FEISHU_PRIMARY_FIELD],
      automatic_fields: false
    }
    const body = await callApi<RecordsResponse>(settings, `${tablePath(settings, 'records/search')}?${params}`, { method: 'POST', body: payload, signal })
    for (const item of body.data?.items ?? []) {
      const value = parsePrimaryFieldText(item.fields?.[FEISHU_PRIMARY_FIELD])
      if (item.record_id && value) result.set(value, item.record_id)
    }
    pageToken = body.data?.has_more ? body.data?.page_token : undefined
  } while (pageToken)
  return result
}

/**
 * Return the created record ids (empty string when the API omits one) so a
 * following sync can update these rows even before the search index catches up.
 */
export async function batchCreate(
  settings: FeishuSettings,
  records: FeishuRecordFields[],
  signal?: AbortSignal
): Promise<string[]> {
  if (records.length === 0) return []
  const body = await callApi<BatchResponse>(settings, tablePath(settings, 'records/batch_create'), {
    method: 'POST',
    body: { records: records.map(fields => ({ fields })) },
    signal
  })
  const created = body.data?.records
  return records.map((_, index) => {
    const id = (Array.isArray(created) ? created[index] : undefined) as { record_id?: unknown } | undefined
    return typeof id?.record_id === 'string' ? id.record_id : ''
  })
}

export async function batchUpdate(
  settings: FeishuSettings,
  updates: Array<{ record_id: string; fields: FeishuRecordFields }>,
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

/**
 * Upload image bytes to the Bitable app and return its file_token. The token is
 * scoped to the app (app_token), so it can be reused across every table of that
 * app. The body is a FormData factory so a token-refresh retry stays valid.
 */
export async function uploadMedia(
  settings: FeishuSettings,
  params: { fileName: string; bytes: Buffer; mimeType: string; parentNode: string; extra: string },
  signal?: AbortSignal
): Promise<string> {
  const { fileName, bytes, mimeType, parentNode, extra } = params
  const body = await callApi<MediaUploadResponse>(settings, '/drive/v1/medias/upload_all', {
    method: 'POST',
    form: () => {
      const fd = new FormData()
      fd.append('file_name', fileName)
      fd.append('parent_type', 'bitable_image')
      fd.append('parent_node', parentNode)
      fd.append('size', String(bytes.length))
      fd.append('extra', extra)
      // Copy into a plain ArrayBuffer-backed Uint8Array: @types/node's Buffer
      // is Uint8Array<ArrayBufferLike>, which DOM BlobPart does not accept.
      fd.append('file', new Blob([Uint8Array.from(bytes)], { type: mimeType }), fileName)
      return fd
    },
    signal
  })
  const fileToken = body.data?.file_token
  if (!fileToken) throw new FeishuClientError('飞书上传素材成功但未返回 file_token', 'invalid_response')
  return fileToken
}

/** Read-only probe used by the settings "测试连接" button; never rejects. */
export async function testFeishuConnection(settings: FeishuSettings): Promise<FeishuTestResult> {
  try {
    await getTenantAccessToken(settings)
    const fields = await listFields(settings)
    assertPrimaryField(fields)
    return { ok: true, message: `连接成功，主字段为「${FEISHU_PRIMARY_FIELD}」，当前表格共有 ${fields.length} 个字段` }
  } catch (err) {
    return { ok: false, message: errorMessage(err) }
  }
}
