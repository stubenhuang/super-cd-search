import { getSetting } from '../settings'
import { browserPool } from '../browser'
import { throttledFetch } from '../throttle'
import { convertToUSDWithFallback } from '../currency'
import type { QueryResult, CDDetails } from './types'
import { notFound, queryError, parseJPYPrice } from './types'
import { getCachedQueryResult, cacheQueryResult, getCachedProductData, cacheProductData } from './cache'
import { waitForResultOrNoResult } from './wait'
import { logger } from '../logger'

const KOJIMA_WEB_URL = 'https://kojimarokuon.com'

// Light throttle for the Shopify JSON endpoint: one lightweight GET per unique
// product (cached thereafter), far cheaper than rendering the product page.
const JSON_THROTTLE = { minDelay: 300, maxDelay: 800, timeoutMs: 15000 }

interface KojimaProductData {
  price: number | null
  details: CDDetails
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('\n')
}

/** Parse "Key: Value" lines out of the Shopify product description HTML. */
function parseDetailsFromDescription(html: string, tags: string[] = []): CDDetails {
  const details: CDDetails = { label: null, format: null, country: 'Japan', released: null, genre: null }

  for (const line of stripHtml(html).split('\n')) {
    const match = line.match(/^(.+?)[:：]\s*(.+)$/)
    if (!match) continue
    const key = match[1].toLowerCase()
    const value = match[2].trim()

    if (key.includes('format') || key.includes('フォーマット') || key.includes('形式')) {
      if (!details.format) details.format = value
    } else if (key.includes('release') || key.includes('発売') || key.includes('date')) {
      if (!details.released) details.released = value
    } else if (key.includes('label') || key.includes('レーベル')) {
      if (!details.label) details.label = value
    } else if (key.includes('genre') || key.includes('ジャンル')) {
      if (!details.genre) details.genre = value
    }
  }

  if (!details.genre && tags.length > 0) {
    details.genre = tags.slice(0, 3).join(' / ')
  }

  return details
}

/**
 * Fetch price and details from Shopify's `/products/{handle}.js` JSON endpoint
 * instead of rendering the product page. Returns null when the URL has no
 * handle or the endpoint is unavailable, so the caller can fall back to the
 * render-based scraper.
 */
async function tryGetKojimaProductDataFromJson(link: string): Promise<KojimaProductData | null> {
  const cached = getCachedProductData<KojimaProductData>('kojima', link)
  if (cached) return cached

  const handleMatch = link.match(/\/products\/([^/?#]+)/)
  if (!handleMatch) return null
  const handle = handleMatch[1]

  try {
    const url = `${KOJIMA_WEB_URL}/products/${encodeURIComponent(handle)}.js`
    const response = await throttledFetch('kojimarokuon.com', url, undefined, JSON_THROTTLE)
    if (!response.ok) return null

    const data = await response.json() as {
      price?: number
      price_min?: number
      price_max?: number
      description?: string
      tags?: string[]
      variants?: Array<{ title?: string }>
    }

    // Shopify .js prices are integers in the store's minor unit (cents); for a
    // JPY store dividing by 100 recovers the yen amount.
    const rawPrice = data.price_min ?? data.price
    let price: number | null = null
    if (typeof rawPrice === 'number' && rawPrice > 0) {
      price = await convertToUSDWithFallback(rawPrice / 100, 'JPY')
    }

    const details = parseDetailsFromDescription(data.description ?? '', data.tags ?? [])

    // Variant titles often encode the format (e.g. "CD", "SACD").
    if (!details.format) {
      const variantText = data.variants?.map((v) => v.title).join(' ') ?? ''
      if (variantText && /CD|SACD|LP|Vinyl/i.test(variantText)) {
        details.format = variantText.trim()
      }
    }

    const result: KojimaProductData = { price, details }
    cacheProductData('kojima', link, result)
    return result
  } catch (err) {
    logger.warn('queries.kojima', 'Shopify JSON lookup failed, falling back to rendering', { link, error: err instanceof Error ? err.message : String(err) })
    return null
  }
}

async function getKojimaProductDetails(page: import('puppeteer').Page, link: string): Promise<{ price: number | null; details: CDDetails }> {
  const cached = getCachedProductData<{ price: number | null; details: CDDetails }>('kojima', link)
  if (cached) return cached

  const details: CDDetails = { label: null, format: null, country: null, released: null, genre: null }
  let price: number | null = null

  try {
    await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await page.waitForSelector(
      '.price__regular, .price-item, .product__price, .product__description, .product-specs, [data-product-price], .price',
      { timeout: 3000 }
    ).catch(() => null)

    // Extract price
    const priceText = await page.evaluate(() => {
      const selectors = [
        '.price__regular .price-item--regular',
        '.price__sale .price-item--sale',
        '.product__price',
        '.price-item',
        '[data-product-price]',
        '.product-single__price',
        'span[data-product-price]'
      ]
      for (const sel of selectors) {
        const el = document.querySelector(sel)
        if (el && el.textContent) {
          return el.textContent.trim()
        }
      }
      return null
    })

    if (priceText) {
      price = await parseJPYPrice(priceText)
    }

    // Extract product details from Shopify product page
    const productDetails = await page.evaluate(() => {
      const result: { format?: string; released?: string; label?: string; genre?: string; artist?: string } = {}

      // Look for product description/accordion content
      const descriptionEl = document.querySelector('.product__description, .rte, .product-description, [data-product-description]') as HTMLElement | null
      if (descriptionEl) {
        const text = descriptionEl.innerText || ''
        const lines = text.split('\n').map((l: string) => l.trim()).filter(Boolean)

        for (const line of lines) {
          const colonMatch = line.match(/^(.+?)[:：]\s*(.+)$/)
          if (colonMatch) {
            const [, key, value] = colonMatch
            const keyLower = key.toLowerCase()

            if (keyLower.includes('format') || keyLower.includes('フォーマット') || keyLower.includes('形式')) {
              result.format = value
            } else if (keyLower.includes('release') || keyLower.includes('発売') || keyLower.includes('date')) {
              result.released = value
            } else if (keyLower.includes('label') || keyLower.includes('レーベル')) {
              result.label = value
            } else if (keyLower.includes('genre') || keyLower.includes('ジャンル')) {
              result.genre = value
            } else if (keyLower.includes('artist') || keyLower.includes('アーティスト')) {
              result.artist = value
            }
          }
        }
      }

      // Look for variant/select options (often contain format info)
      const variantSelects = document.querySelectorAll('select[name="id"] option, .variant__button-label')
      for (const opt of variantSelects) {
        const text = opt.textContent?.trim() || ''
        if (text.includes('CD') || text.includes('SACD') || text.includes('LP') || text.includes('Vinyl')) {
          if (!result.format) result.format = text
        }
      }

      // Look for product meta fields (common in Shopify themes)
      const metaFields = document.querySelectorAll('.product__meta, .product-meta, .product-details')
      for (const meta of metaFields) {
        const text = meta.textContent?.trim() || ''
        if (text.includes('Release')) {
          const match = text.match(/Release[:：]?\s*(\d{4}[\-\/\.]\d{1,2}[\-\/\.]\d{1,2}|\d{4})/)
          if (match) result.released = match[1]
        }
      }

      // Check for product tags or categories
      const tags = document.querySelectorAll('.product-tags a, .product__tags a, .tag')
      const tagTexts = Array.from(tags).map(t => t.textContent?.trim()).filter(Boolean)
      if (tagTexts.length > 0 && !result.genre) {
        result.genre = tagTexts.slice(0, 3).join(' / ')
      }

      return result
    })

    if (productDetails.format) details.format = productDetails.format
    if (productDetails.released) details.released = productDetails.released
    if (productDetails.label) details.label = productDetails.label
    if (productDetails.genre) details.genre = productDetails.genre

    // Kojima Rokuon is Japan-based
    details.country = 'Japan'

    const result = { price, details }
    cacheProductData('kojima', link, result)
    return result
  } catch (err) {
    logger.warn('queries.kojima', 'failed to get details from product page', { link, error: err instanceof Error ? err.message : String(err) })
    return { price: null, details }
  }
}

async function queryKojimaWeb(catalogNumber: string, cookies?: string): Promise<QueryResult> {
  const { browser, page } = await browserPool.acquire()

  try {
    if (cookies) {
      await page.setCookie({
        name: 'kojimarokuon',
        value: cookies,
        domain: '.kojimarokuon.com',
        path: '/'
      })
    }

    await page.setExtraHTTPHeaders({
      'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8'
    })

    const searchUrl = `${KOJIMA_WEB_URL}/search/?q=${encodeURIComponent(catalogNumber)}`
    logger.debug('queries.kojima', 'open search page', { catalogNumber, searchUrl })
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })

    // Wait for the Shopify standard card structure.
    await waitForResultOrNoResult(page, { resultSelector: '.card', timeoutMs: 4000 })
    const firstItem = await page.$('.card')
    logger.debug('queries.kojima', 'search result resolution', { catalogNumber, foundFirstItem: !!firstItem })
    if (!firstItem) {
      return notFound('kojima')
    }

    // Extract name from card heading
    const name = await firstItem.$eval('.card__heading a', el => el.textContent?.trim() || null).catch(() => null)

    // Extract cover image
    let coverUrl = await firstItem.$eval('.card__media img', el => el.getAttribute('src')).catch(() => null)
    if (coverUrl && coverUrl.startsWith('//')) {
      coverUrl = `https:${coverUrl}`
    }

    // Extract link
    let link = await firstItem.$eval('.card__heading a', el => el.getAttribute('href')).catch(() => null)
    if (link && !link.startsWith('http')) {
      link = `${KOJIMA_WEB_URL}${link}`
    }

    logger.debug('queries.kojima', 'search card extracted', { catalogNumber, hasName: !!name, link, coverUrl: !!coverUrl })

    if (!name) {
      return notFound('kojima')
    }

    // Navigate to product page for price and details
    let priceMin: number | null = null
    let priceMax: number | null = null
    let details: CDDetails | undefined

    if (link) {
      logger.debug('queries.kojima', 'fetch product data', { catalogNumber, link })
      // Prefer the lightweight JSON endpoint; fall back to rendering only when
      // it is unavailable, so the common case avoids a second full page load.
      const productData = await tryGetKojimaProductDataFromJson(link)
        ?? await getKojimaProductDetails(page, link)
      priceMin = productData.price
      priceMax = productData.price

      if (productData.details.label || productData.details.format ||
          productData.details.released || productData.details.genre) {
        details = productData.details
      }
    }

    return {
      platform: 'kojima',
      name,
      artist: null,
      priceMin,
      priceMax,
      coverUrl,
      link,
      status: 'found',
      details
    }
  } finally {
    await browserPool.release(browser, page)
  }
}

export async function queryKojima(catalogNumber: string): Promise<QueryResult> {
  logger.debug('queries.kojima', 'query start', { catalogNumber })
  const cached = getCachedQueryResult('kojima', catalogNumber)
  if (cached) return cached

  const cookies = getSetting('cookies')?.kojima

  let result: QueryResult

  try {
    result = await queryKojimaWeb(catalogNumber, cookies)
  } catch (err) {
    logger.warn('queries.kojima', 'query failed', { catalogNumber, error: err instanceof Error ? err.message : String(err) })
    result = queryError('kojima', err instanceof Error ? err.message : 'Unknown error')
  }

  cacheQueryResult(catalogNumber, result)
  return result
}
