import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createDomEvaluate } from './helpers/dom-evaluate'

const { mockGetSetting, mockBrowserPool, mockConvert, mockTryLLMParse, mockThrottledFetch } = vi.hoisted(() => ({
  mockGetSetting: vi.fn(),
  mockBrowserPool: { acquire: vi.fn(), release: vi.fn() },
  mockConvert: vi.fn(async (amount: number) => Math.round(amount * 0.0067 * 100) / 100),
  mockTryLLMParse: vi.fn(),
  mockThrottledFetch: vi.fn()
}))

vi.mock('../src/main/settings', () => ({ getSetting: mockGetSetting }))
vi.mock('../src/main/browser', () => ({ browserPool: mockBrowserPool }))
vi.mock('../src/main/currency', () => ({ convertToUSDWithFallback: mockConvert }))
vi.mock('../src/main/llm/parser', () => ({ tryLLMParse: mockTryLLMParse }))
vi.mock('../src/main/throttle', () => ({ throttledFetch: mockThrottledFetch }))

import { queryKojima } from '../src/main/queries/kojima'
import { clearAllCaches } from '../src/main/queries/cache'

function okJson(data: unknown) {
  return { ok: true, status: 200, json: async () => data }
}

function notOk() {
  return { ok: false, status: 404, json: async () => ({}) }
}

function createKojimaPage() {
  let headingCalls = 0
  const firstItem = {
    $eval: vi.fn(async (selector: string) => {
      if (selector === '.card__heading a') {
        headingCalls++
        return headingCalls === 1 ? 'Kojima Album' : '/products/1'
      }
      if (selector === '.card__media img') return '//cdn.kojima.example/cover.jpg'
      return null
    })
  }
  const page = {
    setCookie: vi.fn().mockResolvedValue(undefined),
    setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue({}),
    evaluate: vi.fn(),
    $: vi.fn().mockResolvedValue(firstItem),
    content: vi.fn().mockResolvedValue('<html></html>'),
    close: vi.fn().mockResolvedValue(undefined)
  }
  const browser = { close: vi.fn() }
  return { page, browser, firstItem }
}

async function runWithFakeTimers<T>(fn: () => Promise<T>, totalMs = 30000): Promise<T> {
  vi.useFakeTimers()
  const promise = fn()
  await vi.advanceTimersByTimeAsync(totalMs)
  vi.useRealTimers()
  return await promise
}

beforeEach(() => {
  vi.clearAllMocks()
  clearAllCaches()
  mockGetSetting.mockImplementation((key: string) => {
    if (key === 'cookies') return { kojima: 'cookie-value' }
    return undefined
  })
  mockTryLLMParse.mockResolvedValue(null)
  mockBrowserPool.acquire.mockResolvedValue({ browser: {}, page: {} })
  mockBrowserPool.release.mockResolvedValue(undefined)
  mockThrottledFetch.mockResolvedValue(notOk())
})

describe('queryKojima', () => {
  it('returns not_found when search has no results', async () => {
    const { page, browser } = createKojimaPage()
    page.waitForSelector.mockRejectedValue(new Error('timeout'))
    page.$ = vi.fn().mockResolvedValue(null)
    page.evaluate = createDomEvaluate(['<body>検索結果は見つかりませんでした</body>'])
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const result = await runWithFakeTimers(() => queryKojima('ABC-123'))

    expect(result.status).toBe('not_found')
    expect(page.setCookie).toHaveBeenCalledWith({
      name: 'kojimarokuon',
      value: 'cookie-value',
      domain: '.kojimarokuon.com',
      path: '/'
    })
    expect(mockBrowserPool.release).toHaveBeenCalledWith(browser, page)
  })

  it('returns not_found when no card is present', async () => {
    const { page, browser } = createKojimaPage()
    page.waitForSelector.mockRejectedValue(new Error('timeout'))
    page.$ = vi.fn().mockResolvedValue(null)
    page.evaluate = createDomEvaluate(['<body>normal page</body>'])
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const result = await runWithFakeTimers(() => queryKojima('ABC-123'))
    expect(result.status).toBe('not_found')
  })

  it('extracts card data and JSON product details without rendering the product page', async () => {
    mockThrottledFetch.mockResolvedValue(okJson({
      price: 330000,
      price_min: 330000,
      description: '<p>Format: SACD</p><p>発売日: 2024-01-15</p><p>レーベル: Test Label</p><p>ジャンル: Jazz</p>',
      tags: []
    }))
    const { page, browser } = createKojimaPage()
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const result = await runWithFakeTimers(() => queryKojima('ABC-123'))

    expect(result).toMatchObject({
      platform: 'kojima',
      name: 'Kojima Album',
      coverUrl: 'https://cdn.kojima.example/cover.jpg',
      link: 'https://kojimarokuon.com/products/1',
      priceMin: 22.11,
      priceMax: 22.11,
      status: 'found',
      details: { format: 'SACD', released: '2024-01-15', label: 'Test Label', genre: 'Jazz', country: 'Japan' }
    })
    // Only the search page is loaded; the product page is never rendered.
    expect(page.goto).toHaveBeenCalledTimes(1)
    expect(page.goto).toHaveBeenCalledWith(expect.stringContaining('/search/'), expect.anything())
    expect(mockThrottledFetch).toHaveBeenCalledWith(
      'kojimarokuon.com',
      expect.stringContaining('/products/1.js'),
      undefined,
      expect.anything()
    )
  })

  it('falls back to rendering when the JSON endpoint is unavailable', async () => {
    const { page, browser } = createKojimaPage()
    page.evaluate = createDomEvaluate([
      '<div class="product__price">¥1,000</div>',
      '<select name="id"><option>SACD</option></select>' +
        '<div class="product__meta">Release: 2024</div>' +
        '<div class="product-tags"><a>Jazz</a><a>Japan</a></div>'
    ])
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })
    // default mockThrottledFetch -> notOk(), so the JSON path returns null

    const result = await runWithFakeTimers(() => queryKojima('ABC-123'))

    expect(result).toMatchObject({
      priceMin: 6.7,
      details: { format: 'SACD', released: '2024', genre: 'Jazz / Japan', country: 'Japan' }
    })
    expect(result.details?.label).toBeNull()
    expect(page.goto).toHaveBeenCalledWith('https://kojimarokuon.com/products/1', expect.anything())
  })

  it('prefers DOM extraction and skips LLM when the name is found', async () => {
    const { page, browser } = createKojimaPage()
    page.evaluate = createDomEvaluate([
      '<div class="product__price">¥2,000</div>',
      '<div class="product__description"></div>'
    ])
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })
    mockTryLLMParse.mockResolvedValue({
      platform: 'kojima',
      name: 'LLM Album',
      artist: null,
      priceMin: null,
      priceMax: null,
      coverUrl: null,
      link: null,
      status: 'found'
    })

    const result = await runWithFakeTimers(() => queryKojima('ABC-123'))

    expect(result.name).toBe('Kojima Album')
    expect(mockTryLLMParse).not.toHaveBeenCalled()
  })

  it('falls back to LLM parsing when DOM extraction misses the name', async () => {
    const { page, browser, firstItem } = createKojimaPage()
    firstItem.$eval.mockImplementation(async (selector: string) => {
      if (selector === '.card__media img') return '//cdn.kojima.example/cover.jpg'
      return null
    })
    page.evaluate = createDomEvaluate(['<body>normal search page</body>'])
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })
    mockTryLLMParse.mockResolvedValue({
      platform: 'kojima',
      name: 'LLM Album',
      artist: null,
      priceMin: null,
      priceMax: null,
      coverUrl: null,
      link: null,
      status: 'found'
    })

    const result = await runWithFakeTimers(() => queryKojima('ABC-123'))

    expect(result.name).toBe('LLM Album')
    expect(result.coverUrl).toBe('https://cdn.kojima.example/cover.jpg')
    expect(mockTryLLMParse).toHaveBeenCalled()
  })

  it('returns a query error when the browser fails', async () => {
    mockBrowserPool.acquire.mockRejectedValue(new Error('no browser'))
    const result = await queryKojima('ABC-123')
    expect(result).toMatchObject({ platform: 'kojima', status: 'error', error: 'no browser' })
  })

  it('serves a repeated lookup from the query cache without using the browser', async () => {
    mockThrottledFetch.mockResolvedValue(okJson({ price: 200000, price_min: 200000, description: '', tags: [] }))
    const { page, browser } = createKojimaPage()
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const first = await runWithFakeTimers(() => queryKojima('CACHED-1'))
    expect(first.status).toBe('found')
    expect(mockBrowserPool.acquire).toHaveBeenCalledTimes(1)

    mockBrowserPool.acquire.mockClear()
    const second = await runWithFakeTimers(() => queryKojima('CACHED-1'))
    expect(second).toEqual(first)
    expect(mockBrowserPool.acquire).not.toHaveBeenCalled()
  })

  it('reuses cached JSON product details across different catalog numbers', async () => {
    mockThrottledFetch.mockResolvedValue(okJson({ price: 330000, price_min: 330000, description: '', tags: [] }))
    const { page, browser } = createKojimaPage()
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const first = await runWithFakeTimers(() => queryKojima('ALBUM-1'))
    expect(first.status).toBe('found')
    // Only the search page is loaded; details come from the JSON endpoint.
    expect(page.goto).toHaveBeenCalledTimes(1)
    expect(mockThrottledFetch).toHaveBeenCalledTimes(1)

    page.goto.mockClear()
    const second = await runWithFakeTimers(() => queryKojima('ALBUM-2'))
    expect(second.status).toBe('found')
    // Only the search page is loaded again; product data comes from the cache.
    expect(page.goto).toHaveBeenCalledTimes(1)
    expect(mockThrottledFetch).toHaveBeenCalledTimes(1)
    expect(second.priceMin).toBe(22.11)
  })
})
