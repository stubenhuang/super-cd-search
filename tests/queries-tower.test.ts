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

import { queryTower } from '../src/main/queries/tower'
import { clearAllCaches } from '../src/main/queries/cache'

const TOWER_CARD = '<div class="TOL-item-search-result-PC-result-list-display-item">' +
  '<div class="tr-item-block-img"><img src="https://cdn.tower.jp/za/l/cover.jpg"></div>' +
  '<div class="result-display-contents-category-text">CD</div>' +
  '<div class="tr-item-block-info-item-name"><h3>' +
  '<a href="https://tower.jp/item/588401">Tower Album</a>' +
  '<span class="artist-link"><a href="/artist/1">Some Artist</a></span>' +
  '</h3></div>' +
  '<div class="tr-item-block-info-price"><span class="is-text-amount">¥1,885</span></div>' +
  '<div class="TOL-item-search-result-PC-result-display-contents-info-tag">' +
  '<div class="common-tag is-gray is-light"><span class="text-size-12 is-text-gray">国内</span></div>' +
  '<div class="TOL-item-search-result-PC-result-display-contents-info">' +
  '<span class="text-size-12 is-text-gray">発売日：2015年06月17日 | 規格品番：' +
  '<!HS>X-1<!HE> | レーベル：TOWER RECORDS UNIVERSAL VINTAGE COLLECTION +plus</span>' +
  '</div>' +
  '</div>' +
  '</div>'

function createTowerPage() {
  const page = {
    setCookie: vi.fn().mockResolvedValue(undefined),
    setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue({}),
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
  mockGetSetting.mockReturnValue(undefined)
  mockTryLLMParse.mockResolvedValue(null)
  mockBrowserPool.acquire.mockResolvedValue({ browser: {}, page: {} })
  mockBrowserPool.release.mockResolvedValue(undefined)
})

describe('queryTower', () => {
  it('extracts the first search result card', async () => {
    const { page, browser } = createTowerPage()
    page.evaluate = createDomEvaluate([`<html><body>${TOWER_CARD}</body></html>`])
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const result = await queryTower('X-1')

    expect(result).toMatchObject({
      platform: 'tower',
      name: 'Tower Album',
      artist: 'Some Artist',
      priceMin: 1885,
      priceMax: 1885,
      coverUrl: 'https://cdn.tower.jp/za/l/cover.jpg',
      link: 'https://tower.jp/item/588401',
      status: 'found',
      details: {
        format: 'CD',
        label: 'TOWER RECORDS UNIVERSAL VINTAGE COLLECTION +plus',
        country: 'Japan',
        released: '2015-06-17'
      }
    })
    expect(page.goto).toHaveBeenCalledWith('https://tower.jp/search/item/X-1', expect.anything())
    expect(mockConvert).toHaveBeenCalledWith(1885, 'JPY')
    expect(mockBrowserPool.release).toHaveBeenCalledWith(browser, page)
  })

  it('returns not_found when the search has no result cards', async () => {
    const { page, browser } = createTowerPage()
    page.evaluate = createDomEvaluate(['<html><body>検索結果：0件</body></html>'])
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const result = await queryTower('NOPE-1')
    expect(result.status).toBe('not_found')
    expect(mockBrowserPool.release).toHaveBeenCalledWith(browser, page)
  })

  it('returns not_found when the card has no name and never invokes LLM', async () => {
    const { page, browser } = createTowerPage()
    page.evaluate = createDomEvaluate([
      `<html><body><div class="TOL-item-search-result-PC-result-list-display-item"><div class="tr-item-block-info-item-name"><h3><a href="https://tower.jp/item/1"></a></h3></div></div></body></html>`
    ])
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const result = await queryTower('X-1')
    expect(result.status).toBe('not_found')
    expect(mockTryLLMParse).not.toHaveBeenCalled()
  })

  it('serves a repeated lookup from the query cache', async () => {
    const { page, browser } = createTowerPage()
    page.evaluate = createDomEvaluate([`<html><body>${TOWER_CARD}</body></html>`])
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const first = await queryTower('CACHED-1')
    expect(first.status).toBe('found')
    expect(mockBrowserPool.acquire).toHaveBeenCalledTimes(1)

    mockBrowserPool.acquire.mockClear()
    const second = await queryTower('CACHED-1')
    expect(second).toEqual(first)
    expect(mockBrowserPool.acquire).not.toHaveBeenCalled()
  })

  it('returns a query error when the browser fails', async () => {
    mockBrowserPool.acquire.mockRejectedValue(new Error('no browser'))
    const result = await queryTower('X-1')
    expect(result).toMatchObject({ platform: 'tower', status: 'error', error: 'no browser' })
  })
})
