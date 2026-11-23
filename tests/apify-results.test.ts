import { describe, it, expect, vi, beforeEach } from 'vitest'

// Prices are USD-normalized by the real currency module; use a fixed rate here.
vi.mock('../src/main/currency', () => ({
  convertToUSDWithFallback: vi.fn(async (amount: number) => amount / 7)
}))

import { listingsToQueryResult } from '../src/main/queries/apify-results'
import { convertToUSDWithFallback } from '../src/main/currency'
import type { ApifyListing } from '../src/main/apify/client'

beforeEach(() => {
  vi.clearAllMocks()
})

const listing = (overrides: Partial<ApifyListing> = {}): ApifyListing => ({
  title: 'Album',
  priceCNY: 70,
  url: 'https://example.com/item',
  coverUrl: 'https://example.com/cover.jpg',
  ...overrides
})

describe('listingsToQueryResult', () => {
  it('uses the best match for identity and the top N prices for min/max', async () => {
    const listings = [
      listing({ title: 'Best', priceCNY: 70, url: 'https://example.com/best', coverUrl: 'https://example.com/best.jpg' }),
      listing({ title: 'Second', priceCNY: 140 }),
      listing({ title: 'Third', priceCNY: 35 })
    ]

    const result = await listingsToQueryResult('taobao', listings, 3)

    expect(result.status).toBe('found')
    expect(result.name).toBe('Best')
    expect(result.link).toBe('https://example.com/best')
    expect(result.coverUrl).toBe('https://example.com/best.jpg')
    expect(result.priceMin).toBe(5)
    expect(result.priceMax).toBe(20)
    expect(result.artist).toBeNull()
    expect(vi.mocked(convertToUSDWithFallback)).toHaveBeenCalledWith(70, 'CNY')
  })

  it('caps the price range at 3 listings and keeps the first item as the cover', async () => {
    const listings = [
      listing({ title: 'Best', priceCNY: 70, coverUrl: 'https://example.com/best.jpg' }),
      listing({ priceCNY: 140 }),
      listing({ priceCNY: 210 }),
      listing({ priceCNY: 9999 })
    ]

    const result = await listingsToQueryResult('taobao', listings, 3)

    expect(result.name).toBe('Best')
    expect(result.coverUrl).toBe('https://example.com/best.jpg')
    expect(result.priceMin).toBe(10)
    expect(result.priceMax).toBe(30)
    expect(vi.mocked(convertToUSDWithFallback)).toHaveBeenCalledTimes(3)
  })

  it('respects topN when building the price range', async () => {
    const listings = [
      listing({ priceCNY: 70 }),
      listing({ priceCNY: 140 }),
      listing({ priceCNY: 350 })
    ]

    const result = await listingsToQueryResult('xianyu', listings, 2)

    expect(result.priceMin).toBe(10)
    expect(result.priceMax).toBe(20)
    expect(vi.mocked(convertToUSDWithFallback)).toHaveBeenCalledTimes(2)
  })

  it('skips listings without a usable price', async () => {
    const result = await listingsToQueryResult('taobao', [
      listing({ priceCNY: null }),
      listing({ priceCNY: 70 })
    ], 2)

    expect(result.status).toBe('found')
    expect(result.priceMin).toBe(10)
    expect(result.priceMax).toBe(10)
  })

  it('returns not_found when no listing has a price', async () => {
    const result = await listingsToQueryResult('taobao', [listing({ priceCNY: null })], 5)
    expect(result).toMatchObject({ platform: 'taobao', status: 'not_found', priceMin: null })
  })

  it('returns not_found for an empty dataset', async () => {
    const result = await listingsToQueryResult('xianyu', [], 5)
    expect(result).toMatchObject({ platform: 'xianyu', status: 'not_found' })
    expect(vi.mocked(convertToUSDWithFallback)).not.toHaveBeenCalled()
  })
})
