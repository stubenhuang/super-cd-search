import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { CDLibraryRecordInput } from '../src/shared/types'
import {
  closeCDLibrary,
  createLibraryRecord,
  deleteLibraryRecords,
  getLibraryRecords,
  initCDLibrary,
  setRecordPublishPlatforms,
  setRecordPublishState,
  updateLibraryRecord
} from '../src/main/library'
import { finishPublishRound, getPublishSnapshot, startPublishRound } from '../src/main/publish/round'

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

describe('in-memory publish round', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'scd-round-'))
    initCDLibrary(dir)
  })

  afterEach(() => {
    finishPublishRound()
    closeCDLibrary()
    rmSync(dir, { recursive: true, force: true })
  })

  it('starts empty and finishing without a round is a no-op', () => {
    expect(getPublishSnapshot()).toEqual({ publishedAt: null, items: [] })
    expect(() => finishPublishRound()).not.toThrow()
  })

  it('starts a round in order, skipping unknown numbers and case-insensitive duplicates', () => {
    createLibraryRecord(record('A-1'))
    createLibraryRecord(record('B-2'))

    expect(startPublishRound(['B-2', 'missing', 'a-1', 'A-1'])).toBe(2)
    const snapshot = getPublishSnapshot()
    expect(snapshot.publishedAt).not.toBeNull()
    expect(snapshot.items.map(item => item.catalogNumber)).toEqual(['B-2', 'A-1'])
    expect(snapshot.items[0]).toMatchObject({ details: '详情 B-2', published: false, platforms: [] })
  })

  it('joins live library fields and persistent state into the snapshot', () => {
    createLibraryRecord(record('A-1'))
    createLibraryRecord(record('B-2'))
    startPublishRound(['A-1', 'B-2'])

    setRecordPublishState('A-1', true)
    setRecordPublishPlatforms('A-1', ['taobao'])
    updateLibraryRecord('A-1', record('A-1', { details: 'edited later' }))
    deleteLibraryRecords(['B-2'])

    const snapshot = getPublishSnapshot()
    expect(snapshot.items).toHaveLength(1)
    expect(snapshot.items[0]).toMatchObject({
      catalogNumber: 'A-1',
      details: 'edited later',
      published: true,
      platforms: ['taobao']
    })
  })

  it('finishing clears the round but keeps per-record publish state', () => {
    createLibraryRecord(record('A-1'))
    startPublishRound(['A-1'])
    setRecordPublishState('A-1', true)

    finishPublishRound()
    expect(getPublishSnapshot()).toEqual({ publishedAt: null, items: [] })

    expect(getLibraryRecords(['A-1'])[0].published).toBe(true)
  })

  it('rejects invalid input', () => {
    expect(() => startPublishRound('X-1' as never)).toThrow('编号列表格式无效')
  })
})
