import type { FeishuSettings } from '../../shared/types'
import {
  aggregateFieldTypes,
  emptySyncResult,
  FEISHU_AUTO_FIELDS,
  FEISHU_IMAGE_FIELD,
  FEISHU_PRIMARY_FIELD,
  FEISHU_RESULTS_FIELD,
  type FeishuRecordFields,
  type FeishuSyncPayload,
  type FeishuSyncResult,
  type FeishuSyncRow,
  type FeishuTestResult
} from '../../shared/feishu'
import { errorMessage } from '../../shared/utils'
import { logger } from '../logger'
import {
  batchCreate,
  batchUpdate,
  ensureFields,
  findArchivedResults,
  findRecordIds,
  isFeishuConfigured,
  normalizeFeishuSettings,
  readFeishuSettings,
  testFeishuConnection
} from './client'
import { applyImageDecision, createImageSyncContext, decideImageValue } from './media'
import { parseArchivedResults } from './archived'
import { buildFeishuFields } from './record'

/**
 * Aggregate-table syncs, deep dig and per-platform flushes all funnel through
 * this queue. Serializing means the second run sees the record ids created by
 * the first, and two writes never hit the same Feishu table concurrently.
 * Image uploads also ride on this queue — upload_all forbids concurrency.
 */
let queue: Promise<unknown> = Promise.resolve(undefined)

/**
 * records/search can lag behind a just-finished batch_create, so remember the
 * ids we created and reuse them for the next few minutes. Bounded by TTL and
 * size so a long-running session cannot grow without limit.
 */
interface CachedRecordId {
  id: string
  at: number
}
const CREATED_ID_TTL_MS = 10 * 60 * 1000
const CREATED_ID_CACHE_MAX = 1000
const createdIds = new Map<string, CachedRecordId>()

/**
 * records/search is a read, so one retry is safe and absorbs transient
 * Feishu/network blips that would otherwise silently erase the archived set.
 */
const MAX_ARCHIVED_READ_ATTEMPTS = 2

/** Test hook: drop the id cache and the serialization queue between cases. */
export function resetFeishuSyncState(): void {
  createdIds.clear()
  queue = Promise.resolve(undefined)
}

function cacheKey(settings: FeishuSettings, key: string): string {
  return `${settings.appToken}:${settings.tableId}:${key}`
}

export function purgeCreatedIds(now: number): void {
  for (const [key, entry] of createdIds) {
    if (now - entry.at > CREATED_ID_TTL_MS) createdIds.delete(key)
  }
  const overflow = createdIds.size - CREATED_ID_CACHE_MAX
  if (overflow > 0) {
    for (const key of [...createdIds.keys()].slice(0, overflow)) createdIds.delete(key)
  }
}

/**
 * Run one Feishu task on the shared serialization queue. A failed task never
 * poisons the queue for the next one. Used by both the aggregate sync and the
 * per-platform flush.
 */
export function enqueueFeishu<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task)
  queue = result.then(() => undefined, () => undefined)
  return result
}

/** Look up a record id created moments ago (records/search can lag behind). */
export function getCachedCreatedId(settings: FeishuSettings, key: string): string | undefined {
  return createdIds.get(cacheKey(settings, key))?.id
}

/** Remember freshly created record ids, positional by key. */
export function rememberCreatedIds(settings: FeishuSettings, keys: string[], ids: string[], now: number): void {
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]
    const key = keys[i]
    if (id && key) createdIds.set(cacheKey(settings, key), { id, at: now })
  }
}

export function syncToFeishu(payload: FeishuSyncPayload): Promise<FeishuSyncResult> {
  return enqueueFeishu(() => doSync(payload))
}

async function doSync(payload: FeishuSyncPayload): Promise<FeishuSyncResult> {
  const raw = readFeishuSettings()
  if (!raw.enabled || !isFeishuConfigured(raw) || !Array.isArray(payload?.rows) || payload.rows.length === 0) {
    return emptySyncResult('skipped')
  }
  const settings = normalizeFeishuSettings(raw)

  // Last row wins when a batch somehow repeats a catalog number.
  const rows = new Map<string, FeishuSyncRow>()
  for (const row of payload.rows) {
    if (row?.catalogNumber) rows.set(row.catalogNumber, row)
  }
  if (rows.size === 0) return emptySyncResult('skipped')
  const list = [...rows.values()]

  try {
    // With the toggle off, keep the historical behaviour: image columns are
    // plain text and carry the URL string. Only opt-in users get type-17 columns
    // created for them (existing columns are always read as-is).
    const types = await ensureFields(settings, FEISHU_AUTO_FIELDS, {
      fieldTypes: settings.syncImages ? aggregateFieldTypes() : undefined
    })
    const catalogNumbers = list.map(row => row.catalogNumber)
    const ids = await findRecordIds(settings, catalogNumbers)
    // Read back the previous archive so resultsJson can be merged by platform:
    // a search with fewer channels must not erase channels found in earlier runs.
    // If the read fails, we must NOT write a fresh (possibly narrower) resultsJson
    // over existing rows — omitting that key keeps Feishu's stored value instead.
    let archivedTexts = new Map<string, string>()
    let archiveReadOk = true
    for (let attempt = 1; attempt <= MAX_ARCHIVED_READ_ATTEMPTS; attempt++) {
      try {
        archivedTexts = await findArchivedResults(settings, catalogNumbers)
        break
      } catch (err) {
        if (attempt === MAX_ARCHIVED_READ_ATTEMPTS) {
          archiveReadOk = false
          logger.warn('feishu', 'archived read failed after retry, preserving existing resultsJson', { error: errorMessage(err) })
        } else {
          logger.debug('feishu', 'archived read failed, retrying', { error: errorMessage(err) })
        }
      }
    }
    const imageContext = createImageSyncContext(settings)

    // A record created moments ago may not be visible to records/search yet.
    const now = Date.now()
    purgeCreatedIds(now)
    for (const row of list) {
      if (ids.has(row.catalogNumber)) continue
      const cached = createdIds.get(cacheKey(settings, row.catalogNumber))
      if (cached) ids.set(row.catalogNumber, cached.id)
    }

    const creates: FeishuRecordFields[] = []
    const updates: Array<{ record_id: string; fields: FeishuRecordFields }> = []
    for (const row of list) {
      const archived = parseArchivedResults(archivedTexts.get(row.catalogNumber.toUpperCase()) ?? '')
      const base = buildFeishuFields(row, archived)
      const url = typeof base[FEISHU_IMAGE_FIELD] === 'string' ? base[FEISHU_IMAGE_FIELD] : null
      const decision = await decideImageValue(imageContext, url, FEISHU_IMAGE_FIELD, types.get(FEISHU_IMAGE_FIELD))
      const fields = applyImageDecision(base, FEISHU_IMAGE_FIELD, decision)
      const recordId = ids.get(row.catalogNumber)
      // A failed archive read means we cannot safely merge. Never overwrite an
      // existing row's resultsJson with this batch's narrower set: omit the key
      // so Feishu keeps the stored cell. New rows have nothing to preserve.
      if (!archiveReadOk && recordId) delete fields[FEISHU_RESULTS_FIELD]
      if (recordId) updates.push({ record_id: recordId, fields })
      else creates.push(fields)
    }

    const createdRecordIds = creates.length > 0 ? await batchCreate(settings, creates) : []
    const updated = updates.length > 0 ? await batchUpdate(settings, updates) : 0
    for (let i = 0; i < createdRecordIds.length; i++) {
      const id = createdRecordIds[i]
      const catalogNumber = creates[i]?.[FEISHU_PRIMARY_FIELD]
      if (id && typeof catalogNumber === 'string') {
        createdIds.set(cacheKey(settings, catalogNumber), { id, at: now })
      }
    }
    const created = createdRecordIds.length
    const failed = Math.max(0, list.length - created - updated)
    logger.debug('feishu', 'sync completed', { total: list.length, created, updated, failed })
    return { status: 'ok', created, updated, failed }
  } catch (err) {
    const message = errorMessage(err)
    logger.warn('feishu', 'sync failed', { error: message })
    return emptySyncResult('error', message)
  }
}

/**
 * Connection probe against the values currently in the settings form. Works
 * even when the master switch is still off and never persists anything.
 */
export async function testFeishu(settings: FeishuSettings): Promise<FeishuTestResult> {
  if (!isFeishuConfigured(settings)) {
    return { ok: false, message: '请先填写 App ID / App Secret / App Token / Table ID' }
  }
  return testFeishuConnection(normalizeFeishuSettings(settings))
}
