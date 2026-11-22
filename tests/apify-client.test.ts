import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setSetting, deleteSetting } from '../src/main/settings'
import { DEFAULT_APIFY_SETTINGS } from '../src/shared/apify'
import {
  searchTaobaoByImage,
  searchXianyuByImage,
  normalizeListings,
  parsePriceCNY,
  ApifyClientError
} from '../src/main/apify/client'

// Keep the real abort/timeout helpers but make the 2s poll delay instant so
// the async-run tests stay fast and deterministic.
vi.mock('../src/main/browser/abort', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/browser/abort')>()
  return {
    ...actual,
    abortableDelay: vi.fn(async (_ms: number, signal?: AbortSignal) => {
      if (signal?.aborted) throw actual.createAbortError()
    })
  }
})

let fetchMock: ReturnType<typeof vi.fn>

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  setSetting('apify', { ...DEFAULT_APIFY_SETTINGS, token: 'test-token' })
})

afterEach(() => {
  vi.unstubAllGlobals()
  deleteSetting('apify')
})

describe('normalizeListings / parsePriceCNY', () => {
  it('parses numeric and string CNY prices and normalizes image URLs', () => {
    const listings = normalizeListings([
      { title: 'A', price: 100, productUrl: 'https://item.taobao.com/a', imageUrl: 'https://img/x.jpg' },
      { title: 'B', priceText: '¥1,234.50', url: 'http://item.taobao.com/b' },
      { title: 'C', price: '88元', link: 'https://item.taobao.com/c', imageUrl: '//img.alicdn.com/c.jpg' }
    ])

    expect(listings).toHaveLength(3)
    expect(listings[0].priceCNY).toBe(100)
    expect(listings[1].priceCNY).toBe(1234.5)
    expect(listings[2].priceCNY).toBe(88)
    expect(listings[1].url).toBe('https://item.taobao.com/b')
    expect(listings[2].coverUrl).toBe('https://img.alicdn.com/c.jpg')
  })

  it('flattens a wrapper object carrying a products array', () => {
    expect(normalizeListings({ success: true, totalCount: 1, products: [{ title: 'P', price: 50 }] }))
      .toEqual([{ title: 'P', priceCNY: 50, url: null, coverUrl: null }])
  })

  it('reads the first image from images / imageGallery arrays', () => {
    expect(normalizeListings([{ title: 'A', price: 10, images: ['//img/a.jpg'] }])[0].coverUrl)
      .toBe('https://img/a.jpg')
    expect(normalizeListings([{ title: 'B', price: 10, imageGallery: ['https://img/b.jpg'] }])[0].coverUrl)
      .toBe('https://img/b.jpg')
  })

  it('drops rows with no title, price or link', () => {
    expect(normalizeListings([{}, null, 42, undefined, { title: 'Kept' }])).toHaveLength(1)
  })

  it('rejects non-positive and unparseable prices', () => {
    expect(parsePriceCNY('¥1,234.00')).toBe(1234)
    expect(parsePriceCNY('88元')).toBe(88)
    expect(parsePriceCNY(0)).toBeNull()
    expect(parsePriceCNY(-5)).toBeNull()
    expect(parsePriceCNY('free')).toBeNull()
    expect(parsePriceCNY(undefined)).toBeNull()
  })
})

describe('searchTaobaoByImage', () => {
  it('calls the sync actor with a Bearer token and returns normalized listings', async () => {
    fetchMock.mockResolvedValue(jsonResponse([
      { title: 'CD', price: 88, productUrl: 'https://item.taobao.com/1', imageUrl: 'https://img/1.jpg' }
    ]))

    const listings = await searchTaobaoByImage('https://cover.example/x.jpg')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.apify.com/v2/acts/dev00~taobao-reverse-image-search/run-sync-get-dataset-items?timeout=60')
    expect(url).not.toContain('token=')
    expect(options.method).toBe('POST')
    expect(options.headers.Authorization).toBe('Bearer test-token')
    expect(JSON.parse(options.body)).toEqual({ imageUrl: 'https://cover.example/x.jpg', num: 20 })
    expect(listings[0]).toMatchObject({ title: 'CD', priceCNY: 88 })
  })

  it('normalizes a slash-form actor id', async () => {
    setSetting('apify', { ...DEFAULT_APIFY_SETTINGS, token: 't', taobaoActor: 'dev00/taobao-reverse-image-search' })
    fetchMock.mockResolvedValue(jsonResponse([]))

    await searchTaobaoByImage('https://cover.example/x.jpg')

    expect(fetchMock.mock.calls[0][0]).toContain('/acts/dev00~taobao-reverse-image-search/')
  })

  it('refuses to make a paid request without a token', async () => {
    deleteSetting('apify')

    await expect(searchTaobaoByImage('https://cover.example/x.jpg'))
      .rejects.toMatchObject({ name: 'ApifyClientError', code: 'missing_token' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps 401/403 and 429 to friendly errors', async () => {
    fetchMock.mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
    await expect(searchTaobaoByImage('x')).rejects.toThrow(/Token 无效/)

    fetchMock.mockResolvedValueOnce(new Response('slow down', { status: 429 }))
    await expect(searchTaobaoByImage('x')).rejects.toThrow(/过于频繁/)
  })

  it('reports a non-ok status with its code', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }))
    await expect(searchTaobaoByImage('x')).rejects.toMatchObject({ code: 'http' })
  })

  it('reports invalid JSON responses', async () => {
    fetchMock.mockResolvedValueOnce(new Response('not json', { status: 200 }))
    await expect(searchTaobaoByImage('x')).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('returns an empty list for an empty dataset', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]))
    expect(await searchTaobaoByImage('x')).toEqual([])
  })
})

describe('searchXianyuByImage', () => {
  it('starts a run, polls until SUCCEEDED, then reads the dataset', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'run1', defaultDatasetId: 'ds1', status: 'RUNNING' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { status: 'RUNNING' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { status: 'SUCCEEDED' } }))
      .mockResolvedValueOnce(jsonResponse([
        { title: 'Used CD', price: 66, url: 'https://www.goofish.com/item?id=1' }
      ]))

    const listings = await searchXianyuByImage('https://cover.example/x.jpg')

    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(fetchMock.mock.calls[0][0]).toContain('/acts/zen-studio~goofish-xianyu-visual-search-scraper/runs')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      imageUrls: ['https://cover.example/x.jpg'],
      maxItems: 100,
      detailLevel: 'summary'
    })
    expect(fetchMock.mock.calls[1][0]).toContain('/actor-runs/run1')
    expect(fetchMock.mock.calls[3][0]).toContain('/datasets/ds1/items')
    expect(listings[0]).toMatchObject({ title: 'Used CD', priceCNY: 66 })
  })

  it('surfaces partial rows from a TIMED-OUT run', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'r', defaultDatasetId: 'd', status: 'RUNNING' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { status: 'TIMED-OUT' } }))
      .mockResolvedValueOnce(jsonResponse([{ title: 'Partial', price: 20 }]))

    expect(await searchXianyuByImage('x')).toHaveLength(1)
  })

  it('throws when the run FAILED', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'r', defaultDatasetId: 'd', status: 'RUNNING' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { status: 'FAILED', statusMessage: 'captcha' } }))

    await expect(searchXianyuByImage('x')).rejects.toThrow(/运行失败/)
  })

  it('throws when a timed-out run has no rows', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'r', defaultDatasetId: 'd', status: 'RUNNING' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { status: 'TIMED-OUT' } }))
      .mockResolvedValueOnce(jsonResponse([]))

    await expect(searchXianyuByImage('x')).rejects.toMatchObject({ code: 'run_failed' })
  })

  it('rejects a run response without an id/dataset', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: {} }))
    await expect(searchXianyuByImage('x')).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('does not start a run when the batch is already cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(searchXianyuByImage('x', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('stops polling when the caller aborts mid-run', async () => {
    const controller = new AbortController()
    fetchMock.mockImplementation(async () => {
      controller.abort()
      return jsonResponse({ data: { id: 'r', defaultDatasetId: 'd', status: 'RUNNING' } })
    })

    await expect(searchXianyuByImage('x', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('ApifyClientError', () => {
  it('carries a machine-readable code', () => {
    const err = new ApifyClientError('oops', 'http')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('ApifyClientError')
    expect(err.code).toBe('http')
  })
})
