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
    async chat(_messages: unknown, options: unknown) {
      return mockChat(options)
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

import { enrichDetails, SMART_FILL_PLATFORM_PRIORITY } from '../src/main/llm/enrich'

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

function foundResult(platform: QueryResult['platform'], details?: QueryResult['details']): QueryResult {
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

function setupLlm(llm: unknown): void {
  mockGetSetting.mockImplementation((key: string) => {
    if (key === 'llm') return llm
    return undefined
  })
}

function setupBrowserPage(html = '<html><body>product</body></html>') {
  const page = {
    goto: vi.fn().mockResolvedValue(undefined),
    content: vi.fn().mockResolvedValue(html),
    setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
    setCookie: vi.fn().mockResolvedValue(undefined)
  }
  mockAcquireBrowser.mockResolvedValue({ browser: {}, page })
  mockReleaseBrowser.mockResolvedValue(undefined)
  mockIsChallenge.mockResolvedValue(false)
  return page
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([])
  setupLlm(fullLlmSettings)
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

describe('enrichDetails', () => {
  it('returns not_configured without touching any source when LLM settings are missing', async () => {
    setupLlm(undefined)

    const result = await enrichDetails('X-1', [])
    expect(result.llmConfigured).toBe(false)
    expect(result.status).toBe('not_configured')
    expect(mockQueryTower).not.toHaveBeenCalled()
  })

  it('serves a complete cached enrichment without invoking the LLM', async () => {
    mockGetCachedEnrichment.mockReturnValue({
      label: 'Cached Label',
      format: 'CD',
      country: 'Japan',
      released: '2024-01-01',
      genre: 'Jazz'
    })

    const result = await enrichDetails('X-1', [])
    expect(result.status).toBe('complete')
    expect(result.usedCache).toBe(true)
    expect(result.details.label).toBe('Cached Label')
    expect(mockQueryTower).not.toHaveBeenCalled()
    expect(mockChat).not.toHaveBeenCalled()
    expect(mockCacheEnrichment).not.toHaveBeenCalled()
  })

  it('merges cached fields and still asks the LLM for the rest', async () => {
    mockGetCachedEnrichment.mockReturnValue({
      label: 'Cached Label',
      format: 'CD',
      country: 'Japan',
      released: '2024-01-01',
      genre: null
    })

    const result = await enrichDetails('X-1', [])
    expect(result.status).toBe('complete')
    expect(result.usedCache).toBe(true)
    expect(result.details.label).toBe('Cached Label')
    expect(result.details.genre).toBe('Jazz')
    expect(mockChat).toHaveBeenCalledTimes(1)
    expect(mockCacheEnrichment).toHaveBeenCalledWith('X-1', expect.objectContaining({ genre: 'Jazz' }))
  })

  it('returns cached details even when LLM is not configured', async () => {
    setupLlm(undefined)
    mockGetCachedEnrichment.mockReturnValue({
      label: 'Cached Label',
      format: 'CD',
      country: 'Japan',
      released: null,
      genre: null
    })

    const result = await enrichDetails('X-1', [])
    expect(result.status).toBe('not_configured')
    expect(result.usedCache).toBe(true)
    expect(result.details.label).toBe('Cached Label')
    expect(result.missingFields).toEqual(['released', 'genre'])
  })

  it('walks sources in the configured priority order and stops as soon as all fields are complete', async () => {
    const discogs = foundResult('discogs', {
      label: 'Discogs Label',
      format: 'CD',
      country: 'Japan',
      released: '2024-01-01',
      genre: null
    })
    const ebay = foundResult('ebay')
    mockQueryTower.mockResolvedValue(foundResult('tower', {
      label: 'Tower Label',
      format: 'CD',
      country: 'Japan',
      released: '2024/01/01',
      genre: null
    }))

    const result = await enrichDetails('X-1', [discogs, ebay])

    expect(result.status).toBe('complete')
    expect(result.missingFields).toEqual([])
    expect(result.analyzedPlatforms).toEqual(['tower'])
    expect(result.details).toEqual({
      label: 'Discogs Label', // richest existing source keeps its fields
      format: 'CD',
      country: 'Japan',
      released: '2024-01-01',
      genre: 'Jazz' // LLM fills only the missing field
    })
    expect(mockQueryTower).toHaveBeenCalledWith('X-1', expect.any(AbortSignal))
    expect(mockQueryHmv).not.toHaveBeenCalled()
    expect(mockChat).toHaveBeenCalledTimes(1)
  })

  it('never queries or parses discogs and ebay, and skips sources without a product', async () => {
    mockQueryTower.mockResolvedValue({ ...foundResult('tower'), status: 'not_found', link: null })
    mockQueryHmv.mockResolvedValue({ ...foundResult('hmv'), status: 'not_found', link: null })
    mockQueryCdjapan.mockResolvedValue({ ...foundResult('cdjapan'), status: 'not_found', link: null })
    mockQueryKojima.mockResolvedValue({ ...foundResult('kojima'), status: 'not_found', link: null })
    mockQueryYahoo.mockResolvedValue({ ...foundResult('yahoo'), status: 'not_found', link: null })
    mockQuerySurugaya.mockResolvedValue({ ...foundResult('surugaya'), status: 'challenge', link: null })
    mockQueryZenmarket.mockResolvedValue({ ...foundResult('zenmarket'), status: 'not_found', link: null })

    const result = await enrichDetails('X-1', [])

    expect(result.status).toBe('partial')
    expect(result.analyzedPlatforms).toEqual([])
    expect(result.skippedPlatforms.map(s => s.platform)).toEqual(SMART_FILL_PLATFORM_PRIORITY)
    expect(mockChat).not.toHaveBeenCalled()
    expect(mockAcquireBrowser).not.toHaveBeenCalled()
  })

  it('honors the per-platform LLM enable toggle', async () => {
    setupLlm({
      ...fullLlmSettings,
      platformEnabled: { ...fullLlmSettings.platformEnabled, tower: false }
    })

    const result = await enrichDetails('X-1', [])
    expect(result.skippedPlatforms[0]).toEqual({ platform: 'tower', reason: 'platform_disabled' })
    expect(mockQueryTower).not.toHaveBeenCalled()
  })

  it('continues to the next source when the first LLM analysis fails', async () => {
    mockChat
      .mockResolvedValueOnce({ content: 'not json' })
      .mockResolvedValueOnce({
        content: '{"details":{"label":"HMV Label","format":"CD","country":"Japan","released":"2024-03-01","genre":"Rock"}}'
      })

    const result = await enrichDetails('X-1', [])

    // Tower fails to parse, so HMV is tried next and completes the fields.
    expect(result.analyzedPlatforms).toEqual(['tower', 'hmv'])
    expect(result.status).toBe('complete')
    expect(result.details.genre).toBe('Rock')
  })

  it('merges deterministic scraper details before deciding whether LLM is needed', async () => {
    mockQueryTower.mockResolvedValue(foundResult('tower', {
      label: 'Tower Label',
      format: 'CD',
      country: 'Japan',
      released: '2024/01/01',
      genre: 'Jazz'
    }))

    const result = await enrichDetails('X-1', [])
    expect(result.status).toBe('complete')
    expect(mockAcquireBrowser).not.toHaveBeenCalled()
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('keeps the fields already known from existing results even when LLM returns different values', async () => {
    const tower = foundResult('tower', { label: 'Tower Label', format: 'CD', genre: 'Jazz' })
    mockQueryTower.mockResolvedValue(tower)
    mockChat.mockResolvedValue({
      content: '{"details":{"label":"Overridden","format":"LP","genre":"Metal","country":"US","released":"2000"}}'
    })

    const result = await enrichDetails('X-1', [tower])

    expect(result.details.label).toBe('Tower Label')
    expect(result.details.format).toBe('CD')
    expect(result.details.genre).toBe('Jazz')
    expect(result.details.country).toBe('US')
    expect(result.details.released).toBe('2000')
  })

  it('emits per-source progress to open renderer windows', async () => {
    const send = vi.fn()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { webContents: { send } } as never
    ])

    const discogs = foundResult('discogs', {
      label: 'Discogs Label',
      format: 'CD',
      country: 'Japan',
      released: '2024-01-01',
      genre: null
    })
    await enrichDetails('X-1', [discogs])

    expect(send).toHaveBeenCalledWith('detail:enrich-progress', expect.objectContaining({ platform: 'tower' }))
  })

  it('does not inject any configured cookie when fetching a regular product page', async () => {
    setupLlm(fullLlmSettings)
    const page = setupBrowserPage()

    await enrichDetails('X-1', [])
    expect(page.setCookie).not.toHaveBeenCalled()
  })

  it('skips a source when its detail page cannot be fetched', async () => {
    const page = setupBrowserPage()
    page.goto.mockRejectedValue(new Error('blocked'))

    const result = await enrichDetails('X-1', [])
    expect(result.skippedPlatforms[0]).toEqual({ platform: 'tower', reason: 'fetch_failed' })
    expect(result.attemptedPlatforms).toContain('tower')
  })

  it('fetches Cloudflare-protected sources through the real-Chrome page', async () => {
    setupLlm({
      ...fullLlmSettings,
      platformEnabled: {
        ...fullLlmSettings.platformEnabled,
        tower: false,
        hmv: false,
        cdjapan: false,
        kojima: false,
        yahoo: false,
        surugaya: true,
        zenmarket: false
      }
    })
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      content: vi.fn().mockResolvedValue('<html><body>surugaya</body></html>'),
      setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
      setCookie: vi.fn().mockResolvedValue(undefined)
    }
    const release = vi.fn()
    mockAcquireCloudflare.mockResolvedValue({ page, release })
    mockQuerySurugaya.mockResolvedValue(foundResult('surugaya'))
    mockChat.mockResolvedValue({
      content: '{"details":{"label":"L","format":"CD","country":"Japan","released":"2024","genre":"Jazz"}}'
    })

    const result = await enrichDetails('X-1', [])
    expect(result.analyzedPlatforms).toEqual(['surugaya'])
    expect(result.status).toBe('complete')
    expect(release).toHaveBeenCalled()
  })

  it('trusts an existing not_found result and does not search that platform again', async () => {
    const existing: QueryResult = { ...foundResult('tower'), status: 'not_found', link: null }

    const result = await enrichDetails('X-1', [existing])
    expect(result.skippedPlatforms[0]).toEqual({ platform: 'tower', reason: 'not_found' })
    expect(mockQueryTower).not.toHaveBeenCalled()
  })

  it('trusts an existing challenge result and does not search that platform again', async () => {
    const existing: QueryResult = { ...foundResult('tower'), status: 'challenge', link: null }

    const result = await enrichDetails('X-1', [existing])
    expect(result.skippedPlatforms[0]).toEqual({ platform: 'tower', reason: 'cloudflare_challenge' })
    expect(mockQueryTower).not.toHaveBeenCalled()
  })

  it('skips a Cloudflare-protected source while its page still shows a challenge', async () => {
    setupLlm({
      ...fullLlmSettings,
      platformEnabled: {
        ...fullLlmSettings.platformEnabled,
        tower: false,
        hmv: false,
        cdjapan: false,
        kojima: false,
        yahoo: false,
        surugaya: true,
        zenmarket: false
      }
    })
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      content: vi.fn().mockResolvedValue('<html>Just a moment</html>'),
      setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
      setCookie: vi.fn().mockResolvedValue(undefined)
    }
    const release = vi.fn()
    mockAcquireCloudflare.mockResolvedValue({ page, release })
    mockQuerySurugaya.mockResolvedValue(foundResult('surugaya'))
    mockIsChallenge.mockResolvedValue(true)

    const result = await enrichDetails('X-1', [])
    expect(result.skippedPlatforms).toContainEqual({ platform: 'surugaya', reason: 'cloudflare_challenge' })
    expect(mockChat).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalled()
  })

  it('reports no_product_link when a source finds a title without a product URL', async () => {
    mockQueryTower.mockResolvedValue({ ...foundResult('tower'), link: null })

    const result = await enrichDetails('X-1', [])
    expect(result.skippedPlatforms[0]).toEqual({ platform: 'tower', reason: 'no_product_link' })
  })

  it('treats a throwing source search as not_found and continues', async () => {
    mockQueryTower.mockRejectedValue(new Error('search down'))

    const result = await enrichDetails('X-1', [])
    expect(result.skippedPlatforms[0]).toEqual({ platform: 'tower', reason: 'not_found' })
    expect(result.attemptedPlatforms).not.toContain('tower')
  })

  it('records llm_failed and keeps going when the chat request throws', async () => {
    mockChat.mockRejectedValue(new Error('api 500'))

    const result = await enrichDetails('X-1', [])
    expect(result.skippedPlatforms[0]).toEqual({ platform: 'tower', reason: 'llm_failed' })
    expect(result.attemptedPlatforms).toContain('tower')
  })

  it('treats missing platformEnabled settings as all-enabled', async () => {
    setupLlm({ ...fullLlmSettings, platformEnabled: undefined })

    const result = await enrichDetails('X-1', [])
    expect(result.skippedPlatforms.some(s => s.reason === 'platform_disabled')).toBe(false)
  })

  it('passes the caller signal to the LLM client so an in-flight request can be cancelled', async () => {
    const controller = new AbortController()

    await enrichDetails('X-1', [], null, controller.signal)

    expect(mockChat).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }))
  })
})
