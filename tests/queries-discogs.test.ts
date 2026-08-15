import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetSetting, mockThrottledFetch, mockBrowserPool, mockConvert, mockTryLLMParse } = vi.hoisted(() => ({
  mockGetSetting: vi.fn(),
  mockThrottledFetch: vi.fn(),
  mockBrowserPool: { acquire: vi.fn(), release: vi.fn() },
  mockConvert: vi.fn(async (amount: number) => amount),
  mockTryLLMParse: vi.fn()
}))

vi.mock('../src/main/settings', () => ({ getSetting: mockGetSetting }))
vi.mock('../src/main/throttle', () => ({ throttledFetch: mockThrottledFetch }))
vi.mock('../src/main/browser', () => ({ browserPool: mockBrowserPool }))
vi.mock('../src/main/currency', () => ({ convertToUSDWithFallback: mockConvert }))
vi.mock('../src/main/llm/parser', () => ({ tryLLMParse: mockTryLLMParse }))

import {
  queryDiscogs,
  queryDiscogsByBarcode,
  normalizeDiscogsBarcode,
  clearReleaseCache,
  clearDiscogsBarcodeCache
} from '../src/main/queries/discogs'
import { clearAllCaches } from '../src/main/queries/cache'

function okJson(data: unknown) {
  return { ok: true, status: 200, json: async () => data }
}

function createDiscogsPage() {
  const firstResult = {
    $eval: vi.fn(async (selector: string) => {
      if (selector.startsWith('a[aria-label^="Release:"]')) return 'Some Album'
      if (selector.startsWith('a[aria-label^="Artist:"]')) return 'Some Artist'
      if (selector === 'img') return 'https://cdn.discogs.com/cover.jpg'
      if (selector.startsWith('a[href*="/release/"]')) return '/release/123456'
      return null
    })
  }
  const page = {
    setCookie: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue({}),
    evaluate: vi.fn().mockResolvedValue('Some body text without results markers'),
    $: vi.fn().mockResolvedValue(firstResult),
    content: vi.fn().mockResolvedValue('<html></html>'),
    close: vi.fn().mockResolvedValue(undefined)
  }
  const browser = { newPage: vi.fn().mockResolvedValue(page), close: vi.fn() }
  return { page, browser, firstResult }
}

beforeEach(() => {
  vi.clearAllMocks()
  clearAllCaches()
  clearDiscogsBarcodeCache()
  mockGetSetting.mockImplementation((key: string) => {
    if (key === 'discogsToken') return 'token-123'
    if (key === 'cookies') return { discogs: 'cookie-value' }
    return undefined
  })
  mockTryLLMParse.mockResolvedValue(null)
  mockBrowserPool.acquire.mockResolvedValue({ browser: {}, page: {} })
  mockBrowserPool.release.mockResolvedValue(undefined)
})

describe('queryDiscogs', () => {
  it('clears the release-detail cache', () => {
    clearReleaseCache()
  })

  describe('API path', () => {
    it('finds an exact catalog match and enriches with prices and details', async () => {
      mockThrottledFetch.mockImplementation(async (_domain: string, url: string) => {
        if (url.includes('/database/search')) {
          return okJson({
            results: [
              { id: 2, title: 'Wrong - Album', catno: 'OTHER-1', cover_image: null, uri: '/release/2' },
              { id: 1, title: 'Artist - UCCG-90530 Album', catno: 'UCCG-90530', cover_image: 'https://cdn/cover.jpg', uri: '/release/1' }
            ]
          })
        }
        if (url.includes('/marketplace/stats')) {
          return okJson({
            lowest_price: { value: 10, currency: 'USD' },
            num_for_sale: 3,
            blocked_from_sale: false
          })
        }
        if (url.includes('/releases/')) {
          return okJson({
            labels: [{ name: 'Test Label' }],
            formats: [{ name: 'CD', descriptions: ['Album', 'Reissue'] }],
            country: 'Japan',
            released: '2024-03-01',
            released_formatted: '01 Mar 2024',
            year: '2024',
            genres: ['Jazz'],
            styles: ['Hard Bop']
          })
        }
        return { ok: false, status: 404 }
      })

      const result = await queryDiscogs('UCCG-90530')

      expect(result).toMatchObject({
        platform: 'discogs',
        name: 'UCCG-90530 Album',
        artist: 'Artist',
        priceMin: 10,
        priceMax: 10,
        coverUrl: 'https://cdn/cover.jpg',
        link: 'https://www.discogs.com/release/1',
        status: 'found',
        details: {
          label: 'Test Label',
          format: 'CD, Album, Reissue',
          country: 'Japan',
          released: '2024-03-01',
          genre: 'Jazz, Hard Bop'
        }
      })
      expect(mockBrowserPool.acquire).not.toHaveBeenCalled()
    })

    it('falls back to released_formatted and then year', async () => {
      mockThrottledFetch.mockImplementation(async (_domain: string, url: string) => {
        if (url.includes('/database/search')) {
          return okJson({
            results: [{ id: 9, title: 'Artist - FALL-1', catno: 'FALL-1', uri: '/release/9' }]
          })
        }
        if (url.includes('/marketplace/stats')) return okJson({})
        if (url.includes('/releases/9')) {
          return okJson({
            labels: [],
            formats: [{ name: 'CD' }],
            country: 'Japan',
            released_formatted: '16 Sep 2022',
            year: '2022',
            genres: ['Rock'],
            styles: []
          })
        }
        return { ok: false, status: 404 }
      })

      const formatted = await queryDiscogs('FALL-1')
      expect(formatted.details?.released).toBe('16 Sep 2022')

      mockThrottledFetch.mockImplementation(async (_domain: string, url: string) => {
        if (url.includes('/database/search')) {
          return okJson({
            results: [{ id: 10, title: 'Artist - FALL-2', catno: 'FALL-2', uri: '/release/10' }]
          })
        }
        if (url.includes('/marketplace/stats')) return okJson({})
        if (url.includes('/releases/10')) {
          return okJson({
            labels: [],
            formats: [{ name: 'CD' }],
            country: 'Japan',
            year: '2021',
            genres: [],
            styles: []
          })
        }
        return { ok: false, status: 404 }
      })

      const yearOnly = await queryDiscogs('FALL-2')
      expect(yearOnly.details?.released).toBe('2021')
    })

    it('matches Discogs catalog numbers that use spaces instead of dashes', async () => {
      mockThrottledFetch.mockImplementation(async (_domain: string, url: string) => {
        if (url.includes('/database/search')) {
          return okJson({
            results: [
              { id: 21, title: 'Pink Floyd - Animals', catno: 'SICP 6480', uri: '/release/21' },
              { id: 22, title: 'Other - Album', catno: 'SICP-6481', uri: '/release/22' }
            ]
          })
        }
        if (url.includes('/marketplace/stats')) return okJson({})
        if (url.includes('/releases/')) {
          return okJson({
            labels: [{ name: 'Pink Floyd Records' }],
            formats: [{ name: 'CD', descriptions: ['Album'] }],
            country: 'Japan',
            released: '2022-09-16',
            year: '2022',
            genres: ['Rock'],
            styles: ['Prog Rock']
          })
        }
        return { ok: false, status: 404 }
      })

      const result = await queryDiscogs('SICP-6480')
      expect(result.name).toBe('Animals')
      expect(result.link).toBe('https://www.discogs.com/release/21')
      expect(mockThrottledFetch).toHaveBeenCalledWith(
        'api.discogs.com',
        expect.stringContaining('/releases/21'),
        undefined,
        expect.anything()
      )
    })

    it('returns not_found when the API has no results', async () => {
      mockThrottledFetch.mockResolvedValue(okJson({ results: [] }))
      const result = await queryDiscogs('NOPE-1')
      expect(result.status).toBe('not_found')
    })

    it('keeps null prices when marketplace stats have no lowest price', async () => {
      mockThrottledFetch.mockImplementation(async (_domain: string, url: string) => {
        if (url.includes('/database/search')) {
          return okJson({ results: [{ id: 99, title: 'A - B', catno: 'X-1' }] })
        }
        if (url.includes('/marketplace/stats')) {
          return okJson({ num_for_sale: 0, blocked_from_sale: false })
        }
        if (url.includes('/releases/')) return okJson({})
        return { ok: false, status: 404 }
      })

      const result = await queryDiscogs('X-1')
      expect(result.priceMin).toBeNull()
      expect(result.priceMax).toBeNull()
      expect(result.details).toEqual({ label: null, format: null, country: null, released: null, genre: null })
    })

    it('falls back to web scraping when the API fails', async () => {
      mockThrottledFetch.mockResolvedValue({ ok: false, status: 500 })
      const { page, browser } = createDiscogsPage()
      mockBrowserPool.acquire.mockResolvedValue({ browser, page })

      const result = await queryDiscogs('UCCG-90530')

      expect(result).toMatchObject({
        platform: 'discogs',
        name: 'Some Album',
        artist: 'Some Artist',
        coverUrl: 'https://cdn.discogs.com/cover.jpg',
        link: 'https://www.discogs.com/release/123456',
        status: 'found'
      })
      expect(page.setCookie).toHaveBeenCalledWith({
        name: 'discogs_dot_com',
        value: 'cookie-value',
        domain: '.discogs.com',
        path: '/'
      })
      expect(mockBrowserPool.release).toHaveBeenCalledWith(browser, page)
    })
  })

  describe('barcode lookup', () => {
    it('normalizes scanned barcodes to 8-14 digits', () => {
      expect(normalizeDiscogsBarcode(' 4988006812345 ')).toBe('4988006812345')
      expect(normalizeDiscogsBarcode('4 988006 812345')).toBe('4988006812345')
      expect(normalizeDiscogsBarcode('4-988006-812345')).toBe('4988006812345')
      expect(normalizeDiscogsBarcode('123')).toBeNull()
      expect(normalizeDiscogsBarcode('123456789012345')).toBeNull()
      expect(normalizeDiscogsBarcode('ABCDEFGHIJKL')).toBeNull()
    })

    it('returns no_token when Discogs token is not configured', async () => {
      mockGetSetting.mockImplementation((key: string) => {
        if (key === 'discogsToken') return undefined
        return undefined
      })

      expect(await queryDiscogsByBarcode('4988006812345')).toEqual({
        status: 'no_token',
        barcode: '4988006812345'
      })
      expect(mockThrottledFetch).not.toHaveBeenCalled()
    })

    it('resolves a barcode to a catalog number and caches the full result', async () => {
      mockThrottledFetch.mockImplementation(async (_domain: string, url: string) => {
        if (url.includes('/database/search')) {
          if (url.includes('barcode=')) {
            return okJson({
              results: [
                { id: 77, title: 'Artist - Barcode Album', catno: 'SICP 6480', cover_image: 'https://cdn/cover.jpg', uri: '/release/77' }
              ]
            })
          }
          return okJson({ results: [] })
        }
        if (url.includes('/marketplace/stats')) {
          return okJson({ lowest_price: { value: 20, currency: 'USD' } })
        }
        if (url.includes('/releases/77')) {
          return okJson({
            labels: [{ name: 'Barcode Label' }],
            formats: [{ name: 'CD', descriptions: ['Album'] }],
            country: 'Japan',
            released: '2023-01-02',
            year: '2023',
            genres: ['Rock'],
            styles: []
          })
        }
        return { ok: false, status: 404 }
      })

      const lookup = await queryDiscogsByBarcode('4 988006 812345')
      expect(lookup).toMatchObject({
        status: 'found',
        barcode: '4988006812345',
        catalogNumber: 'SICP-6480',
        title: 'Artist - Barcode Album'
      })
      expect(lookup.result).toMatchObject({
        platform: 'discogs',
        name: 'Barcode Album',
        artist: 'Artist',
        priceMin: 20,
        priceMax: 20,
        status: 'found'
      })

      const callsBefore = mockThrottledFetch.mock.calls.length
      const cached = await queryDiscogs('SICP-6480')
      expect(cached).toMatchObject({ platform: 'discogs', status: 'found', name: 'Barcode Album' })
      expect(mockThrottledFetch.mock.calls.length).toBe(callsBefore)
    })

    it('caches not_found barcode lookups', async () => {
      mockThrottledFetch.mockResolvedValue(okJson({ results: [] }))

      expect(await queryDiscogsByBarcode('4988006812345')).toMatchObject({ status: 'not_found' })
      expect(await queryDiscogsByBarcode('4988006812345')).toMatchObject({ status: 'not_found' })
      expect(mockThrottledFetch).toHaveBeenCalledTimes(1)
    })

    it('returns an error when the release has no catalog number', async () => {
      mockThrottledFetch.mockResolvedValue(okJson({
        results: [{ id: 88, title: 'No Catno Album', uri: '/release/88' }]
      }))

      const lookup = await queryDiscogsByBarcode('4988006812345')
      expect(lookup.status).toBe('error')
      expect(lookup.message).toContain('目录号')
    })

    it('returns an error when the API fails and never falls back to scraping', async () => {
      mockThrottledFetch.mockResolvedValue({ ok: false, status: 500 })

      const lookup = await queryDiscogsByBarcode('4988006812345')
      expect(lookup.status).toBe('error')
      expect(mockBrowserPool.acquire).not.toHaveBeenCalled()
    })
  })

  describe('web path', () => {
    it('returns not_found when the page shows no results', async () => {
      mockGetSetting.mockImplementation((key: string) => {
        if (key === 'discogsToken') return undefined
        if (key === 'cookies') return {}
        return undefined
      })
      const { page, browser } = createDiscogsPage()
      page.waitForSelector.mockRejectedValue(new Error('timeout'))
      page.$ = vi.fn().mockResolvedValue(null)
      mockBrowserPool.acquire.mockResolvedValue({ browser, page })

      const result = await queryDiscogs('NOPE-1')
      expect(result.status).toBe('not_found')
      expect(mockBrowserPool.release).toHaveBeenCalledWith(browser, page)
    })

    it('returns not_found when no result list item exists', async () => {
      mockGetSetting.mockImplementation((key: string) => (key === 'discogsToken' ? undefined : undefined))
      const { page, browser } = createDiscogsPage()
      page.waitForSelector.mockRejectedValue(new Error('timeout'))
      page.$ = vi.fn().mockResolvedValue(null)
      mockBrowserPool.acquire.mockResolvedValue({ browser, page })

      const result = await queryDiscogs('NOPE-1')
      expect(result.status).toBe('not_found')
    })

    it('uses DOM extraction first and skips LLM when the name is found', async () => {
      mockGetSetting.mockImplementation((key: string) => (key === 'discogsToken' ? undefined : undefined))
      const { page, browser } = createDiscogsPage()
      mockBrowserPool.acquire.mockResolvedValue({ browser, page })

      const result = await queryDiscogs('UCCG-90530')
      expect(result.name).toBe('Some Album')
      expect(mockTryLLMParse).not.toHaveBeenCalled()
    })

    it('returns not_found when DOM extraction misses the name and never invokes LLM', async () => {
      mockGetSetting.mockImplementation((key: string) => (key === 'discogsToken' ? undefined : undefined))
      const { page, browser, firstResult } = createDiscogsPage()
      firstResult.$eval.mockResolvedValue(null)
      mockBrowserPool.acquire.mockResolvedValue({ browser, page })

      const result = await queryDiscogs('UCCG-90530')
      expect(result.status).toBe('not_found')
      expect(mockTryLLMParse).not.toHaveBeenCalled()
    })

    it('returns a query error when both API and web fail', async () => {
      mockThrottledFetch.mockRejectedValue(new Error('API unreachable'))
      mockBrowserPool.acquire.mockRejectedValue(new Error('browser crashed'))

      const result = await queryDiscogs('UCCG-90530')
      expect(result).toMatchObject({ platform: 'discogs', status: 'error', error: 'browser crashed' })
    })
  })

  it('serves a repeated lookup from the query cache without re-fetching', async () => {
    mockThrottledFetch.mockImplementation(async (_domain: string, url: string) => {
      if (url.includes('/database/search')) {
        return okJson({ results: [{ id: 7, title: 'Artist - Cached Album', catno: 'CACHED-1', uri: '/release/7' }] })
      }
      if (url.includes('/marketplace/stats')) return okJson({})
      if (url.includes('/releases/')) return okJson({})
      return { ok: false, status: 404 }
    })

    const first = await queryDiscogs('CACHED-1')
    expect(first.status).toBe('found')
    const callsAfterFirst = mockThrottledFetch.mock.calls.length

    const second = await queryDiscogs('CACHED-1')
    expect(second).toEqual(first)
    expect(mockThrottledFetch.mock.calls.length).toBe(callsAfterFirst)
    expect(mockBrowserPool.acquire).not.toHaveBeenCalled()
  })
})
