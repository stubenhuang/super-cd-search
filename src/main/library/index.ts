import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { join } from 'path'
import { PUBLISH_PLATFORMS } from '../../shared/platforms'
import type {
  CDLibraryListQuery,
  CDLibraryListResult,
  CDLibraryRecord,
  CDLibraryRecordInput,
  PublishPlatform
} from '../../shared/types'
import { normalizeCatalogNumber } from '../../shared/utils'
import { logger } from '../logger'

interface LibraryRow {
  catalog_number: string
  image_url: string
  details: string
  lowest_price_usd: number | null
  highest_price_usd: number | null
  lowest_price_cny: number | null
  highest_price_cny: number | null
  has_embedded_image: number
  created_at: number
  updated_at: number
  published: number
  platforms: string
}

export interface EmbeddedLibraryImage {
  buffer: Buffer
  mimeType: 'image/png' | 'image/jpeg'
}

export interface ImportedLibraryRecord extends CDLibraryRecordInput {
  embeddedImage?: EmbeddedLibraryImage | null
}

let database: DatabaseSync | null = null

const PRICE_KEYS = [
  'lowestPriceUsd',
  'highestPriceUsd',
  'lowestPriceCny',
  'highestPriceCny'
] as const

function getDatabase(): DatabaseSync {
  if (!database) throw new Error('CD library database is not initialized')
  return database
}

function isHttpUrl(value: string): boolean {
  if (!value) return true
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function validatePrice(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label}必须是非负数字`)
  }
  if (Math.abs(value * 100 - Math.round(value * 100)) > 1e-7) {
    throw new Error(`${label}最多保留两位小数`)
  }
  return Math.round(value * 100) / 100
}

export function validateLibraryRecordInput(input: CDLibraryRecordInput): CDLibraryRecordInput {
  if (!input || typeof input !== 'object') throw new Error('记录格式无效')
  const catalogNumber = normalizeCatalogNumber(String(input.catalogNumber ?? ''))
  if (!catalogNumber) throw new Error('编号不能为空')

  const imageUrl = String(input.imageUrl ?? '').trim()
  if (!isHttpUrl(imageUrl)) throw new Error('图片地址必须是 HTTP 或 HTTPS URL')
  const details = String(input.details ?? '')

  const normalized = {
    catalogNumber,
    imageUrl,
    details,
    lowestPriceUsd: validatePrice(input.lowestPriceUsd, '最低价($)'),
    highestPriceUsd: validatePrice(input.highestPriceUsd, '最高价($)'),
    lowestPriceCny: validatePrice(input.lowestPriceCny, '最低价(￥)'),
    highestPriceCny: validatePrice(input.highestPriceCny, '最高价(￥)')
  }

  if (
    normalized.lowestPriceUsd !== null &&
    normalized.highestPriceUsd !== null &&
    normalized.lowestPriceUsd > normalized.highestPriceUsd
  ) {
    throw new Error('最低价($)不能高于最高价($)')
  }
  if (
    normalized.lowestPriceCny !== null &&
    normalized.highestPriceCny !== null &&
    normalized.lowestPriceCny > normalized.highestPriceCny
  ) {
    throw new Error('最低价(￥)不能高于最高价(￥)')
  }
  return normalized
}

function mapRow(row: LibraryRow): CDLibraryRecord {
  const record: CDLibraryRecord = {
    catalogNumber: row.catalog_number,
    imageUrl: row.image_url || '',
    details: row.details || '',
    lowestPriceUsd: row.lowest_price_usd,
    highestPriceUsd: row.highest_price_usd,
    lowestPriceCny: row.lowest_price_cny,
    highestPriceCny: row.highest_price_cny,
    hasEmbeddedImage: row.has_embedded_image === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
  record.published = row.published === 1
  record.platforms = parsePlatformsJson(row.platforms)
  return record
}

function parsePlatformsJson(value: string | null | undefined): PublishPlatform[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is PublishPlatform =>
      typeof item === 'string' && (PUBLISH_PLATFORMS as string[]).includes(item)
    )
  } catch {
    return []
  }
}

function values(input: CDLibraryRecordInput): Array<string | number | null> {
  return [
    input.catalogNumber,
    input.imageUrl,
    input.details,
    input.lowestPriceUsd,
    input.highestPriceUsd,
    input.lowestPriceCny,
    input.highestPriceCny
  ]
}

function insertStatement(db: DatabaseSync): StatementSync {
  return db.prepare(`
    INSERT INTO cd_library (
      catalog_number, image_url, image_blob, image_mime, details,
      lowest_price_usd, highest_price_usd, lowest_price_cny, highest_price_cny,
      created_at, updated_at
    ) VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)
  `)
}

function upsertStatement(db: DatabaseSync): StatementSync {
  return db.prepare(`
    INSERT INTO cd_library (
      catalog_number, image_url, image_blob, image_mime, details,
      lowest_price_usd, highest_price_usd, lowest_price_cny, highest_price_cny,
      created_at, updated_at
    ) VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(catalog_number) DO UPDATE SET
      image_url = excluded.image_url,
      image_blob = NULL,
      image_mime = NULL,
      details = excluded.details,
      lowest_price_usd = excluded.lowest_price_usd,
      highest_price_usd = excluded.highest_price_usd,
      lowest_price_cny = excluded.lowest_price_cny,
      highest_price_cny = excluded.highest_price_cny,
      updated_at = excluded.updated_at
  `)
}

export function initCDLibrary(userDataDir: string): void {
  if (database) database.close()
  const filePath = join(userDataDir, 'cd-library.sqlite')
  const db = new DatabaseSync(filePath)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec('PRAGMA busy_timeout = 5000')
  const version = Number((db.prepare('PRAGMA user_version').get() as { user_version?: number })?.user_version ?? 0)
  if (version < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS cd_library (
        catalog_number TEXT PRIMARY KEY COLLATE NOCASE,
        image_url TEXT NOT NULL DEFAULT '',
        image_blob BLOB,
        image_mime TEXT,
        details TEXT NOT NULL DEFAULT '',
        lowest_price_usd REAL,
        highest_price_usd REAL,
        lowest_price_cny REAL,
        highest_price_cny REAL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cd_library_updated
        ON cd_library(updated_at DESC, catalog_number ASC);
      PRAGMA user_version = 1;
    `)
  }
  if (version < 3) {
    // Publish batch: single overwritten-in-place batch; items only carry
    // user-maintained state, library fields are joined live on read. The drop
    // rebuilds tables from interim dev builds that named the flag differently.
    db.exec(`
      DROP TABLE IF EXISTS publish_items;
      CREATE TABLE IF NOT EXISTS publish_items (
        catalog_number TEXT PRIMARY KEY COLLATE NOCASE,
        sort_order INTEGER NOT NULL,
        published INTEGER NOT NULL DEFAULT 0,
        platforms TEXT NOT NULL DEFAULT '[]',
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS publish_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      PRAGMA user_version = 3;
    `)
  }
  if (version < 4) {
    // Publish state (published flag + platform checkmarks) became persistent
    // per-record columns; the round tables are gone (rounds now live in memory).
    db.exec(`
      ALTER TABLE cd_library ADD COLUMN published INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE cd_library ADD COLUMN platforms TEXT NOT NULL DEFAULT '[]';
      UPDATE cd_library SET
        published = COALESCE((
          SELECT pi.published FROM publish_items pi
          WHERE pi.catalog_number = cd_library.catalog_number
        ), 0),
        platforms = COALESCE((
          SELECT pi.platforms FROM publish_items pi
          WHERE pi.catalog_number = cd_library.catalog_number
        ), '[]');
      DROP TABLE IF EXISTS publish_items;
      DROP TABLE IF EXISTS publish_meta;
      PRAGMA user_version = 4;
    `)
  }
  database = db
  logger.info('library.db', 'CD library database initialized', { filePath, version: Math.max(version, 4) })
}

export function closeCDLibrary(): void {
  if (!database) return
  database.close()
  database = null
}

const PUBLISH_STATUS_FILTERS = ['all', 'published', 'unpublished'] as const

export function listLibraryRecords(query: CDLibraryListQuery): CDLibraryListResult {
  const db = getDatabase()
  const catalogQuery = String(query?.catalogQuery ?? '').trim()
  const pageSize = ([20, 50, 100] as number[]).includes(query?.pageSize) ? query.pageSize : 20
  const requestedPage = Number.isInteger(query?.page) && query.page > 0 ? query.page : 1

  const conditions: string[] = []
  const filterParams: Array<string | number> = []
  if (catalogQuery) {
    conditions.push('instr(lower(cl.catalog_number), lower(?)) > 0')
    filterParams.push(catalogQuery)
  }
  const publishStatus = PUBLISH_STATUS_FILTERS.find(value => value === query?.publishStatus) ?? 'all'
  if (publishStatus === 'published') conditions.push('cl.published = 1')
  else if (publishStatus === 'unpublished') conditions.push('cl.published = 0')
  const publishPlatform = query?.publishPlatform
  if (publishPlatform && publishPlatform !== 'all') {
    // platforms is a small JSON array of fixed safe tokens, so substring match works.
    conditions.push(`cl.platforms LIKE '%"' || ? || '"%'`)
    filterParams.push(publishPlatform)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const countRow = db.prepare(`
    SELECT COUNT(*) AS count
    FROM cd_library cl
    ${where}
  `).get(...filterParams) as { count: number }
  const total = Number(countRow.count)
  const maxPage = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(requestedPage, maxPage)
  const listStmt = db.prepare(`
    SELECT cl.catalog_number, cl.image_url, cl.details,
      cl.lowest_price_usd, cl.highest_price_usd, cl.lowest_price_cny, cl.highest_price_cny,
      CASE WHEN cl.image_blob IS NULL THEN 0 ELSE 1 END AS has_embedded_image,
      cl.created_at, cl.updated_at,
      cl.published, cl.platforms
    FROM cd_library cl
    ${where}
    ORDER BY cl.updated_at DESC, cl.catalog_number ASC
    LIMIT ? OFFSET ?
  `)
  const offset = (page - 1) * pageSize
  const rows = listStmt.all(...filterParams, pageSize, offset) as unknown as LibraryRow[]
  return { records: rows.map(mapRow), total, page, pageSize }
}

export function getLibraryRecords(catalogNumbers: string[]): CDLibraryRecord[] {
  const db = getDatabase()
  const stmt = db.prepare(`
    SELECT catalog_number, image_url, details,
      lowest_price_usd, highest_price_usd, lowest_price_cny, highest_price_cny,
      CASE WHEN image_blob IS NULL THEN 0 ELSE 1 END AS has_embedded_image,
      created_at, updated_at, published, platforms
    FROM cd_library WHERE catalog_number = ? COLLATE NOCASE
  `)
  const records: CDLibraryRecord[] = []
  for (const raw of catalogNumbers) {
    const catalogNumber = normalizeCatalogNumber(String(raw ?? ''))
    if (!catalogNumber) continue
    const row = stmt.get(catalogNumber) as unknown as LibraryRow | undefined
    if (row) records.push(mapRow(row))
  }
  return records
}

export function createLibraryRecord(input: CDLibraryRecordInput): CDLibraryRecord {
  const db = getDatabase()
  const record = validateLibraryRecordInput(input)
  const now = Date.now()
  try {
    insertStatement(db).run(...values(record), now, now)
  } catch (err) {
    if (String(err).includes('UNIQUE')) throw new Error('该编号已存在')
    throw err
  }
  return getLibraryRecords([record.catalogNumber])[0]!
}

export function updateLibraryRecord(catalogNumber: string, input: CDLibraryRecordInput): CDLibraryRecord {
  const db = getDatabase()
  const key = normalizeCatalogNumber(catalogNumber)
  const record = validateLibraryRecordInput({ ...input, catalogNumber: key })
  const now = Date.now()
  const preserveEmbeddedImage = input.preserveEmbeddedImage === true
  const result = db.prepare(`
    UPDATE cd_library SET
      image_url = ?,
      image_blob = CASE WHEN ? THEN image_blob ELSE NULL END,
      image_mime = CASE WHEN ? THEN image_mime ELSE NULL END,
      details = ?,
      lowest_price_usd = ?, highest_price_usd = ?,
      lowest_price_cny = ?, highest_price_cny = ?, updated_at = ?
    WHERE catalog_number = ? COLLATE NOCASE
  `).run(
    record.imageUrl,
    preserveEmbeddedImage ? 1 : 0,
    preserveEmbeddedImage ? 1 : 0,
    record.details,
    record.lowestPriceUsd,
    record.highestPriceUsd,
    record.lowestPriceCny,
    record.highestPriceCny,
    now,
    key
  )
  if (Number(result.changes) === 0) throw new Error('记录不存在')
  return getLibraryRecords([key])[0]!
}

export function upsertLibraryRecords(inputs: CDLibraryRecordInput[]): void {
  if (!Array.isArray(inputs)) throw new Error('记录列表格式无效')
  const records = inputs.map(validateLibraryRecordInput)
  const db = getDatabase()
  const stmt = upsertStatement(db)
  const now = Date.now()
  db.exec('BEGIN IMMEDIATE')
  try {
    records.forEach(record => stmt.run(...values(record), now, now))
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export function upsertImportedRecords(records: ImportedLibraryRecord[]): { added: number; updated: number } {
  const db = getDatabase()
  const exists = db.prepare('SELECT 1 AS found FROM cd_library WHERE catalog_number = ? COLLATE NOCASE')
  const stmt = db.prepare(`
    INSERT INTO cd_library (
      catalog_number, image_url, image_blob, image_mime, details,
      lowest_price_usd, highest_price_usd, lowest_price_cny, highest_price_cny,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(catalog_number) DO UPDATE SET
      image_url = excluded.image_url,
      image_blob = excluded.image_blob,
      image_mime = excluded.image_mime,
      details = excluded.details,
      lowest_price_usd = excluded.lowest_price_usd,
      highest_price_usd = excluded.highest_price_usd,
      lowest_price_cny = excluded.lowest_price_cny,
      highest_price_cny = excluded.highest_price_cny,
      updated_at = excluded.updated_at
  `)
  let added = 0
  let updated = 0
  const now = Date.now()
  db.exec('BEGIN IMMEDIATE')
  try {
    records.forEach(raw => {
      const record = validateLibraryRecordInput(raw)
      const alreadyExists = !!exists.get(record.catalogNumber)
      const image = raw.embeddedImage ?? null
      stmt.run(
        record.catalogNumber,
        record.imageUrl,
        image?.buffer ?? null,
        image?.mimeType ?? null,
        record.details,
        record.lowestPriceUsd,
        record.highestPriceUsd,
        record.lowestPriceCny,
        record.highestPriceCny,
        now,
        now
      )
      if (alreadyExists) updated++
      else added++
    })
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return { added, updated }
}

export function deleteLibraryRecords(catalogNumbers: string[]): number {
  if (!Array.isArray(catalogNumbers)) throw new Error('编号列表格式无效')
  const db = getDatabase()
  const stmt = db.prepare('DELETE FROM cd_library WHERE catalog_number = ? COLLATE NOCASE')
  let deleted = 0
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const raw of catalogNumbers) {
      const catalogNumber = normalizeCatalogNumber(String(raw ?? ''))
      if (!catalogNumber) continue
      deleted += Number(stmt.run(catalogNumber).changes)
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return deleted
}

export function getEmbeddedLibraryImage(catalogNumber: string): EmbeddedLibraryImage | null {
  const db = getDatabase()
  const row = db.prepare(`
    SELECT image_blob, image_mime FROM cd_library
    WHERE catalog_number = ? COLLATE NOCASE
  `).get(normalizeCatalogNumber(catalogNumber)) as { image_blob?: Uint8Array; image_mime?: string } | undefined
  if (!row?.image_blob || (row.image_mime !== 'image/png' && row.image_mime !== 'image/jpeg')) return null
  return { buffer: Buffer.from(row.image_blob), mimeType: row.image_mime }
}

export function getLibraryCount(): number {
  const row = getDatabase().prepare('SELECT COUNT(*) AS count FROM cd_library').get() as { count: number }
  return Number(row.count)
}

/**
 * Set the persistent "published" flag of one library record. Survives publish
 * rounds and app restarts; the user maintains it from desktop or phone.
 */
export function setRecordPublishState(catalogNumber: string, published: boolean): void {
  const db = getDatabase()
  const result = db.prepare(`
    UPDATE cd_library SET published = ?, updated_at = ?
    WHERE catalog_number = ? COLLATE NOCASE
  `).run(published ? 1 : 0, Date.now(), normalizeCatalogNumber(String(catalogNumber ?? '')))
  if (Number(result.changes) === 0) throw new Error('记录不存在')
}

/** Update the persistent published-platform checkmarks of one library record. */
export function setRecordPublishPlatforms(catalogNumber: string, platforms: PublishPlatform[]): void {
  if (!Array.isArray(platforms) || platforms.some(item => !(PUBLISH_PLATFORMS as string[]).includes(item))) {
    throw new Error('平台列表无效')
  }
  const unique = [...new Set(platforms)]
  const db = getDatabase()
  const result = db.prepare(`
    UPDATE cd_library SET platforms = ?, updated_at = ?
    WHERE catalog_number = ? COLLATE NOCASE
  `).run(JSON.stringify(unique), Date.now(), normalizeCatalogNumber(String(catalogNumber ?? '')))
  if (Number(result.changes) === 0) throw new Error('记录不存在')
}

export { PRICE_KEYS }
