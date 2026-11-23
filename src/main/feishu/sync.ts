import type { FeishuSettings } from '../../shared/types'
import {
  emptySyncResult,
  FEISHU_PRIMARY_FIELD,
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
  findRecordIds,
  isFeishuConfigured,
  normalizeFeishuSettings,
  readFeishuSettings,
  testFeishuConnection
} from './client'
import { buildFeishuFields } from './record'

/**
 * Search, deep dig and smart generation finish within seconds of each other.
 * Serializing syncs means the second run always sees the record ids created by
 * the first, so the same catalog number is updated instead of inserted twice.
 */
let queue: Promise<FeishuSyncResult> = Promise.resolve(emptySyncResult('skipped'))

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

/** Test hook: drop the id cache and the serialization queue between cases. */
export function resetFeishuSyncState(): void {
  createdIds.clear()
  queue = Promise.resolve(emptySyncResult('skipped'))
}

function cacheKey(settings: FeishuSettings, catalogNumber: string): string {
  return `${settings.appToken}:${settings.tableId}:${catalogNumber}`
}

function purgeCreatedIds(now: number): void {
  for (const [key, entry] of createdIds) {
    if (now - entry.at > CREATED_ID_TTL_MS) createdIds.delete(key)
  }
  const overflow = createdIds.size - CREATED_ID_CACHE_MAX
  if (overflow > 0) {
    for (const key of [...createdIds.keys()].slice(0, overflow)) createdIds.delete(key)
  }
}

export function syncToFeishu(payload: FeishuSyncPayload): Promise<FeishuSyncResult> {
  const task = queue.then(() => doSync(payload), () => doSync(payload))
  queue = task
  return task
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
    await ensureFields(settings)
    const ids = await findRecordIds(settings, list.map(row => row.catalogNumber))

    // A record created moments ago may not be visible to records/search yet.
    const now = Date.now()
    purgeCreatedIds(now)
    for (const row of list) {
      if (ids.has(row.catalogNumber)) continue
      const cached = createdIds.get(cacheKey(settings, row.catalogNumber))
      if (cached) ids.set(row.catalogNumber, cached.id)
    }

    const creates: Array<Record<string, string>> = []
    const updates: Array<{ record_id: string; fields: Record<string, string> }> = []
    for (const row of list) {
      const fields = buildFeishuFields(row)
      const recordId = ids.get(row.catalogNumber)
      if (recordId) updates.push({ record_id: recordId, fields })
      else creates.push(fields)
    }

    const createdRecordIds = creates.length > 0 ? await batchCreate(settings, creates) : []
    const updated = updates.length > 0 ? await batchUpdate(settings, updates) : 0
    for (let i = 0; i < createdRecordIds.length; i++) {
      const id = createdRecordIds[i]
      const catalogNumber = creates[i]?.[FEISHU_PRIMARY_FIELD]
      if (id && catalogNumber) {
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
