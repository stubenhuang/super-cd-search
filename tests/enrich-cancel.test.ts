import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BrowserWindow } from 'electron'
import type { QueryResult } from '../src/shared/types'

const {
  mockGetSetting,
  mockAcquireBrowser,
  mockReleaseBrowser,
  mockAcquireCloudflare,
  mockIsChallenge,
  mockCompressHtml,
  mockChat,
  mockQueryTower,
  mockQueryHmv,
  mockQueryCdjapan,
  mockQueryKojima,
  mockQueryYahoo,
  mockQuerySurugaya,
  mockQueryZenmarket,
  mockGetCachedEnrichment,
  mockCacheEnrichment
} = vi.hoisted(() => ({
  mockGetSetting: vi.fn(),
  mockAcquireBrowser: vi.fn(),
  mockReleaseBrowser: vi.fn(),
  mockAcquireCloudflare: vi.fn(),
  mockIsChallenge: vi.fn(),
  mockCompressHtml: vi.fn(),
  mockChat: vi.fn(),
  mockQueryTower: vi.fn(),
  mockQueryHmv: vi.fn(),
  mockQueryCdjapan: vi.fn(),
  mockQueryKojima: vi.fn(),
  mockQueryYahoo: vi.fn(),
  mockQuerySurugaya: vi.fn(),
  mockQueryZenmarket: vi.fn(),
  mockGetCachedEnrichment: vi.fn(),
  mockCacheEnrichment: vi.fn()
}))

vi.mock('../src/main/settings', () => ({ getSetting: mockGetSetting }))
vi.mock('../src/main/browser', () => ({
  browserPool: { acquire: mockAcquireBrowser, release: mockReleaseBrowser }
}))
vi.mock('../src/main/cloudflare', () => ({
  acquireCloudflarePage: mockAcquireCloudflare,
  isCloudflareChallenge: mockIsChallenge
}))
vi.mock('../src/main/parser/readability', () => ({ compressHtml: mockCompressHtml }))
vi.mock('../src/main/llm/client', () => ({
  LLMClient: class {
    async chat() {
      return mockChat()
    }
  }
}))
vi.mock('../src/main/queries/tower', () => ({ queryTower: mockQueryTower }))
vi.mock('../src/main/queries/hmv', () => ({ queryHmv: mockQueryHmv }))
vi.mock('../src/main/queries/cdjapan', () => ({ queryCdjapan: mockQueryCdjapan }))
vi.mock('../src/main/queries/kojima', () => ({ queryKojima: mockQueryKojima }))
vi.mock('../src/main/queries/yahoo', () => ({ queryYahoo: mockQueryYahoo }))
vi.mock('../src/main/queries/surugaya', () => ({ querySurugaya: mockQuerySurugaya }))
vi.mock('../src/main/queries/zenmarket', () => ({ queryZenmarket: mockQueryZenmarket }))
vi.mock('../src/main/queries/cache', () => ({
  getCachedEnrichment: mockGetCachedEnrichment,
  cacheEnrichment: mockCacheEnrichment
}))

import { enrichDetails } from '../src/main/llm/enrich'

const fullLlmSettings = {
  enabled: true,
  apiBaseUrl: 'https://api.example.com/v1',
  apiKey: 'key',
  model: 'model',
  platformEnabled: {
    discogs: true,
    ebay: true,
    kojima: true,
    hmv: true,
    yahoo: true,
    cdjapan: true,
    tower: true,
    surugaya: true,
    zenmarket: true
  }
}

function foundResult(platform: QueryResult['platform']): QueryResult {
  return {
    platform,
    name: `${platform} album`,
    artist: null,
    priceMin: null,
    priceMax: null,
    coverUrl: null,
    link: `https://example.com/${platform}/item`,
    status: 'found',
    details: null
  }
}

function setupBrowserPage() {
  const page = {
    goto: vi.fn().mockResolvedValue(undefined),
    content: vi.fn().mockResolvedValue('<html><body>product</body></html>'),
    setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
    setCookie: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(undefined)
  }
  mockAcquireBrowser.mockResolvedValue({ browser: {}, page })
  mockReleaseBrowser.mockResolvedValue(undefined)
  mockIsChallenge.mockResolvedValue(false)
  return page
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([])
  mockGetSetting.mockImplementation((key: string) => {
    if (key === 'llm') return fullLlmSettings
    return undefined
  })
  setupBrowserPage()
  mockCompressHtml.mockReturnValue({
    text: 'compressed product page',
    pageUrl: 'https://example.com/tower/item',
    imageUrls: [],
    linkUrls: []
  })
  mockChat.mockResolvedValue({ content: '{"details":{"genre":"Jazz"}}' })
  mockQueryTower.mockResolvedValue(foundResult('tower'))
  mockQueryHmv.mockResolvedValue(foundResult('hmv'))
  mockQueryCdjapan.mockResolvedValue(foundResult('cdjapan'))
  mockQueryKojima.mockResolvedValue(foundResult('kojima'))
  mockQueryYahoo.mockResolvedValue(foundResult('yahoo'))
  mockQuerySurugaya.mockResolvedValue(foundResult('surugaya'))
  mockQueryZenmarket.mockResolvedValue(foundResult('zenmarket'))
  mockGetCachedEnrichment.mockReturnValue(null)
  mockCacheEnrichment.mockReturnValue(undefined)
})

describe('enrichDetails cancellation', () => {
  it('returns cancelled immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    const result = await enrichDetails('X-1', [], null, controller.signal)

    expect(result.status).toBe('cancelled')
    expect(result.analyzedPlatforms).toEqual([])
    expect(mockQueryTower).not.toHaveBeenCalled()
    expect(mockCacheEnrichment).not.toHaveBeenCalled()
  })

  it('aborts a page fetch, returns cancelled, never caches, and broadcasts a cancelled progress event', async () => {
    const send = vi.fn()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { webContents: { send } } as never
    ])

    const controller = new AbortController()
    const page = setupBrowserPage()
    // Navigation that stays in flight until we abort it.
    page.goto = vi.fn(() => new Promise<void>(() => {}))

    const run = enrichDetails('X-1', [], null, controller.signal)

    // Let the run reach the in-flight navigation before cancelling.
    await vi.waitFor(() => expect(page.goto).toHaveBeenCalled())
    controller.abort()

    const result = await run

    expect(result.status).toBe('cancelled')
    expect(mockCacheEnrichment).not.toHaveBeenCalled()
    expect(page.evaluate).toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(
      'detail:enrich-progress',
      expect.objectContaining({ status: 'cancelled', catalogNumber: 'X-1' })
    )
  })
})
