import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createDomEvaluate } from './helpers/dom-evaluate'

const { mockGetSetting, mockBrowserPool, mockConvert, mockTryLLMParse } = vi.hoisted(() => ({
  mockGetSetting: vi.fn(),
  mockBrowserPool: { acquire: vi.fn(), release: vi.fn() },
  mockConvert: vi.fn(async (amount: number) => Math.round(amount * 0.0067 * 100) / 100),
  mockTryLLMParse: vi.fn()
}))

vi.mock('../src/main/settings', () => ({ getSetting: mockGetSetting }))
vi.mock('../src/main/browser', () => ({ browserPool: mockBrowserPool }))
vi.mock('../src/main/currency', () => ({ convertToUSDWithFallback: mockConvert }))
vi.mock('../src/main/llm/parser', () => ({ tryLLMParse: mockTryLLMParse }))

import { queryKojima } from '../src/main/queries/kojima'
import { clearAllCaches } from '../src/main/queries/cache'

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

  it('extracts card data and product page details with price', async () => {
    const { page, browser } = createKojimaPage()
    page.evaluate = createDomEvaluate([
      '<div class="price__regular"><span class="price-item--regular">¥3,300</span></div>',
      '<div class="product__description">Format: SACD\n発売日: 2024-01-15\nレーベル: Test Label\nジャンル: Jazz\nアーティスト: Someone</div>'
    ])
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
    expect(page.goto).toHaveBeenCalledWith('https://kojimarokuon.com/products/1', expect.anything())
  })

  it('extracts variant options, meta fields and tags when no description exists', async () => {
    const { page, browser } = createKojimaPage()
    page.evaluate = createDomEvaluate([
      '<div class="product__price">¥1,000</div>',
      '<select name="id"><option>SACD</option></select>' +
        '<div class="product__meta">Release: 2024</div>' +
        '<div class="product-tags"><a>Jazz</a><a>Japan</a></div>'
    ])
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const result = await runWithFakeTimers(() => queryKojima('ABC-123'))

    expect(result).toMatchObject({
      priceMin: 6.7,
      details: { format: 'SACD', released: '2024', genre: 'Jazz / Japan', country: 'Japan' }
    })
    expect(result.details?.label).toBeNull()
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
    const { page, browser } = createKojimaPage()
    page.evaluate = createDomEvaluate([
      '<div class="product__price">¥1,000</div>',
      '<div class="product__description"></div>'
    ])
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const first = await runWithFakeTimers(() => queryKojima('CACHED-1'))
    expect(first.status).toBe('found')
    expect(mockBrowserPool.acquire).toHaveBeenCalledTimes(1)

    mockBrowserPool.acquire.mockClear()
    const second = await runWithFakeTimers(() => queryKojima('CACHED-1'))
    expect(second).toEqual(first)
    expect(mockBrowserPool.acquire).not.toHaveBeenCalled()
  })

  it('reuses cached product details across different catalog numbers', async () => {
    const { page, browser } = createKojimaPage()
    page.evaluate = createDomEvaluate([
      '<div class="product__price">¥2,000</div>',
      '<div class="product__description"></div>'
    ])
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const first = await runWithFakeTimers(() => queryKojima('ALBUM-1'))
    expect(first.status).toBe('found')
    // Search page + product page.
    expect(page.goto).toHaveBeenCalledTimes(2)

    page.goto.mockClear()
    const second = await runWithFakeTimers(() => queryKojima('ALBUM-2'))
    expect(second.status).toBe('found')
    // Only the search page is loaded; product details come from the cache.
    expect(page.goto).toHaveBeenCalledTimes(1)
    expect(second.priceMin).toBe(13.4)
  })
})
