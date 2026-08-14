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

import { queryYahoo } from '../src/main/queries/yahoo'
import { clearAllCaches } from '../src/main/queries/cache'

function createYahooPage() {
  const firstItem = {
    evaluate: vi.fn(async () => ({
      name: 'Yahoo Album',
      link: 'https://store.example.com/item/1',
      coverUrl: 'https://cdn.example.com/cover.jpg',
      priceText: '¥1,980',
      storeName: 'Test Store'
    }))
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
    if (key === 'cookies') return { yahoo: 'cookie-value' }
    return undefined
  })
  mockTryLLMParse.mockResolvedValue(null)
  mockBrowserPool.acquire.mockResolvedValue({ browser: {}, page: {} })
  mockBrowserPool.release.mockResolvedValue(undefined)
})

describe('queryYahoo', () => {
  it('returns not_found when search has no results', async () => {
    const { page, browser } = createYahooPage()
    page.waitForSelector.mockRejectedValue(new Error('timeout'))
    page.$ = vi.fn().mockResolvedValue(null)
    page.evaluate = createDomEvaluate(['<body>検索条件に一致する商品が見つかりませんでした</body>'])
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const result = await runWithFakeTimers(() => queryYahoo('ABC-123'))

    expect(result.status).toBe('not_found')
    expect(page.setCookie).toHaveBeenCalled()
    expect(mockBrowserPool.release).toHaveBeenCalledWith(browser, page)
  })

  it('returns not_found when no result item exists', async () => {
    const { page, browser } = createYahooPage()
    page.waitForSelector.mockRejectedValue(new Error('timeout'))
    page.$ = vi.fn().mockResolvedValue(null)
    page.evaluate = createDomEvaluate(['<body>normal page</body>'])
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const result = await runWithFakeTimers(() => queryYahoo('ABC-123'))
    expect(result.status).toBe('not_found')
  })

  it('extracts search result data, price and spec table details', async () => {
    const { page, browser } = createYahooPage()
    page.evaluate = createDomEvaluate([
      '<table>' +
        '<tr><th>フォーマット</th><td>CD</td></tr>' +
        '<tr><th>発売日</th><td>2024/02/02</td></tr>' +
        '<tr><th>レーベル</th><td>Y Label</td></tr>' +
        '<tr><th>ジャンル</th><td>Rock</td></tr>' +
        '</table>'
    ])
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const result = await runWithFakeTimers(() => queryYahoo('ABC-123'))

    expect(result).toMatchObject({
      platform: 'yahoo',
      name: 'Yahoo Album',
      artist: 'Test Store',
      priceMin: 13.27,
      priceMax: 13.27,
      coverUrl: 'https://cdn.example.com/cover.jpg',
      link: 'https://store.example.com/item/1',
      status: 'found',
      details: { format: 'CD', released: '2024/02/02', label: 'Y Label', genre: 'Rock' }
    })
    expect(page.goto).toHaveBeenCalledWith('https://store.example.com/item/1', expect.anything())
  })

  it('parses description text when no spec table exists', async () => {
    const { page, browser } = createYahooPage()
    page.evaluate = createDomEvaluate([
      '<div class="productDescription">フォーマット: CD\n発売日: 2024-02-02\nレーベル: Y Label\nジャンル: Rock</div>'
    ])
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const result = await runWithFakeTimers(() => queryYahoo('ABC-123'))
    expect(result.details).toMatchObject({
      format: 'CD',
      released: '2024-02-02',
      label: 'Y Label',
      genre: 'Rock'
    })
  })

  it('omits details when the product page has none', async () => {
    const { page, browser } = createYahooPage()
    page.evaluate = createDomEvaluate(['<body>nothing here</body>'])
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const result = await runWithFakeTimers(() => queryYahoo('ABC-123'))
    expect(result.details).toBeUndefined()
  })

  it('prefers DOM extraction and skips LLM when the name is found', async () => {
    const { page, browser } = createYahooPage()
    page.evaluate = createDomEvaluate(['<body>nothing here</body>'])
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })
    mockTryLLMParse.mockResolvedValue({
      platform: 'yahoo',
      name: 'LLM Album',
      artist: null,
      priceMin: null,
      priceMax: null,
      coverUrl: null,
      link: null,
      status: 'found'
    })

    const result = await runWithFakeTimers(() => queryYahoo('ABC-123'))

    expect(result.name).toBe('Yahoo Album')
    expect(mockTryLLMParse).not.toHaveBeenCalled()
  })

  it('falls back to LLM parsing when DOM extraction misses the name', async () => {
    const { page, browser, firstItem } = createYahooPage()
    firstItem.evaluate.mockImplementation(async () => ({
      name: null,
      link: 'https://store.example.com/item/1',
      coverUrl: 'https://cdn.example.com/cover.jpg',
      priceText: '¥1,980',
      storeName: 'Test Store'
    }))
    page.evaluate = createDomEvaluate(['<body>normal search page</body>'])
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })
    mockTryLLMParse.mockResolvedValue({
      platform: 'yahoo',
      name: 'LLM Album',
      artist: null,
      priceMin: null,
      priceMax: null,
      coverUrl: null,
      link: null,
      status: 'found'
    })

    const result = await runWithFakeTimers(() => queryYahoo('ABC-123'))

    expect(result.name).toBe('LLM Album')
    expect(result.coverUrl).toBe('https://cdn.example.com/cover.jpg')
    expect(mockTryLLMParse).toHaveBeenCalled()
  })

  it('returns a query error when the browser fails', async () => {
    mockBrowserPool.acquire.mockRejectedValue(new Error('no browser'))
    const result = await queryYahoo('ABC-123')
    expect(result).toMatchObject({ platform: 'yahoo', status: 'error', error: 'no browser' })
  })

  it('serves a repeated lookup from the query cache without using the browser', async () => {
    const { page, browser } = createYahooPage()
    page.evaluate = createDomEvaluate(['<body>nothing here</body>'])
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const first = await runWithFakeTimers(() => queryYahoo('CACHED-1'))
    expect(first.status).toBe('found')
    expect(mockBrowserPool.acquire).toHaveBeenCalledTimes(1)

    mockBrowserPool.acquire.mockClear()
    const second = await runWithFakeTimers(() => queryYahoo('CACHED-1'))
    expect(second).toEqual(first)
    expect(mockBrowserPool.acquire).not.toHaveBeenCalled()
  })

  it('reuses cached product details across different catalog numbers', async () => {
    const { page, browser } = createYahooPage()
    page.evaluate = createDomEvaluate([
      '<table><tr><th>フォーマット</th><td>CD</td></tr></table>'
    ])
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const first = await runWithFakeTimers(() => queryYahoo('ALBUM-1'))
    expect(first.status).toBe('found')
    // Search page + product page.
    expect(page.goto).toHaveBeenCalledTimes(2)

    page.goto.mockClear()
    const second = await runWithFakeTimers(() => queryYahoo('ALBUM-2'))
    expect(second.status).toBe('found')
    // Only the search page is loaded; product details come from the cache.
    expect(page.goto).toHaveBeenCalledTimes(1)
    expect(second.details).toMatchObject({ format: 'CD' })
  })

  it('skips the product page navigation in fast mode', async () => {
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'cookies') return { yahoo: 'cookie-value' }
      if (key === 'fastMode') return true
      return undefined
    })
    const { page, browser } = createYahooPage()
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const result = await runWithFakeTimers(() => queryYahoo('ABC-123'))

    expect(result.status).toBe('found')
    expect(result.priceMin).toBe(13.27)
    expect(result.details).toBeUndefined()
    // Only the search page is loaded; no product page navigation happens.
    expect(page.goto).toHaveBeenCalledTimes(1)
  })
})
