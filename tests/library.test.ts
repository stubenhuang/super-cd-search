import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'os'
import { join } from 'path'
import type { CDLibraryRecordInput } from '../src/shared/types'
import {
  closeCDLibrary,
  createLibraryRecord,
  deleteLibraryRecords,
  getEmbeddedLibraryImage,
  getLibraryCount,
  getLibraryRecords,
  initCDLibrary,
  listLibraryRecords,
  setRecordPublishPlatforms,
  setRecordPublishState,
  updateLibraryRecord,
  upsertImportedRecords,
  upsertLibraryRecords,
  validateLibraryRecordInput
} from '../src/main/library'

function record(catalogNumber: string, overrides: Partial<CDLibraryRecordInput> = {}): CDLibraryRecordInput {
  return {
    catalogNumber,
    imageUrl: '',
    details: `详情 ${catalogNumber}`,
    lowestPriceUsd: 1,
    highestPriceUsd: 2,
    lowestPriceCny: 7.2,
    highestPriceCny: 14.4,
    ...overrides
  }
}

describe('CD library SQLite store', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'scd-library-'))
    initCDLibrary(dir)
  })

  afterEach(() => {
    closeCDLibrary()
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates normalized records and rejects duplicate catalog numbers', () => {
    const created = createLibraryRecord(record('abc100'))
    expect(created.catalogNumber).toBe('ABC-100')
    expect(created.lowestPriceUsd).toBe(1)
    expect(getLibraryCount()).toBe(1)
    expect(() => createLibraryRecord(record('ABC-100'))).toThrow('该编号已存在')
  })

  it('lists with contains matching, pagination and newest-updated ordering', () => {
    createLibraryRecord(record('ABC-100'))
    createLibraryRecord(record('ZZ-200'))
    updateLibraryRecord('ABC-100', record('ABC-100', { details: 'updated' }))

    const all = listLibraryRecords({ catalogQuery: '', page: 1, pageSize: 20 })
    expect(all.total).toBe(2)
    expect(all.records[0].catalogNumber).toBe('ABC-100')

    const filtered = listLibraryRecords({ catalogQuery: 'bc-1', page: 1, pageSize: 20 })
    expect(filtered.records.map(item => item.catalogNumber)).toEqual(['ABC-100'])

    const clamped = listLibraryRecords({ catalogQuery: '', page: 99, pageSize: 20 })
    expect(clamped.page).toBe(1)
  })

  it('upserts search records as complete overwrites and deletes transactionally', () => {
    createLibraryRecord(record('X-1', { details: 'manual', imageUrl: 'https://example.com/old.jpg' }))

    const upsert = upsertLibraryRecords([record('X-1', { details: 'searched', imageUrl: '' }), record('X-2')])
    expect(upsert.inserted).toEqual(['X-2'])
    expect(upsert.updated).toEqual(['X-1'])

    // Upserting the same records again classifies everything as an update.
    const repeat = upsertLibraryRecords([record('X-2', { details: 'again' })])
    expect(repeat.inserted).toEqual([])
    expect(repeat.updated).toEqual(['X-2'])

    const records = getLibraryRecords(['X-2', 'X-1'])
    expect(records.map(item => item.catalogNumber)).toEqual(['X-2', 'X-1'])
    expect(records[1].details).toBe('searched')
    expect(records[1].imageUrl).toBe('')
    expect(deleteLibraryRecords(['X-1', 'missing'])).toBe(1)
    expect(getLibraryCount()).toBe(1)
  })

  it('stores imported embedded images and preserves them during ordinary edits when requested', () => {
    const png = Buffer.from('89504e470d0a1a0a', 'hex')
    upsertImportedRecords([{
      ...record('IMG-1'),
      embeddedImage: { buffer: png, mimeType: 'image/png' }
    }])
    expect(getEmbeddedLibraryImage('IMG-1')?.buffer).toEqual(png)

    updateLibraryRecord('IMG-1', { ...record('IMG-1', { details: 'edited' }), preserveEmbeddedImage: true })
    expect(getEmbeddedLibraryImage('IMG-1')?.buffer).toEqual(png)

    updateLibraryRecord('IMG-1', record('IMG-1', { details: 'removed' }))
    expect(getEmbeddedLibraryImage('IMG-1')).toBeNull()
  })

  it('validates URLs, price precision and min/max relationships', () => {
    expect(() => validateLibraryRecordInput(record('X-1', { imageUrl: 'file:///tmp/a.jpg' }))).toThrow('HTTP')
    expect(() => validateLibraryRecordInput(record('X-1', { lowestPriceUsd: -1 }))).toThrow('非负')
    expect(() => validateLibraryRecordInput(record('X-1', { lowestPriceUsd: 1.234 }))).toThrow('两位小数')
    expect(() => validateLibraryRecordInput(record('X-1', { lowestPriceUsd: 3, highestPriceUsd: 2 }))).toThrow('不能高于')
  })
})

describe('persistent publish state', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'scd-publish-'))
    initCDLibrary(dir)
  })

  afterEach(() => {
    closeCDLibrary()
    rmSync(dir, { recursive: true, force: true })
  })

  it('stores published state and platforms on the record and survives reopening the database', () => {
    createLibraryRecord(record('A-1'))
    createLibraryRecord(record('B-2'))

    const all = listLibraryRecords({ catalogQuery: '', page: 1, pageSize: 20 })
    expect(all.records.every(item => item.published === false && item.platforms !== undefined)).toBe(true)

    setRecordPublishState('a-1', true)
    setRecordPublishPlatforms('A-1', ['taobao', 'discogs'])
    expect(getLibraryRecords(['A-1'])[0]).toMatchObject({ published: true, platforms: ['taobao', 'discogs'] })

    // Persistent: closing and reopening the database keeps the state.
    closeCDLibrary()
    initCDLibrary(dir)
    const reloaded = listLibraryRecords({ catalogQuery: 'A-1', page: 1, pageSize: 20 })
    expect(reloaded.records[0]).toMatchObject({ published: true, platforms: ['taobao', 'discogs'] })
  })

  it('filters the library list by publish status and platform', () => {
    createLibraryRecord(record('A-1'))
    createLibraryRecord(record('B-2'))
    createLibraryRecord(record('C-3'))
    setRecordPublishState('A-1', true)
    setRecordPublishPlatforms('A-1', ['taobao'])
    setRecordPublishPlatforms('B-2', ['xianyu'])

    const catalogs = (filters: { publishStatus?: string; publishPlatform?: string; catalogQuery?: string }) =>
      listLibraryRecords({ catalogQuery: '', page: 1, pageSize: 20, ...filters })
        .records.map(item => item.catalogNumber).sort()

    expect(catalogs({ publishStatus: 'published' })).toEqual(['A-1'])
    expect(catalogs({ publishStatus: 'unpublished' })).toEqual(['B-2', 'C-3'])
    expect(catalogs({ publishPlatform: 'taobao' })).toEqual(['A-1'])
    expect(catalogs({ publishPlatform: 'xianyu' })).toEqual(['B-2'])
    expect(catalogs({ publishPlatform: 'discogs' })).toEqual([])
    expect(catalogs({ publishStatus: 'published', catalogQuery: 'a' })).toEqual(['A-1'])
    expect(catalogs({ publishStatus: 'published', catalogQuery: 'b' })).toEqual([])
  })

  it('validates publish-state updates', () => {
    createLibraryRecord(record('A-1'))
    expect(() => setRecordPublishState('missing', true)).toThrow('记录不存在')
    expect(() => setRecordPublishPlatforms('A-1', ['jd' as never])).toThrow('平台列表无效')
    expect(() => setRecordPublishPlatforms('missing', ['taobao'])).toThrow('记录不存在')

    setRecordPublishPlatforms('A-1', ['taobao', 'taobao'])
    expect(getLibraryRecords(['A-1'])[0].platforms).toEqual(['taobao'])
  })

  it('migrates v3 batch state onto persistent record columns', () => {
    closeCDLibrary()
    const legacyDir = join(dir, 'legacy')
    mkdirSync(legacyDir)
    const filePath = join(legacyDir, 'cd-library.sqlite')
    const legacy = new DatabaseSync(filePath)
    legacy.exec(`
      CREATE TABLE cd_library (
        catalog_number TEXT PRIMARY KEY COLLATE NOCASE,
        image_url TEXT NOT NULL DEFAULT '',
        image_blob BLOB,
        image_mime TEXT,
        details TEXT NOT NULL DEFAULT '',
        lowest_price_usd REAL, highest_price_usd REAL,
        lowest_price_cny REAL, highest_price_cny REAL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE publish_items (
        catalog_number TEXT PRIMARY KEY COLLATE NOCASE,
        sort_order INTEGER NOT NULL,
        published INTEGER NOT NULL DEFAULT 0,
        platforms TEXT NOT NULL DEFAULT '[]',
        updated_at INTEGER NOT NULL
      );
      PRAGMA user_version = 3;
    `)
    legacy.prepare(`INSERT INTO cd_library (catalog_number, details, created_at, updated_at) VALUES (?, ?, ?, ?)`)
      .run('A-1', 'legacy', 1, 1)
    legacy.prepare(`INSERT INTO publish_items (catalog_number, sort_order, published, platforms, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run('A-1', 0, 1, '["taobao"]', 1)
    legacy.close()

    initCDLibrary(legacyDir)
    const row = getLibraryRecords(['A-1'])[0]
    expect(row).toMatchObject({ details: 'legacy', published: true, platforms: ['taobao'] })
    const names = new DatabaseSync(filePath).prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'publish_%'"
    ).all() as Array<{ name: string }>
    expect(names).toEqual([])
  })
})
