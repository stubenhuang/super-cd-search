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
  mockGetSetting.mockImplementation((key: string) => {
    if (key === 'cookies') return { hmv: 'cookie-value' }
    return undefined
  })
  mockTryLLMParse.mockResolvedValue(null)
  mockBrowserPool.acquire.mockResolvedValue({ browser: {}, page: {} })
  mockBrowserPool.release.mockResolvedValue(undefined)
})

describe('queryHmv', () => {
  it('returns not_found when search has no results', async () => {
    const { page, browser } = createHmvPage()
    page.evaluate = createDomEvaluate(['<body>0 results found</body>'])
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const result = await runWithFakeTimers(() => queryHmv('ABC-123'))

    expect(result.status).toBe('not_found')
    expect(page.setCookie).toHaveBeenCalled()
    expect(mockBrowserPool.release).toHaveBeenCalledWith(browser, page)
  })

  it('returns not_found when no product list item exists', async () => {
    const { page, browser } = createHmvPage()
    page.evaluate = createDomEvaluate(['<body>normal page</body>'])
    page.$ = vi.fn().mockResolvedValue(null)
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const result = await runWithFakeTimers(() => queryHmv('ABC-123'))
    expect(result.status).toBe('not_found')
  })

  it('extracts search result and spec table details', async () => {
    const { page, browser } = createHmvPage()
    page.evaluate = createDomEvaluate([
      '<body>normal search page</body>',
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
      '<body>normal search page</body>',
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

  it('prefers LLM results but falls back to the extracted cover image', async () => {
    const { page, browser } = createHmvPage()
    page.evaluate = createDomEvaluate(['<body>normal search page</body>'])
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

    expect(result.name).toBe('LLM Album')
    expect(result.coverUrl).toBe('https://cdn.hmv.example/cover.jpg')
  })

  it('returns a query error when the browser fails', async () => {
    mockBrowserPool.acquire.mockRejectedValue(new Error('no browser'))
    const result = await queryHmv('ABC-123')
    expect(result).toMatchObject({ platform: 'hmv', status: 'error', error: 'no browser' })
  })
})
