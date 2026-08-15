import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetSetting, mockBrowserPool, mockQueryDiscogsByBarcode, mockWait, mockCloudflareStatus, mockAcquireCloudflarePage, mockIsCloudflareChallenge } = vi.hoisted(() => ({
  mockGetSetting: vi.fn(),
  mockBrowserPool: { acquire: vi.fn(), release: vi.fn() },
  mockQueryDiscogsByBarcode: vi.fn(),
  mockWait: vi.fn(),
  mockCloudflareStatus: vi.fn(),
  mockAcquireCloudflarePage: vi.fn(),
  mockIsCloudflareChallenge: vi.fn()
}))

vi.mock('../src/main/settings', () => ({ getSetting: mockGetSetting }))
vi.mock('../src/main/browser', () => ({ browserPool: mockBrowserPool }))
vi.mock('../src/main/queries/discogs', () => ({ queryDiscogsByBarcode: mockQueryDiscogsByBarcode }))
vi.mock('../src/main/queries/wait', () => ({ waitForResultOrNoResult: mockWait }))
vi.mock('../src/main/cloudflare', () => ({
  acquireCloudflarePage: mockAcquireCloudflarePage,
  getCloudflareStatus: mockCloudflareStatus,
  isCloudflareChallenge: mockIsCloudflareChallenge
}))

import {
  resolveDiscogsBarcode,
  resolveHmvBarcode,
  resolveSurugayaBarcode,
  resolveTowerBarcode,
  resolveYahooBarcode
} from '../src/main/barcode/providers'

function makePage() {
  const page = {
    setCookie: vi.fn().mockResolvedValue(undefined),
    setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(undefined),
    $: vi.fn().mockResolvedValue(null)
  }
  return page
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSetting.mockImplementation((key: string) => {
    if (key === 'cookies') return { tower: 't', hmv: 'h', yahoo: 'y' }
    return undefined
  })
  mockBrowserPool.acquire.mockResolvedValue({ browser: {}, page: makePage() })
  mockBrowserPool.release.mockResolvedValue(undefined)
  mockWait.mockResolvedValue(undefined)
})

describe('barcode provider wrappers', () => {
  it('resolveDiscogsBarcode maps found/no_token/not_found/error outcomes', async () => {
    mockQueryDiscogsByBarcode.mockResolvedValue({
      status: 'found',
      barcode: '4943674029365',
      catalogNumber: 'WPCS-11100',
      title: 'Luminosa',
      result: { link: 'https://www.discogs.com/release/1' }
    })
    expect(await resolveDiscogsBarcode('4943674029365')).toMatchObject({
      status: 'found',
      candidate: { catalogNumber: 'WPCS-11100', source: 'discogs', confidence: 'high' }
    })

    mockQueryDiscogsByBarcode.mockResolvedValue({ status: 'no_token', barcode: 'x' })
    expect(await resolveDiscogsBarcode('x')).toEqual({ status: 'no_token' })

    mockQueryDiscogsByBarcode.mockResolvedValue({ status: 'not_found', barcode: 'x' })
    expect(await resolveDiscogsBarcode('x')).toEqual({ status: 'not_found' })

    mockQueryDiscogsByBarcode.mockResolvedValue({ status: 'error', barcode: 'x', message: 'boom' })
    expect(await resolveDiscogsBarcode('x')).toEqual({ status: 'error', message: 'boom' })
  })

  it('resolveTowerBarcode returns a high-confidence candidate from the detail spec table', async () => {
    const page = makePage()
    mockBrowserPool.acquire.mockResolvedValue({ browser: {}, page })

    page.evaluate.mockImplementation(async (fn: unknown) => {
      const source = String(fn)
      if (source.includes('TOL-item-search-result-PC-result-list-display-item')) {
        return {
          title: 'Luminosa - Libera',
          link: '/item/727866/Luminosa',
          infoText: '規格品番：WPCS-11100'
        }
      }
      if (source.includes('body.innerText')) {
        return {
          title: 'ルミノーサ～聖なる光/リベラ',
          bodyText: '規格品番 WPCS-11100\nSKU 4943674029365'
        }
      }
      return undefined
    })

    expect(await resolveTowerBarcode('4943674029365')).toMatchObject({
      status: 'found',
      candidate: { catalogNumber: 'WPCS-11100', source: 'tower', confidence: 'high' }
    })
    expect(page.goto).toHaveBeenCalledTimes(2)
    expect(mockBrowserPool.release).toHaveBeenCalled()
  })

  it('resolveTowerBarcode returns not_found when the search page has no card', async () => {
    const page = makePage()
    mockBrowserPool.acquire.mockResolvedValue({ browser: {}, page })
    page.evaluate.mockResolvedValue(null)

    expect(await resolveTowerBarcode('4943674029365')).toEqual({ status: 'not_found' })
  })

  it('resolveHmvBarcode returns a candidate from the product spec page', async () => {
    const page = makePage()
    mockBrowserPool.acquire.mockResolvedValue({ browser: {}, page })
    const firstItem = {
      evaluate: vi.fn().mockResolvedValue({ title: 'Luminosa - Libera', link: '/product/detail/926476' })
    }
    page.$.mockResolvedValue(firstItem)
    page.evaluate.mockImplementation(async (fn: unknown) => {
      const source = String(fn)
      if (source.includes('document.body.innerText')) {
        return 'JAN 4943674029365\n規格品番 WPCS-11100'
      }
      if (source.includes('h1')) return 'Luminosa - Libera'
      return undefined
    })

    expect(await resolveHmvBarcode('4943674029365')).toMatchObject({
      status: 'found',
      candidate: { catalogNumber: 'WPCS-11100', source: 'hmv', confidence: 'high' }
    })
  })

  it('resolveYahooBarcode returns a high-confidence candidate from the result title', async () => {
    const page = makePage()
    mockBrowserPool.acquire.mockResolvedValue({ browser: {}, page })
    const firstItem = {
      evaluate: vi.fn().mockResolvedValue({
        name: 'ルミノーサ〜聖なる光/CD/WPCS-11100 中古',
        link: 'https://store.shopping.yahoo.co.jp/vaboo/item.html'
      })
    }
    page.$.mockResolvedValue(firstItem)
    page.evaluate.mockImplementation(async (fn: unknown) => {
      const source = String(fn)
      if (source.includes('document.body.innerText')) return '検索結果 4943674029365'
      return undefined
    })

    expect(await resolveYahooBarcode('4943674029365')).toMatchObject({
      status: 'found',
      candidate: { catalogNumber: 'WPCS-11100', source: 'yahoo', confidence: 'high' }
    })
  })

  it('resolveSurugayaBarcode skips unless the Cloudflare session is verified', async () => {
    mockCloudflareStatus.mockResolvedValue({ state: 'unverified' })
    expect(await resolveSurugayaBarcode('4943674029365')).toMatchObject({ status: 'skipped' })
    expect(mockAcquireCloudflarePage).not.toHaveBeenCalled()
  })

  it('resolveSurugayaBarcode returns a candidate when verified and the spec matches', async () => {
    mockCloudflareStatus.mockResolvedValue({ state: 'verified' })
    mockIsCloudflareChallenge.mockResolvedValue(false)

    const page = makePage()
    page.evaluate.mockImplementation(async (fn: unknown) => {
      const source = String(fn)
      if (source.includes('/product/detail/')) {
        return { title: 'Luminosa', link: '/product/detail/230025530' }
      }
      if (source.includes('document.body.innerText')) {
        return 'JAN 4943674029365\n品番 WPCS-11100'
      }
      if (source.includes('h1')) return 'ルミノーサ～聖なる光/リベラ'
      return undefined
    })
    mockAcquireCloudflarePage.mockResolvedValue({ page, release: vi.fn() })

    expect(await resolveSurugayaBarcode('4943674029365')).toMatchObject({
      status: 'found',
      candidate: { catalogNumber: 'WPCS-11100', source: 'surugaya', confidence: 'high' }
    })
  })

  it('resolveTowerBarcode falls back to a low-confidence search-card candidate when the detail page fails', async () => {
    const page = makePage()
    mockBrowserPool.acquire.mockResolvedValue({ browser: {}, page })

    page.evaluate.mockImplementation(async (fn: unknown) => {
      const source = String(fn)
      if (source.includes('TOL-item-search-result-PC-result-list-display-item')) {
        return { title: 'Luminosa', link: '/item/727866', infoText: '規格品番：WPCS-11100' }
      }
      if (source.includes('body.innerText')) throw new Error('detail blocked')
      return undefined
    })

    expect(await resolveTowerBarcode('4943674029365')).toMatchObject({
      status: 'found',
      candidate: { catalogNumber: 'WPCS-11100', confidence: 'low' }
    })
  })

  it('resolveTowerBarcode returns not_found when no catalog number appears anywhere', async () => {
    const page = makePage()
    mockBrowserPool.acquire.mockResolvedValue({ browser: {}, page })
    page.evaluate.mockImplementation(async (fn: unknown) => {
      const source = String(fn)
      if (source.includes('TOL-item-search-result-PC-result-list-display-item')) {
        return { title: 'No Catno', link: '/item/1', infoText: '' }
      }
      if (source.includes('body.innerText')) return { title: 'No Catno', bodyText: 'nothing useful' }
      return undefined
    })

    expect(await resolveTowerBarcode('4943674029365')).toEqual({ status: 'not_found' })
  })

  it('resolveHmvBarcode returns not_found when the search page has no items', async () => {
    const page = makePage()
    mockBrowserPool.acquire.mockResolvedValue({ browser: {}, page })
    page.$.mockResolvedValue(null)

    expect(await resolveHmvBarcode('4943674029365')).toEqual({ status: 'not_found' })
  })

  it('resolveHmvBarcode falls back to a catno embedded in the result title', async () => {
    const page = makePage()
    mockBrowserPool.acquire.mockResolvedValue({ browser: {}, page })
    const firstItem = {
      evaluate: vi.fn().mockResolvedValue({ title: 'CD/WPCS-11100 中古', link: null })
    }
    page.$.mockResolvedValue(firstItem)
    page.evaluate.mockResolvedValue(undefined)

    expect(await resolveHmvBarcode('4943674029365')).toMatchObject({
      status: 'found',
      candidate: { catalogNumber: 'WPCS-11100', confidence: 'low' }
    })
  })

  it('resolveYahooBarcode returns not_found for an empty result page', async () => {
    const page = makePage()
    mockBrowserPool.acquire.mockResolvedValue({ browser: {}, page })
    page.$.mockResolvedValue(null)

    expect(await resolveYahooBarcode('4943674029365')).toEqual({ status: 'not_found' })
  })

  it('resolveYahooBarcode returns a low-confidence candidate when the JAN is not visible in the page', async () => {
    const page = makePage()
    mockBrowserPool.acquire.mockResolvedValue({ browser: {}, page })
    const firstItem = {
      evaluate: vi.fn().mockResolvedValue({
        name: 'ルミノーサ〜聖なる光/CD/WPCS-11100 中古',
        link: null
      })
    }
    page.$.mockResolvedValue(firstItem)
    page.evaluate.mockImplementation(async (fn: unknown) => {
      if (String(fn).includes('document.body.innerText')) return 'no barcode text'
      return undefined
    })

    expect(await resolveYahooBarcode('4943674029365')).toMatchObject({
      status: 'found',
      candidate: { catalogNumber: 'WPCS-11100', confidence: 'low' }
    })
  })

  it('resolveSurugayaBarcode skips when the verified session cannot be acquired', async () => {
    mockCloudflareStatus.mockResolvedValue({ state: 'verified' })
    mockAcquireCloudflarePage.mockResolvedValue(null)

    expect(await resolveSurugayaBarcode('4943674029365')).toMatchObject({ status: 'skipped' })
  })

  it('resolveSurugayaBarcode skips when Cloudflare challenges the search page', async () => {
    mockCloudflareStatus.mockResolvedValue({ state: 'verified' })
    mockIsCloudflareChallenge.mockResolvedValue(true)
    mockAcquireCloudflarePage.mockResolvedValue({ page: makePage(), release: vi.fn() })

    expect(await resolveSurugayaBarcode('4943674029365')).toMatchObject({ status: 'skipped' })
  })

  it('resolveSurugayaBarcode returns not_found when the search page has no product', async () => {
    mockCloudflareStatus.mockResolvedValue({ state: 'verified' })
    mockIsCloudflareChallenge.mockResolvedValue(false)
    const page = makePage()
    page.evaluate.mockImplementation(async (fn: unknown) => {
      if (String(fn).includes('/product/detail/')) return null
      return undefined
    })
    mockAcquireCloudflarePage.mockResolvedValue({ page, release: vi.fn() })

    expect(await resolveSurugayaBarcode('4943674029365')).toEqual({ status: 'not_found' })
  })
})
