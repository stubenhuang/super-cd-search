import type { FeishuSettings } from '../../shared/types'
import {
  emptySyncResult,
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

    const creates: Array<Record<string, string>> = []
    const updates: Array<{ record_id: string; fields: Record<string, string> }> = []
    for (const row of list) {
      const fields = buildFeishuFields(row)
      const recordId = ids.get(row.catalogNumber)
      if (recordId) updates.push({ record_id: recordId, fields })
      else creates.push(fields)
    }

    const created = await batchCreate(settings, creates)
    const updated = await batchUpdate(settings, updates)
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
