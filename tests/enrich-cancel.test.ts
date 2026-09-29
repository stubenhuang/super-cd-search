import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BrowserWindow } from 'electron'
import { applyEnrichDefaults, foundResult, fullLlmSettings, mocks, setupBrowserPage } from './helpers/enrich-harness'
import { enrichDetails } from '../src/main/llm/enrich'

vi.mock('../src/main/settings', () => ({ getSetting: mocks.mockGetSetting }))
vi.mock('../src/main/browser', () => ({
  browserPool: { acquire: mocks.mockAcquireBrowser, release: mocks.mockReleaseBrowser }
}))
vi.mock('../src/main/parser/readability', () => ({ compressHtml: mocks.mockCompressHtml }))
vi.mock('../src/main/llm/client', () => ({
  LLMClient: class {
    async chat(_messages: unknown, options: unknown) {
      return mocks.mockChat(options)
    }
  }
}))
vi.mock('../src/main/queries/tower', () => ({ queryTower: mocks.mockQueryTower }))
vi.mock('../src/main/queries/hmv', () => ({ queryHmv: mocks.mockQueryHmv }))
vi.mock('../src/main/queries/cdjapan', () => ({ queryCdjapan: mocks.mockQueryCdjapan }))
vi.mock('../src/main/queries/kojima', () => ({ queryKojima: mocks.mockQueryKojima }))
vi.mock('../src/main/queries/yahoo', () => ({ queryYahoo: mocks.mockQueryYahoo }))
vi.mock('../src/main/queries/cache', () => ({
  getCachedEnrichment: mocks.mockGetCachedEnrichment,
  cacheEnrichment: mocks.mockCacheEnrichment
}))

beforeEach(() => {
  applyEnrichDefaults()
})

describe('enrichDetails cancellation', () => {
  it('returns cancelled immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    const result = await enrichDetails('X-1', [], null, controller.signal)

    expect(result.status).toBe('cancelled')
    expect(result.analyzedPlatforms).toEqual([])
    expect(mocks.mockQueryTower).not.toHaveBeenCalled()
    expect(mocks.mockCacheEnrichment).not.toHaveBeenCalled()
  })

  it('aborts a page fetch, returns cancelled, never caches, and broadcasts a cancelled progress event', async () => {
    const send = vi.fn()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { isDestroyed: () => false, webContents: { send } } as never
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
    expect(mocks.mockCacheEnrichment).not.toHaveBeenCalled()
    expect(page.evaluate).toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(
      'detail:enrich-progress',
      expect.objectContaining({ status: 'cancelled', catalogNumber: 'X-1' })
    )
  })
})
