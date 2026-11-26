import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Platform, QueryResult } from '../src/shared/types'
import { deleteSetting, setSetting } from '../src/main/settings'

const { mockFindArchivedResults } = vi.hoisted(() => ({
  mockFindArchivedResults: vi.fn()
}))

vi.mock('../src/main/feishu/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/feishu/client')>()
  return { ...actual, findArchivedResults: mockFindArchivedResults }
})

import {
  serializeResults,
  parseArchivedResults,
  mergeResults,
  foundByPlatform,
  loadArchivedFoundResults
} from '../src/main/feishu/archived'

const CONFIG = {
  enabled: true,
  appId: 'cli_a1',
  appSecret: 'secret',
  appToken: 'appTOKEN',
  tableId: 'tblXYZ',
  mappingTableId: '',
  syncImages: false
}

function result(
  platform: Platform,
  status: QueryResult['status'] = 'found',
  extra: Partial<QueryResult> = {}
): QueryResult {
  return {
    platform,
    name: `Name-${platform}`,
    artist: 'Artist',
    priceMin: 1,
    priceMax: 2,
    coverUrl: 'https://img.example/a.jpg',
    link: 'https://example/a',
    status,
    ...extra
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  deleteSetting('feishu')
  mockFindArchivedResults.mockResolvedValue(new Map())
})

describe('serializeResults', () => {
  it('keeps the full result array (including rawItems) under the cell limit', () => {
    const results = [result('discogs', 'found', { rawItems: [{ title: 'A', price: 10 }] })]
    const text = serializeResults(results)!
    const parsed = JSON.parse(text) as QueryResult[]
    expect(parsed[0].rawItems).toEqual([{ title: 'A', price: 10 }])
    expect(parsed[0].link).toBe('https://example/a')
  })

  it('drops rawItems first when the JSON approaches Feishu\'s 100k limit', () => {
    const rawItems = Array.from({ length: 200 }, (_, i) => ({ title: `T${i}`, blob: 'x'.repeat(600) }))
    const text = serializeResults([result('taobao', 'found', { rawItems })])
    expect(text).not.toBeNull()
    const parsed = JSON.parse(text!) as QueryResult[]
    expect(parsed[0].rawItems).toBeUndefined()
    expect(parsed[0].name).toBe('Name-taobao')
  })

  it('returns null when even the slimmed JSON would overflow', () => {
    const huge = result('discogs', 'found', { name: 'x'.repeat(100_000) })
    expect(serializeResults([huge])).toBeNull()
  })
})

describe('parseArchivedResults', () => {
  it('round-trips everything serializeResults writes', () => {
    const results = [
      result('discogs', 'found', { details: { label: 'EMI', format: 'CD', country: null, released: '1977', genre: null } }),
      result('ebay', 'not_found', { error: 'no match', rawItems: [{ title: 'A', price: 10, flag: true, none: null }] })
    ]
    const parsed = parseArchivedResults(serializeResults(results)!)
    expect(parsed).toHaveLength(2)
    expect(parsed[0].details?.label).toBe('EMI')
    expect(parsed[1].error).toBe('no match')
    expect(parsed[1].rawItems).toEqual([{ title: 'A', price: 10, flag: true, none: null }])
  })

  it('returns an empty list for corrupt, oversized or non-array cells', () => {
    expect(parseArchivedResults('')).toEqual([])
    expect(parseArchivedResults('not json')).toEqual([])
    expect(parseArchivedResults('{"a":1}')).toEqual([])
    expect(parseArchivedResults('x'.repeat(200_001))).toEqual([])
  })

  it('drops entries with an unknown platform or status', () => {
    const raw = JSON.stringify([
      { platform: 'unknown', status: 'found' },
      { platform: 'discogs', status: 'weird' },
      null,
      'garbage',
      result('hmv')
    ])
    const parsed = parseArchivedResults(raw)
    expect(parsed.map(r => r.platform)).toEqual(['hmv'])
  })

  it('coerces bad field types instead of passing them to the renderer', () => {
    const raw = JSON.stringify([{
      platform: 'discogs', status: 'found',
      name: 42, artist: null, priceMin: '12', priceMax: Number.NaN,
      coverUrl: false, link: 7, error: 9,
      details: { label: 5 },
      rawItems: [{ title: 'A', nested: { x: 1 }, arr: [1], ok: 'yes' }]
    }])
    const parsed = parseArchivedResults(raw)
    expect(parsed[0]).toMatchObject({
      name: null, priceMin: null, priceMax: null, coverUrl: null, link: null
    })
    expect(parsed[0]).not.toHaveProperty('error')
    expect(parsed[0].details?.label).toBeNull()
    expect(parsed[0].rawItems).toEqual([{ title: 'A', ok: 'yes' }])
  })
})

describe('mergeResults', () => {
  it('preserves archived platforms absent from the current batch in canonical order', () => {
    const merged = mergeResults(
      [result('discogs'), result('ebay')],
      [result('hmv'), result('discogs', 'found', { name: 'Old' })]
    )
    expect(merged.map(r => r.platform)).toEqual(['discogs', 'ebay', 'hmv'])
    expect(merged[0].name).toBe('Name-discogs')
  })

  it('lets the current batch override an archived result for the same platform', () => {
    const merged = mergeResults(
      [result('discogs', 'found', { name: 'Fresh' })],
      [result('discogs', 'found', { name: 'Old' })]
    )
    expect(merged[0].name).toBe('Fresh')
  })

  it('never downgrades an archived found result with a later not_found/error', () => {
    const merged = mergeResults(
      [result('discogs', 'not_found')],
      [result('discogs', 'found', { name: 'Still here' })]
    )
    expect(merged[0].status).toBe('found')
    expect(merged[0].name).toBe('Still here')
  })

  it('returns canonical order when only archived results exist', () => {
    const merged = mergeResults([], [result('tower'), result('discogs')])
    expect(merged.map(r => r.platform)).toEqual(['discogs', 'tower'])
  })
})

describe('foundByPlatform', () => {
  it('keeps only found results and ignores later duplicates', () => {
    const map = foundByPlatform([
      result('discogs', 'not_found'),
      result('discogs', 'found', { name: 'First' }),
      result('discogs', 'found', { name: 'Second' }),
      result('ebay', 'found')
    ])
    expect([...map.keys()]).toEqual(['discogs', 'ebay'])
    expect(map.get('discogs')?.name).toBe('First')
  })
})

describe('loadArchivedFoundResults', () => {
  const signal = () => new AbortController().signal

  it('does not touch Feishu when the sink is disabled or unconfigured', async () => {
    setSetting('feishu', { ...CONFIG, enabled: false })
    expect((await loadArchivedFoundResults(['X-1'], signal())).size).toBe(0)
    deleteSetting('feishu')
    expect((await loadArchivedFoundResults(['X-1'], signal())).size).toBe(0)
    expect(mockFindArchivedResults).not.toHaveBeenCalled()
  })

  it('does nothing for an empty catalog list or an already aborted signal', async () => {
    setSetting('feishu', CONFIG)
    expect((await loadArchivedFoundResults([], signal())).size).toBe(0)
    const controller = new AbortController()
    controller.abort()
    expect((await loadArchivedFoundResults(['X-1'], controller.signal)).size).toBe(0)
    expect(mockFindArchivedResults).not.toHaveBeenCalled()
  })

  it('returns only found channels, keyed by catalog number', async () => {
    setSetting('feishu', CONFIG)
    mockFindArchivedResults.mockResolvedValue(new Map([
      ['X-1', JSON.stringify([
        result('discogs', 'found'),
        result('ebay', 'not_found'),
        result('hmv', 'error', { error: 'timeout' })
      ])],
      ['X-2', 'corrupt json']
    ]))
    const loaded = await loadArchivedFoundResults(['x-1', 'x-2'], signal())
    expect([...loaded.keys()]).toEqual(['X-1'])
    expect([...loaded.get('X-1')!.keys()]).toEqual(['discogs'])
  })

  it('degrades to no archive when the Feishu lookup fails', async () => {
    setSetting('feishu', CONFIG)
    mockFindArchivedResults.mockRejectedValue(new Error('offline'))
    await expect(loadArchivedFoundResults(['X-1'], signal())).resolves.toEqual(new Map())
  })
})
