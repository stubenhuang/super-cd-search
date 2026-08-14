import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
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
  /** Insert preserving the original fetch time; used when restoring from disk. */
  seed(key: K, value: V, fetchedAt: number): void
  /** Return all live entries in insertion (recency) order, for serialization. */
  entries(): Array<[K, { value: V; fetchedAt: number }]>
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
    seed(key, value, fetchedAt) {
      store.delete(key)
      store.set(key, { value, fetchedAt })
      if (store.size > maxSize) {
        const oldest = store.keys().next().value
        if (oldest !== undefined) store.delete(oldest)
      }
    },
    entries() {
      return [...store.entries()]
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
  schedulePersist()
}

/** Return cached product-page data keyed by product URL, or null. */
export function getCachedProductData<T>(platform: Platform, productUrl: string): T | null {
  return (productDetailCache.get(`${platform}:${productUrl}`) as T | undefined) ?? null
}

/** Store product-page data (details/price) keyed by product URL. */
export function cacheProductData(platform: Platform, productUrl: string, value: unknown): void {
  productDetailCache.set(`${platform}:${productUrl}`, value)
  schedulePersist()
}

/** Clear every cache; mainly used by tests. */
export function clearAllCaches(): void {
  queryResultCache.clear()
  productDetailCache.clear()
}

// ---------------------------------------------------------------------------
// Optional disk persistence. Enabled only when `initCachePersistence` is given
// a directory (the Electron main process passes `app.getPath('userData')`);
// without it the caches stay in-memory so unit tests run without a real app.
// ---------------------------------------------------------------------------

const CACHE_FILE_NAME = 'search-cache.json'
const PERSIST_DEBOUNCE_MS = 30_000

let persistenceDir: string | null = null
let persistTimer: ReturnType<typeof setTimeout> | null = null

interface PersistedCacheEntry {
  queryResults: Record<string, { value: QueryResult; fetchedAt: number }>
  productDetails: Record<string, { value: unknown; fetchedAt: number }>
}

function cacheFilePath(): string | null {
  return persistenceDir ? join(persistenceDir, CACHE_FILE_NAME) : null
}

/**
 * Enable and load disk-backed caching. Call once at startup with the app's
 * userData directory. Expired entries are skipped; a missing or corrupt file
 * starts from an empty cache.
 */
export function initCachePersistence(dir?: string | null): void {
  persistenceDir = dir ?? null
  if (!persistenceDir) return
  loadCacheFromDisk()
}

function loadCacheFromDisk(): void {
  const file = cacheFilePath()
  if (!file) return
  try {
    const data = JSON.parse(readFileSync(file, 'utf-8')) as PersistedCacheEntry
    for (const [key, entry] of Object.entries(data.queryResults ?? {})) {
      if (Date.now() - entry.fetchedAt <= CACHE_TTL) {
        queryResultCache.seed(key, entry.value, entry.fetchedAt)
      }
    }
    for (const [key, entry] of Object.entries(data.productDetails ?? {})) {
      if (Date.now() - entry.fetchedAt <= CACHE_TTL) {
        productDetailCache.seed(key, entry.value, entry.fetchedAt)
      }
    }
  } catch {
    // Missing or corrupt file: start empty.
  }
}

/** Write the caches to disk immediately; call on app shutdown. */
export function flushCacheToDisk(): void {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  writeCacheToDisk()
}

function schedulePersist(): void {
  if (!persistenceDir) return
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    writeCacheToDisk()
  }, PERSIST_DEBOUNCE_MS)
}

function writeCacheToDisk(): void {
  const dir = persistenceDir
  if (!dir) return
  try {
    mkdirSync(dir, { recursive: true })
    const data: PersistedCacheEntry = {
      queryResults: Object.fromEntries(queryResultCache.entries()),
      productDetails: Object.fromEntries(productDetailCache.entries())
    }
    writeFileSync(join(dir, CACHE_FILE_NAME), JSON.stringify(data))
  } catch (err) {
    console.warn('Failed to persist search cache:', err)
  }
}
