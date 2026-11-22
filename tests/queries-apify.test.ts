import { describe, it, expect, vi, beforeEach } from 'vitest'

// Only the two network calls are stubbed; keep the real error class and
// normalization helpers so error mapping is exercised end to end.
vi.mock('../src/main/apify/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/apify/client')>()
  return {
    ...actual,
    searchTaobaoByImage: vi.fn(),
    searchXianyuByImage: vi.fn()
  }
})
vi.mock('../src/main/currency', () => ({
  convertToUSDWithFallback: vi.fn(async (amount: number) => amount / 7)
}))

import { queryTaobao } from '../src/main/queries/taobao'
import { queryXianyu } from '../src/main/queries/xianyu'
import { searchTaobaoByImage, searchXianyuByImage, ApifyClientError } from '../src/main/apify/client'
import { clearAllCaches } from '../src/main/queries/cache'
import type { ApifyListing } from '../src/main/apify/client'

const listings: ApifyListing[] = [
  { title: 'Best', priceCNY: 70, url: 'https://example.com/best', coverUrl: 'https://example.com/best.jpg' },
  { title: 'Second', priceCNY: 140, url: 'https://example.com/2', coverUrl: null }
]

function timeoutError(message: string): Error {
  const err = new Error(message)
  err.name = 'TimeoutError'
  return err
}

beforeEach(() => {
  vi.clearAllMocks()
  clearAllCaches()
  vi.mocked(searchTaobaoByImage).mockResolvedValue(listings)
  vi.mocked(searchXianyuByImage).mockResolvedValue(listings)
})

describe('queryTaobao', () => {
  it('returns a found result with a USD price range', async () => {
    const result = await queryTaobao('X-1', 'https://cover.example/x.jpg')

    expect(vi.mocked(searchTaobaoByImage).mock.calls[0][0]).toBe('https://cover.example/x.jpg')
    expect(result).toMatchObject({
      platform: 'taobao',
      status: 'found',
      name: 'Best',
      priceMin: 10,
      priceMax: 20,
      link: 'https://example.com/best',
      coverUrl: 'https://example.com/best.jpg'
    })
  })

  it('maps an ApifyClientError to a friendly error result', async () => {
    vi.mocked(searchTaobaoByImage).mockRejectedValue(new ApifyClientError('Token 无效或已过期', 'http'))

    const result = await queryTaobao('X-1', 'https://cover.example/x.jpg')

    expect(result).toMatchObject({ platform: 'taobao', status: 'error', error: 'Token 无效或已过期' })
  })

  it('maps a timeout to a retryable error result', async () => {
    vi.mocked(searchTaobaoByImage).mockRejectedValue(timeoutError('淘宝图搜超时'))

    const result = await queryTaobao('X-1', 'https://cover.example/x.jpg')

    expect(result).toMatchObject({ platform: 'taobao', status: 'error', error: '淘宝图搜超时' })
  })
})

describe('queryXianyu', () => {
  it('returns a found result with a USD price range', async () => {
    const result = await queryXianyu('X-1', 'https://cover.example/x.jpg')

    expect(vi.mocked(searchXianyuByImage).mock.calls[0][0]).toBe('https://cover.example/x.jpg')
    expect(result).toMatchObject({ platform: 'xianyu', status: 'found', priceMin: 10, priceMax: 20 })
  })

  it('maps an ApifyClientError to an error result', async () => {
    vi.mocked(searchXianyuByImage).mockRejectedValue(new ApifyClientError('闲鱼图搜运行失败', 'run_failed'))

    const result = await queryXianyu('X-1', 'https://cover.example/x.jpg')

    expect(result).toMatchObject({ platform: 'xianyu', status: 'error', error: '闲鱼图搜运行失败' })
  })

  it('falls back to a generic error message', async () => {
    vi.mocked(searchXianyuByImage).mockRejectedValue(new Error('socket hang up'))

    const result = await queryXianyu('X-1', 'https://cover.example/x.jpg')

    expect(result).toMatchObject({ platform: 'xianyu', status: 'error', error: 'socket hang up' })
  })
})
