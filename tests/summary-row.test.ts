import { describe, expect, it } from 'vitest'
import type { CDDetails, QueryResult, QueryStatus } from '../src/shared/types'
import { PLATFORMS } from '../src/shared/platforms'
import { FEISHU_FIELDS } from '../src/shared/feishu'
import { DETAIL_KEYS } from '../src/shared/details'
import {
  SUMMARY_COLUMNS,
  SUMMARY_COLUMN_LABEL_KEYS,
  SUMMARY_FIELD_GROUPS,
  SUMMARY_GROUP_LABEL_KEYS,
  STATUS_LABEL_KEYS,
  WIDE_COLUMNS,
  buildPriceAllEntries,
  buildResultsSummary,
  buildSummaryCells,
  computePriceBounds,
  formatPrice,
  pickPrimaryResult,
  safeCoverUrl
} from '../src/renderer/src/summaryRow'

function result(overrides: Partial<QueryResult> = {}): QueryResult {
  return {
    platform: 'discogs',
    name: null,
    artist: null,
    priceMin: null,
    priceMax: null,
    coverUrl: null,
    link: null,
    status: 'not_found',
    ...overrides
  }
}

function details(partial: Partial<CDDetails> = {}): CDDetails {
  return { label: null, format: null, country: null, released: null, genre: null, ...partial }
}

describe('column set and label maps', () => {
  it('uses the Feishu 汇总表 column set and order verbatim', () => {
    expect(SUMMARY_COLUMNS).toEqual(FEISHU_FIELDS)
    expect(SUMMARY_COLUMNS).toHaveLength(13)
  })

  it('labels every Feishu column and all four statuses', () => {
    expect(Object.keys(SUMMARY_COLUMN_LABEL_KEYS).sort()).toEqual([...FEISHU_FIELDS].sort())
    const statuses: QueryStatus[] = ['found', 'not_found', 'error', 'challenge']
    expect(Object.keys(STATUS_LABEL_KEYS).sort()).toEqual([...statuses].sort())
  })
})

describe('summary field groups', () => {
  it('covers all 13 Feishu columns exactly once, in order', () => {
    const flattened = SUMMARY_FIELD_GROUPS.flatMap(group => group.columns)
    expect(flattened).toEqual([...SUMMARY_COLUMNS])
    expect(flattened).toEqual([...FEISHU_FIELDS])
    expect(flattened).toHaveLength(13)
    expect(new Set(flattened).size).toBe(13)
  })

  it('labels every group', () => {
    expect(Object.keys(SUMMARY_GROUP_LABEL_KEYS).sort()).toEqual(
      SUMMARY_FIELD_GROUPS.map(group => group.id).sort()
    )
    expect(SUMMARY_FIELD_GROUPS.every(group => (group.columns as readonly string[]).length > 0)).toBe(true)
  })

  it('marks only priceAll and resultsJson as full-width fields', () => {
    expect([...WIDE_COLUMNS].sort()).toEqual(['priceAll', 'resultsJson'])
    expect(SUMMARY_FIELD_GROUPS.flatMap(group => group.columns).some(col => WIDE_COLUMNS.has(col))).toBe(true)
  })
})

describe('pickPrimaryResult', () => {
  it('prefers a found result carrying an album name', () => {
    const foundNoName = result({ platform: 'hmv', status: 'found' })
    const named = result({ platform: 'ebay', status: 'found', name: 'Animals' })
    expect(pickPrimaryResult([foundNoName, named])).toBe(named)
  })

  it('falls back to the first found result, then to results[0]', () => {
    const err = result({ platform: 'tower', status: 'error' })
    const foundNoName = result({ platform: 'hmv', status: 'found' })
    const notFound = result({ platform: 'kojima' })
    expect(pickPrimaryResult([err, foundNoName])).toBe(foundNoName)
    expect(pickPrimaryResult([err, notFound])).toBe(err)
  })

  it('returns undefined for an empty batch', () => {
    expect(pickPrimaryResult([])).toBeUndefined()
  })
})

describe('buildSummaryCells', () => {
  it('takes name/artist/cover/status/error from the primary result', () => {
    const primary = result({
      platform: 'ebay',
      status: 'found',
      name: 'Animals',
      artist: 'Pink Floyd',
      coverUrl: 'https://example.com/cover.jpg',
      error: 'bad gateway'
    })
    const cells = buildSummaryCells([result({ platform: 'hmv' }), primary])
    expect(cells.name).toBe('Animals')
    expect(cells.artist).toBe('Pink Floyd')
    expect(cells.coverUrl).toBe('https://example.com/cover.jpg')
    expect(cells.status).toBe('found')
    expect(cells.error).toBe('bad gateway')
  })

  it('aggregates details and lets LLM enrichment fill only missing fields', () => {
    const scraped = result({ platform: 'discogs', details: details({ label: 'Scraped' }) })
    const enriched = details({ label: 'LLM', format: 'CD' })
    const cells = buildSummaryCells([scraped], enriched)
    expect(cells.details.label).toBe('Scraped')
    expect(cells.details.format).toBe('CD')
  })

  it('does not sort by platform priority before aggregating (matches buildFeishuFields)', () => {
    const ebayFirst = result({ platform: 'ebay', details: details({ label: 'FromEbay' }) })
    const discogsSecond = result({ platform: 'discogs', details: details({ label: 'FromDiscogs' }) })
    // Equal scores keep input order, so eBay wins. A PLATFORM_PRIORITY sort
    // (as in DetailModal) would have picked Discogs instead.
    expect(buildSummaryCells([ebayFirst, discogsSecond]).details.label).toBe('FromEbay')
  })

  it('returns an empty, all-null row for an empty batch', () => {
    const cells = buildSummaryCells([])
    expect(cells.status).toBeNull()
    expect(cells.error).toBeNull()
    expect(cells.name).toBeNull()
    expect(cells.priceEntries).toEqual([])
    expect(cells.resultsTotal).toBe(0)
    expect(cells.resultsFound).toBe(0)
    expect(DETAIL_KEYS.every(key => cells.details[key] === null)).toBe(true)
  })
})

describe('buildPriceAllEntries', () => {
  it('orders entries by canonical PLATFORMS, not completion order', () => {
    const entries = buildPriceAllEntries([
      result({ platform: 'taobao', status: 'found', priceMin: 5, priceMax: 5 }),
      result({ platform: 'discogs', status: 'found', priceMin: 10, priceMax: 10 })
    ])
    expect(entries.map(e => e.platform)).toEqual(['discogs', 'taobao'])
    expect(entries.map(e => e.platform)).toEqual(PLATFORMS.filter(p => p === 'discogs' || p === 'taobao'))
  })

  it('keeps a key for every platform present, including not_found with null prices', () => {
    const entries = buildPriceAllEntries([result({ platform: 'kojima' })])
    expect(entries).toHaveLength(1)
    expect(entries[0].priceMin).toBeNull()
    expect(entries[0].priceMax).toBeNull()
  })

  it('normalizes non-finite prices to null', () => {
    const entries = buildPriceAllEntries([
      result({ platform: 'ebay', status: 'found', priceMin: Number.NaN, priceMax: Number.POSITIVE_INFINITY })
    ])
    expect(entries[0].priceMin).toBeNull()
    expect(entries[0].priceMax).toBeNull()
  })

  it('filters relative/unsafe links so openExternal never receives them', () => {
    const entries = buildPriceAllEntries([
      result({ platform: 'discogs', link: '/release/123' }),
      result({ platform: 'ebay', link: 'https://example.com/item' }),
      result({ platform: 'kojima', link: 'javascript:alert(1)' })
    ])
    expect(entries.find(e => e.platform === 'discogs')?.link).toBeNull()
    expect(entries.find(e => e.platform === 'ebay')?.link).toBe('https://example.com/item')
    expect(entries.find(e => e.platform === 'kojima')?.link).toBeNull()
  })

  it('flags lowest and highest prices, but not highest for a single priced source', () => {
    const low = result({ platform: 'discogs', status: 'found', priceMin: 10, priceMax: 10 })
    const high = result({ platform: 'ebay', status: 'found', priceMin: 20, priceMax: 20 })
    const both = buildPriceAllEntries([low, high])
    expect(both.find(e => e.platform === 'discogs')?.isLowest).toBe(true)
    expect(both.find(e => e.platform === 'discogs')?.isHighest).toBe(false)
    expect(both.find(e => e.platform === 'ebay')?.isLowest).toBe(false)
    expect(both.find(e => e.platform === 'ebay')?.isHighest).toBe(true)

    const single = buildPriceAllEntries([low])
    expect(single[0].isLowest).toBe(true)
    expect(single[0].isHighest).toBe(false)
  })
})

describe('computePriceBounds', () => {
  it('uses only found results with a price', () => {
    const bounds = computePriceBounds([
      result({ platform: 'discogs', status: 'found', priceMin: 10, priceMax: 12 }),
      result({ platform: 'ebay', status: 'found', priceMin: 8, priceMax: 20 }),
      result({ platform: 'kojima', priceMin: 1, priceMax: 1 })
    ])
    expect(bounds).toEqual({ lowestPrice: 8, highestPrice: 20 })
  })

  it('returns nulls when no found result has a price', () => {
    expect(computePriceBounds([result({ platform: 'hmv' })])).toEqual({ lowestPrice: null, highestPrice: null })
  })
})

describe('formatPrice', () => {
  it('renders USD fixed, ranges and one-sided prices', () => {
    expect(formatPrice(null, null, 'USD', null)).toBe('-')
    expect(formatPrice(10, 10, 'USD', null)).toBe('$10.00')
    expect(formatPrice(10, null, 'USD', null)).toBe('$10.00')
    expect(formatPrice(null, 12, 'USD', null)).toBe('$12.00')
    expect(formatPrice(10, 20, 'USD', null)).toBe('$10.00 - $20.00')
  })

  it('converts to CNY only when a rate is available, otherwise falls back to USD', () => {
    expect(formatPrice(10, 10, 'CNY', 7)).toBe('¥70.00')
    expect(formatPrice(10, 10, 'CNY', null)).toBe('$10.00')
  })
})

describe('safeCoverUrl', () => {
  it('rejects empty, null, relative and non-http(s) URLs', () => {
    expect(safeCoverUrl('')).toBeNull()
    expect(safeCoverUrl(null)).toBeNull()
    expect(safeCoverUrl('/release/123')).toBeNull()
    expect(safeCoverUrl('javascript:alert(1)')).toBeNull()
    expect(safeCoverUrl('https://example.com/a.jpg')).toBe('https://example.com/a.jpg')
  })
})

describe('buildResultsSummary', () => {
  it('counts all results and only found ones', () => {
    expect(buildResultsSummary([
      result({ platform: 'discogs', status: 'found' }),
      result({ platform: 'ebay' }),
      result({ platform: 'hmv', status: 'error' })
    ])).toEqual({ total: 3, found: 1 })
  })
})
