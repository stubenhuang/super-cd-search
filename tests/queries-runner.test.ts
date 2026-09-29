import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The shared platform-query scaffold: cache lookup, abort checks, error
 * containment and the "errors are never cached" rule all live here, so the
 * nine platform modules can stay a `run` callback each.
 */

const { mockGetCachedQueryResult, mockCacheQueryResult, mockLogger } = vi.hoisted(() => ({
  mockGetCachedQueryResult: vi.fn(),
  mockCacheQueryResult: vi.fn(),
  mockLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

vi.mock('../src/main/queries/cache', () => ({
  getCachedQueryResult: mockGetCachedQueryResult,
  cacheQueryResult: mockCacheQueryResult
}))
vi.mock('../src/main/logger', () => ({ logger: mockLogger }))

import { runPlatformQuery } from '../src/main/queries/runner'
import type { QueryResult } from '../src/shared/types'

function found(platform: QueryResult['platform']): QueryResult {
  return { platform, name: 'Album', artist: null, priceMin: 1, priceMax: 1, coverUrl: null, link: null, status: 'found' }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetCachedQueryResult.mockReturnValue(null)
})

describe('runPlatformQuery', () => {
  it('returns a cached result without running the platform', async () => {
    const cached = found('tower')
    mockGetCachedQueryResult.mockReturnValue(cached)
    const run = vi.fn(async () => found('tower'))

    const result = await runPlatformQuery('X-1', undefined, { platform: 'tower', tag: 'queries.tower', run })

    expect(result).toBe(cached)
    expect(run).not.toHaveBeenCalled()
    expect(mockCacheQueryResult).not.toHaveBeenCalled()
  })

  it('passes the cache context through to both cache calls', async () => {
    await runPlatformQuery('X-1', undefined, {
      platform: 'hmv',
      tag: 'queries.hmv',
      cacheContext: 'fast',
      run: async () => found('hmv')
    })

    expect(mockGetCachedQueryResult).toHaveBeenCalledWith('hmv', 'X-1', 'fast')
    expect(mockCacheQueryResult).toHaveBeenCalledWith('X-1', expect.objectContaining({ platform: 'hmv' }), 'fast')
  })

  it('caches a successful result under the given platform', async () => {
    const result = await runPlatformQuery('X-1', undefined, { platform: 'tower', tag: 'queries.tower', run: async () => found('tower') })
    expect(result.status).toBe('found')
    expect(mockCacheQueryResult).toHaveBeenCalledWith('X-1', result, undefined)
  })

  it('turns a platform failure into an error result that still gets cached', async () => {
    const result = await runPlatformQuery('X-1', undefined, {
      platform: 'tower',
      tag: 'queries.tower',
      run: async () => { throw new Error('dom changed') }
    })

    // The cache module is the one that refuses to persist error results.
    expect(result).toMatchObject({ platform: 'tower', status: 'error', error: 'dom changed' })
    expect(mockCacheQueryResult).toHaveBeenCalledWith('X-1', result, undefined)
  })

  it('rejects with Unknown error for non-Error throws', async () => {
    const result = await runPlatformQuery('X-1', undefined, {
      platform: 'tower',
      tag: 'queries.tower',
      run: async () => { throw 'boom' }
    })
    expect(result.error).toBe('Unknown error')
  })

  it('uses the custom error mapper when one is given', async () => {
    const custom = found('xianyu')
    const result = await runPlatformQuery('X-1', undefined, {
      platform: 'xianyu',
      tag: 'queries.xianyu',
      mapError: () => ({ ...custom, status: 'error', error: 'timeout message' }),
      run: async () => { throw new Error('deadline') }
    })
    expect(result.error).toBe('timeout message')
  })

  it('propagates an abort before the run instead of caching it', async () => {
    const controller = new AbortController()
    controller.abort()
    const run = vi.fn(async () => found('tower'))

    await expect(runPlatformQuery('X-1', controller.signal, { platform: 'tower', tag: 'queries.tower', run }))
      .rejects.toThrow('Aborted')
    expect(run).not.toHaveBeenCalled()
    expect(mockCacheQueryResult).not.toHaveBeenCalled()
  })

  it('propagates an abort raised inside the run', async () => {
    const controller = new AbortController()
    const run = vi.fn(async () => {
      controller.abort()
      throw new Error('Aborted')
    })

    await expect(runPlatformQuery('X-1', controller.signal, { platform: 'tower', tag: 'queries.tower', run }))
      .rejects.toThrow('Aborted')
    expect(mockCacheQueryResult).not.toHaveBeenCalled()
  })

  it('does not cache an abort that happens after the run succeeded', async () => {
    const controller = new AbortController()
    const run = vi.fn(async () => {
      controller.abort()
      return found('tower')
    })

    await expect(runPlatformQuery('X-1', controller.signal, { platform: 'tower', tag: 'queries.tower', run }))
      .rejects.toThrow('Aborted')
    expect(mockCacheQueryResult).not.toHaveBeenCalled()
  })

  it('forwards the batch signal to the run callback', async () => {
    const controller = new AbortController()
    const run = vi.fn(async (signal?: AbortSignal) => {
      expect(signal).toBe(controller.signal)
      return found('tower')
    })

    await runPlatformQuery('X-1', controller.signal, { platform: 'tower', tag: 'queries.tower', run })
    expect(run).toHaveBeenCalledTimes(1)
  })
})
