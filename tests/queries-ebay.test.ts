import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetSetting, mockThrottledFetch, mockBrowserPool, mockConvert, mockTryLLMParse } = vi.hoisted(() => ({
  mockGetSetting: vi.fn(),
  mockThrottledFetch: vi.fn(),
  mockBrowserPool: { acquire: vi.fn(), release: vi.fn() },
  mockConvert: vi.fn(async (amount: number) => amount),
  mockTryLLMParse: vi.fn()
}))

vi.mock('../src/main/settings', () => ({ getSetting: mockGetSetting }))
vi.mock('../src/main/throttle', () => ({ throttledFetch: mockThrottledFetch }))
vi.mock('../src/main/browser', () => ({ browserPool: mockBrowserPool }))
vi.mock('../src/main/currency', () => ({ convertToUSDWithFallback: mockConvert }))
vi.mock('../src/main/llm/parser', () => ({ tryLLMParse: mockTryLLMParse }))

type EbayModule = typeof import('../src/main/queries/ebay')

async function loadEbay(): Promise<EbayModule> {
  vi.resetModules()
  return await import('../src/main/queries/ebay')
}

async function runWithFakeTimers<T>(fn: () => Promise<T>, totalMs = 60000): Promise<T> {
  vi.useFakeTimers()
  const promise = fn()
  await vi.advanceTimersByTimeAsync(totalMs)
  vi.useRealTimers()
  return await promise
}

function okJson(data: unknown) {
  return { ok: true, status: 200, json: async () => data }
}

interface EbayPageState {
  bodyByDomain: Record<string, { home?: string; search?: string }>
  defaultBody: string
  dollarResults: Record<string, unknown>
  dollarDollarResults: Record<string, unknown[]>
  firstItemValues: Record<string, unknown>
  contentHtml: string
}

function createEbayPage(overrides: Partial<EbayPageState> = {}) {
  const state: EbayPageState = {
    bodyByDomain: {},
    defaultBody: 'normal page',
    dollarResults: {},
    dollarDollarResults: {},
    firstItemValues: {},
    contentHtml: '<html></html>',
    ...overrides
  }

  const firstItem = {
    $eval: vi.fn(async (selector: string) => state.firstItemValues[selector] ?? null)
  }

  const page = {
    setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
    setCookie: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn(async (url: string) => {
      const hostname = new URL(url).hostname
      const phase = url.includes('/sch/i.html') ? 'search' : 'home'
      state.defaultBody = state.bodyByDomain[hostname]?.[phase] ?? state.defaultBody
    }),
    waitForSelector: vi.fn().mockResolvedValue({}),
    evaluate: vi.fn(async () => state.defaultBody),
    $: vi.fn(async (selector: string) => state.dollarResults[selector] ?? null),
    $$: vi.fn(async (selector: string) => state.dollarDollarResults[selector] ?? []),
    content: vi.fn(async () => state.contentHtml),
    evaluateHandle: vi.fn(async () => firstItem),
    viewport: vi.fn(() => ({ width: 1920, height: 1080 })),
    mouse: { move: vi.fn().mockResolvedValue(undefined) },
    close: vi.fn().mockResolvedValue(undefined)
  }

  return { page, state, firstItem }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSetting.mockImplementation((key: string) => {
    if (key === 'ebayClientId') return 'client-id'
    if (key === 'ebayClientSecret') return 'client-secret'
    if (key === 'cookies') return { ebay: 'cookie-value' }
    return undefined
  })
  mockTryLLMParse.mockResolvedValue(null)
  mockBrowserPool.acquire.mockResolvedValue({ browser: {}, page: {} })
  mockBrowserPool.release.mockResolvedValue(undefined)
})

describe('queryEbay', () => {
  it('returns not_found without API credentials (web no results)', async () => {
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'ebayClientId') return undefined
      if (key === 'ebayClientSecret') return undefined
      if (key === 'cookies') return { ebay: 'cookie-value' }
      return undefined
    })
    const { queryEbay } = await loadEbay()
    const { page, browser } = createEbayPage()
    page.$ = vi.fn(async (selector: string) =>
      selector.includes('srp-rail__no-results') ? {} : null
    )
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const result = await runWithFakeTimers(() => queryEbay('ABC-123'))

    expect(result.status).toBe('not_found')
    expect(page.setCookie).toHaveBeenCalled()
    expect(mockBrowserPool.release).toHaveBeenCalledWith(browser, page)
  })

  it('queries the API and maps items, prices and details to USD', async () => {
    const { queryEbay } = await loadEbay()
    mockThrottledFetch.mockImplementation(async (_domain: string, url: string) => {
      if (url.includes('/identity/v1/oauth2/token')) {
        return okJson({ access_token: 'access-token', expires_in: 3600 })
      }
      if (url.includes('/item_summary/search')) {
        return okJson({
          itemSummaries: [
            {
              title: 'Great CD',
              price: { value: '12.5', currency: 'USD' },
              image: { imageUrl: 'https://i.ebayimg.com/cover.jpg' },
              itemWebUrl: 'https://www.ebay.com/itm/123456'
            },
            {
              title: 'Cheaper CD',
              price: { value: '8', currency: 'USD' }
            }
          ]
        })
      }
      if (url.includes('/item/123456')) {
        return okJson({
          localizedAspects: [
            { name: 'Format', value: 'CD' },
            { name: 'Record Label', value: 'Label X' },
            { name: 'Release Year', value: '2023' },
            { name: 'Genre', value: 'Rock' },
            { name: 'Country', value: 'Japan' },
            { name: 'Artist', value: 'Someone' }
          ]
        })
      }
      return { ok: false, status: 404 }
    })

    const result = await queryEbay('ABC-123')

    expect(result).toMatchObject({
      platform: 'ebay',
      name: 'Great CD',
      priceMin: 8,
      priceMax: 12.5,
      coverUrl: 'https://i.ebayimg.com/cover.jpg',
      link: 'https://www.ebay.com/itm/123456',
      status: 'found',
      details: { format: 'CD', label: 'Label X', released: '2023', genre: 'Rock', country: 'Japan' }
    })
    expect(mockBrowserPool.acquire).not.toHaveBeenCalled()
  })

  it('returns not_found when the API has no items', async () => {
    const { queryEbay } = await loadEbay()
    mockThrottledFetch.mockImplementation(async (_domain: string, url: string) => {
      if (url.includes('/identity/v1/oauth2/token')) return okJson({ access_token: 't', expires_in: 3600 })
      return okJson({ itemSummaries: [] })
    })

    const result = await queryEbay('ABC-123')
    expect(result.status).toBe('not_found')
  })

  it('leaves details empty when the API omits item details', async () => {
    const { queryEbay } = await loadEbay()
    mockThrottledFetch.mockImplementation(async (_domain: string, url: string) => {
      if (url.includes('/identity/v1/oauth2/token')) return okJson({ access_token: 't', expires_in: 3600 })
      if (url.includes('/item_summary/search')) {
        return okJson({
          itemSummaries: [{ title: 'No Details', price: { value: '1', currency: 'USD' } }]
        })
      }
      return { ok: false, status: 404 }
    })

    const result = await queryEbay('ABC-123')
    expect(result.details).toBeUndefined()
  })

  it('returns empty details when the item URL has no /itm/ id', async () => {
    const { queryEbay } = await loadEbay()
    mockThrottledFetch.mockImplementation(async (_domain: string, url: string) => {
      if (url.includes('/identity/v1/oauth2/token')) return okJson({ access_token: 't', expires_in: 3600 })
      if (url.includes('/item_summary/search')) {
        return okJson({
          itemSummaries: [{ title: 'X', itemWebUrl: 'https://www.ebay.com/other' }]
        })
      }
      return { ok: false, status: 404 }
    })

    const result = await queryEbay('ABC-123')
    expect(result.details).toEqual({ label: null, format: null, country: null, released: null, genre: null })
    // No item-details fetch happened
    expect(mockThrottledFetch.mock.calls.some(([, url]) => url.includes('/item/'))).toBe(false)
  })

  it('extracts item data from the web when the API fails', async () => {
    const { queryEbay } = await loadEbay()
    mockThrottledFetch.mockRejectedValue(new Error('token endpoint down'))
    const { page, browser, state, firstItem } = createEbayPage()
    state.dollarDollarResults['.srp-results .s-item'] = [firstItem]
    state.firstItemValues = {
      '.s-item__title, h3, [class*="title"]': 'Web Album',
      img: 'https://i.ebayimg.com/web.jpg',
      'a[href*="/itm/"], a': 'https://www.ebay.com/itm/777',
      '.s-item__price, [class*="price"]': '$9.99 to $12.99'
    }
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const result = await runWithFakeTimers(() => queryEbay('ABC-123'))

    expect(result).toMatchObject({
      name: 'Web Album',
      priceMin: 9.99,
      priceMax: 12.99,
      coverUrl: 'https://i.ebayimg.com/web.jpg',
      link: 'https://www.ebay.com/itm/777',
      status: 'found'
    })
    expect(mockTryLLMParse).not.toHaveBeenCalled()
  })

  it('parses non-USD prices from the web and converts currency', async () => {
    const { queryEbay } = await loadEbay()
    mockThrottledFetch.mockRejectedValue(new Error('api down'))
    const { page, browser, state, firstItem } = createEbayPage()
    state.dollarDollarResults['.srp-results .s-item'] = [firstItem]
    state.firstItemValues = {
      '.s-item__title, h3, [class*="title"]': 'Euro Album',
      '.s-item__price, [class*="price"]': '€10.50'
    }
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const result = await runWithFakeTimers(() => queryEbay('ABC-123'))
    expect(result.priceMin).toBe(10.5)
    expect(mockConvert).toHaveBeenCalledWith(10.5, 'EUR')
  })

  it('falls back to item link traversal when standard selectors miss', async () => {
    const { queryEbay } = await loadEbay()
    mockThrottledFetch.mockRejectedValue(new Error('api down'))
    const { page, browser, state, firstItem } = createEbayPage()
    const itemLink = {
      evaluateHandle: vi.fn(async () => firstItem)
    }
    state.dollarResults['a[href*="/itm/"]'] = itemLink
    state.firstItemValues = {
      '.s-item__title, h3, [class*="title"]': 'Traversal Album',
      'a[href*="/itm/"], a': '/itm/555'
    }
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const result = await runWithFakeTimers(() => queryEbay('ABC-123'))
    expect(result.name).toBe('Traversal Album')
    expect(itemLink.evaluateHandle).toHaveBeenCalled()
  })

  it('prefers LLM results on the web', async () => {
    const { queryEbay } = await loadEbay()
    mockThrottledFetch.mockRejectedValue(new Error('api down'))
    const { page, browser, state, firstItem } = createEbayPage()
    state.dollarDollarResults['.srp-results .s-item'] = [firstItem]
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })
    mockTryLLMParse.mockResolvedValue({
      platform: 'ebay',
      name: 'LLM Item',
      artist: null,
      priceMin: 3,
      priceMax: 3,
      coverUrl: null,
      link: null,
      status: 'found'
    })

    const result = await runWithFakeTimers(() => queryEbay('ABC-123'))
    expect(result.name).toBe('LLM Item')
    expect(mockTryLLMParse).toHaveBeenCalled()
  })

  it('tries alternative domains when the main domain blocks', async () => {
    const { queryEbay } = await loadEbay()
    mockThrottledFetch.mockRejectedValue(new Error('api down'))
    const { page, browser, state, firstItem } = createEbayPage()
    state.bodyByDomain = {
      'www.ebay.com': { home: 'Just a moment...', search: 'Just a moment...' },
      'www.ebay.co.uk': { home: 'normal', search: 'normal' }
    }
    state.dollarDollarResults['.srp-results .s-item'] = [firstItem]
    state.firstItemValues = { '.s-item__title, h3, [class*="title"]': 'UK Album' }
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const result = await runWithFakeTimers(() => queryEbay('ABC-123'))
    expect(result.name).toBe('UK Album')
    expect(page.goto.mock.calls.some(([url]: string[]) => url.includes('ebay.co.uk'))).toBe(true)
  })

  it('returns not_found when every domain blocks', async () => {
    const { queryEbay } = await loadEbay()
    mockThrottledFetch.mockRejectedValue(new Error('api down'))
    const { page, browser, state } = createEbayPage()
    state.bodyByDomain = {
      'www.ebay.com': { home: 'Just a moment...', search: 'Just a moment...' },
      'www.ebay.co.uk': { home: 'Just a moment...', search: 'Just a moment...' },
      'www.ebay.de': { home: 'Just a moment...', search: 'Just a moment...' },
      'www.ebay.ca': { home: 'Just a moment...', search: 'Just a moment...' }
    }
    mockBrowserPool.acquire.mockResolvedValue({ browser, page })

    const result = await runWithFakeTimers(() => queryEbay('ABC-123'))
    expect(result.status).toBe('not_found')
  })

  it('returns a query error when both API and web fail', async () => {
    const { queryEbay } = await loadEbay()
    mockThrottledFetch.mockRejectedValue(new Error('api down'))
    mockBrowserPool.acquire.mockRejectedValue(new Error('no browsers'))

    const result = await queryEbay('ABC-123')
    expect(result).toMatchObject({ platform: 'ebay', status: 'error', error: 'no browsers' })
  })

  it('uses cached access tokens when still valid', async () => {
    const { queryEbay } = await loadEbay()
    mockThrottledFetch.mockImplementation(async (_domain: string, url: string) => {
      if (url.includes('/identity/v1/oauth2/token')) return okJson({ access_token: 't', expires_in: 3600 })
      if (url.includes('/item_summary/search')) return okJson({ itemSummaries: [{ title: 'X' }] })
      return { ok: false, status: 404 }
    })

    await queryEbay('ABC-123')
    // Drop the query-result cache (not the module state) so the second lookup
    // really re-runs the API path and only the access token is reused.
    const { clearAllCaches } = await import('../src/main/queries/cache')
    clearAllCaches()
    await queryEbay('ABC-123')

    const tokenCalls = mockThrottledFetch.mock.calls.filter(([, url]) =>
      url.includes('/identity/v1/oauth2/token')
    )
    expect(tokenCalls).toHaveLength(1)
  })

  it('serves a repeated lookup from the query cache without re-fetching', async () => {
    const { queryEbay } = await loadEbay()
    mockThrottledFetch.mockImplementation(async (_domain: string, url: string) => {
      if (url.includes('/identity/v1/oauth2/token')) return okJson({ access_token: 't', expires_in: 3600 })
      if (url.includes('/item_summary/search')) return okJson({ itemSummaries: [{ title: 'Cached Item' }] })
      return { ok: false, status: 404 }
    })

    const first = await queryEbay('CACHED-2')
    expect(first.status).toBe('found')
    const callsAfterFirst = mockThrottledFetch.mock.calls.length

    const second = await queryEbay('CACHED-2')
    expect(second).toEqual(first)
    expect(mockThrottledFetch.mock.calls.length).toBe(callsAfterFirst)
    expect(mockBrowserPool.acquire).not.toHaveBeenCalled()
  })
})
