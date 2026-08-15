import { describe, it, expect } from 'vitest'
import {
  aggregateDetails,
  countValidDetailFields,
  emptyCDDetails,
  hasAllDetailFields,
  missingDetailKeys
} from '../src/shared/details'
import type { CDDetails } from '../src/shared/types'

const all = (overrides: Partial<CDDetails> = {}): CDDetails => ({
  label: null,
  format: null,
  country: null,
  released: null,
  genre: null,
  ...overrides
})

describe('countValidDetailFields', () => {
  it('counts only non-empty, trimmed values', () => {
    expect(countValidDetailFields(undefined)).toBe(0)
    expect(countValidDetailFields(null)).toBe(0)
    expect(countValidDetailFields(all())).toBe(0)
    expect(countValidDetailFields(all({ label: ' ', format: 'CD', country: 'Japan' }))).toBe(2)
  })

  it('exposes missing keys and completion state', () => {
    expect(missingDetailKeys(all({ label: 'L' }))).toEqual(['format', 'country', 'released', 'genre'])
    expect(hasAllDetailFields(all({ label: 'L' }))).toBe(false)
    expect(hasAllDetailFields(all({ label: 'L', format: 'CD', country: 'JP', released: '2024', genre: 'Jazz' }))).toBe(true)
  })
})

describe('aggregateDetails', () => {
  it('lets the source with more valid fields dominate and fills gaps from poorer sources', () => {
    const rich = all({ label: 'Rich Label', format: 'CD', country: 'Japan', released: '2024-01-01' })
    const poor = all({ label: 'Poor Label', genre: 'Jazz' })

    const { details, best } = aggregateDetails([
      { platform: 'discogs', details: poor },
      { platform: 'tower', details: rich }
    ])

    expect(best?.platform).toBe('tower')
    expect(details).toEqual({
      label: 'Rich Label', // poor source's label must NOT override the richer source
      format: 'CD',
      country: 'Japan', // gap filled by the poorer source
      released: '2024-01-01',
      genre: 'Jazz'
    })
  })

  it('preserves input order as the tie-breaker for equal field counts', () => {
    const first = all({ label: 'First', format: 'CD' })
    const second = all({ country: 'Japan', genre: 'Jazz' })

    const aggregation = aggregateDetails([
      { platform: 'hmv', details: first },
      { platform: 'yahoo', details: second }
    ])

    expect(aggregation.best?.platform).toBe('hmv')
    expect(aggregation.details.label).toBe('First')
  })

  it('trims values and ignores empty sources', () => {
    const aggregation = aggregateDetails([
      { platform: 'discogs', details: undefined },
      { platform: 'ebay', details: all({ format: '  SACD  ' }) }
    ])

    expect(aggregation.details).toEqual(all({ format: 'SACD' }))
    expect(aggregation.best?.platform).toBe('ebay')
  })

  it('returns an empty detail object when every source is empty', () => {
    expect(aggregateDetails([])).toEqual({ details: emptyCDDetails(), best: null })
  })
})
