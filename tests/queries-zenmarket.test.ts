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

import { queryZenmarket } from '../src/main/queries/zenmarket'
import { clearAllCaches } from '../src/main/queries/cache'

const RESULT_CARD = '<div class="item">' +
  '<img src="https://img.example/zen.jpg">' +
  '<a href="/en/yshopping/product.aspx?itemCode=zen123" title="Zen Album">Zen Album</a>' +
  '<span>¥2,000</span>' +
  '</div>'

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

describe('queryZenmarket', () => {
  it('extracts the first search result through the real-Chrome page', async () => {
    const { page, release } = createPage()
    page.evaluate = createDomEvaluate([`<html><body>${RESULT_CARD}</body></html>`])
    mockAcquire.mockResolvedValue({ page, release })

    const result = await queryZenmarket('TOCP-53001')

    expect(page.goto).toHaveBeenCalledWith(
      'https://zenmarket.jp/en/yshopping.aspx?q=TOCP-53001',
      expect.anything()
    )
    expect(result).toMatchObject({
      platform: 'zenmarket',
      name: 'Zen Album',
      priceMin: 2000,
      priceMax: 2000,
      coverUrl: 'https://img.example/zen.jpg',
      status: 'found'
    })
    expect(mockConvert).toHaveBeenCalledWith(2000, 'JPY')
    expect(release).toHaveBeenCalled()
  })

  it('returns challenge status when the real Chrome session is not running', async () => {
    mockAcquire.mockResolvedValue(null)
    const result = await queryZenmarket('X-1')
    expect(result.status).toBe('challenge')
  })

  it('returns challenge status when the page is still a Cloudflare challenge', async () => {
    const { page, release } = createPage()
    mockAcquire.mockResolvedValue({ page, release })
    mockIsChallenge.mockResolvedValue(true)

    const result = await queryZenmarket('X-1')

    expect(result.status).toBe('challenge')
    expect(release).toHaveBeenCalled()
  })

  it('returns not_found when the search page has no product links', async () => {
    const { page, release } = createPage()
    page.evaluate = createDomEvaluate(['<html><body>no results</body></html>'])
    mockAcquire.mockResolvedValue({ page, release })

    const result = await queryZenmarket('NOPE-1')
    expect(result.status).toBe('not_found')
    expect(release).toHaveBeenCalled()
  })

  it('serves a repeated lookup from the query cache', async () => {
    const { page, release } = createPage()
    page.evaluate = createDomEvaluate([`<html><body>${RESULT_CARD}</body></html>`])
    mockAcquire.mockResolvedValue({ page, release })

    const first = await queryZenmarket('CACHED-1')
    expect(first.status).toBe('found')
    expect(mockAcquire).toHaveBeenCalledTimes(1)

    mockAcquire.mockClear()
    const second = await queryZenmarket('CACHED-1')
    expect(second).toEqual(first)
    expect(mockAcquire).not.toHaveBeenCalled()
  })

  it('returns a query error when acquiring the page fails', async () => {
    mockAcquire.mockRejectedValue(new Error('no chrome'))
    const result = await queryZenmarket('X-1')
    expect(result).toMatchObject({ platform: 'zenmarket', status: 'error', error: 'no chrome' })
  })
})
