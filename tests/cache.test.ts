import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  createTtlCache,
  getCachedQueryResult,
  cacheQueryResult,
  getCachedProductData,
  cacheProductData,
  clearAllCaches,
  initCachePersistence,
  flushCacheToDisk
} from '../src/main/queries/cache'
import type { QueryResult } from '../src/shared/types'

afterEach(() => {
  vi.useRealTimers()
})

function found(platform: QueryResult['platform'], name = 'Album'): QueryResult {
  return {
    platform,
    name,
    artist: 'Artist',
    priceMin: 10,
    priceMax: 20,
    coverUrl: null,
    link: null,
    status: 'found'
  }
}

describe('createTtlCache', () => {
  it('stores and returns values', () => {
    const cache = createTtlCache<string, number>(1000)
    cache.set('a', 1)
    expect(cache.get('a')).toBe(1)
    expect(cache.get('missing')).toBeUndefined()
  })

  it('expires entries after the TTL', () => {
    vi.useFakeTimers()
    const cache = createTtlCache<string, number>(1000)
    cache.set('a', 1)
    expect(cache.get('a')).toBe(1)

    vi.advanceTimersByTime(1001)
    expect(cache.get('a')).toBeUndefined()
  })

  it('evicts the oldest entry when over capacity', () => {
    const cache = createTtlCache<string, number>(10000, 3)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    cache.set('d', 4)

    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe(2)
    expect(cache.get('c')).toBe(3)
    expect(cache.get('d')).toBe(4)
  })

  it('treats re-insertion as the most recent entry', () => {
    const cache = createTtlCache<string, number>(10000, 3)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('a', 3) // refresh a -> b becomes the oldest
    cache.set('c', 4)
    cache.set('d', 5) // evicts b

    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBe(3)
  })

  it('clears all entries', () => {
    const cache = createTtlCache<string, number>(1000)
    cache.set('a', 1)
    cache.clear()
    expect(cache.get('a')).toBeUndefined()
  })

  it('tracks its size', () => {
    const cache = createTtlCache<string, number>(1000)
    expect(cache.size).toBe(0)
    cache.set('a', 1)
    cache.set('b', 2)
    expect(cache.size).toBe(2)
  })
})

describe('query result cache', () => {
  afterEach(() => clearAllCaches())

  it('round-trips results and ignores catalog number case', () => {
    cacheQueryResult('UCCG-90530', found('discogs'))
    expect(getCachedQueryResult('discogs', 'UCCG-90530')?.name).toBe('Album')
    expect(getCachedQueryResult('discogs', 'uccg-90530')?.name).toBe('Album')
  })

  it('isolates entries per platform', () => {
    cacheQueryResult('UCCG-90530', found('discogs'))
    expect(getCachedQueryResult('ebay', 'UCCG-90530')).toBeNull()
  })

  it('never caches error results', () => {
    const errorResult: QueryResult = {
      platform: 'ebay',
      name: null,
      artist: null,
      priceMin: null,
      priceMax: null,
      coverUrl: null,
      link: null,
      status: 'error',
      error: 'boom'
    }
    cacheQueryResult('X-1', errorResult)
    expect(getCachedQueryResult('ebay', 'X-1')).toBeNull()
  })
})

describe('product detail cache', () => {
  afterEach(() => clearAllCaches())

  it('round-trips details keyed by product URL', () => {
    cacheProductData('kojima', 'https://kojimarokuon.com/products/1', { price: 100, details: { format: 'CD' } })
    expect(getCachedProductData<{ price: number; details: { format: string } }>('kojima', 'https://kojimarokuon.com/products/1')).toEqual({
      price: 100,
      details: { format: 'CD' }
    })
  })

  it('isolates entries per platform', () => {
    cacheProductData('hmv', 'https://www.hmv.co.jp/product/1', { price: 1 })
    expect(getCachedProductData('yahoo', 'https://www.hmv.co.jp/product/1')).toBeNull()
  })

  it('clearAllCaches clears every cache', () => {
    cacheProductData('yahoo', 'https://shopping.yahoo.co.jp/p/1', { format: 'CD' })
    cacheQueryResult('X-1', found('yahoo', 'Album X'))
    clearAllCaches()

    expect(getCachedProductData('yahoo', 'https://shopping.yahoo.co.jp/p/1')).toBeNull()
    expect(getCachedQueryResult('yahoo', 'X-1')).toBeNull()
  })
})

describe('disk persistence', () => {
  let dir: string

  beforeEach(() => {
    clearAllCaches()
    dir = mkdtempSync(join(tmpdir(), 'scd-cache-'))
  })

  afterEach(() => {
    clearAllCaches()
    flushCacheToDisk()
    initCachePersistence(null)
    rmSync(dir, { recursive: true, force: true })
  })

  it('persists query results and restores them on the next init', () => {
    initCachePersistence(dir)
    cacheQueryResult('X-1', found('discogs', 'Persisted Album'))
    flushCacheToDisk()

    clearAllCaches()
    expect(getCachedQueryResult('discogs', 'X-1')).toBeNull()

    initCachePersistence(dir)
    expect(getCachedQueryResult('discogs', 'X-1')?.name).toBe('Persisted Album')
  })

  it('persists product details and restores them', () => {
    initCachePersistence(dir)
    cacheProductData('hmv', 'https://www.hmv.co.jp/product/9', { format: 'CD' })
    flushCacheToDisk()

    clearAllCaches()
    initCachePersistence(dir)
    expect(getCachedProductData<{ format: string }>('hmv', 'https://www.hmv.co.jp/product/9')).toEqual({ format: 'CD' })
  })

  it('skips expired entries when loading from disk', () => {
    const file = join(dir, 'search-cache.json')
    writeFileSync(file, JSON.stringify({
      queryResults: {
        'discogs:X-1': { value: found('discogs', 'Stale'), fetchedAt: Date.now() - 2 * 60 * 60 * 1000 }
      },
      productDetails: {}
    }))

    initCachePersistence(dir)
    expect(getCachedQueryResult('discogs', 'X-1')).toBeNull()
  })

  it('tolerates a corrupt cache file', () => {
    writeFileSync(join(dir, 'search-cache.json'), '{not json')
    expect(() => initCachePersistence(dir)).not.toThrow()
    expect(getCachedQueryResult('discogs', 'X-1')).toBeNull()
  })
})
