import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
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
    upsertLibraryRecords([record('X-1', { details: 'searched', imageUrl: '' }), record('X-2')])

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
