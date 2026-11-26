import type { CDDetails, FeishuSettings, Platform, QueryResult } from './types'

/**
 * Defaults for the Feishu Bitable sink. Syncing stays off until the user opts
 * in and fills in the credentials, so a fresh install never makes a request.
 */
export const DEFAULT_FEISHU_SETTINGS: FeishuSettings = {
  enabled: false,
  appId: '',
  appSecret: '',
  appToken: '',
  tableId: '',
  mappingTableId: '',
  syncImages: false
}

/**
 * Bitable primary (index) field and our business key. Feishu fixes the primary
 * field as the table's first column and the API cannot promote an existing
 * field into it, so the user must name that first column 编号. We never create
 * 编号 ourselves — creating it would produce an ordinary, non-primary column.
 */
export const FEISHU_PRIMARY_FIELD = '编号'

/**
 * The columns written for each catalog number. `coverUrl` holds an image
 * attachment when the user enabled image sync; the rest stay multi-line text so
 * JSON and empty values never hit numeric/URL write validation. `resultsJson`
 * is the machine-readable archive: the full QueryResult[] for that catalog,
 * read back before the next search to skip channels already found.
 */
export const FEISHU_FIELDS = [
  '编号',
  'name',
  'artist',
  'coverUrl',
  'status',
  'error',
  'label',
  'format',
  'country',
  'released',
  'genre',
  'priceAll',
  'resultsJson'
] as const

/** Aggregate-table column holding the full archived QueryResult[] as JSON. */
export const FEISHU_RESULTS_FIELD = 'resultsJson'

export type FeishuFieldName = (typeof FEISHU_FIELDS)[number]

/** Columns ensureFields creates on first sync; excludes the primary field. */
export const FEISHU_AUTO_FIELDS: readonly string[] = FEISHU_FIELDS.filter(
  name => name !== FEISHU_PRIMARY_FIELD
)

/** Feishu Bitable field type 1 = multi-line text. */
export const FEISHU_FIELD_TYPE_TEXT = 1
/** Feishu Bitable field type 17 = attachment (images render as thumbnails). */
export const FEISHU_FIELD_TYPE_ATTACHMENT = 17

/** Aggregate-table column holding the cover image. */
export const FEISHU_IMAGE_FIELD = 'coverUrl'

/** A Bitable cell value: plain text, or an attachment field's file-token list. */
export type FeishuFieldValue = string | Array<{ file_token: string }>
export type FeishuRecordFields = Record<string, FeishuFieldValue>

/** Column in the mapping table holding the per-platform data table id. */
export const MAPPING_TARGET_FIELD = 'tableId'

/**
 * Columns shared by every per-platform data table, besides the primary field.
 * 目录号 is the catalog number and 序号 is the item's 1-based rank within that
 * catalog's list; together with 编号 they form a stable upsert key.
 */
export const PLATFORM_TABLE_COMMON_FIELDS = ['目录号', '序号'] as const

/**
 * Per-platform raw columns, curated from what each scraper actually parses.
 * Values are kept as-is (no USD normalization): the aggregate 汇总表 already
 * carries USD prices in `priceAll`. Field names must avoid 编号/目录号/序号.
 */
export const PLATFORM_TABLE_FIELDS: Record<Platform, readonly string[]> = {
  discogs: ['id', 'title', 'catno', 'year', 'format', 'cover_image', 'uri', 'communityHave', 'communityWant'],
  ebay: ['title', 'imageUrl', 'itemWebUrl', 'priceValue', 'priceCurrency', 'priceText'],
  kojima: ['name', 'coverUrl', 'link', 'price'],
  hmv: ['name', 'artist', 'coverUrl', 'link', 'priceText'],
  yahoo: ['name', 'link', 'coverUrl', 'priceText', 'storeName'],
  cdjapan: ['name', 'artist', 'coverUrl', 'releaseDate', 'priceText', 'priceCurrency', 'format'],
  tower: ['name', 'artist', 'coverUrl', 'link', 'priceText', 'format', 'released', 'label', 'country'],
  xianyu: ['title', 'priceCNY', 'url', 'coverUrl'],
  taobao: ['title', 'priceCNY', 'url', 'coverUrl']
}

/**
 * The per-platform column holding the listing image. Written as an attachment
 * (type 17) once the user enables image sync and converts the column in Feishu;
 * every other column stays type 1 text.
 */
export const PLATFORM_TABLE_IMAGE_FIELDS: Record<Platform, string> = {
  discogs: 'cover_image',
  ebay: 'imageUrl',
  kojima: 'coverUrl',
  hmv: 'coverUrl',
  yahoo: 'coverUrl',
  cdjapan: 'coverUrl',
  tower: 'coverUrl',
  xianyu: 'coverUrl',
  taobao: 'coverUrl'
}

export function platformTableImageColumn(platform: Platform): string {
  return PLATFORM_TABLE_IMAGE_FIELDS[platform]
}

/** Type overrides for missing aggregate columns (image column = attachment). */
export function aggregateFieldTypes(): Record<string, number> {
  return { [FEISHU_IMAGE_FIELD]: FEISHU_FIELD_TYPE_ATTACHMENT }
}

/** Type overrides for missing per-platform columns (image column = attachment). */
export function platformTableFieldTypes(platform: Platform): Record<string, number> {
  return { [platformTableImageColumn(platform)]: FEISHU_FIELD_TYPE_ATTACHMENT }
}

/** Full column list for create-table: the first field becomes the primary/index field. */
export function platformTableColumns(platform: Platform): string[] {
  return [FEISHU_PRIMARY_FIELD, ...PLATFORM_TABLE_COMMON_FIELDS, ...PLATFORM_TABLE_FIELDS[platform]]
}

/** Columns ensureFields adds to an existing per-platform table (primary already exists). */
export function platformTableAutoColumns(platform: Platform): string[] {
  return [...PLATFORM_TABLE_COMMON_FIELDS, ...PLATFORM_TABLE_FIELDS[platform]]
}

/** One catalog number's worth of search data, sent from the renderer. */
export interface FeishuSyncRow {
  catalogNumber: string
  results: QueryResult[]
  /** Accumulated LLM-generated details, if any (fill-missing, never overwrite). */
  enrichedDetails?: CDDetails | null
}

export interface FeishuSyncPayload {
  rows: FeishuSyncRow[]
}

export interface FeishuSyncResult {
  status: 'skipped' | 'ok' | 'error'
  created: number
  updated: number
  failed: number
  message?: string
}

export interface FeishuTestResult {
  ok: boolean
  message: string
}

export function emptySyncResult(status: FeishuSyncResult['status'], message?: string): FeishuSyncResult {
  return { status, created: 0, updated: 0, failed: 0, ...(message ? { message } : {}) }
}
