import { describe, it, expect } from 'vitest'
import { buildExportRows, getCatalogPriceBounds } from '../src/renderer/src/exportData'
import type { QueryResult, CDDetails } from '../src/shared/types'

function found(platform: QueryResult['platform'], overrides: Partial<QueryResult> = {}): QueryResult {
  return {
    platform,
    name: `${platform} Album`,
    artist: `${platform} Artist`,
    priceMin: 10,
    priceMax: 10,
    coverUrl: `https://example.com/${platform}.jpg`,
    link: null,
    status: 'found',
    ...overrides
  }
}

const labels: Record<string, string> = {
  'detail.catalogNumber': '编号',
  'detail.album': '专辑',
  'detail.artist': '艺术家',
  'detail.label': '厂牌',
  'detail.format': '格式',
  'detail.country': '国家',
  'detail.released': '发行',
  'detail.genre': '类型'
}

function t(key: string): string {
  return labels[key] ?? key
}

describe('getCatalogPriceBounds', () => {
  it('aggregates min and max prices across found sources', () => {
    const results = [
      found('discogs', { priceMin: 5, priceMax: 9 }),
      found('tower', { priceMin: 12, priceMax: 20 }),
      { ...found('hmv'), status: 'not_found', priceMin: null, priceMax: null }
    ]
    expect(getCatalogPriceBounds(results)).toEqual({ lowestPrice: 5, highestPrice: 20 })
  })

  it('falls back to the other price bound when only one is present', () => {
    const results = [found('yahoo', { priceMin: null, priceMax: 15 })]
    expect(getCatalogPriceBounds(results)).toEqual({ lowestPrice: 15, highestPrice: 15 })
  })

  it('returns nulls when there are no prices', () => {
    expect(getCatalogPriceBounds([found('ebay', { priceMin: null, priceMax: null })])).toEqual({
      lowestPrice: null,
      highestPrice: null
    })
  })
})

describe('buildExportRows', () => {
  it('builds rows with the same detail text as the copy action', () => {
    const results = [
      found('discogs', {
        name: 'Album',
        artist: 'Artist',
        priceMin: 5,
        priceMax: 9,
        coverUrl: 'https://example.com/cover.jpg',
        details: { label: 'Label', format: 'CD', country: 'Japan', released: '2024', genre: 'Jazz' }
      })
    ]
    const enriched: CDDetails = { label: 'LLM Label', format: null, country: null, released: null, genre: 'Rock' }

    const rows = buildExportRows({
      catalogNumbers: ['X-1'],
      resultsByCatalog: new Map([['X-1', results]]),
      enrichedDetailsByCatalog: new Map([['X-1', enriched]]),
      formatPrice: usd => `$${usd.toFixed(2)}`,
      t
    })

    expect(rows[0]).toEqual({
      catalogNumber: 'X-1',
      imageUrl: 'https://example.com/cover.jpg',
      details: [
        '编号: X-1',
        '专辑: Album',
        '艺术家: Artist',
        '厂牌: Label',
        '格式: CD',
        '国家: Japan',
        '发行: 2024',
        '类型: Jazz'
      ].join('\n'),
      lowestPrice: '$5.00',
      highestPrice: '$9.00'
    })
  })

  it('uses the richest source for title/cover and fills gaps from poorer sources', () => {
    const rich = found('tower', {
      name: 'Tower Album',
      coverUrl: 'https://example.com/tower.jpg',
      details: { label: 'Rich Label', format: 'CD', country: 'Japan', released: '2024', genre: null }
    })
    const poor = found('discogs', {
      name: 'Discogs Album',
      details: { label: null, format: null, country: null, released: null, genre: 'Jazz' }
    })

    const rows = buildExportRows({
      catalogNumbers: ['X-1'],
      resultsByCatalog: new Map([['X-1', [poor, rich]]]),
      enrichedDetailsByCatalog: new Map(),
      formatPrice: usd => `$${usd.toFixed(2)}`,
      t
    })

    expect(rows[0].imageUrl).toBe('https://example.com/tower.jpg')
    expect(rows[0].details).toContain('专辑: Tower Album')
    expect(rows[0].details).toContain('厂牌: Rich Label')
    expect(rows[0].details).toContain('类型: Jazz')
  })
})
