import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setSetting, deleteSetting } from '../src/main/settings'
import { DEFAULT_APIFY_SETTINGS, resolveApifySettings } from '../src/shared/apify'
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

/** undici's `TypeError: fetch failed` carries the real reason in `cause`. */
function fetchFailedError(code: string): TypeError {
  const cause = Object.assign(new Error(`socket error (${code})`), { code })
  const err = new TypeError('fetch failed')
  Object.assign(err, { cause })
  return err
}

/** A 200 whose body stream dies mid-read. */
function brokenBodyResponse(): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.reject(fetchFailedError('UND_ERR_SOCKET')),
    text: () => Promise.resolve('')
  } as unknown as Response
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

describe('resolveApifySettings', () => {
  it('migrates the broken 1688 actor id back to the dedicated Taobao actor', () => {
    expect(resolveApifySettings({ token: 't', taobaoActor: 'apivault_labs~1688-image-search' }).taobaoActor)
      .toBe(DEFAULT_APIFY_SETTINGS.taobaoActor)
    expect(resolveApifySettings({ taobaoActor: 'apivault_labs/1688-image-search' }).taobaoActor)
      .toBe(DEFAULT_APIFY_SETTINGS.taobaoActor)
    expect(resolveApifySettings({ taobaoActor: DEFAULT_APIFY_SETTINGS.taobaoActor }).taobaoActor)
      .toBe(DEFAULT_APIFY_SETTINGS.taobaoActor)
  })

  it('keeps custom actor ids and fills defaults', () => {
    expect(resolveApifySettings({ taobaoActor: 'me/my-actor' })).toMatchObject({
      token: '',
      taobaoActor: 'me/my-actor',
      num: 3
    })
    expect(resolveApifySettings()).toEqual(DEFAULT_APIFY_SETTINGS)
  })
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

  it('reads the Xianyu pictureUrl and object-shaped gallery entries', () => {
    const listings = normalizeListings([
      { title: 'A', price: 10, pictureUrl: '//img.alicdn.com/a.jpg', images: [{ url: 'https://img.alicdn.com/gallery.jpg', width: 800 }] },
      { title: 'B', price: 20, images: [{ url: 'https://img.alicdn.com/b.jpg' }] }
    ])
    expect(listings[0].coverUrl).toBe('https://img.alicdn.com/a.jpg')
    expect(listings[1].coverUrl).toBe('https://img.alicdn.com/b.jpg')
  })

  it('reads priceCny and flattens a results wrapper (generic actor output)', () => {
    expect(normalizeListings({ results: [{ title: 'P', priceCny: 39.9, productUrl: 'https://item.taobao.com/p', imageUrl: 'https://img/p.jpg' }] }))
      .toEqual([{ title: 'P', priceCNY: 39.9, url: 'https://item.taobao.com/p', coverUrl: 'https://img/p.jpg' }])
  })

  it('drops rows with no title, price or link', () => {
    expect(normalizeListings([{}, null, 42, undefined, { title: 'Kept' }])).toHaveLength(1)
  })

  it('ignores SUMMARY / ERRORS diagnostic rows in a mixed dataset', () => {
    const rows = normalizeListings([
      { kind: 'SUMMARY', totalCount: 1, lowestPriceCny: 88, highestPriceCny: 88, OUTPUT: { count: 1 } },
      { kind: 'ERRORS', message: 'taobao_details_source_access_unavailable' },
      { title: 'CD', priceCny: 88, productUrl: 'https://item.taobao.com/1', imageUrl: 'https://img/1.jpg', marketplace: 'taobao' }
    ])
    expect(rows).toEqual([
      { title: 'CD', priceCNY: 88, url: 'https://item.taobao.com/1', coverUrl: 'https://img/1.jpg' }
    ])
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
  it('starts an async run, polls until SUCCEEDED, then reads the dataset', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'run1', defaultDatasetId: 'ds1', status: 'RUNNING' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { status: 'SUCCEEDED' } }))
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        totalCount: 1,
        products: [
          { title: 'CD', price: 88, productUrl: 'https://item.taobao.com/1', imageUrl: 'https://img/1.jpg' }
        ]
      }))

    const listings = await searchTaobaoByImage('BASE64')

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.apify.com/v2/acts/dev00~taobao-reverse-image-search/runs')
    expect(fetchMock.mock.calls[0][0]).not.toContain('token=')
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer test-token')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toEqual({ imageBase64: 'BASE64', num: 3 })
    expect(body).not.toHaveProperty('imageUrl')
    expect(body).not.toHaveProperty('imagesBase64')
    expect(body).not.toHaveProperty('marketplace')
    expect(fetchMock.mock.calls[1][0]).toContain('/actor-runs/run1')
    expect(fetchMock.mock.calls[2][0]).toContain('/datasets/ds1/items')
    expect(listings[0]).toMatchObject({ title: 'CD', priceCNY: 88, coverUrl: 'https://img/1.jpg' })
  })

  it('clamps num into the actor 1-50 range', async () => {
    setSetting('apify', { ...DEFAULT_APIFY_SETTINGS, token: 't', num: 999 })
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'r', defaultDatasetId: 'd', status: 'SUCCEEDED' } }))
      .mockResolvedValueOnce(jsonResponse([]))

    await searchTaobaoByImage('BASE64')

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).num).toBe(50)
  })

  it('normalizes a slash-form actor id', async () => {
    setSetting('apify', { ...DEFAULT_APIFY_SETTINGS, token: 't', taobaoActor: 'me/my-actor' })
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'r', defaultDatasetId: 'd', status: 'SUCCEEDED' } }))
      .mockResolvedValueOnce(jsonResponse([]))

    await searchTaobaoByImage('BASE64')

    expect(fetchMock.mock.calls[0][0]).toContain('/acts/me~my-actor/runs')
  })

  it('migrates a saved broken actor id before starting the run', async () => {
    setSetting('apify', { ...DEFAULT_APIFY_SETTINGS, token: 't', taobaoActor: 'apivault_labs~1688-image-search' })
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'r', defaultDatasetId: 'd', status: 'SUCCEEDED' } }))
      .mockResolvedValueOnce(jsonResponse([]))

    await searchTaobaoByImage('BASE64')

    expect(fetchMock.mock.calls[0][0]).toContain('/acts/dev00~taobao-reverse-image-search/runs')
  })

  it('refuses to make a paid request without a token', async () => {
    deleteSetting('apify')

    await expect(searchTaobaoByImage('BASE64'))
      .rejects.toMatchObject({ name: 'ApifyClientError', code: 'missing_token' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps 401 and 429 to friendly errors', async () => {
    fetchMock.mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
    await expect(searchTaobaoByImage('x')).rejects.toThrow(/Token 无效/)

    fetchMock.mockResolvedValueOnce(new Response('slow down', { status: 429 }))
    await expect(searchTaobaoByImage('x')).rejects.toThrow(/过于频繁/)
  })

  it('reports 401 as a bad token but never blames the token for a 403', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      error: {
        type: 'full-permission-actor-not-approved',
        message: 'This Actor requires full access to your account.',
        data: { approvalUrl: 'https://console.apify.com/actors/abc123?approvePermissions=true' }
      }
    }, 403))

    const err = await searchTaobaoByImage('x').catch(e => e) as ApifyClientError
    expect(err).toBeInstanceOf(ApifyClientError)
    expect(err.code).toBe('http')
    expect(err.message).toContain('完整权限')
    expect(err.message).toContain('https://console.apify.com/actors/abc123?approvePermissions=true')
    expect(err.message).not.toContain('Token 无效')
    // A single rejected start must not fall through to polling / dataset reads.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to a generic approval URL when Apify omits one', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      error: { type: 'full-permission-actor-not-approved', message: 'approve me' }
    }, 403))

    await expect(searchTaobaoByImage('x'))
      .rejects.toThrow(/console\.apify\.com\/actors\/\?approvePermissions=true/)
  })

  it('surfaces the actor-level reason for other 403s', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      error: { type: 'insufficient-permissions', message: 'Actor is not rented' }
    }, 403))

    const err = await searchTaobaoByImage('x').catch(e => e) as ApifyClientError
    expect(err.message).toContain('没有运行权限')
    expect(err.message).toContain('Actor is not rented')
    expect(err.message).not.toContain('Token 无效')
  })

  it('surfaces Apify structured error messages on other non-ok statuses', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      error: { type: 'invalid-input', message: 'imageBase64 must decode as an image' }
    }, 400))

    await expect(searchTaobaoByImage('x'))
      .rejects.toThrow(/imageBase64 must decode as an image/)
  })

  it('keeps plain-text error bodies as a fallback', async () => {
    fetchMock.mockResolvedValueOnce(new Response('bad gateway', { status: 502 }))
    await expect(searchTaobaoByImage('x')).rejects.toThrow(/Apify API 502: bad gateway/)
  })

  it('retries a transient fetch failed on the run-status poll', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'r', defaultDatasetId: 'd', status: 'RUNNING' } }))
      .mockRejectedValueOnce(fetchFailedError('ECONNRESET'))
      .mockResolvedValueOnce(jsonResponse({ data: { status: 'SUCCEEDED' } }))
      .mockResolvedValueOnce(jsonResponse([{ title: 'CD', price: 88, productUrl: 'https://item.taobao.com/1', imageUrl: 'https://img/1.jpg' }]))

    const listings = await searchTaobaoByImage('x')

    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(listings).toHaveLength(1)
    expect(listings[0].title).toBe('CD')
  })

  it('retries a transient fetch failed while reading dataset items', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'r', defaultDatasetId: 'd', status: 'SUCCEEDED' } }))
      .mockRejectedValueOnce(fetchFailedError('UND_ERR_SOCKET'))
      .mockResolvedValueOnce(jsonResponse([{ title: 'CD', price: 50 }]))

    expect(await searchTaobaoByImage('x')).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('retries a dropped connection mid-body instead of calling it invalid JSON', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'r', defaultDatasetId: 'd', status: 'RUNNING' } }))
      .mockResolvedValueOnce(brokenBodyResponse())
      .mockResolvedValueOnce(jsonResponse({ data: { status: 'SUCCEEDED' } }))
      .mockResolvedValueOnce(jsonResponse([{ title: 'CD', price: 88 }]))

    expect(await searchTaobaoByImage('x')).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('never retries the run-start POST and reports the underlying cause', async () => {
    fetchMock.mockRejectedValueOnce(fetchFailedError('ENOTFOUND'))

    const err = await searchTaobaoByImage('x').catch(e => e) as ApifyClientError
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(err.code).toBe('network')
    expect(err.message).toContain('网络连接失败')
    expect(err.message).toContain('ENOTFOUND')
  })

  it('gives up after the bounded GET retries with a readable cause', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'r', defaultDatasetId: 'd', status: 'RUNNING' } }))
      .mockRejectedValue(fetchFailedError('ECONNRESET'))

    const err = await searchTaobaoByImage('x').catch(e => e) as ApifyClientError
    expect(err.code).toBe('network')
    expect(err.message).toContain('ECONNRESET')
    // 1 POST + 3 GET attempts, no more.
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('reports a non-ok status with its code', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }))
    await expect(searchTaobaoByImage('x')).rejects.toMatchObject({ code: 'http' })
  })

  it('reports invalid JSON responses', async () => {
    fetchMock.mockResolvedValueOnce(new Response('not json', { status: 200 }))
    await expect(searchTaobaoByImage('x')).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('returns an empty list for a SUCCEEDED run with an empty dataset', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'r', defaultDatasetId: 'd', status: 'SUCCEEDED' } }))
      .mockResolvedValueOnce(jsonResponse([]))
    expect(await searchTaobaoByImage('x')).toEqual([])
  })

  it('throws when the run FAILED', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'r', defaultDatasetId: 'd', status: 'RUNNING' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { status: 'FAILED', statusMessage: 'captcha' } }))

    await expect(searchTaobaoByImage('x')).rejects.toThrow(/运行失败/)
  })

  it('surfaces the actor ERRORS/SUMMARY records on a FAILED run', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'r', defaultDatasetId: 'd', defaultKeyValueStoreId: 'kv1', status: 'RUNNING' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { status: 'FAILED', statusMessage: 'All photo search failed; see ERRORS' } }))
      .mockResolvedValueOnce(jsonResponse([{ code: 'fatkun_rate_limited', message: 'upstream refused' }]))
      .mockResolvedValueOnce(jsonResponse({ status: 'FAILED' }))

    const err = await searchTaobaoByImage('x').catch(e => e) as ApifyClientError
    expect(err.code).toBe('run_failed')
    expect(err.message).toContain('All photo search failed')
    expect(err.message).toContain('fatkun_rate_limited')
    expect(fetchMock.mock.calls[2][0]).toContain('/key-value-stores/kv1/records/ERRORS')
    expect(fetchMock.mock.calls[3][0]).toContain('/key-value-stores/kv1/records/SUMMARY')
  })

  it('falls back to a Console hint when diagnostics are unreadable', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'r', defaultDatasetId: 'd', defaultKeyValueStoreId: 'kv1', status: 'FAILED', statusMessage: 'All photo search failed; see ERRORS' } }))
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))

    const err = await searchTaobaoByImage('x').catch(e => e) as ApifyClientError
    expect(err.message).toContain('All photo search failed')
    expect(err.message).toContain('Apify Console')
  })

  it('surfaces the dedicated actor error payload when it emits no products', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'r', defaultDatasetId: 'd', status: 'SUCCEEDED' } }))
      .mockResolvedValueOnce(jsonResponse({ success: false, error: 'Missing required field: imageUrl', code: 'invalid_parameters' }))

    const err = await searchTaobaoByImage('x').catch(e => e) as ApifyClientError
    expect(err.code).toBe('run_failed')
    expect(err.message).toContain('Missing required field: imageUrl')
    expect(err.message).toContain('invalid_parameters')
  })

  it('reports a SUMMARY failure even when the run is marked SUCCEEDED', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'r', defaultDatasetId: 'd', status: 'SUCCEEDED' } }))
      .mockResolvedValueOnce(jsonResponse([{ status: 'FAILED', message: 'All photo search failed; see ERRORS' }]))

    const err = await searchTaobaoByImage('x').catch(e => e) as ApifyClientError
    expect(err.code).toBe('run_failed')
    expect(err.message).toContain('All photo search failed')
  })

  it('throws when a timed-out run has no rows', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'r', defaultDatasetId: 'd', status: 'RUNNING' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { status: 'TIMED-OUT' } }))
      .mockResolvedValueOnce(jsonResponse([]))

    await expect(searchTaobaoByImage('x')).rejects.toMatchObject({ code: 'run_failed' })
  })

  it('rejects a run response without an id/dataset', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: {} }))
    await expect(searchTaobaoByImage('x')).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('does not start a run when the batch is already cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(searchTaobaoByImage('x', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('searchXianyuByImage', () => {
  it('starts a run, polls until SUCCEEDED, then reads the dataset', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'run1', defaultDatasetId: 'ds1', status: 'RUNNING' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { status: 'RUNNING' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { status: 'SUCCEEDED' } }))
      .mockResolvedValueOnce(jsonResponse([
        { title: 'Used CD', price: 66, url: 'https://www.goofish.com/item?id=1', pictureUrl: '//img.alicdn.com/x.jpg' }
      ]))

    const listings = await searchXianyuByImage('BASE64')

    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(fetchMock.mock.calls[0][0]).toContain('/acts/zen-studio~goofish-xianyu-visual-search-scraper/runs')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toMatchObject({
      imageBase64: 'BASE64',
      maxItems: 3,
      detailLevel: 'summary',
      sortBy: 'relevance'
    })
    expect(body).not.toHaveProperty('imageUrls')
    expect(fetchMock.mock.calls[1][0]).toContain('/actor-runs/run1')
    expect(fetchMock.mock.calls[3][0]).toContain('/datasets/ds1/items')
    expect(listings[0]).toMatchObject({ title: 'Used CD', priceCNY: 66, coverUrl: 'https://img.alicdn.com/x.jpg' })
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
