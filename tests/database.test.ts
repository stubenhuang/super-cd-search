import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { app } from 'electron'
import { initDatabase, getDatabase, closeDatabase } from '../src/main/database'
import {
  getHistory,
  getHistoryEntry,
  deleteHistoryEntry,
  clearAllHistory
} from '../src/main/database/queries'

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'scs-db-'))
  vi.mocked(app.getPath).mockReturnValue(tempDir)
})

afterEach(() => {
  closeDatabase()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('database', () => {
  it('throws before initialization', () => {
    expect(() => getDatabase()).toThrow('Database not initialized')
  })

  it('initializes a SQLite database with the expected schema', () => {
    const db = initDatabase()
    expect(getDatabase()).toBe(db)

    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    ).all() as Array<{ name: string }>
    expect(tables.map(t => t.name)).toEqual(expect.arrayContaining(['queries', 'results']))

    const columns = db.prepare('PRAGMA table_info(results)').all() as Array<{ name: string }>
    expect(columns.map(c => c.name)).toEqual(
      expect.arrayContaining([
        'query_id', 'platform', 'name', 'artist', 'price_min', 'price_max',
        'cover_url', 'link', 'status', 'label', 'format', 'country', 'released', 'genre'
      ])
    )
  })

  it('is idempotent across repeated init calls', () => {
    initDatabase()
    initDatabase()
    const db = getDatabase()
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'"
    ).all() as Array<{ name: string }>
    expect(tables.map(t => t.name).filter(n => n === 'queries')).toHaveLength(1)
  })

  it('persists queries and results through the history API', () => {
    const db = initDatabase()
    const insertQuery = db.prepare('INSERT INTO queries (catalog_number, created_at) VALUES (?, ?)')
    const insertResult = db.prepare(`
      INSERT INTO results (query_id, platform, name, artist, price_min, price_max, cover_url, link, status, label, format, country, released, genre)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const info = insertQuery.run('UCCG-90530', '2024-01-01 00:00:00')
    const queryId = Number(info.lastInsertRowid)
    insertResult.run(queryId, 'discogs', 'Album', 'Artist', 10, 20, 'http://cover', 'http://link', 'found', 'Label', 'CD', 'JP', '2024', 'Jazz')

    expect(getHistory()).toEqual([
      { id: queryId, catalogNumber: 'UCCG-90530', createdAt: '2024-01-01 00:00:00' }
    ])

    const entry = getHistoryEntry(queryId)
    expect(entry?.query.catalogNumber).toBe('UCCG-90530')
    expect(entry?.results[0]).toMatchObject({
      platform: 'discogs',
      name: 'Album',
      artist: 'Artist',
      priceMin: 10,
      priceMax: 20,
      status: 'found',
      details: { label: 'Label', format: 'CD', country: 'JP', released: '2024', genre: 'Jazz' }
    })
  })

  it('orders history newest first', () => {
    const db = initDatabase()
    const insert = db.prepare('INSERT INTO queries (catalog_number, created_at) VALUES (?, ?)')
    insert.run('OLD-1', '2024-01-01 00:00:00')
    insert.run('NEW-1', '2024-02-01 00:00:00')

    expect(getHistory().map(h => h.catalogNumber)).toEqual(['NEW-1', 'OLD-1'])
  })

  it('omits details from entries without metadata', () => {
    const db = initDatabase()
    const insert = db.prepare('INSERT INTO queries (catalog_number) VALUES (?)')
    const info = insert.run('NO-DETAILS')
    const queryId = Number(info.lastInsertRowid)
    db.prepare(
      "INSERT INTO results (query_id, platform, status) VALUES (?, 'discogs', 'not_found')"
    ).run(queryId)

    const entry = getHistoryEntry(queryId)
    expect(entry?.results[0].details).toBeUndefined()
    expect(entry?.results[0].status).toBe('not_found')
  })

  it('returns null for unknown history entries', () => {
    initDatabase()
    expect(getHistoryEntry(99999)).toBeNull()
  })

  it('deletes a single history entry and its results', () => {
    const db = initDatabase()
    const info = db.prepare('INSERT INTO queries (catalog_number) VALUES (?)').run('DEL-1')
    const queryId = Number(info.lastInsertRowid)
    db.prepare(
      "INSERT INTO results (query_id, platform, status) VALUES (?, 'ebay', 'error')"
    ).run(queryId)

    deleteHistoryEntry(queryId)

    expect(getHistoryEntry(queryId)).toBeNull()
    expect(db.prepare('SELECT COUNT(*) as c FROM results WHERE query_id = ?').get(queryId)).toEqual({ c: 0 })
  })

  it('clears all history', () => {
    const db = initDatabase()
    const insert = db.prepare('INSERT INTO queries (catalog_number) VALUES (?)')
    insert.run('A-1')
    insert.run('B-1')

    clearAllHistory()

    expect(getHistory()).toEqual([])
    expect(db.prepare('SELECT COUNT(*) as c FROM results').get()).toEqual({ c: 0 })
  })
})
