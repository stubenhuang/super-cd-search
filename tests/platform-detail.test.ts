import { describe, expect, it } from 'vitest'
import type { QueryResult } from '../src/shared/types'
import { PLATFORMS } from '../src/shared/platforms'
import { PLATFORM_TABLE_FIELDS } from '../src/shared/feishu'
import {
  MAX_DETAIL_ROWS,
  capRows,
  formatRawValue,
  getPlatformTabs,
  isSafeLink,
  visibleColumns
} from '../src/renderer/src/platformDetail'

function result(platform: QueryResult['platform'], rawItems?: QueryResult['rawItems']): QueryResult {
  return {
    platform,
    name: null,
    artist: null,
    priceMin: null,
    priceMax: null,
    coverUrl: null,
    link: null,
    status: rawItems ? 'found' : 'not_found',
    ...(rawItems ? { rawItems } : {})
  }
}

describe('getPlatformTabs', () => {
  it('keeps only platforms that carry raw items', () => {
    const tabs = getPlatformTabs([
      result('discogs', [{ title: 'A' }]),
      result('kojima'),
      result('ebay', [{ title: 'B' }])
    ])
    expect(tabs).toEqual(['discogs', 'ebay'])
  })

  it('returns canonical PLATFORMS order regardless of input order', () => {
    const tabs = getPlatformTabs([
      result('taobao', [{ title: 'T' }]),
      result('xianyu', [{ title: 'X' }]),
      result('discogs', [{ title: 'D' }])
    ])
    expect(tabs).toEqual(['discogs', 'xianyu', 'taobao'])
  })

  it('ignores empty, undefined, not_found and error results', () => {
    expect(getPlatformTabs([
      result('discogs', []),
      result('ebay'),
      { ...result('kojima'), status: 'error' },
      result('hmv', [{ name: 'H' }])
    ])).toEqual(['hmv'])
  })

  it('deduplicates repeated platforms', () => {
    expect(getPlatformTabs([
      result('discogs', [{ title: 'A' }]),
      result('discogs', [{ title: 'B' }])
    ])).toEqual(['discogs'])
  })

  it('returns an empty list for empty input', () => {
    expect(getPlatformTabs([])).toEqual([])
  })

  it('never returns a platform outside PLATFORMS', () => {
    const tabs = getPlatformTabs([result('discogs', [{ title: 'A' }])])
    expect(tabs.every(p => PLATFORMS.includes(p))).toBe(true)
  })
})

describe('visibleColumns', () => {
  it('equals the curated Feishu detail columns for the platform', () => {
    expect(visibleColumns('discogs')).toEqual(PLATFORM_TABLE_FIELDS.discogs)
    expect(visibleColumns('taobao')).toEqual(['title', 'priceCNY', 'url', 'coverUrl'])
  })

  it('excludes the per-record metadata columns', () => {
    const cols = visibleColumns('discogs')
    expect(cols).not.toContain('编号')
    expect(cols).not.toContain('目录号')
    expect(cols).not.toContain('序号')
    expect(cols).toContain('cover_image')
    expect(cols).toContain('uri')
  })
})

describe('isSafeLink', () => {
  it('accepts absolute http(s) URLs', () => {
    expect(isSafeLink('https://example.com/release/1')).toBe(true)
    expect(isSafeLink('http://example.com')).toBe(true)
  })

  it('rejects relative paths such as Discogs uri values', () => {
    expect(isSafeLink('/release/24580325')).toBe(false)
  })

  it('rejects non-http schemes, malformed strings and non-strings', () => {
    expect(isSafeLink('javascript:alert(1)')).toBe(false)
    expect(isSafeLink('ftp://example.com/x')).toBe(false)
    expect(isSafeLink('file:///etc/passwd')).toBe(false)
    expect(isSafeLink('not a url')).toBe(false)
    expect(isSafeLink('')).toBe(false)
    expect(isSafeLink(42)).toBe(false)
    expect(isSafeLink(null)).toBe(false)
    expect(isSafeLink(undefined)).toBe(false)
  })

  it('rejects over-long values just like the main process', () => {
    expect(isSafeLink(`https://example.com/${'x'.repeat(4096)}`)).toBe(false)
  })
})

describe('formatRawValue', () => {
  it('renders missing values as a dash', () => {
    expect(formatRawValue(null)).toBe('—')
    expect(formatRawValue(undefined)).toBe('—')
    expect(formatRawValue('')).toBe('—')
  })

  it('renders booleans as Chinese yes/no', () => {
    expect(formatRawValue(true)).toBe('是')
    expect(formatRawValue(false)).toBe('否')
  })

  it('stringifies numbers and strings verbatim', () => {
    expect(formatRawValue(0)).toBe('0')
    expect(formatRawValue(159.19)).toBe('159.19')
    expect(formatRawValue('CD, Album')).toBe('CD, Album')
    expect(formatRawValue('  ')).toBe('  ')
  })
})

describe('capRows', () => {
  it('returns everything when below or at the cap', () => {
    expect(capRows([1, 2, 3])).toEqual({ shown: [1, 2, 3], hidden: 0 })
    const atCap = Array.from({ length: MAX_DETAIL_ROWS }, (_, i) => i)
    expect(capRows(atCap)).toEqual({ shown: atCap, hidden: 0 })
  })

  it('bounds large lists and reports the hidden count', () => {
    const all = Array.from({ length: 1000 }, (_, i) => i)
    const { shown, hidden } = capRows(all)
    expect(shown).toHaveLength(MAX_DETAIL_ROWS)
    expect(hidden).toBe(950)
    expect(shown[0]).toBe(0)
    expect(shown[49]).toBe(49)
  })

  it('honours a custom cap and handles empty input', () => {
    expect(capRows([1, 2, 3, 4], 2)).toEqual({ shown: [1, 2], hidden: 2 })
    expect(capRows([])).toEqual({ shown: [], hidden: 0 })
  })
})
