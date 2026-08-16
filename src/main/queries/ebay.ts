import { getSetting } from '../settings'
import { throttledFetch } from '../throttle'
import { browserPool } from '../browser'
import { abortableDelay, gotoWithAbort, throwIfAborted } from '../browser/abort'
import { convertToUSDWithFallback, type Currency } from '../currency'
import type { QueryResult, CDDetails } from './types'
import { notFound, queryError } from './types'
import { type Page, type ElementHandle } from 'puppeteer'
import { getCachedQueryResult, cacheQueryResult } from './cache'
import { logger } from '../logger'

const EBAY_API_URL = 'https://api.ebay.com'
const EBAY_WEB_URL = 'https://www.ebay.com'

// Light throttle for token-authenticated API calls.
const API_THROTTLE = { minDelay: 300, maxDelay: 800 }

// Alternative eBay domains to try if main domain blocks
const EBAY_ALT_DOMAINS = [
  'https://www.ebay.co.uk',
  'https://www.ebay.de',
  'https://www.ebay.ca'
]

let accessToken: string | null = null
let tokenExpiry: number = 0

const itemDetailsCache = new Map<string, { details: CDDetails; fetchedAt: number }>()
const ITEM_CACHE_TTL = 24 * 60 * 60 * 1000 // 1 day

/** Clear the in-memory item-detail cache (used by "clear search cache"). */
export function clearItemDetailsCache(): void {
  itemDetailsCache.clear()
}

async function getEbayAccessToken(signal?: AbortSignal): Promise<string | null> {
  if (accessToken && Date.now() < tokenExpiry) {
    return accessToken
  }

  const clientId = getSetting('ebayClientId')
  const clientSecret = getSetting('ebayClientSecret')

  if (!clientId || !clientSecret) {
    return null
  }

  try {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    const response = await throttledFetch(
      'api.ebay.com',
      `${EBAY_API_URL}/identity/v1/oauth2/token`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
        ...(signal ? { signal } : {})
      },
      API_THROTTLE
    )

    if (!response.ok) {
      return null
    }

    const data = await response.json()
    accessToken = data.access_token
    tokenExpiry = Date.now() + (data.expires_in - 60) * 1000
    return accessToken
  } catch {
    throwIfAborted(signal)
    return null
  }
}

async function queryEbayApi(catalogNumber: string, signal?: AbortSignal): Promise<QueryResult> {
  const token = await getEbayAccessToken(signal)
  if (!token) {
    throw new Error('No eBay API credentials')
  }

  const url = `${EBAY_API_URL}/buy/browse/v1/item_summary/search?q=${encodeURIComponent(catalogNumber)}&limit=5`

  const response = await throttledFetch('api.ebay.com', url, {
    headers: {
      'Authorization': `Bearer ${token}`
    },
    ...(signal ? { signal } : {})
  }, API_THROTTLE)

  if (!response.ok) {
    throw new Error(`eBay API returned ${response.status}`)
  }

  const data = await response.json()
  const items = data.itemSummaries as Array<{
    title: string
    price?: { value: string; currency: string }
    image?: { imageUrl: string }
    itemWebUrl?: string
  }> | undefined

  if (!items || items.length === 0) {
    return notFound('ebay')
  }

  const first = items[0]

  // Convert prices and fetch item details concurrently.
  const [prices, details] = await Promise.all([
    Promise.all(
      items
        .filter(i => i.price && parseFloat(i.price.value) > 0)
        .map(async i => {
          const amount = parseFloat(i.price!.value)
          const currency = i.price!.currency as Currency
          return await convertToUSDWithFallback(amount, currency)
        })
    ),
    first.itemWebUrl ? getEbayItemDetails(first.itemWebUrl, token, signal) : Promise.resolve(undefined)
  ])

  return {
    platform: 'ebay',
    name: first.title,
    artist: null,
    priceMin: prices.length > 0 ? Math.min(...prices) : null,
    priceMax: prices.length > 0 ? Math.max(...prices) : null,
    coverUrl: first.image?.imageUrl || null,
    link: first.itemWebUrl || null,
    status: 'found',
    details
  }
}

async function getEbayItemDetails(itemWebUrl: string, token: string, signal?: AbortSignal): Promise<CDDetails> {
  const details: CDDetails = { label: null, format: null, country: null, released: null, genre: null }

  try {
    // Extract item ID from URL (e.g., /itm/123456789 or /itm/123456789?...)
    const itemIdMatch = itemWebUrl.match(/\/itm\/(\d+)/)
    if (!itemIdMatch) return details

    const itemId = itemIdMatch[1]
    const cached = itemDetailsCache.get(itemId)
    if (cached && Date.now() - cached.fetchedAt < ITEM_CACHE_TTL) {
      return cached.details
    }

    const url = `${EBAY_API_URL}/buy/browse/v1/item/${itemId}`

    const response = await throttledFetch('api.ebay.com', url, {
      headers: {
        'Authorization': `Bearer ${token}`
      },
      ...(signal ? { signal } : {})
    }, API_THROTTLE)

    if (!response.ok) return details

    const data = await response.json()
    const localizedAspects = data.localizedAspects as Array<{
      name: string
      value: string
    }> | undefined

    if (localizedAspects) {
      for (const aspect of localizedAspects) {
        const nameLower = aspect.name.toLowerCase()
        if (nameLower.includes('format') || nameLower.includes('type')) {
          details.format = aspect.value
        } else if (nameLower.includes('label') || nameLower.includes('record label')) {
          details.label = aspect.value
        } else if (nameLower.includes('release') || nameLower.includes('year')) {
          details.released = aspect.value
        } else if (nameLower.includes('genre') || nameLower.includes('style')) {
          details.genre = aspect.value
        } else if (nameLower.includes('country') || nameLower.includes('region')) {
          details.country = aspect.value
        } else if (nameLower.includes('artist')) {
          // Could extract artist from aspects but we already have it from title
        }
      }
    }

    itemDetailsCache.set(itemId, { details: { ...details }, fetchedAt: Date.now() })
    if (itemDetailsCache.size > 500) {
      const oldest = itemDetailsCache.keys().next().value
      if (oldest !== undefined) itemDetailsCache.delete(oldest)
    }
  } catch (err) {
    throwIfAborted(signal)
    logger.warn('queries.ebay', 'failed to get item details', { itemWebUrl, error: err instanceof Error ? err.message : String(err) })
  }

  return details
}

// Check if page is blocked
async function isPageBlocked(page: Page): Promise<boolean> {
  // Lightweight probe: title plus a bounded slice of body text avoids reading
  // the full page layout (innerText) just to detect a challenge page.
  const probe = await page.evaluate(() => {
    const bodyText = (document.body?.textContent || '').slice(0, 1000)
    return `${document.title}\n${bodyText}`
  })
  return probe.includes('Access Denied') ||
         probe.includes('Checking your browser') ||
         probe.includes('Just a moment') ||
         probe.includes('blocked') ||
         probe.includes('captcha')
}

async function queryEbayDomain(page: Page, domain: string, catalogNumber: string, signal?: AbortSignal): Promise<{ success: boolean; result?: QueryResult }> {
  try {
    logger.debug('queries.ebay', 'trying domain', { catalogNumber, domain })

    // Use direct URL navigation (more reliable than search box interaction)
    const searchUrl = `${domain}/sch/i.html?_nkw=${encodeURIComponent(catalogNumber)}`
    await gotoWithAbort(page, searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }, signal)

    // Short one-time settle delay (balanced anti-detection pacing).
    await abortableDelay(500 + Math.random() * 500, signal)

    // Check if blocked
    if (await isPageBlocked(page)) {
      logger.warn('queries.ebay', 'domain blocked', { catalogNumber, domain })
      return { success: false }
    }

    // Wait for either result items or the no-results banner.
    await page.waitForSelector(
      '.srp-results, .srp-results .s-item, li.s-item, .brw-river-item, [data-listing-id], .srp-rail__no-results, .srp-no-results',
      { timeout: 4000 }
    ).catch(() => null)

    const noResults = await page.$('.srp-rail__no-results, .srp-no-results')
    if (noResults) {
      return { success: true, result: notFound('ebay') }
    }

    // Try to find items
    const itemSelectors = [
      '.srp-results .s-item',
      'li.s-item',
      '.s-item',
      '.brw-river-item',
      '[data-listing-id]',
      'li[class*="item"]:not([class*="gh-"])'
    ]

    let firstItem: ElementHandle<Element> | null = null
    for (const selector of itemSelectors) {
      const items = await page.$$(selector)
      if (items.length > 0) {
        firstItem = items[0]
        logger.debug('queries.ebay', 'found result items', { catalogNumber, domain, selector, itemCount: items.length })
        break
      }
    }

    if (!firstItem) {
      // Try to find any item link
      const itemLink = await page.$('a[href*="/itm/"]')
      if (itemLink) {
        const handle = await itemLink.evaluateHandle((el: Element) => {
          let parent = el.parentElement
          for (let i = 0; i < 5 && parent; i++) {
            if (parent.tagName === 'LI') return parent
            parent = parent.parentElement
          }
          return el.parentElement?.parentElement?.parentElement
        })
        // Cast the JSHandle to ElementHandle
        firstItem = handle as ElementHandle<Element>
        logger.debug('queries.ebay', 'found item via link traversal', { catalogNumber, domain })
      }
    }

    if (!firstItem) {
      logger.warn('queries.ebay', 'no items found on page', { catalogNumber, domain })
      return { success: true, result: notFound('ebay') }
    }

    const name = await firstItem.$eval('.s-item__title, h3, [class*="title"]', (el: Element) => el.textContent?.trim() || null).catch(() => null)

    if (!name) {
      return { success: true, result: notFound('ebay') }
    }

    // Extract image
    const coverUrl = await firstItem.$eval('img', (el: Element) => el.getAttribute('src') || el.getAttribute('data-src')).catch(() => null)

    // Extract link
    const link = await firstItem.$eval('a[href*="/itm/"], a', (el: Element) => el.getAttribute('href')).catch(() => null)

    // Extract price
    const priceText = await firstItem.$eval('.s-item__price, [class*="price"]', (el: Element) => el.textContent?.trim() || '').catch(() => '')
    let priceMin: number | null = null
    let priceMax: number | null = null

    if (priceText) {
      // Detect currency from symbol
      let currency: Currency = 'USD'
      if (priceText.includes('€')) currency = 'EUR'
      else if (priceText.includes('£')) currency = 'GBP'
      else if (priceText.includes('¥')) currency = 'JPY'

      const prices = priceText.match(/[\$€£¥][\d,.]+/g)
      if (prices) {
        const nums = prices.map(p => parseFloat(p.replace(/[^0-9.]/g, ''))).filter(n => n > 0)
        if (nums.length > 0) {
          const minJPY = Math.min(...nums)
          const maxJPY = Math.max(...nums)
          priceMin = await convertToUSDWithFallback(minJPY, currency)
          priceMax = await convertToUSDWithFallback(maxJPY, currency)
        }
      }
    }

    return {
      success: true,
      result: {
        platform: 'ebay',
        name,
        artist: null,
        priceMin,
        priceMax,
        coverUrl,
        link,
        status: 'found'
        // eBay doesn't provide detailed metadata like label/format/country
      }
    }
  } catch (err) {
    throwIfAborted(signal)
    logger.warn('queries.ebay', 'domain query error', { catalogNumber, domain, error: err instanceof Error ? err.message : String(err) })
    return { success: false }
  }
}

async function queryEbayWeb(catalogNumber: string, signal?: AbortSignal): Promise<QueryResult> {
  const { browser, page } = await browserPool.acquire(signal)

  try {
    // Platform-specific headers for realistic browser fingerprint
    const platform = process.platform === 'win32' ? 'Windows' : process.platform === 'linux' ? 'Linux' : 'macOS'
    const userAgent = process.platform === 'win32'
      ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      : process.platform === 'linux'
        ? 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

    // Set realistic headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br, zstd',
      'Cache-Control': 'max-age=0',
      'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': `"${platform}"`,
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'User-Agent': userAgent
    })

    // Try main domain first
    let result = await queryEbayDomain(page, EBAY_WEB_URL, catalogNumber, signal)

    // If blocked, try alternative domains
    if (!result.success) {
      for (const altDomain of EBAY_ALT_DOMAINS) {
        result = await queryEbayDomain(page, altDomain, catalogNumber, signal)
        if (result.success) break
      }
    }

    return result.result || notFound('ebay')
  } finally {
    await browserPool.release(browser, page)
  }
}

export async function queryEbay(catalogNumber: string, signal?: AbortSignal): Promise<QueryResult> {
  throwIfAborted(signal)
  logger.debug('queries.ebay', 'query start', { catalogNumber })
  const hasApiCredentials = !!getSetting('ebayClientId') && !!getSetting('ebayClientSecret')
  const cacheContext = hasApiCredentials ? 'api' : 'web'
  const cached = getCachedQueryResult('ebay', catalogNumber, cacheContext)
  if (cached) return cached

  logger.debug('queries.ebay', 'query mode', { catalogNumber, hasApiToken: hasApiCredentials })

  let result: QueryResult

  try {
    result = await queryEbayApi(catalogNumber, signal)
  } catch (err) {
    throwIfAborted(signal)
    logger.warn('queries.ebay', 'API failed, falling back to web scraping', { catalogNumber, error: err instanceof Error ? err.message : String(err) })
    try {
      result = await queryEbayWeb(catalogNumber, signal)
    } catch (webErr) {
      throwIfAborted(signal)
      result = queryError('ebay', webErr instanceof Error ? webErr.message : 'Unknown error')
    }
  }

  throwIfAborted(signal)
  cacheQueryResult(catalogNumber, result, cacheContext)
  return result
}
