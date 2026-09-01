import { getSetting } from '../settings'
import { throttledFetch } from '../throttle'
import { browserPool } from '../browser'
import { gotoWithAbort, throwIfAborted } from '../browser/abort'
import { convertToUSDWithFallback, type Currency } from '../currency'
import type { QueryResult } from './types'
import type { CDDetails } from '../../shared/types'
import { notFound, queryError } from './types'
import { getCachedQueryResult, cacheQueryResult } from './cache'
import { waitForResultOrNoResult } from './wait'
import { normalizeCatalogNumber } from '../../shared/utils'
import { logger } from '../logger'

const DISCOGS_API_URL = 'https://api.discogs.com'
const DISCOGS_WEB_URL = 'https://www.discogs.com'
/** Discogs requires a descriptive User-Agent; requests without one may be rejected. */
const DISCOGS_USER_AGENT = 'SuperCDSearch/1.0 (+https://github.com/stubenhuang/super-cd-search)'

// Light throttle for token-authenticated API calls (the default 2-6s delay is
// meant for anonymous web traffic).
const API_THROTTLE = { minDelay: 300, maxDelay: 800 }

/**
 * Build the fetch init for an authenticated Discogs API call.
 *
 * The token travels in the `Authorization` header rather than the URL query
 * string: throttledFetch logs the full URL (including at `warn` level, which
 * reaches the log file under the production default level), so a query-string
 * token would only be protected by a single logger redaction rule. Keeping it
 * out of the URL removes the leak path entirely.
 */
function discogsRequestInit(token: string, signal?: AbortSignal): RequestInit {
  return {
    headers: {
      'Authorization': `Discogs token=${token}`,
      'User-Agent': DISCOGS_USER_AGENT,
      'Accept': 'application/json'
    },
    ...(signal ? { signal } : {})
  }
}

interface ReleaseCacheEntry {
  prices: { min: number | null; max: number | null }
  details: CDDetails
  fetchedAt: number
}

const releaseCache = new Map<number, ReleaseCacheEntry>()
const RELEASE_CACHE_TTL = 24 * 60 * 60 * 1000 // 1 day

interface DiscogsSearchHit {
  id: number
  title: string
  catno?: string
  year?: string
  cover_image?: string
  uri?: string
  community?: { have: number; want: number }
}

export type DiscogsBarcodeLookupStatus = 'found' | 'not_found' | 'no_token' | 'error'

export interface DiscogsBarcodeLookup {
  status: DiscogsBarcodeLookupStatus
  barcode: string
  catalogNumber?: string
  title?: string
  result?: QueryResult
  message?: string
}

interface BarcodeCacheEntry {
  lookup: DiscogsBarcodeLookup
  fetchedAt: number
}

const barcodeCache = new Map<string, BarcodeCacheEntry>()
const BARCODE_CACHE_TTL = RELEASE_CACHE_TTL
const BARCODE_CACHE_MAX = 500

/** Clear the in-memory release-detail cache (used by "clear search cache"). */
export function clearReleaseCache(): void {
  releaseCache.clear()
}

/** Clear the in-memory barcode -> catalog-number cache (used by "clear search cache"). */
export function clearDiscogsBarcodeCache(): void {
  barcodeCache.clear()
}

/** Normalize a phone-scanned barcode to 8-14 digits, or return null. */
export function normalizeDiscogsBarcode(barcode: string): string | null {
  const normalized = barcode.replace(/[\s-]+/g, '')
  if (!/^\d{8,14}$/.test(normalized)) return null
  return normalized
}

function getCachedBarcode(barcode: string): DiscogsBarcodeLookup | null {
  const entry = barcodeCache.get(barcode)
  if (!entry) return null
  if (Date.now() - entry.fetchedAt > BARCODE_CACHE_TTL) {
    barcodeCache.delete(barcode)
    return null
  }
  return entry.lookup
}

function cacheBarcodeLookup(lookup: DiscogsBarcodeLookup): void {
  barcodeCache.delete(lookup.barcode)
  barcodeCache.set(lookup.barcode, { lookup, fetchedAt: Date.now() })
  if (barcodeCache.size > BARCODE_CACHE_MAX) {
    const oldest = barcodeCache.keys().next().value
    if (oldest !== undefined) barcodeCache.delete(oldest)
  }
}

function getCachedRelease(releaseId: number): ReleaseCacheEntry | null {
  const entry = releaseCache.get(releaseId)
  if (!entry) return null
  if (Date.now() - entry.fetchedAt > RELEASE_CACHE_TTL) {
    releaseCache.delete(releaseId)
    return null
  }
  return entry
}

async function getDiscogsLowestPrice(releaseId: number, token: string, signal?: AbortSignal): Promise<{ min: number | null; max: number | null }> {
  const cached = getCachedRelease(releaseId)
  if (cached) return cached.prices

  try {
    const url = `${DISCOGS_API_URL}/marketplace/stats/${releaseId}`
    const response = await throttledFetch('api.discogs.com', url, discogsRequestInit(token, signal), API_THROTTLE)

    if (response.ok) {
      const data = await response.json() as {
        lowest_price?: { value?: number; currency?: string }
      }

      // The stats endpoint reports the current lowest marketplace listing,
      // matching the "From $X" figure shown on the Discogs release page.
      const lowest = data.lowest_price
      if (lowest && typeof lowest.value === 'number') {
        const usd = await convertToUSDWithFallback(lowest.value, (lowest.currency || 'USD') as Currency)
        return { min: usd, max: usd }
      }
    }
  } catch (err) {
    throwIfAborted(signal)
    logger.warn('queries.discogs', 'marketplace stats failed', { releaseId, error: err instanceof Error ? err.message : String(err) })
  }

  return { min: null, max: null }
}

async function getReleaseDetails(releaseId: number, token: string, signal?: AbortSignal): Promise<CDDetails> {
  const cached = getCachedRelease(releaseId)
  if (cached) {
    logger.debug('queries.discogs', 'release details cache hit', { releaseId })
    return cached.details
  }

  try {
    const url = `${DISCOGS_API_URL}/releases/${releaseId}`
    logger.debug('queries.discogs', 'fetch release details', { releaseId })
    const response = await throttledFetch('api.discogs.com', url, discogsRequestInit(token, signal), API_THROTTLE)

    if (!response.ok) {
      logger.debug('queries.discogs', 'release details request failed', { releaseId, status: response.status })
      return { label: null, format: null, country: null, released: null, genre: null }
    }

    const data = await response.json() as {
      labels?: Array<{ name?: string }>
      formats?: Array<{ name?: string; descriptions?: string[] }>
      country?: string
      /** Full release date, e.g. "2022-09-16". */
      released?: string
      /** Human-readable release date, e.g. "16 Sep 2022". */
      released_formatted?: string
      year?: string | number
      genres?: string[]
      styles?: string[]
    }

    const formatParts: string[] = []
    if (data.formats?.length) {
      for (const f of data.formats) {
        if (f.name) formatParts.push(f.name)
        if (f.descriptions?.length) formatParts.push(...f.descriptions)
      }
    }

    const genreParts = [...(data.genres || []), ...(data.styles || [])]

    const details: CDDetails = {
      label: data.labels?.[0]?.name || null,
      format: formatParts.length > 0 ? formatParts.join(', ') : null,
      country: data.country || null,
      released: data.released || data.released_formatted || (data.year != null ? String(data.year) : null),
      genre: genreParts.length > 0 ? genreParts.join(', ') : null
    }
    logger.debug('queries.discogs', 'release details parsed', { releaseId, details })
    return details
  } catch (err) {
    throwIfAborted(signal)
    logger.warn('queries.discogs', 'release details failed', { releaseId, error: err instanceof Error ? err.message : String(err) })
    return { label: null, format: null, country: null, released: null, genre: null }
  }
}

function compactCatalog(value: string): string {
  return value.replace(/[\s-]+/g, '').toUpperCase()
}

/**
 * Build the complete Discogs QueryResult for a database-search hit: fetch
 * marketplace price and release details concurrently, then cache the release
 * data in memory for other searches.
 */
async function buildDiscogsResultFromHit(hit: DiscogsSearchHit, catalogNumber: string, token: string, signal?: AbortSignal): Promise<QueryResult> {
  const titleParts = hit.title.split(' - ')
  const artist = titleParts[0] || null
  const name = titleParts.slice(1).join(' - ') || hit.title

  // Fetch lowest marketplace price and release details concurrently.
  const [prices, details] = await Promise.all([
    getDiscogsLowestPrice(hit.id, token, signal),
    getReleaseDetails(hit.id, token, signal)
  ])

  if (!getCachedRelease(hit.id)) {
    releaseCache.set(hit.id, { prices, details, fetchedAt: Date.now() })
    if (releaseCache.size > 500) {
      const oldest = releaseCache.keys().next().value
      if (oldest !== undefined) releaseCache.delete(oldest)
    }
  }

  return {
    platform: 'discogs',
    name,
    artist,
    priceMin: prices.min,
    priceMax: prices.max,
    coverUrl: hit.cover_image || null,
    link: hit.uri ? `${DISCOGS_WEB_URL}${hit.uri}` : null,
    status: 'found',
    details
  }
}

async function queryDiscogsApi(catalogNumber: string, token: string, signal?: AbortSignal): Promise<QueryResult> {
  const url = `${DISCOGS_API_URL}/database/search?catno=${encodeURIComponent(catalogNumber)}&type=release`
  logger.debug('queries.discogs', 'search API request', { catalogNumber })

  const response = await throttledFetch('api.discogs.com', url, discogsRequestInit(token, signal), API_THROTTLE)

  if (!response.ok) {
    throw new Error(`Discogs API returned ${response.status}`)
  }

  const data = await response.json()
  const results = data.results as DiscogsSearchHit[] | undefined

  logger.debug('queries.discogs', 'search API results', {
    catalogNumber,
    resultCount: results?.length ?? 0,
    candidates: results?.slice(0, 5).map(r => ({ id: r.id, catno: r.catno, title: r.title }))
  })

  if (!results || results.length === 0) {
    return notFound('discogs')
  }

  // Prioritize exact catalog number match. Discogs writes "SICP 6480" while the
  // app normalizes input to "SICP-6480", so compare ignoring spaces and dashes.
  const normalizedCatalog = compactCatalog(catalogNumber)
  const exactMatch = results.find(r =>
    r.catno && compactCatalog(r.catno) === normalizedCatalog
  )
  const first = exactMatch || results[0]!
  logger.debug('queries.discogs', 'release selected', {
    catalogNumber,
    releaseId: first.id,
    title: first.title,
    exactCatalogMatch: !!exactMatch
  })
  return buildDiscogsResultFromHit(first, catalogNumber, token, signal)
}

/**
 * Resolve a CD barcode to a catalog number via Discogs' database search API.
 * On success the complete QueryResult is stored in the shared query cache so a
 * later desktop search for that catalog number needs no further Discogs call.
 */
export async function queryDiscogsByBarcode(barcode: string): Promise<DiscogsBarcodeLookup> {
  const normalized = normalizeDiscogsBarcode(barcode)
  if (!normalized) {
    return {
      status: 'error',
      barcode: barcode.slice(0, 32),
      message: '条码必须是 8-14 位数字'
    }
  }

  const token = getSetting('discogsToken')
  if (!token) {
    logger.debug('queries.discogs', 'barcode lookup rejected: no Discogs token', { barcode: normalized })
    return { status: 'no_token', barcode: normalized }
  }

  const cached = getCachedBarcode(normalized)
  if (cached) {
    logger.debug('queries.discogs', 'barcode lookup cache hit', { barcode: normalized, status: cached.status })
    return cached
  }

  logger.debug('queries.discogs', 'barcode lookup request', { barcode: normalized })
  try {
    const url = `${DISCOGS_API_URL}/database/search?barcode=${encodeURIComponent(normalized)}&type=release`
    const response = await throttledFetch('api.discogs.com', url, discogsRequestInit(token), API_THROTTLE)

    if (!response.ok) {
      throw new Error(`Discogs API returned ${response.status}`)
    }

    const data = await response.json()
    const results = data.results as DiscogsSearchHit[] | undefined
    logger.debug('queries.discogs', 'barcode lookup results', {
      barcode: normalized,
      resultCount: results?.length ?? 0,
      candidates: results?.slice(0, 3).map(r => ({ id: r.id, catno: r.catno, title: r.title }))
    })

    if (!results || results.length === 0) {
      const lookup: DiscogsBarcodeLookup = { status: 'not_found', barcode: normalized }
      cacheBarcodeLookup(lookup)
      return lookup
    }

    const hit = results[0]!
    const catalogNumber = hit.catno ? normalizeCatalogNumber(hit.catno.trim().replace(/\s+/g, '-')) : ''
    if (!catalogNumber) {
      return {
        status: 'error',
        barcode: normalized,
        message: 'Discogs 结果中缺少目录号'
      }
    }

    const result = await buildDiscogsResultFromHit(hit, catalogNumber, token)
    cacheQueryResult(catalogNumber, result, 'api')

    const lookup: DiscogsBarcodeLookup = {
      status: 'found',
      barcode: normalized,
      catalogNumber,
      title: hit.title,
      result
    }
    cacheBarcodeLookup(lookup)
    return lookup
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    logger.warn('queries.discogs', 'barcode lookup failed', { barcode: normalized, error: message })
    return { status: 'error', barcode: normalized, message }
  }
}

async function queryDiscogsWeb(catalogNumber: string, signal?: AbortSignal): Promise<QueryResult> {
  const { browser, page } = await browserPool.acquire(signal)

  try {
    const searchUrl = `${DISCOGS_WEB_URL}/search/?q=&type=release&catno=${encodeURIComponent(catalogNumber)}`
    await gotoWithAbort(page, searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }, signal)

    // Wait for results to load (fails fast when the empty state appears).
    await waitForResultOrNoResult(page, { resultSelector: 'div[role="listitem"]', timeoutMs: 4000 })

    // Find first result item
    const firstResult = await page.$('div[role="listitem"]')
    if (!firstResult) {
      return notFound('discogs')
    }

    // Extract data using updated selectors for new Discogs layout
    const name = await firstResult.$eval('a[aria-label^="Release:"]', el => el.textContent?.trim() || null).catch(() => null)
    const artist = await firstResult.$eval('a[aria-label^="Artist:"]', el => el.textContent?.trim() || null).catch(() => null)
    const coverUrl = await firstResult.$eval('img', el => el.getAttribute('src')).catch(() => null)
    let link = await firstResult.$eval('a[href*="/release/"]', el => el.getAttribute('href')).catch(() => null)

    if (!name) {
      return notFound('discogs')
    }

    return {
      platform: 'discogs',
      name,
      artist,
      priceMin: null,  // Price only available via API
      priceMax: null,
      coverUrl,
      link: link ? `${DISCOGS_WEB_URL}${link}` : null,
      status: 'found'
    }
  } finally {
    await browserPool.release(browser, page)
  }
}

export async function queryDiscogs(catalogNumber: string, signal?: AbortSignal): Promise<QueryResult> {
  throwIfAborted(signal)
  logger.debug('queries.discogs', 'query start', { catalogNumber })
  const token = getSetting('discogsToken')
  const cacheContext = token ? 'api' : 'web'
  const cached = getCachedQueryResult('discogs', catalogNumber, cacheContext)
  if (cached) return cached

  logger.debug('queries.discogs', 'query mode', { catalogNumber, hasApiToken: !!token })

  let result: QueryResult

  if (token) {
    try {
      result = await queryDiscogsApi(catalogNumber, token, signal)
    } catch (err) {
      throwIfAborted(signal)
      logger.warn('queries.discogs', 'API failed, falling back to web scraping', { catalogNumber, error: err instanceof Error ? err.message : String(err) })
      try {
        result = await queryDiscogsWeb(catalogNumber, signal)
      } catch (webErr) {
        throwIfAborted(signal)
        result = queryError('discogs', webErr instanceof Error ? webErr.message : 'Unknown error')
      }
    }
  } else {
    try {
      result = await queryDiscogsWeb(catalogNumber, signal)
    } catch (err) {
      throwIfAborted(signal)
      result = queryError('discogs', err instanceof Error ? err.message : 'Unknown error')
    }
  }

  throwIfAborted(signal)
  cacheQueryResult(catalogNumber, result, cacheContext)
  return result
}
