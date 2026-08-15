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

import { queryHmv } from '../src/main/queries/hmv'
import { clearAllCaches } from '../src/main/queries/cache'

function createHmvPage() {
  const firstItem = {
    $eval: vi.fn(async (selector: string) => {
      if (selector === '.itemText h3 a, .itemText .title a') return 'HMV Album'
      if (selector === '.itemStates .name a, .itemStates .name') return 'HMV Artist'
      if (selector === '.itemImg img') return '//cdn.hmv.example/cover.jpg'
      if (selector === '.itemImg a, h3 a') return '/product/1'
      if (selector === '.itemStates .price .right') return '¥2,200'
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
  mockGetSetting.mockReturnValue(undefined)
  mockTryLLMParse.mockResolvedValue(null)
  mockBrowserPool.acquire.mockResolvedValue({ browser: {}, page: {} })
  mockBrowserPool.release.mockResolvedValue(undefined)
})

describe('queryHmv', () => {
  it('returns not_found when search has no results', async () => {
    const { page, browser } = createHmvPage()
    page.waitForSelector.mockRejectedValue(new Error('timeout'))
    page.$ = vi.fn().mockResolvedValue(null)
    page.evaluate = createDomEvaluate(['<body>0 results found</body>'])
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const result = await runWithFakeTimers(() => queryHmv('ABC-123'))

    expect(result.status).toBe('not_found')
    expect(page.setCookie).not.toHaveBeenCalled()
    expect(mockBrowserPool.release).toHaveBeenCalledWith(browser, page)
  })

  it('returns not_found when no product list item exists', async () => {
    const { page, browser } = createHmvPage()
    page.waitForSelector.mockRejectedValue(new Error('timeout'))
    page.$ = vi.fn().mockResolvedValue(null)
    page.evaluate = createDomEvaluate(['<body>normal page</body>'])
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const result = await runWithFakeTimers(() => queryHmv('ABC-123'))
    expect(result.status).toBe('not_found')
  })

  it('extracts search result and spec table details', async () => {
    const { page, browser } = createHmvPage()
    page.evaluate = createDomEvaluate([
      '<div class="priceInfoBlock fontLarge"><span class="price">¥3,900</span></div>',
      '<table class="productSpec">' +
        '<tr><th>Format</th><td>CD</td></tr>' +
        '<tr><th>発売日</th><td>2024/03/01</td></tr>' +
        '<tr><th>レーベル</th><td>HMV Label</td></tr>' +
        '<tr><th>ジャンル</th><td>Pop</td></tr>' +
        '</table>'
    ])
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const result = await runWithFakeTimers(() => queryHmv('ABC-123'))

    expect(result).toMatchObject({
      platform: 'hmv',
      name: 'HMV Album',
      artist: 'HMV Artist',
      coverUrl: 'https://cdn.hmv.example/cover.jpg',
      link: 'https://www.hmv.co.jp/product/1',
      priceMin: 14.74,
      priceMax: 14.74,
      status: 'found',
      details: { format: 'CD', released: '2024/03/01', label: 'HMV Label', genre: 'Pop', country: 'Japan' }
    })
  })

  it('handles placeholders, missing search price and alternative details', async () => {
    const { page, browser, firstItem } = createHmvPage()
    firstItem.$eval.mockImplementation(async (selector: string) => {
      if (selector === '.itemText h3 a, .itemText .title a') return 'Lazy Album'
      if (selector === '.itemStates .name a, .itemStates .name') return 'Artist'
      if (selector === '.itemImg img') return 'https://cdn.hmv.example/blank.gif'
      if (selector === '.itemImg a, h3 a') return '/product/2'
      if (selector === '.itemStates .price .right') return ''
      return null
    })
    page.evaluate = createDomEvaluate([
      '<div class="price">¥1,000</div>',
      '<body>発売日: 2024年1月15日<span class="format">CD</span><div class="breadcrumb"><a>Home</a><a>Jazz</a><span>Sub</span></div></body>'
    ])
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const result = await runWithFakeTimers(() => queryHmv('ABC-123'))

    expect(result.name).toBe('Lazy Album')
    expect(result.coverUrl).toBeNull()
    expect(result.priceMin).toBe(6.7)
    expect(result.details).toMatchObject({
      format: 'CD',
      released: '2024年1月15日',
      genre: 'Jazz / Sub',
      country: 'Japan'
    })
  })

  it('falls back to a direct img tag when the item image selector misses', async () => {
    const { page, browser, firstItem } = createHmvPage()
    firstItem.$eval.mockImplementation(async (selector: string) => {
      if (selector === '.itemText h3 a, .itemText .title a') return 'Fallback Album'
      if (selector === '.itemStates .name a, .itemStates .name') return 'Fallback Artist'
      if (selector === '.itemImg img') return null
      if (selector === 'img') return '//cdn.hmv.example/direct.jpg'
      if (selector === '.itemImg a, h3 a') return null
      if (selector === '.itemStates .price .right') return '¥2,200'
      return null
    })
    page.evaluate = createDomEvaluate(['<body>normal search page</body>'])
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const result = await runWithFakeTimers(() => queryHmv('ABC-123'))

    expect(result.name).toBe('Fallback Album')
    expect(result.coverUrl).toBe('https://cdn.hmv.example/direct.jpg')
    expect(result.link).toBeNull()
  })

  it('falls back to a picture/source tag when both image selectors miss', async () => {
    const { page, browser, firstItem } = createHmvPage()
    firstItem.$eval.mockImplementation(async (selector: string) => {
      if (selector === '.itemText h3 a, .itemText .title a') return 'Picture Album'
      if (selector === '.itemStates .name a, .itemStates .name') return 'Picture Artist'
      if (selector === '.itemImg img') return null
      if (selector === 'img') return null
      if (selector === 'picture source, source') return '//cdn.hmv.example/picture.jpg'
      if (selector === '.itemImg a, h3 a') return null
      if (selector === '.itemStates .price .right') return '¥1,000'
      return null
    })
    page.evaluate = createDomEvaluate(['<body>normal search page</body>'])
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const result = await runWithFakeTimers(() => queryHmv('ABC-123'))

    expect(result.name).toBe('Picture Album')
    expect(result.coverUrl).toBe('https://cdn.hmv.example/picture.jpg')
    expect(result.link).toBeNull()
  })

  it('prefers DOM extraction and skips LLM when the name is found', async () => {
    const { page, browser } = createHmvPage()
    page.evaluate = createDomEvaluate([
      '<div class="priceInfoBlock"><span class="price">¥2,200</span></div>',
      '<div class="productSpec"></div>'
    ])
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })
    mockTryLLMParse.mockResolvedValue({
      platform: 'hmv',
      name: 'LLM Album',
      artist: null,
      priceMin: null,
      priceMax: null,
      coverUrl: null,
      link: null,
      status: 'found'
    })

    const result = await runWithFakeTimers(() => queryHmv('ABC-123'))

    expect(result.name).toBe('HMV Album')
    expect(mockTryLLMParse).not.toHaveBeenCalled()
  })

  it('returns not_found when DOM extraction misses the name and never invokes LLM', async () => {
    const { page, browser, firstItem } = createHmvPage()
    firstItem.$eval.mockImplementation(async (selector: string) => {
      if (selector === '.itemText h3 a, .itemText .title a') return null
      if (selector === '.itemImg img') return '//cdn.hmv.example/cover.jpg'
      if (selector === '.itemImg a, h3 a') return '/product/1'
      if (selector === '.itemStates .price .right') return '¥2,200'
      return null
    })
    page.evaluate = createDomEvaluate(['<body>normal search page</body>'])
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const result = await runWithFakeTimers(() => queryHmv('ABC-123'))

    expect(result.status).toBe('not_found')
    expect(mockTryLLMParse).not.toHaveBeenCalled()
  })

  it('returns a query error when the browser fails', async () => {
    mockBrowserPool.acquire.mockRejectedValue(new Error('no browser'))
    const result = await queryHmv('ABC-123')
    expect(result).toMatchObject({ platform: 'hmv', status: 'error', error: 'no browser' })
  })

  it('serves a repeated lookup from the query cache without using the browser', async () => {
    const { page, browser } = createHmvPage()
    page.evaluate = createDomEvaluate([
      '<div class="priceInfoBlock"><span class="price">¥1,000</span></div>',
      '<div class="productSpec"></div>'
    ])
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const first = await runWithFakeTimers(() => queryHmv('CACHED-1'))
    expect(first.status).toBe('found')
    expect(mockBrowserPool.acquire).toHaveBeenCalledTimes(1)

    mockBrowserPool.acquire.mockClear()
    const second = await runWithFakeTimers(() => queryHmv('CACHED-1'))
    expect(second).toEqual(first)
    expect(mockBrowserPool.acquire).not.toHaveBeenCalled()
  })

  it('reuses cached product details across different catalog numbers', async () => {
    const { page, browser } = createHmvPage()
    page.evaluate = createDomEvaluate([
      '<div class="priceInfoBlock"><span class="price">¥2,000</span></div>' +
        '<table class="productSpec"><tr><th>Format</th><td>CD</td></tr></table>'
    ])
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const first = await runWithFakeTimers(() => queryHmv('ALBUM-1'))
    expect(first.status).toBe('found')
    // Search page + product page.
    expect(page.goto).toHaveBeenCalledTimes(2)

    page.goto.mockClear()
    const second = await runWithFakeTimers(() => queryHmv('ALBUM-2'))
    expect(second.status).toBe('found')
    // Only the search page is loaded; product details come from the cache.
    expect(page.goto).toHaveBeenCalledTimes(1)
    // Search page still provides its own price; details come from the cache.
    expect(second.priceMin).toBe(14.74)
    expect(second.details).toMatchObject({ format: 'CD', country: 'Japan' })
  })

  it('skips the product page navigation in fast mode', async () => {
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'fastMode') return true
      return undefined
    })
    const { page, browser } = createHmvPage()
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const result = await runWithFakeTimers(() => queryHmv('ABC-123'))

    expect(result.status).toBe('found')
    expect(result.priceMin).toBe(14.74)
    expect(result.details).toBeUndefined()
    // Only the search page is loaded; no product page navigation happens.
    expect(page.goto).toHaveBeenCalledTimes(1)
    expect(page.goto).toHaveBeenCalledWith(expect.stringContaining('/search/'), expect.anything())
  })
})
