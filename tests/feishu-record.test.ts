import { describe, it, expect } from 'vitest'
import type { CDDetails, QueryResult } from '../src/shared/types'
import { buildFeishuFields, buildPriceAll } from '../src/main/feishu/record'
import { FEISHU_FIELDS } from '../src/shared/feishu'

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

function details(overrides: Partial<CDDetails> = {}): CDDetails {
  return { label: null, format: null, country: null, released: null, genre: null, ...overrides }
}

describe('buildPriceAll', () => {
  it('records every platform in the batch, with nulls for missing prices', () => {
    const json = buildPriceAll([
      result({ platform: 'discogs', priceMin: 12.5, priceMax: 30 }),
      result({ platform: 'ebay', status: 'error', error: 'timeout' }),
      result({ platform: 'tower', priceMin: 8, priceMax: null })
    ])
    expect(JSON.parse(json)).toEqual({
      discogs: { priceMin: 12.5, priceMax: 30 },
      ebay: { priceMin: null, priceMax: null },
      tower: { priceMin: 8, priceMax: null }
    })
  })

  it('drops non-finite numbers and returns an empty object for no results', () => {
    expect(JSON.parse(buildPriceAll([
      result({ priceMin: Number.NaN, priceMax: Number.POSITIVE_INFINITY })
    ]))).toEqual({ discogs: { priceMin: null, priceMax: null } })
    expect(buildPriceAll([])).toBe('{}')
  })
})

describe('buildFeishuFields', () => {
  const found = result({
    platform: 'discogs',
    name: 'Animals',
    artist: 'Pink Floyd',
    coverUrl: 'https://img.example/a.jpg',
    status: 'found',
    priceMin: 10,
    priceMax: 20
  })

  it('writes the primary result fields and always writes 编号 + priceAll', () => {
    const fields = buildFeishuFields({ catalogNumber: 'SICP-6480', results: [found] })
    expect(fields['编号']).toBe('SICP-6480')
    expect(fields.name).toBe('Animals')
    expect(fields.artist).toBe('Pink Floyd')
    expect(fields.coverUrl).toBe('https://img.example/a.jpg')
    expect(fields.status).toBe('found')
    expect(JSON.parse(fields.priceAll)).toEqual({ discogs: { priceMin: 10, priceMax: 20 } })
  })

  it('omits null / empty fields instead of clearing an existing value', () => {
    const fields = buildFeishuFields({
      catalogNumber: 'X-1',
      results: [result({ status: 'not_found', name: '   ' })]
    })
    expect(fields['编号']).toBe('X-1')
    expect(fields.priceAll).toBeDefined()
    expect(fields).not.toHaveProperty('name')
    expect(fields).not.toHaveProperty('error')
    expect(fields).not.toHaveProperty('label')
    expect(fields.status).toBe('not_found')
  })

  it('takes status and error from the primary result', () => {
    const fields = buildFeishuFields({
      catalogNumber: 'X-2',
      results: [
        result({ platform: 'ebay', status: 'error', error: 'rate limited' }),
        result({ platform: 'hmv', status: 'error', error: 'blocked' })
      ]
    })
    expect(fields.status).toBe('error')
    expect(fields.error).toBe('rate limited')
  })

  it('merges scraped details with LLM details (fill missing, never overwrite)', () => {
    const results = [
      result({ platform: 'discogs', status: 'found', name: 'A', details: details({ label: 'EMI', released: '1977', genre: 'Prog' }) }),
      result({ platform: 'hmv', details: details({ label: 'Wrong', format: 'CD' }) })
    ]
    const fields = buildFeishuFields({
      catalogNumber: 'X-3',
      results,
      enrichedDetails: details({ label: 'LLM Label', genre: 'LLM Genre', country: 'US' })
    })
    // The richer scraped source (3 valid fields) wins over the poorer one on
    // the fields it defines; LLM only fills what is still empty.
    expect(fields.label).toBe('EMI')
    expect(fields.released).toBe('1977')
    expect(fields.genre).toBe('Prog')
    expect(fields.format).toBe('CD')
    expect(fields.country).toBe('US')
  })

  it('uses LLM details when no source carries any detail field', () => {
    const fields = buildFeishuFields({
      catalogNumber: 'X-4',
      results: [result()],
      enrichedDetails: details({ genre: 'Jazz' })
    })
    expect(fields.genre).toBe('Jazz')
    expect(fields).not.toHaveProperty('label')
  })

  it('never emits a column outside the configured fields', () => {
    const fields = buildFeishuFields({
      catalogNumber: 'X-5',
      results: [result({ status: 'error', error: 'oops', details: details({ label: 'L' }) })],
      enrichedDetails: details({ format: 'CD' })
    })
    expect(Object.keys(fields).every(key => (FEISHU_FIELDS as readonly string[]).includes(key))).toBe(true)
  })

  it('writes the full result array to resultsJson (link, status, rawItems)', () => {
    const fields = buildFeishuFields({
      catalogNumber: 'X-6',
      results: [result({
        platform: 'ebay', status: 'found', link: 'https://ebay/1',
        rawItems: [{ title: 'A', priceValue: 12 }]
      })]
    })
    const parsed = JSON.parse(fields.resultsJson) as QueryResult[]
    expect(parsed[0]).toMatchObject({
      platform: 'ebay', link: 'https://ebay/1', status: 'found',
      rawItems: [{ title: 'A', priceValue: 12 }]
    })
  })

  it('merges archived platforms into resultsJson without adding them to human columns', () => {
    const archived = result({ platform: 'hmv', status: 'found', name: 'Archived HMV' })
    const fields = buildFeishuFields({
      catalogNumber: 'X-7',
      results: [result({ platform: 'discogs', status: 'found', name: 'Fresh Discogs' })]
    }, [archived])
    const parsed = JSON.parse(fields.resultsJson) as QueryResult[]
    expect(parsed.map(r => r.platform)).toEqual(['discogs', 'hmv'])
    // The human-readable columns still describe only the current batch.
    expect(fields.name).toBe('Fresh Discogs')
    expect(JSON.parse(fields.priceAll)).toEqual({ discogs: { priceMin: null, priceMax: null } })
  })

  it('does not downgrade an archived found channel with a not_found result', () => {
    const archived = result({ platform: 'discogs', status: 'found', name: 'Old' })
    const fields = buildFeishuFields({
      catalogNumber: 'X-8',
      results: [result({ platform: 'discogs', status: 'not_found' })]
    }, [archived])
    expect((JSON.parse(fields.resultsJson) as QueryResult[])[0].status).toBe('found')
  })
})
