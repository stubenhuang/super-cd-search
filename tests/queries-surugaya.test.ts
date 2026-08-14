import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createDomEvaluate } from './helpers/dom-evaluate'

const { mockAcquire, mockIsChallenge, mockConvert, mockTryLLMParse } = vi.hoisted(() => ({
  mockAcquire: vi.fn(),
  mockIsChallenge: vi.fn(async () => false),
  mockConvert: vi.fn(async (amount: number) => amount),
  mockTryLLMParse: vi.fn()
}))

vi.mock('../src/main/cloudflare', () => ({
  acquireCloudflarePage: mockAcquire,
  isCloudflareChallenge: mockIsChallenge
}))
vi.mock('../src/main/currency', () => ({ convertToUSDWithFallback: mockConvert }))
vi.mock('../src/main/llm/parser', () => ({ tryLLMParse: mockTryLLMParse }))

import { querySurugaya } from '../src/main/queries/surugaya'
import { clearAllCaches } from '../src/main/queries/cache'

const RESULT_CARD = '<li class="item">' +
  '<span class="title"><a href="/product/detail/123">Suruga Album</a></span>' +
  '<a class="thum" href="/product/detail/123"><img src="https://img.example/cover.jpg"></a>' +
  '<span class="price_teika">在庫あり：¥1,000</span>' +
  '</li>'

function createPage() {
  const page = {
    setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue({}),
    evaluate: vi.fn(),
    content: vi.fn().mockResolvedValue('<html></html>')
  }
  const release = vi.fn()
  return { page, release }
}

beforeEach(() => {
  vi.clearAllMocks()
  clearAllCaches()
  mockIsChallenge.mockResolvedValue(false)
  mockTryLLMParse.mockResolvedValue(null)
  mockAcquire.mockResolvedValue(null)
})

describe('querySurugaya', () => {
  it('extracts the first search result through the real-Chrome page', async () => {
    const { page, release } = createPage()
    page.evaluate = createDomEvaluate([`<html><body>${RESULT_CARD}</body></html>`])
    mockAcquire.mockResolvedValue({ page, release })

    const result = await querySurugaya('TOCP-53001')

    expect(page.goto).toHaveBeenCalledWith(
      'https://www.suruga-ya.jp/search?search_word=TOCP-53001',
      expect.anything()
    )
    expect(result).toMatchObject({
      platform: 'surugaya',
      name: 'Suruga Album',
      priceMin: 1000,
      priceMax: 1000,
      coverUrl: 'https://img.example/cover.jpg',
      link: 'https://www.suruga-ya.jp/product/detail/123',
      status: 'found'
    })
    expect(mockConvert).toHaveBeenCalledWith(1000, 'JPY')
    expect(release).toHaveBeenCalled()
  })

  it('returns challenge status when the real Chrome session is not running', async () => {
    mockAcquire.mockResolvedValue(null)
    const result = await querySurugaya('X-1')
    expect(result.status).toBe('challenge')
  })

  it('returns challenge status when the page is still a Cloudflare challenge', async () => {
    const { page, release } = createPage()
    mockAcquire.mockResolvedValue({ page, release })
    mockIsChallenge.mockResolvedValue(true)

    const result = await querySurugaya('X-1')

    expect(result.status).toBe('challenge')
    expect(release).toHaveBeenCalled()
  })

  it('returns not_found when the search page has no product items', async () => {
    const { page, release } = createPage()
    page.evaluate = createDomEvaluate(['<html><body>検索結果：0件</body></html>'])
    mockAcquire.mockResolvedValue({ page, release })

    const result = await querySurugaya('NOPE-1')
    expect(result.status).toBe('not_found')
    expect(release).toHaveBeenCalled()
  })

  it('serves a repeated lookup from the query cache', async () => {
    const { page, release } = createPage()
    page.evaluate = createDomEvaluate([`<html><body>${RESULT_CARD}</body></html>`])
    mockAcquire.mockResolvedValue({ page, release })

    const first = await querySurugaya('CACHED-1')
    expect(first.status).toBe('found')
    expect(mockAcquire).toHaveBeenCalledTimes(1)

    mockAcquire.mockClear()
    const second = await querySurugaya('CACHED-1')
    expect(second).toEqual(first)
    expect(mockAcquire).not.toHaveBeenCalled()
  })

  it('returns a query error when acquiring the page fails', async () => {
    mockAcquire.mockRejectedValue(new Error('no chrome'))
    const result = await querySurugaya('X-1')
    expect(result).toMatchObject({ platform: 'surugaya', status: 'error', error: 'no chrome' })
  })
})
