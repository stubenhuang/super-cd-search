import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createDomEvaluate } from './helpers/dom-evaluate'

const { mockGetSetting, mockBrowserPool, mockConvert, mockTryLLMParse } = vi.hoisted(() => ({
  mockGetSetting: vi.fn(),
  mockBrowserPool: { acquire: vi.fn(), release: vi.fn() },
  mockConvert: vi.fn(async (amount: number) => amount),
  mockTryLLMParse: vi.fn()
}))

vi.mock('../src/main/settings', () => ({ getSetting: mockGetSetting }))
vi.mock('../src/main/browser', () => ({ browserPool: mockBrowserPool }))
vi.mock('../src/main/currency', () => ({ convertToUSDWithFallback: mockConvert }))
vi.mock('../src/main/llm/parser', () => ({ tryLLMParse: mockTryLLMParse }))

import { queryCdjapan } from '../src/main/queries/cdjapan'
import { clearAllCaches } from '../src/main/queries/cache'

function createCdjapanPage() {
  const page = {
    setCookie: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn(),
    content: vi.fn().mockResolvedValue('<html></html>'),
    close: vi.fn().mockResolvedValue(undefined)
  }
  const browser = { close: vi.fn() }
  return { page, browser }
}

beforeEach(() => {
  vi.clearAllMocks()
  clearAllCaches()
  mockGetSetting.mockImplementation((key: string) => {
    if (key === 'cookies') return { cdjapan: 'cookie-value' }
    return undefined
  })
  mockTryLLMParse.mockResolvedValue(null)
  mockBrowserPool.acquire.mockResolvedValue({ browser: {}, page: {} })
  mockBrowserPool.release.mockResolvedValue(undefined)
})

describe('queryCdjapan', () => {
  it('extracts product info from the schema.org markup', async () => {
    const { page, browser } = createCdjapanPage()
    page.evaluate = createDomEvaluate([
      '<html><head><meta property="og:image" content="http://st.cdjapan.co.jp/pictures/l/15/19/X-1.jpg"></head><body>' +
        '<h1><span itemprop="name">CDJapan Album</span></h1>' +
        '<h3 class="person"><a>Some Artist</a></h3>' +
        '<span class="label media">CD Maxi</span>' +
        '<span itemprop="price" content="18.83">3000yen</span>' +
        '<span itemprop="releaseDate">June 03, 2026</span>' +
        '</body></html>'
    ])
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const result = await queryCdjapan('X-1')

    expect(result).toMatchObject({
      platform: 'cdjapan',
      name: 'CDJapan Album',
      artist: 'Some Artist',
      priceMin: 3000,
      priceMax: 3000,
      coverUrl: 'https://st.cdjapan.co.jp/pictures/l/15/19/X-1.jpg',
      link: 'https://www.cdjapan.co.jp/product/X-1',
      status: 'found',
      details: { format: 'CD Maxi', released: 'June 03, 2026' }
    })
    expect(page.goto).toHaveBeenCalledWith('https://www.cdjapan.co.jp/product/X-1', expect.anything())
    expect(mockConvert).toHaveBeenCalledWith(3000, 'JPY')
    expect(mockBrowserPool.release).toHaveBeenCalledWith(browser, page)
  })

  it('uses the priceCurrency meta when the visible label is not in yen', async () => {
    const { page, browser } = createCdjapanPage()
    page.evaluate = createDomEvaluate([
      '<html><head><meta itemprop="priceCurrency" content="USD"></head><body>' +
        '<h1><span itemprop="name">Localized Album</span></h1>' +
        '<span itemprop="price" content="18.83">US$18.83</span>' +
        '</body></html>'
    ])
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const result = await queryCdjapan('X-2')
    expect(result.priceMin).toBe(18.83)
    expect(mockConvert).toHaveBeenCalledWith(18.83, 'USD')
  })

  it('returns not_found when the page has no product name', async () => {
    const { page, browser } = createCdjapanPage()
    page.evaluate = createDomEvaluate(['<html><body>404 not found</body></html>'])
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const result = await queryCdjapan('NOPE-1')
    expect(result.status).toBe('not_found')
    expect(mockBrowserPool.release).toHaveBeenCalledWith(browser, page)
  })

  it('returns not_found when DOM extraction misses the name and never invokes LLM', async () => {
    const { page, browser } = createCdjapanPage()
    page.evaluate = createDomEvaluate(['<html><body>some page</body></html>'])
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const result = await queryCdjapan('X-1')
    expect(result.status).toBe('not_found')
    expect(mockTryLLMParse).not.toHaveBeenCalled()
  })

  it('serves a repeated lookup from the query cache', async () => {
    const { page, browser } = createCdjapanPage()
    page.evaluate = createDomEvaluate([
      '<html><body><h1><span itemprop="name">Cached Album</span></h1></body></html>'
    ])
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const first = await queryCdjapan('CACHED-1')
    expect(first.status).toBe('found')
    expect(mockBrowserPool.acquire).toHaveBeenCalledTimes(1)

    mockBrowserPool.acquire.mockClear()
    const second = await queryCdjapan('CACHED-1')
    expect(second).toEqual(first)
    expect(mockBrowserPool.acquire).not.toHaveBeenCalled()
  })

  it('returns a query error when the browser fails', async () => {
    mockBrowserPool.acquire.mockRejectedValue(new Error('no browser'))
    const result = await queryCdjapan('X-1')
    expect(result).toMatchObject({ platform: 'cdjapan', status: 'error', error: 'no browser' })
  })
})
