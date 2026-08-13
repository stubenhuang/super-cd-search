import type { QueryResult, Platform } from '../../shared/types'

/**
 * Shared in-memory caches for scraper resources.
 *
 * Two layers:
 * 1. Query-result cache – a finished platform lookup for a catalog number is
 *    reused for an hour, so re-running the same search never hits the network
 *    (or the browser pool) again.
 * 2. Product-detail cache – detail pages (Kojima/HMV/Yahoo) are keyed by their
 *    product URL so the same product referenced from different searches is
 *    scraped only once.
 */

interface CacheEntry<V> {
  value: V
  fetchedAt: number
}

export interface TtlCache<K, V> {
  get(key: K): V | undefined
  set(key: K, value: V): void
  clear(): void
  readonly size: number
}

/**
 * A small TTL cache with LRU-style eviction: `set` re-inserts the key so the
 * iteration order (insertion order) doubles as recency order, and the oldest
 * entry is dropped when the size cap is exceeded.
 */
export function createTtlCache<K, V>(ttlMs: number, maxSize = 500): TtlCache<K, V> {
  const store = new Map<K, CacheEntry<V>>()

  function pruneExpired(): void {
    const now = Date.now()
    for (const [key, entry] of store) {
      if (now - entry.fetchedAt > ttlMs) {
        store.delete(key)
      } else {
        // Entries are iterated oldest-first; everything after this is fresh.
        break
      }
    }
  }

  return {
    get(key) {
      const entry = store.get(key)
      if (!entry) return undefined
      if (Date.now() - entry.fetchedAt > ttlMs) {
        store.delete(key)
        return undefined
      }
      return entry.value
    },
    set(key, value) {
      pruneExpired()
      // Re-insert to mark this key as the most recent entry.
      store.delete(key)
      store.set(key, { value, fetchedAt: Date.now() })
      if (store.size > maxSize) {
        const oldest = store.keys().next().value
        if (oldest !== undefined) store.delete(oldest)
      }
    },
    clear() {
      store.clear()
    },
    get size() {
      return store.size
    }
  }
}

const CACHE_TTL = 60 * 60 * 1000 // 1 hour
const QUERY_CACHE_MAX = 1000
const DETAIL_CACHE_MAX = 1000

const queryResultCache = createTtlCache<string, QueryResult>(CACHE_TTL, QUERY_CACHE_MAX)
const productDetailCache = createTtlCache<string, unknown>(CACHE_TTL, DETAIL_CACHE_MAX)

function queryCacheKey(platform: Platform, catalogNumber: string): string {
  return `${platform}:${catalogNumber.toUpperCase()}`
}

/**
 * Return a cached query result for the platform/catalog pair, or null.
 * Errors are never cached, so a transient failure is retried on the next run.
 */
export function getCachedQueryResult(platform: Platform, catalogNumber: string): QueryResult | null {
  return queryResultCache.get(queryCacheKey(platform, catalogNumber)) ?? null
}

/** Store a successful query result (found / not_found) for later reuse. */
export function cacheQueryResult(catalogNumber: string, result: QueryResult): void {
  if (result.status === 'error') return
  queryResultCache.set(queryCacheKey(result.platform, catalogNumber), result)
}

/** Return cached product-page data keyed by product URL, or null. */
export function getCachedProductData<T>(platform: Platform, productUrl: string): T | null {
  return (productDetailCache.get(`${platform}:${productUrl}`) as T | undefined) ?? null
}

/** Store product-page data (details/price) keyed by product URL. */
export function cacheProductData(platform: Platform, productUrl: string, value: unknown): void {
  productDetailCache.set(`${platform}:${productUrl}`, value)
}

/** Clear every cache; mainly used by tests. */
export function clearAllCaches(): void {
  queryResultCache.clear()
  productDetailCache.clear()
}
