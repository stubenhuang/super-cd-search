import { getSetting } from '../settings'
import { throttledFetch } from '../throttle'
import { browserPool } from '../browser'
import { convertToUSDWithFallback, type Currency } from '../currency'
import type { QueryResult } from './types'
import type { CDDetails } from '../../shared/types'
import { notFound, queryError } from './types'
import { tryLLMParse } from '../llm/parser'

const DISCOGS_API_URL = 'https://api.discogs.com'
const DISCOGS_WEB_URL = 'https://www.discogs.com'

// Light throttle for token-authenticated API calls (the default 2-6s delay is
// meant for anonymous web traffic).
const API_THROTTLE = { minDelay: 300, maxDelay: 800 }

interface ReleaseCacheEntry {
  prices: { min: number | null; max: number | null }
  details: CDDetails
  fetchedAt: number
}

const releaseCache = new Map<number, ReleaseCacheEntry>()
const RELEASE_CACHE_TTL = 60 * 60 * 1000 // 1 hour

function getCachedRelease(releaseId: number): ReleaseCacheEntry | null {
  const entry = releaseCache.get(releaseId)
  if (!entry) return null
  if (Date.now() - entry.fetchedAt > RELEASE_CACHE_TTL) {
    releaseCache.delete(releaseId)
    return null
  }
  return entry
}

async function getDiscogsPriceRange(releaseId: number, token: string): Promise<{ min: number | null; max: number | null }> {
  const cached = getCachedRelease(releaseId)
  if (cached) return cached.prices

  try {
    const url = `${DISCOGS_API_URL}/marketplace/price_suggestions/${releaseId}?token=${token}`
    const response = await throttledFetch('api.discogs.com', url, undefined, API_THROTTLE)

    if (response.ok) {
      const data = await response.json()

      // Extract VG and NM prices for typical condition range
      const vgPrice = data['Very Good (VG)']?.value
      const nmPrice = data['Near Mint (NM or M-)']?.value

      if (vgPrice !== undefined && nmPrice !== undefined) {
        const vgCurrency = data['Very Good (VG)']?.currency || 'USD'
        const nmCurrency = data['Near Mint (NM or M-)']?.currency || 'USD'

        return {
          min: await convertToUSDWithFallback(vgPrice, vgCurrency as Currency),
          max: await convertToUSDWithFallback(nmPrice, nmCurrency as Currency)
        }
      }
    }
  } catch (err) {
    console.warn('Discogs price suggestions failed:', err)
  }

  return { min: null, max: null }
}

async function getReleaseDetails(releaseId: number, token: string): Promise<CDDetails> {
  const cached = getCachedRelease(releaseId)
  if (cached) return cached.details

  try {
    const url = `${DISCOGS_API_URL}/releases/${releaseId}?token=${token}`
    const response = await throttledFetch('api.discogs.com', url, undefined, API_THROTTLE)

    if (!response.ok) {
      return { label: null, format: null, country: null, released: null, genre: null }
    }

    const data = await response.json() as {
      labels?: Array<{ name?: string }>
      formats?: Array<{ name?: string; descriptions?: string[] }>
      country?: string
      year?: string
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

    return {
      label: data.labels?.[0]?.name || null,
      format: formatParts.length > 0 ? formatParts.join(', ') : null,
      country: data.country || null,
      released: data.year || null,
      genre: genreParts.length > 0 ? genreParts.join(', ') : null
    }
  } catch (err) {
    console.warn('Discogs release details failed:', err)
    return { label: null, format: null, country: null, released: null, genre: null }
  }
}

async function queryDiscogsApi(catalogNumber: string, token: string): Promise<QueryResult> {
  const url = `${DISCOGS_API_URL}/database/search?catno=${encodeURIComponent(catalogNumber)}&type=release&token=${token}`

  const response = await throttledFetch('api.discogs.com', url, undefined, API_THROTTLE)

  if (!response.ok) {
    throw new Error(`Discogs API returned ${response.status}`)
  }

  const data = await response.json()
  const results = data.results as Array<{
    id: number
    title: string
    catno?: string
    year?: string
    cover_image?: string
    uri?: string
    community?: { have: number; want: number }
  }>

  if (!results || results.length === 0) {
    return notFound('discogs')
  }

  // Prioritize exact catalog number match
  const exactMatch = results.find(r =>
    r.catno && r.catno.toUpperCase() === catalogNumber.toUpperCase()
  )
  const first = exactMatch || results[0]
  const titleParts = first.title.split(' - ')
  const artist = titleParts[0] || null
  const name = titleParts.slice(1).join(' - ') || first.title

  // Fetch price range and release details concurrently.
  const [prices, details] = await Promise.all([
    getDiscogsPriceRange(first.id, token),
    getReleaseDetails(first.id, token)
  ])

  const cacheKey = first.id
  if (!getCachedRelease(cacheKey)) {
    releaseCache.set(cacheKey, { prices, details, fetchedAt: Date.now() })
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
    coverUrl: first.cover_image || null,
    link: first.uri ? `${DISCOGS_WEB_URL}${first.uri}` : null,
    status: 'found',
    details
  }
}

async function queryDiscogsWeb(catalogNumber: string, cookies?: string): Promise<QueryResult> {
  const { browser, page } = await browserPool.acquire()

  try {
    if (cookies) {
      await page.setCookie({
        name: 'discogs_dot_com',
        value: cookies,
        domain: '.discogs.com',
        path: '/'
      })
    }

    const searchUrl = `${DISCOGS_WEB_URL}/search/?q=&type=release&catno=${encodeURIComponent(catalogNumber)}`
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })

    // Wait for results to load
    await page.waitForSelector('div[role="listitem"]', { timeout: 8000 }).catch(() => null)

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

    // DOM extraction first; only fall back to LLM when the key field is missing.
    if (!name) {
      const html = await page.content()
      const llmResult = await tryLLMParse('discogs', catalogNumber, html, searchUrl)
      if (llmResult) return llmResult
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

export async function queryDiscogs(catalogNumber: string): Promise<QueryResult> {
  const token = getSetting('discogsToken')
  const cookies = getSetting('cookies')?.discogs

  if (token) {
    try {
      return await queryDiscogsApi(catalogNumber, token)
    } catch (err) {
      console.warn('Discogs API failed, falling back to web scraping:', err)
    }
  }

  try {
    return await queryDiscogsWeb(catalogNumber, cookies)
  } catch (err) {
    return queryError('discogs', err instanceof Error ? err.message : 'Unknown error')
  }
}
