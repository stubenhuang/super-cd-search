import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockThrottledFetch, mockGetSetting, mockBrowserPool, mockConvertToUSD } = vi.hoisted(() => ({
  mockThrottledFetch: vi.fn(),
  mockGetSetting: vi.fn(),
  mockBrowserPool: { acquire: vi.fn(), release: vi.fn() },
  mockConvertToUSD: vi.fn(async (amount: number) => amount)
}))

vi.mock('../src/main/throttle', () => ({ throttledFetch: mockThrottledFetch }))
vi.mock('../src/main/settings', () => ({ getSetting: mockGetSetting }))
vi.mock('../src/main/browser', () => ({ browserPool: mockBrowserPool }))
vi.mock('../src/main/currency', () => ({
  convertToUSD: mockConvertToUSD,
  convertToUSDWithFallback: mockConvertToUSD,
  convertFromUSD: mockConvertToUSD,
  getUsdToDisplayRate: vi.fn()
}))

import {
  fetchDiscogsIdentity,
  searchReleaseCandidates,
  verifyDiscogsCredentials,
  createDiscogsListing
} from '../src/main/publish/discogs'
import { DISCOGS_USER_AGENT } from '../src/main/queries/discogs'
import type { DiscogsListingInput } from '../src/main/publish/discogs'

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status })
}

function textResponse(body: string, status: number) {
  return new Response(body, { status })
}

/** The last (url, init) pair handed to throttledFetch. */
function lastFetch(): { domain: string; url: string; init: RequestInit } {
  const call = mockThrottledFetch.mock.calls.at(-1)!
  return { domain: call[0] as string, url: call[1] as string, init: call[2] as RequestInit }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSetting.mockReturnValue('token')
})

describe('searchReleaseCandidates', () => {
  it('returns no candidates when the search is empty', async () => {
    mockThrottledFetch.mockResolvedValue(jsonResponse({ results: [] }))
    await expect(searchReleaseCandidates('SICP-6480', 'tok')).resolves.toEqual({ candidates: [], best: null })
  })

  it('handles a missing results array as empty', async () => {
    mockThrottledFetch.mockResolvedValue(jsonResponse({}))
    await expect(searchReleaseCandidates('X-1', 'tok')).resolves.toEqual({ candidates: [], best: null })
  })

  it('prefers an exact catalog match ignoring spaces, dashes and case', async () => {
    mockThrottledFetch.mockResolvedValue(
      jsonResponse({
        results: [
          { id: 1, title: 'A - Album', catno: 'OTHER-1' },
          { id: 2, title: 'A - Album', catno: 'sicp 6480' },
          { id: 3, title: 'A - Album', catno: 'SICP6480' }
        ]
      })
    )
    const search = await searchReleaseCandidates('SICP-6480', 'tok')
    expect(search.candidates).toHaveLength(3)
    expect(search.best?.id).toBe(2)
  })

  it('falls back to the first hit when nothing matches exactly', async () => {
    mockThrottledFetch.mockResolvedValue(
      jsonResponse({
        results: [
          { id: 10, title: 'A - Album', catno: 'NOPE' },
          { id: 11, title: 'B - Album', catno: 'SICP-6481' }
        ]
      })
    )
    const search = await searchReleaseCandidates('SICP-6480', 'tok')
    expect(search.best?.id).toBe(10)
  })

  it('keeps at most five candidates and maps year/format/catno', async () => {
    mockThrottledFetch.mockResolvedValue(
      jsonResponse({
        results: Array.from({ length: 8 }, (_, index) => ({
          id: index + 1,
          title: `Artist - Album ${index + 1}`,
          catno: `C-${index + 1}`,
          year: String(1990 + index),
          format: ['CD', 'Album']
        }))
      })
    )
    const search = await searchReleaseCandidates('C-1', 'tok')
    expect(search.candidates).toHaveLength(5)
    expect(search.candidates[0]).toEqual({
      id: 1,
      title: 'Artist - Album 1',
      catno: 'C-1',
      year: 1990,
      format: 'CD, Album'
    })
    expect(search.best?.id).toBe(1)
  })

  it('omits year/format when the hit does not carry them', async () => {
    mockThrottledFetch.mockResolvedValue(
      jsonResponse({ results: [{ id: 5, title: 'A - B' }, { id: 6, title: 'A - C', format: [] }] })
    )
    const search = await searchReleaseCandidates('ZZZ', 'tok')
    expect(search.candidates[0]).toEqual({ id: 5, title: 'A - B', catno: '' })
    expect(search.candidates[1]).toEqual({ id: 6, title: 'A - C', catno: '' })
  })

  it('requests the database search endpoint with the encoded catalog number', async () => {
    mockThrottledFetch.mockResolvedValue(jsonResponse({ results: [] }))
    await searchReleaseCandidates('SICP 6480', 'tok')
    const { domain, url, init } = lastFetch()
    expect(domain).toBe('api.discogs.com')
    expect(url).toBe('https://api.discogs.com/database/search?catno=SICP%206480&type=release')
    expect(init.headers).toMatchObject({ Authorization: 'Discogs token=tok' })
  })

  it('throws with the HTTP status for a non-2xx response', async () => {
    mockThrottledFetch.mockResolvedValue(textResponse('nope', 500))
    await expect(searchReleaseCandidates('X-1', 'tok')).rejects.toThrow('HTTP 500')
  })
})

describe('fetchDiscogsIdentity', () => {
  it('resolves the username behind a valid token and sends auth headers', async () => {
    mockThrottledFetch.mockResolvedValue(jsonResponse({ id: 42, username: 'seller' }, 200))

    await expect(fetchDiscogsIdentity('tok')).resolves.toEqual({ id: 42, username: 'seller' })

    const { domain, url, init } = lastFetch()
    expect(domain).toBe('api.discogs.com')
    expect(url).toMatch(/\/oauth\/identity$/)
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Discogs token=tok')
    expect(headers['User-Agent']).toBe(DISCOGS_USER_AGENT)
  })

  it('returns null when the payload carries no username', async () => {
    mockThrottledFetch.mockResolvedValue(jsonResponse({ id: 7 }, 200))
    await expect(fetchDiscogsIdentity('tok')).resolves.toBeNull()
  })

  it('throws the status-specific message for a non-2xx response', async () => {
    mockThrottledFetch.mockResolvedValue(jsonResponse({ message: 'Invalid token' }, 401))
    await expect(fetchDiscogsIdentity('bad')).rejects.toThrow(
      'Discogs 认证失败（401）：Token 无效或权限不足 — Invalid token'
    )
  })

  it('passes the abort signal through to the request', async () => {
    mockThrottledFetch.mockResolvedValue(jsonResponse({ username: 'seller' }, 200))
    const controller = new AbortController()
    await fetchDiscogsIdentity('tok', controller.signal)
    expect(lastFetch().init.signal).toBe(controller.signal)
  })
})

describe('verifyDiscogsCredentials', () => {
  it('reports a missing token before any request', async () => {
    await expect(verifyDiscogsCredentials('')).resolves.toEqual({
      ok: false,
      message: '未配置 Discogs Token（可在「API 令牌」分区填写，或在此目标里单独填写）'
    })
    expect(mockThrottledFetch).not.toHaveBeenCalled()
  })

  it('reports the detected account for a valid token', async () => {
    mockThrottledFetch.mockResolvedValue(jsonResponse({ id: 3, username: 'seller' }, 200))

    await expect(verifyDiscogsCredentials('tok')).resolves.toEqual({
      ok: true,
      account: 'seller',
      message: '已连接：seller'
    })

    const { url, init } = lastFetch()
    expect(url).toMatch(/\/oauth\/identity$/)
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Discogs token=tok')
    expect(headers['User-Agent']).toBe(DISCOGS_USER_AGENT)
  })

  it('treats a response without a username as an unrecognised identity', async () => {
    mockThrottledFetch.mockResolvedValue(jsonResponse({ id: 3 }, 200))
    await expect(verifyDiscogsCredentials('tok')).resolves.toEqual({
      ok: false,
      message: 'Discogs 返回了无法识别的身份信息'
    })
  })

  it('surfaces the 401 branch of discogsErrorMessage', async () => {
    mockThrottledFetch.mockResolvedValue(jsonResponse({ message: 'Invalid token' }, 401))
    await expect(verifyDiscogsCredentials('bad')).resolves.toEqual({
      ok: false,
      message: 'Discogs 认证失败（401）：Token 无效或权限不足 — Invalid token'
    })
  })

  it('surfaces the 403 branch of discogsErrorMessage', async () => {
    mockThrottledFetch.mockResolvedValue(textResponse('forbidden', 403))
    const result = await verifyDiscogsCredentials('tok')
    expect(result).toEqual({
      ok: false,
      message: 'Discogs 拒绝访问（403）：账号可能没有卖家权限，或该操作不被允许'
    })
    expect(result.message).not.toContain('forbidden')
  })

  it('surfaces the 404 branch of discogsErrorMessage', async () => {
    mockThrottledFetch.mockResolvedValue(jsonResponse({ message: 'not found' }, 404))
    await expect(verifyDiscogsCredentials('tok')).resolves.toEqual({
      ok: false,
      message: 'Discogs 资源不存在（404） — not found'
    })
  })

  it('falls back to the identity-check message for other statuses', async () => {
    mockThrottledFetch.mockResolvedValue(textResponse('boom', 500))
    await expect(verifyDiscogsCredentials('tok')).resolves.toEqual({
      ok: false,
      message: 'Discogs 身份校验失败（HTTP 500）'
    })
  })

  it('reports a network failure instead of rejecting', async () => {
    mockThrottledFetch.mockRejectedValue(new Error('socket hang up'))
    await expect(verifyDiscogsCredentials('tok')).resolves.toEqual({
      ok: false,
      message: 'socket hang up'
    })
  })
})

describe('createDiscogsListing', () => {
  const input: DiscogsListingInput = {
    releaseId: 123,
    condition: 'Very Good Plus (VG+)',
    price: 19.99,
    status: 'For Sale'
  }

  it('posts the listing and returns the id/url', async () => {
    mockThrottledFetch.mockResolvedValue(
      jsonResponse({ listing_id: 55, resource_url: 'https://www.discogs.com/sell/item/55' }, 201)
    )
    const result = await createDiscogsListing('tok', input)
    expect(result).toEqual({ listingId: '55', listingUrl: 'https://www.discogs.com/sell/item/55' })

    const { domain, url, init } = lastFetch()
    expect(domain).toBe('api.discogs.com')
    expect(url).toBe('https://api.discogs.com/marketplace/listings')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect((init.headers as Record<string, string>).Authorization).toContain('tok')
    expect(JSON.parse(init.body as string)).toEqual({
      release_id: 123,
      condition: 'Very Good Plus (VG+)',
      price: 19.99,
      status: 'For Sale'
    })
  })

  it('forwards every optional field and rounds weight/format_quantity', async () => {
    mockThrottledFetch.mockResolvedValue(jsonResponse({ listing_id: 1 }, 201))
    await createDiscogsListing('tok', {
      ...input,
      status: 'Draft',
      sleeveCondition: 'Generic',
      comments: '  hello  ',
      allowOffers: true,
      externalId: '  SICP-6480  ',
      location: '  上海  ',
      weight: 180.6,
      formatQuantity: 2.4
    })
    expect(JSON.parse(lastFetch().init.body as string)).toEqual({
      release_id: 123,
      condition: 'Very Good Plus (VG+)',
      price: 19.99,
      status: 'Draft',
      sleeve_condition: 'Generic',
      comments: 'hello',
      allow_offers: true,
      external_id: 'SICP-6480',
      location: '上海',
      weight: 181,
      format_quantity: 2
    })
  })

  it('omits empty optional values and keeps allow_offers false', async () => {
    mockThrottledFetch.mockResolvedValue(jsonResponse({ listing_id: 1 }, 201))
    await createDiscogsListing('tok', {
      ...input,
      sleeveCondition: '',
      comments: '   ',
      allowOffers: false,
      externalId: '  ',
      location: '   ',
      weight: null,
      formatQuantity: Number.NaN
    })
    const body = JSON.parse(lastFetch().init.body as string)
    expect(body).toEqual({
      release_id: 123,
      condition: 'Very Good Plus (VG+)',
      price: 19.99,
      status: 'For Sale',
      allow_offers: false
    })
    expect(body).not.toHaveProperty('sleeve_condition')
    expect(body).not.toHaveProperty('comments')
    expect(body).not.toHaveProperty('external_id')
    expect(body).not.toHaveProperty('location')
    expect(body).not.toHaveProperty('weight')
    expect(body).not.toHaveProperty('format_quantity')
  })

  it('passes the abort signal through to the request', async () => {
    mockThrottledFetch.mockResolvedValue(jsonResponse({ listing_id: 1 }, 201))
    const controller = new AbortController()
    await createDiscogsListing('tok', input, controller.signal)
    expect(lastFetch().init.signal).toBe(controller.signal)
  })

  it.each([
    [401, 'Invalid token', '认证失败（401）'],
    [403, 'not a seller', '拒绝访问（403）'],
    [404, 'release not found', '资源不存在（404）'],
    [422, 'invalid price', '拒绝了该发布内容（422）']
  ])('surfaces the %i error branch with a JSON body', async (status, detail, expected) => {
    mockThrottledFetch.mockResolvedValue(jsonResponse({ message: detail }, status))
    const error = await createDiscogsListing('tok', input).catch((err: unknown) => err as Error)
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain(expected)
    expect(error.message).toContain(detail)
  })

  it('surfaces the error branch when the body is not JSON', async () => {
    mockThrottledFetch.mockResolvedValue(textResponse('<html>oops</html>', 422))
    await expect(createDiscogsListing('tok', input)).rejects.toThrow('拒绝了该发布内容（422）')
  })

  it('falls back to the generic branch for unexpected statuses', async () => {
    mockThrottledFetch.mockResolvedValue(textResponse('server error', 500))
    await expect(createDiscogsListing('tok', input)).rejects.toThrow('Discogs 发布失败（HTTP 500）')
  })

  it('falls back to the public item URL when resource_url is missing', async () => {
    mockThrottledFetch.mockResolvedValue(jsonResponse({ listing_id: 77 }, 201))
    await expect(createDiscogsListing('tok', input)).resolves.toEqual({
      listingId: '77',
      listingUrl: 'https://www.discogs.com/sell/item/77'
    })
  })

  it('returns an empty id/url when the response has neither', async () => {
    mockThrottledFetch.mockResolvedValue(jsonResponse({}, 201))
    await expect(createDiscogsListing('tok', input)).resolves.toEqual({ listingId: '', listingUrl: '' })
  })
})
