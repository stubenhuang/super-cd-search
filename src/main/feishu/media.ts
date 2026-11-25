import { createHash } from 'crypto'
import type { FeishuSettings } from '../../shared/types'
import {
  FEISHU_FIELD_TYPE_ATTACHMENT,
  type FeishuRecordFields
} from '../../shared/feishu'
import { errorMessage } from '../../shared/utils'
import { downloadImage, extForMimeType } from '../image'
import { logger } from '../logger'
import { FeishuClientError, uploadMedia } from './client'

/** 800px JPEG thumbnails are plenty for a Bitable cell and stay well under 20 MB. */
const IMAGE_SIZE = 800
/** upload_all allows 5 QPS and forbids concurrent uploads; pace a little under that. */
const UPLOAD_INTERVAL_MS = 220
const MAX_UPLOAD_RETRIES = 2
const FILE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000
const FILE_TOKEN_CACHE_MAX = 500
const DEFAULT_MAX_UPLOADS = 200
const SESSION_UPLOAD_MAX = 2000
const RETRYABLE_API_CODE = 1061045

interface CachedFileToken {
  token: string
  at: number
}

/**
 * file_token is bound to the Bitable app (app_token), not to a table or record.
 * All of our tables live in one app, so one upload serves the aggregate table,
 * every per-platform table, and repeated searches of the same cover URL.
 */
const fileTokenCache = new Map<string, CachedFileToken>()
const warnedColumns = new Set<string>()
let lastUploadAt = 0
let sessionUploads = 0

/** Test hook: drop all module-level upload state between cases. */
export function resetFeishuMediaState(): void {
  fileTokenCache.clear()
  warnedColumns.clear()
  lastUploadAt = 0
  sessionUploads = 0
}

export interface ImageSyncContext {
  settings: FeishuSettings
  /** Uploads performed by this batch; bounded by maxUploads. */
  uploads: number
  maxUploads: number
}

export function createImageSyncContext(
  settings: FeishuSettings,
  maxUploads: number = DEFAULT_MAX_UPLOADS
): ImageSyncContext {
  return { settings, uploads: 0, maxUploads }
}

export type ImageDecision =
  | { action: 'write-attachment'; value: Array<{ file_token: string }> }
  | { action: 'keep-url' }
  | { action: 'omit' }

/**
 * Pure: apply the decision to one record's fields. `keep-url` leaves the URL
 * string intact (text column not yet converted); `omit` drops the key so an
 * existing attachment is never cleared; `write-attachment` replaces it with a
 * file_token list.
 */
export function applyImageDecision(
  fields: Record<string, string>,
  column: string,
  decision: ImageDecision
): FeishuRecordFields {
  const result: FeishuRecordFields = { ...fields }
  if (decision.action === 'write-attachment') result[column] = decision.value
  else if (decision.action === 'omit') delete result[column]
  return result
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function warnOnce(key: string, column: string, message: string): void {
  if (warnedColumns.has(key)) return
  warnedColumns.add(key)
  logger.warn('feishu.image', message, { column })
}

function isRetryable(err: unknown): boolean {
  return err instanceof FeishuClientError &&
    (err.apiCode === RETRYABLE_API_CODE || err.status === 429)
}

async function paceUpload(): Promise<void> {
  const wait = UPLOAD_INTERVAL_MS - (Date.now() - lastUploadAt)
  if (wait > 0) await delay(wait)
  lastUploadAt = Date.now()
}

function rememberFileToken(key: string, token: string): void {
  fileTokenCache.set(key, { token, at: Date.now() })
  const overflow = fileTokenCache.size - FILE_TOKEN_CACHE_MAX
  if (overflow > 0) {
    for (const cached of [...fileTokenCache.keys()].slice(0, overflow)) fileTokenCache.delete(cached)
  }
}

interface UploadParams {
  fileName: string
  bytes: Buffer
  mimeType: string
  parentNode: string
  extra: string
}

async function uploadWithRetry(
  ctx: ImageSyncContext,
  params: UploadParams,
  signal?: AbortSignal
): Promise<string | null> {
  for (let attempt = 0; attempt <= MAX_UPLOAD_RETRIES; attempt++) {
    await paceUpload()
    try {
      return await uploadMedia(ctx.settings, params, signal)
    } catch (err) {
      if (!isRetryable(err) || attempt === MAX_UPLOAD_RETRIES) {
        logger.warn('feishu.image', 'upload media failed', { error: errorMessage(err) })
        return null
      }
      await delay(500 * (attempt + 1))
    }
  }
  return null
}

/** Download one cover, upload it once per app+URL, and return its file_token. */
async function resolveFileToken(
  ctx: ImageSyncContext,
  url: string,
  signal?: AbortSignal
): Promise<string | null> {
  const key = `${ctx.settings.appToken}:${url}`
  const cached = fileTokenCache.get(key)
  if (cached) {
    if (Date.now() - cached.at < FILE_TOKEN_TTL_MS) return cached.token
    fileTokenCache.delete(key)
  }

  // The third argument blocks private-network URLs (SSRF). downloadImage also
  // handles anti-hotlink Referer, alicdn TLS, redirects, an 8 MB cap and caching.
  let downloaded: Awaited<ReturnType<typeof downloadImage>>
  try {
    downloaded = await downloadImage(url, IMAGE_SIZE, false)
  } catch (err) {
    logger.warn('feishu.image', 'cover download threw', { url, error: errorMessage(err) })
    return null
  }
  if (!downloaded) {
    logger.warn('feishu.image', 'cover download returned no image', { url })
    return null
  }

  const bytes = Buffer.from(downloaded.base64, 'base64')
  if (bytes.length === 0) return null

  if (ctx.uploads >= ctx.maxUploads || sessionUploads >= SESSION_UPLOAD_MAX) {
    logger.warn('feishu.image', 'image upload cap reached, skipping remaining covers', {
      uploads: ctx.uploads,
      maxUploads: ctx.maxUploads
    })
    return null
  }

  const fileName = `cover_${createHash('sha1').update(url).digest('hex').slice(0, 16)}.${extForMimeType(downloaded.mimeType)}`
  const token = await uploadWithRetry(ctx, {
    fileName,
    bytes,
    mimeType: downloaded.mimeType,
    parentNode: ctx.settings.appToken,
    extra: JSON.stringify({ drive_route_token: ctx.settings.appToken })
  }, signal)
  if (!token) return null

  ctx.uploads++
  sessionUploads++
  rememberFileToken(key, token)
  return token
}

/**
 * Decide what to write into one image column. NEVER throws: a failed cover must
 * not break the text sync. The write format follows the column's ACTUAL Feishu
 * field type (converted manually by the user), not the setting alone.
 */
export async function decideImageValue(
  ctx: ImageSyncContext,
  url: string | null | undefined,
  column: string,
  fieldType: number | undefined,
  signal?: AbortSignal
): Promise<ImageDecision> {
  if (fieldType !== FEISHU_FIELD_TYPE_ATTACHMENT) {
    if (ctx.settings.syncImages) {
      warnOnce(
        `${ctx.settings.appToken}:${column}`,
        column,
        `飞书列「${column}」仍是文本字段，图片 URL 只会以文本保存；请在飞书表格中把该列的字段类型改为「附件」后重试。`
      )
    }
    return { action: 'keep-url' }
  }

  if (!ctx.settings.syncImages) return { action: 'omit' }
  if (typeof url !== 'string' || url.trim().length === 0) return { action: 'omit' }

  try {
    const token = await resolveFileToken(ctx, url.trim(), signal)
    return token
      ? { action: 'write-attachment', value: [{ file_token: token }] }
      : { action: 'omit' }
  } catch (err) {
    logger.warn('feishu.image', 'image sync failed', { column, error: errorMessage(err) })
    return { action: 'omit' }
  }
}
