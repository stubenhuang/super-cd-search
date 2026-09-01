import { describe, it, expect } from 'vitest'
import {
  PLATFORMS,
  PLATFORM_LABELS,
  DEFAULT_DEEP_PLATFORMS,
  resolveDeepDigPlatforms,
  summarizePlatformNames
} from '../src/shared/platforms'
import type { Platform } from '../src/shared/types'

describe('resolveDeepDigPlatforms', () => {
  it('falls back to the deep defaults when settings are missing', () => {
    expect(resolveDeepDigPlatforms(undefined)).toEqual(DEFAULT_DEEP_PLATFORMS)
    expect(resolveDeepDigPlatforms(null)).toEqual(DEFAULT_DEEP_PLATFORMS)
    expect(resolveDeepDigPlatforms({})).toEqual(DEFAULT_DEEP_PLATFORMS)
  })

  it('returns the configured deep platforms (already in canonical order) when present', () => {
    const configured: Platform[] = ['discogs', 'ebay', 'tower']
    expect(resolveDeepDigPlatforms({ deepPlatforms: configured })).toEqual(configured)
  })

  it('deduplicates and orders by the canonical PLATFORMS list', () => {
    // Deliberately out of order with a duplicate.
    const configured: Platform[] = ['tower', 'ebay', 'tower', 'discogs']
    expect(resolveDeepDigPlatforms({ deepPlatforms: configured })).toEqual([
      'discogs',
      'ebay',
      'tower'
    ])
  })

  it('returns an empty list when configured as empty', () => {
    expect(resolveDeepDigPlatforms({ deepPlatforms: [] })).toEqual([])
  })

  it('keeps channel platforms in canonical order too', () => {
    const configured: Platform[] = ['taobao', 'xianyu', 'discogs']
    const result = resolveDeepDigPlatforms({ deepPlatforms: configured })
    expect(result).toEqual(['discogs', 'xianyu', 'taobao'])
    expect(result.indexOf('xianyu')).toBeLessThan(result.indexOf('taobao'))
  })
})

describe('summarizePlatformNames', () => {
  const labels: Readonly<Record<string, string>> = PLATFORM_LABELS

  it('joins all names when the list is within the max', () => {
    const result = summarizePlatformNames(['discogs', 'ebay'], labels)
    expect(result).toEqual({ shown: 'Discogs / eBay', rest: 0 })
  })

  it('truncates and reports the remainder when over the max', () => {
    const result = summarizePlatformNames(['discogs', 'ebay', 'tower', 'hmv', 'yahoo'], labels, 2)
    expect(result.shown).toBe('Discogs / eBay')
    expect(result.rest).toBe(3)
  })

  it('uses the default max of 4', () => {
    const result = summarizePlatformNames(
      ['discogs', 'ebay', 'tower', 'hmv', 'yahoo'],
      labels
    )
    expect(result.shown).toBe('Discogs / eBay / Tower Records Japan / HMV Japan')
    expect(result.rest).toBe(1)
  })

  it('falls back to the platform id when a label is missing', () => {
    const incompleteLabels: Partial<Record<Platform, string>> = { discogs: 'Discogs' }
    const result = summarizePlatformNames(['discogs', 'ebay'], incompleteLabels, 4)
    expect(result.shown).toBe('Discogs / ebay')
    expect(result.rest).toBe(0)
  })

  it('returns an empty shown for an empty list', () => {
    expect(summarizePlatformNames([], labels)).toEqual({ shown: '', rest: 0 })
  })
})
