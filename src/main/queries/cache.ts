import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import type { QueryResult, Platform, CDDetails } from '../../shared/types'
import { logger } from '../logger'

/**
 * Shared in-memory caches for scraper resources.
 *
 * Three layers:
 * 1. Query-result cache – a finished platform lookup for a catalog number is
 *    reused for a day, so re-running the same search never hits the network
 *    (or the browser pool) again.
 * 2. Product-detail cache – detail pages (Kojima/HMV/Yahoo) are keyed by their
 *    product URL so the same product referenced from different searches is
 *    scraped only once.
 * 3. LLM enrichment cache – smart-generated detail fields are keyed by catalog
 *    number so repeated enrichment never re-invokes the LLM.
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

const CACHE_TTL = 24 * 60 * 60 * 1000 // 1 day
const QUERY_CACHE_MAX = 1000
const DETAIL_CACHE_MAX = 1000
const ENRICHMENT_CACHE_MAX = 500

/**
 * Bump this whenever a query's extracted shape changes in a way that makes
 * previously cached results incomplete. Old entries are ignored and get
 * dropped on the next disk write.
 */
export const QUERY_CACHE_VERSION = 4
const QUERY_CACHE_KEY_PREFIX = `v${QUERY_CACHE_VERSION}:`

const queryResultCache = createTtlCache<string, QueryResult>(CACHE_TTL, QUERY_CACHE_MAX)
const productDetailCache = createTtlCache<string, unknown>(CACHE_TTL, DETAIL_CACHE_MAX)
const enrichmentCache = createTtlCache<string, CDDetails>(CACHE_TTL, ENRICHMENT_CACHE_MAX)

function queryCacheKey(platform: Platform, catalogNumber: string, context = 'default'): string {
  return `${QUERY_CACHE_KEY_PREFIX}${platform}:${context}:${catalogNumber.toUpperCase()}`
}

function enrichmentCacheKey(catalogNumber: string): string {
  return `enrichment:${catalogNumber.toUpperCase()}`
}

/**
 * Return a cached query result for the platform/catalog pair, or null.
 * Errors are never cached, so a transient failure is retried on the next run.
 */
export function getCachedQueryResult(platform: Platform, catalogNumber: string, context = 'default'): QueryResult | null {
  const key = queryCacheKey(platform, catalogNumber, context)
  const cached = queryResultCache.get(key) ?? null
  logger.debug('cache', cached ? 'query cache hit' : 'query cache miss', { platform, catalogNumber: catalogNumber.toUpperCase(), key })
  return cached
}

/** Store a successful query result (found / not_found) for later reuse. */
export function cacheQueryResult(catalogNumber: string, result: QueryResult, context = 'default'): void {
  // Errors and challenge results are never cached, so a transient failure or an
  // expired Cloudflare session is retried on the next run.
  if (result.status === 'error' || result.status === 'challenge') {
    logger.debug('cache', 'not caching transient result', { platform: result.platform, catalogNumber: catalogNumber.toUpperCase(), status: result.status })
    return
  }
  queryResultCache.set(queryCacheKey(result.platform, catalogNumber, context), result)
  logger.debug('cache', 'query result cached', { platform: result.platform, catalogNumber: catalogNumber.toUpperCase() })
  schedulePersist()
}

/** Return cached product-page data keyed by product URL, or null. */
export function getCachedProductData<T>(platform: Platform, productUrl: string): T | null {
  const cached = (productDetailCache.get(`${platform}:${productUrl}`) as T | undefined) ?? null
  logger.debug('cache', cached ? 'product data cache hit' : 'product data cache miss', { platform, productUrl })
  return cached
}

/** Store product-page data (details/price) keyed by product URL. */
export function cacheProductData(platform: Platform, productUrl: string, value: unknown): void {
  productDetailCache.set(`${platform}:${productUrl}`, value)
  logger.debug('cache', 'product data cached', { platform, productUrl })
  schedulePersist()
}

/** Return cached LLM smart-generation details for a catalog number, or null. */
export function getCachedEnrichment(catalogNumber: string): CDDetails | null {
  const key = enrichmentCacheKey(catalogNumber)
  const cached = enrichmentCache.get(key) ?? null
  logger.debug('cache', cached ? 'LLM enrichment cache hit' : 'LLM enrichment cache miss', { catalogNumber: catalogNumber.toUpperCase(), key })
  return cached
}

/** Store LLM smart-generation details keyed by catalog number. */
export function cacheEnrichment(catalogNumber: string, details: CDDetails): void {
  enrichmentCache.set(enrichmentCacheKey(catalogNumber), { ...details })
  logger.debug('cache', 'LLM enrichment cached', { catalogNumber: catalogNumber.toUpperCase() })
  schedulePersist()
}

/** Clear every cache; mainly used by tests. */
export function clearAllCaches(): void {
  queryResultCache.clear()
  productDetailCache.clear()
  enrichmentCache.clear()
}

/**
 * Clear the query-result and product-detail caches and delete the on-disk
 * cache file. Used by the "clear search cache" action in settings.
 */
export function clearSearchCache(): void {
  queryResultCache.clear()
  productDetailCache.clear()
  enrichmentCache.clear()

  // Drop any pending debounced write so it can't resurrect stale entries.
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }

  const file = cacheFilePath()
  if (file) {
    try {
      unlinkSync(file)
    } catch {
      // Missing file is fine.
    }
  }
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
  enrichments: Record<string, { value: CDDetails; fetchedAt: number }>
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
  logger.debug('cache', 'cache persistence init', { enabled: !!persistenceDir, dir: persistenceDir ?? undefined })
  if (!persistenceDir) return
  loadCacheFromDisk()
}

function loadCacheFromDisk(): void {
  const file = cacheFilePath()
  if (!file) return
  try {
    const data = JSON.parse(readFileSync(file, 'utf-8')) as PersistedCacheEntry
    let queryResultsLoaded = 0
    let productDetailsLoaded = 0
    let enrichmentsLoaded = 0
    let staleSkipped = 0
    let legacySkipped = 0

    for (const [key, entry] of Object.entries(data.queryResults ?? {})) {
      if (!key.startsWith(QUERY_CACHE_KEY_PREFIX)) {
        legacySkipped++
        continue
      }
      if (Date.now() - entry.fetchedAt <= CACHE_TTL) {
        queryResultCache.seed(key, entry.value, entry.fetchedAt)
        queryResultsLoaded++
      } else {
        staleSkipped++
      }
    }
    for (const [key, entry] of Object.entries(data.productDetails ?? {})) {
      if (Date.now() - entry.fetchedAt <= CACHE_TTL) {
        productDetailCache.seed(key, entry.value, entry.fetchedAt)
        productDetailsLoaded++
      }
    }
    for (const [key, entry] of Object.entries(data.enrichments ?? {})) {
      if (Date.now() - entry.fetchedAt <= CACHE_TTL) {
        enrichmentCache.seed(key, entry.value, entry.fetchedAt)
        enrichmentsLoaded++
      }
    }
    logger.debug('cache', 'loaded cache from disk', { file, queryResultsLoaded, productDetailsLoaded, enrichmentsLoaded, staleSkipped, legacySkipped })
  } catch {
    logger.debug('cache', 'missing or corrupt cache file, starting empty', { file })
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
  const startedAt = Date.now()
  try {
    mkdirSync(dir, { recursive: true })
    const data: PersistedCacheEntry = {
      queryResults: Object.fromEntries(queryResultCache.entries()),
      productDetails: Object.fromEntries(productDetailCache.entries()),
      enrichments: Object.fromEntries(enrichmentCache.entries())
    }
    writeFileSync(join(dir, CACHE_FILE_NAME), JSON.stringify(data))
    logger.debug('cache', 'cache persisted to disk', {
      file: join(dir, CACHE_FILE_NAME),
      queryResultCount: Object.keys(data.queryResults).length,
      productDetailCount: Object.keys(data.productDetails).length,
      enrichmentCount: Object.keys(data.enrichments).length,
      durationMs: Date.now() - startedAt
    })
  } catch (err) {
    logger.warn('cache', 'failed to persist search cache', { error: err instanceof Error ? err.message : String(err) })
  }
}
