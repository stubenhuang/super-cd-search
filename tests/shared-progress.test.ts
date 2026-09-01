import { describe, it, expect } from 'vitest'
import {
  makeProgressKey,
  parseProgressKey,
  isTerminalStatus,
  buildProgressByCatalog,
  clearProgressEntries,
  countCompletedCatalogs
} from '../src/shared/progress'

describe('makeProgressKey / parseProgressKey', () => {
  it('round-trips a catalog number and platform', () => {
    expect(makeProgressKey('TOCP-53001', 'discogs')).toBe('TOCP-53001:discogs')
    expect(parseProgressKey('TOCP-53001:discogs')).toEqual({
      catalogNumber: 'TOCP-53001',
      platform: 'discogs'
    })
  })

  it('parses keys whose catalog number contains no colon but platform does not', () => {
    expect(parseProgressKey('BVCP-21002:ebay')).toEqual({
      catalogNumber: 'BVCP-21002',
      platform: 'ebay'
    })
  })

  it('returns null for a key without a separator', () => {
    expect(parseProgressKey('TOCP-53001')).toBeNull()
  })

  it('returns null for an empty catalog number (key starts with separator)', () => {
    expect(parseProgressKey(':discogs')).toBeNull()
  })

  it('returns null for an empty platform (key ends with separator)', () => {
    expect(parseProgressKey('TOCP-53001:')).toBeNull()
  })
})

describe('isTerminalStatus', () => {
  it('treats complete / not_found / error / challenge as terminal', () => {
    for (const status of ['complete', 'not_found', 'error', 'challenge']) {
      expect(isTerminalStatus(status)).toBe(true)
    }
  })

  it('treats loading / pending / undefined as not terminal', () => {
    expect(isTerminalStatus('loading')).toBe(false)
    expect(isTerminalStatus('pending')).toBe(false)
    expect(isTerminalStatus(undefined)).toBe(false)
  })
})

describe('buildProgressByCatalog', () => {
  it('aggregates statuses into a catalog -> platform map', () => {
    const statuses = new Map<string, string>([
      ['A:discogs', 'complete'],
      ['A:ebay', 'not_found'],
      ['B:discogs', 'loading']
    ])
    const result = buildProgressByCatalog(statuses, ['discogs', 'ebay'])
    expect(result.get('A')?.get('discogs')).toBe('complete')
    expect(result.get('A')?.get('ebay')).toBe('not_found')
    expect(result.get('B')?.get('discogs')).toBe('loading')
    expect(result.get('B')?.has('ebay')).toBe(false)
  })

  it('filters out platforms outside the allowlist', () => {
    const statuses = new Map<string, string>([
      ['A:discogs', 'complete'],
      ['A:hmv', 'complete']
    ])
    const result = buildProgressByCatalog(statuses, ['discogs'])
    expect(result.get('A')?.size).toBe(1)
    expect(result.get('A')?.has('hmv')).toBe(false)
  })

  it('ignores malformed keys', () => {
    const statuses = new Map<string, string>([
      ['no-separator', 'complete'],
      [':empty-catalog', 'complete'],
      ['empty-platform:', 'complete']
    ])
    expect(buildProgressByCatalog(statuses, ['discogs']).size).toBe(0)
  })
})

describe('clearProgressEntries', () => {
  it('removes only the catalogs × platforms cross entries', () => {
    const statuses = new Map<string, string>([
      ['A:discogs', 'complete'],
      ['A:ebay', 'not_found'],
      ['A:hmv', 'complete'],
      ['B:discogs', 'complete'],
      ['B:ebay', 'complete']
    ])
    const result = clearProgressEntries(statuses, ['A'], ['discogs', 'ebay'])
    expect(result.has('A:discogs')).toBe(false)
    expect(result.has('A:ebay')).toBe(false)
    expect(result.get('A:hmv')).toBe('complete')
    expect(result.get('B:discogs')).toBe('complete')
    expect(result.get('B:ebay')).toBe('complete')
  })

  it('does not mutate the input map', () => {
    const statuses = new Map<string, string>([['A:discogs', 'complete']])
    clearProgressEntries(statuses, ['A'], ['discogs'])
    expect(statuses.get('A:discogs')).toBe('complete')
  })

  it('returns the same reference when nothing is removed', () => {
    const statuses = new Map<string, string>([['A:discogs', 'complete']])
    expect(clearProgressEntries(statuses, ['A'], ['ebay'])).toBe(statuses)
  })

  it('returns a new map when at least one entry is removed', () => {
    const statuses = new Map<string, string>([['A:discogs', 'complete']])
    const result = clearProgressEntries(statuses, ['A'], ['discogs'])
    expect(result).not.toBe(statuses)
    expect(result.size).toBe(0)
  })

  it('ignores malformed keys without touching them', () => {
    const statuses = new Map<string, string>([
      ['no-separator', 'complete'],
      ['A:discogs', 'complete']
    ])
    const result = clearProgressEntries(statuses, ['A'], ['discogs'])
    expect(result.has('A:discogs')).toBe(false)
    expect(result.get('no-separator')).toBe('complete')
  })
})

describe('countCompletedCatalogs', () => {
  const platforms = ['discogs', 'ebay']

  it('counts a catalog whose platforms are all terminal', () => {
    const byCatalog = new Map([
      ['A', new Map([['discogs', 'complete'], ['ebay', 'not_found']])]
    ])
    expect(countCompletedCatalogs(byCatalog, ['A'], platforms)).toBe(1)
  })

  it('does not count a catalog with a non-terminal status', () => {
    const byCatalog = new Map([
      ['A', new Map([['discogs', 'complete'], ['ebay', 'loading']])]
    ])
    expect(countCompletedCatalogs(byCatalog, ['A'], platforms)).toBe(0)
  })

  it('does not count a catalog missing a platform row', () => {
    const byCatalog = new Map([
      ['A', new Map([['discogs', 'complete']])]
    ])
    expect(countCompletedCatalogs(byCatalog, ['A'], platforms)).toBe(0)
  })

  it('does not count a catalog absent from the map', () => {
    expect(countCompletedCatalogs(new Map(), ['A'], platforms)).toBe(0)
  })

  it('sums across multiple catalogs', () => {
    const byCatalog = new Map([
      ['A', new Map([['discogs', 'complete'], ['ebay', 'complete']])],
      ['B', new Map([['discogs', 'error'], ['ebay', 'challenge']])],
      ['C', new Map([['discogs', 'loading'], ['ebay', 'loading']])]
    ])
    expect(countCompletedCatalogs(byCatalog, ['A', 'B', 'C'], platforms)).toBe(2)
  })
})
