import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockConvert } = vi.hoisted(() => ({
  mockConvert: vi.fn(async (_amount: number) => 22.11)
}))

vi.mock('../src/main/currency', () => ({
  convertToUSDWithFallback: mockConvert
}))

import { notFound, queryError, parseJPYPrice } from '../src/main/queries/types'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('queries/types', () => {
  it('notFound returns a not_found result for the platform', () => {
    expect(notFound('discogs')).toEqual({
      platform: 'discogs',
      name: null,
      artist: null,
      priceMin: null,
      priceMax: null,
      coverUrl: null,
      link: null,
      status: 'not_found'
    })
  })

  it('queryError returns an error result with message', () => {
    expect(queryError('ebay', 'oops')).toMatchObject({
      platform: 'ebay',
      status: 'error',
      error: 'oops'
    })
  })

  it('parseJPYPrice parses yen amounts and converts them', async () => {
    expect(await parseJPYPrice('¥3,300')).toBe(22.11)
    expect(mockConvert).toHaveBeenCalledWith(3300, 'JPY')

    await parseJPYPrice('1,980円')
    expect(mockConvert).toHaveBeenCalledWith(1980, 'JPY')
  })

  it('parseJPYPrice returns null for unparseable text', async () => {
    expect(await parseJPYPrice('no price here')).toBeNull()
    expect(await parseJPYPrice('￥-')).toBeNull()
  })

  it('parseJPYPrice returns null when conversion fails', async () => {
    mockConvert.mockResolvedValueOnce(null as never)
    expect(await parseJPYPrice('¥3,300')).toBeNull()
  })
})
