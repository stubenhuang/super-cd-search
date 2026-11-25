import type { BatchQueryResult, FeishuSettings, Platform, RawItem } from '../../shared/types'
import {
  FEISHU_PRIMARY_FIELD,
  MAPPING_TARGET_FIELD,
  PLATFORM_TABLE_FIELDS,
  platformTableAutoColumns,
  platformTableColumns,
  platformTableFieldTypes,
  platformTableImageColumn,
  type FeishuRecordFields
} from '../../shared/feishu'
import { PLATFORM_LABELS } from '../../shared/platforms'
import { errorMessage } from '../../shared/utils'
import { logger } from '../logger'
import {
  FeishuClientError,
  batchCreate,
  batchUpdate,
  createField,
  createTable,
  ensureFields,
  findRecordIds,
  isFeishuConfigured,
  listFields,
  listRecords,
  listTables,
  normalizeFeishuSettings,
  parsePrimaryFieldText,
  primaryFieldName,
  readFeishuSettings
} from './client'
import { applyImageDecision, createImageSyncContext, decideImageValue, type ImageSyncContext } from './media'
import { putField } from './record'
import { enqueueFeishu, getCachedCreatedId, purgeCreatedIds, rememberCreatedIds } from './sync'

/** Feishu caps a single batch_create/batch_update at 500 records. */
const MAX_BATCH = 500
/** Conservative cap on OR conditions in one records/search request. */
const MAX_FILTER_KEYS = 50
const TABLE_NAME_PREFIX = 'CD数据-'
/** Feishu indexes freshly created tables/fields asynchronously. */
const SCHEMA_SETTLE_MS = 400

interface RawEntry {
  catalogNumber: string
  rank: number
  item: RawItem
}

type PlatformGroups = Map<Platform, RawEntry[]>

interface MappingEntry {
  tableId: string
  recordId: string
}

interface MappingRead {
  /** The mapping table's primary field name — arbitrary, never forced to 编号. */
  primaryName: string
  entries: Map<string, MappingEntry>
}

/** Stable upsert key for one raw item: catalog number + 1-based rank. */
export function platformRecordKey(entry: RawEntry): string {
  return `${entry.catalogNumber}#${entry.rank}`
}

/** Group every raw item of a finished batch by its platform. Pure, no shared state. */
export function groupRawItems(completed: readonly BatchQueryResult[]): PlatformGroups {
  const groups: PlatformGroups = new Map()
  for (const batch of completed) {
    for (const result of batch.results ?? []) {
      if (!Array.isArray(result.rawItems) || result.rawItems.length === 0) continue
      let list = groups.get(result.platform)
      if (!list) {
        list = []
        groups.set(result.platform, list)
      }
      result.rawItems.forEach((item, index) => {
        list!.push({ catalogNumber: batch.catalogNumber, rank: index + 1, item })
      })
    }
  }
  return groups
}

/** Project one raw item into the platform table's columns (whitelist only). */
export function buildRawRecord(platform: Platform, entry: RawEntry): Record<string, string> {
  const fields: Record<string, string> = {}
  putField(fields, FEISHU_PRIMARY_FIELD, platformRecordKey(entry))
  putField(fields, '目录号', entry.catalogNumber)
  putField(fields, '序号', entry.rank)
  for (const name of PLATFORM_TABLE_FIELDS[platform]) {
    putField(fields, name, entry.item[name])
  }
  return fields
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const parts: T[][] = []
  for (let start = 0; start < items.length; start += size) {
    parts.push(items.slice(start, start + size))
  }
  return parts
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Read the mapping table: discover its primary field name, ensure the tableId
 * column exists, and parse rows into { platform -> tableId, recordId }.
 */
async function readMapping(mappingSettings: FeishuSettings): Promise<MappingRead> {
  const fields = await listFields(mappingSettings)
  const primaryName = primaryFieldName(fields)
  if (!primaryName) throw new Error('飞书映射表没有主字段（首列），无法读取平台映射')

  if (!fields.some(field => field.field_name === MAPPING_TARGET_FIELD)) {
    await createField(mappingSettings, MAPPING_TARGET_FIELD)
    await delay(SCHEMA_SETTLE_MS)
  }

  const records = await listRecords(mappingSettings)
  const entries = new Map<string, MappingEntry>()
  for (const record of records) {
    const platform = parsePrimaryFieldText(record.fields[primaryName])
    if (!platform) continue
    const tableId = parsePrimaryFieldText(record.fields[MAPPING_TARGET_FIELD])
    entries.set(platform, { tableId, recordId: record.record_id })
  }
  return { primaryName, entries }
}

/**
 * Resolve a platform's data table id, creating the table and writing the
 * mapping row back when needed. 1254013 (duplicate name) is healed by reusing
 * the existing table with the same name.
 */
async function resolvePlatformTable(
  base: FeishuSettings,
  mappingSettings: FeishuSettings,
  mapping: MappingRead,
  platform: Platform
): Promise<string> {
  const cached = mapping.entries.get(platform)
  if (cached?.tableId) return cached.tableId

  const name = `${TABLE_NAME_PREFIX}${PLATFORM_LABELS[platform]}`
  let tableId: string
  try {
    tableId = await createTable(base, name, platformTableColumns(platform), {
      fieldTypes: base.syncImages ? platformTableFieldTypes(platform) : undefined
    })
    await delay(SCHEMA_SETTLE_MS)
  } catch (err) {
    if (err instanceof FeishuClientError && err.apiCode === 1254013) {
      const tables = await listTables(base)
      const found = tables.find(table => table.name === name)
      if (!found) throw err
      tableId = found.tableId
    } else {
      throw err
    }
  }

  const recordFields: Record<string, string> = {
    [mapping.primaryName]: platform,
    [MAPPING_TARGET_FIELD]: tableId
  }
  if (cached) {
    await batchUpdate(mappingSettings, [{ record_id: cached.recordId, fields: recordFields }])
  } else {
    await batchCreate(mappingSettings, [recordFields])
  }
  mapping.entries.set(platform, { tableId, recordId: cached?.recordId ?? '' })
  return tableId
}

/** Upsert all raw items of one platform into its own table. */
async function upsertRows(
  platformSettings: FeishuSettings,
  platform: Platform,
  entries: readonly RawEntry[],
  imageContext: ImageSyncContext
): Promise<{ created: number; updated: number }> {
  const types = await ensureFields(platformSettings, platformTableAutoColumns(platform), {
    fieldTypes: imageContext.settings.syncImages ? platformTableFieldTypes(platform) : undefined
  })
  const imageColumn = platformTableImageColumn(platform)

  // Last entry wins for a repeated key, mirroring the aggregate sync.
  const unique = new Map<string, RawEntry>()
  for (const entry of entries) unique.set(platformRecordKey(entry), entry)
  const list = [...unique.values()]

  const keys = list.map(platformRecordKey)
  const ids = new Map<string, string>()
  for (const part of chunk(keys, MAX_FILTER_KEYS)) {
    for (const [key, id] of await findRecordIds(platformSettings, part)) ids.set(key, id)
  }

  const now = Date.now()
  purgeCreatedIds(now)
  for (const key of keys) {
    if (ids.has(key)) continue
    const cached = getCachedCreatedId(platformSettings, key)
    if (cached) ids.set(key, cached)
  }

  const creates: Array<{ key: string; fields: FeishuRecordFields }> = []
  const updates: Array<{ record_id: string; fields: FeishuRecordFields }> = []
  for (const entry of list) {
    const base = buildRawRecord(platform, entry)
    const url = typeof base[imageColumn] === 'string' ? base[imageColumn] : null
    const decision = await decideImageValue(imageContext, url, imageColumn, types.get(imageColumn))
    const fields = applyImageDecision(base, imageColumn, decision)
    const key = platformRecordKey(entry)
    const recordId = ids.get(key)
    if (recordId) updates.push({ record_id: recordId, fields })
    else creates.push({ key, fields })
  }

  let created = 0
  let updated = 0
  for (const part of chunk(creates, MAX_BATCH)) {
    const newIds = await batchCreate(platformSettings, part.map(item => item.fields))
    rememberCreatedIds(platformSettings, part.map(item => item.key), newIds, now)
    created += newIds.length
  }
  for (const part of chunk(updates, MAX_BATCH)) {
    updated += await batchUpdate(platformSettings, part)
  }
  return { created, updated }
}

async function doFlush(settings: FeishuSettings, groups: PlatformGroups): Promise<void> {
  // Re-gate inside the queue in case the config changed since the snapshot.
  if (!settings.enabled || !isFeishuConfigured(settings) || !settings.mappingTableId.trim()) return

  const mappingSettings: FeishuSettings = { ...settings, tableId: settings.mappingTableId }
  const mapping = await readMapping(mappingSettings)
  // One context for the whole flush so a cover URL is uploaded once and its
  // file_token is reused across every per-platform table.
  const imageContext = createImageSyncContext(settings)

  let totalCreated = 0
  let totalUpdated = 0
  for (const [platform, entries] of groups) {
    if (entries.length === 0) continue
    try {
      const tableId = await resolvePlatformTable(settings, mappingSettings, mapping, platform)
      const platformSettings: FeishuSettings = { ...settings, tableId }
      const { created, updated } = await upsertRows(platformSettings, platform, entries, imageContext)
      totalCreated += created
      totalUpdated += updated
    } catch (err) {
      logger.warn('feishu.platform', 'platform flush failed', { platform, error: errorMessage(err) })
    }
  }
  logger.debug('feishu.platform', 'flush completed', {
    platforms: groups.size,
    created: totalCreated,
    updated: totalUpdated
  })
}

/**
 * Batch-end entry point. Does the gate and the pure snapshot synchronously,
 * then enqueues the Feishu work on the shared serialization queue. Never throws
 * into executeBatchQuery; failures are logged only.
 */
export function flushPlatformTables(completed: readonly BatchQueryResult[]): void {
  try {
    const raw = readFeishuSettings()
    if (!raw.enabled || !isFeishuConfigured(raw) || !raw.mappingTableId?.trim()) return
    const groups = groupRawItems(completed)
    if (groups.size === 0) return
    const settings = normalizeFeishuSettings(raw)
    void enqueueFeishu(() => doFlush(settings, groups))
      .catch(err => logger.warn('feishu.platform', 'flush failed', { error: errorMessage(err) }))
  } catch (err) {
    logger.warn('feishu.platform', 'flush setup failed', { error: errorMessage(err) })
  }
}
