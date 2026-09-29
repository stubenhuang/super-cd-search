import { vi } from 'vitest'
import { BrowserWindow } from 'electron'
import type { QueryResult } from '../../src/shared/types'

/**
 * Shared mock wiring for the two enrichment suites (`enrich.test.ts` and
 * `enrich-cancel.test.ts`), which used to carry byte-identical copies of the
 * twelve-mock block, the settings fixture and the `beforeEach` defaults.
 *
 * Each test file still declares its own `vi.mock(...)` lines (vitest resolves
 * those relative to the file that calls them), pointing at the mocks exported
 * here — everything else (fixtures, defaults, page stub) is shared.
 */

export const mocks = {
  mockGetSetting: vi.fn(),
  mockAcquireBrowser: vi.fn(),
  mockReleaseBrowser: vi.fn(),
  mockCompressHtml: vi.fn(),
  mockChat: vi.fn(),
  mockQueryTower: vi.fn(),
  mockQueryHmv: vi.fn(),
  mockQueryCdjapan: vi.fn(),
  mockQueryKojima: vi.fn(),
  mockQueryYahoo: vi.fn(),
  mockGetCachedEnrichment: vi.fn(),
  mockCacheEnrichment: vi.fn()
}

/** LLM settings that pass `isLLMConfigured` for every platform. */
export const fullLlmSettings = {
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
    tower: true
  }
}

export function foundResult(platform: QueryResult['platform'], details?: QueryResult['details']): QueryResult {
  return {
    platform,
    name: `${platform} album`,
    artist: null,
    priceMin: null,
    priceMax: null,
    coverUrl: null,
    link: `https://example.com/${platform}/item`,
    status: 'found',
    details
  }
}

/** A product page the enrichment fetch resolves; every suite needs one. */
export function setupBrowserPage(html = '<html><body>product</body></html>') {
  const page = {
    goto: vi.fn().mockResolvedValue(undefined),
    content: vi.fn().mockResolvedValue(html),
    setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
    setCookie: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(undefined)
  }
  mocks.mockAcquireBrowser.mockResolvedValue({ browser: {}, page })
  mocks.mockReleaseBrowser.mockResolvedValue(undefined)
  return page
}

/** The default mock returns every suite starts from; call from `beforeEach`. */
export function applyEnrichDefaults(): void {
  vi.clearAllMocks()
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([])
  mocks.mockGetSetting.mockImplementation((key: string) => {
    if (key === 'llm') return fullLlmSettings
    return undefined
  })
  setupBrowserPage()
  mocks.mockCompressHtml.mockReturnValue({
    text: 'compressed product page',
    pageUrl: 'https://example.com/tower/item',
    imageUrls: [],
    linkUrls: []
  })
  mocks.mockChat.mockResolvedValue({ content: '{"details":{"genre":"Jazz"}}' })
  mocks.mockQueryTower.mockResolvedValue(foundResult('tower'))
  mocks.mockQueryHmv.mockResolvedValue(foundResult('hmv'))
  mocks.mockQueryCdjapan.mockResolvedValue(foundResult('cdjapan'))
  mocks.mockQueryKojima.mockResolvedValue(foundResult('kojima'))
  mocks.mockQueryYahoo.mockResolvedValue(foundResult('yahoo'))

  mocks.mockGetCachedEnrichment.mockReturnValue(null)
  mocks.mockCacheEnrichment.mockReturnValue(undefined)
}
