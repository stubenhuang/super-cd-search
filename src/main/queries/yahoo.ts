import { getSetting } from '../settings'
import { browserPool } from '../browser'
import { gotoWithAbort, throwIfAborted } from '../browser/abort'
import type { QueryResult, CDDetails } from './types'
import { notFound, queryError, parseJPYPrice } from './types'
import { getCachedQueryResult, cacheQueryResult, getCachedProductData, cacheProductData } from './cache'
import { waitForResultOrNoResult } from './wait'
import { logger } from '../logger'

const YAHOO_SHOPPING_URL = 'https://shopping.yahoo.co.jp'

async function getYahooProductDetails(page: import('puppeteer').Page, link: string, signal?: AbortSignal): Promise<CDDetails> {
  const cached = getCachedProductData<CDDetails>('yahoo', link)
  if (cached) return cached

  const details: CDDetails = { label: null, format: null, country: null, released: null, genre: null }

  try {
    await gotoWithAbort(page, link, { waitUntil: 'domcontentloaded', timeout: 20000 }, signal)
    await page.waitForSelector(
      'table, .specTable, .productSpec, .productDescription, .itemDescription, [class*="description"]',
      { timeout: 3000 }
    ).catch(() => null)

    // Extract product details from the page
    const productDetails = await page.evaluate(() => {
      const result: { format?: string; released?: string; label?: string; genre?: string } = {}

      // Look for product specification tables (common in Yahoo Shopping product pages)
      const specTables = document.querySelectorAll('table, .specTable, .productSpec, dl')
      for (const table of specTables) {
        const rows = table.querySelectorAll('tr, dt, .specRow')
        for (const row of rows) {
          const keyEl = row.querySelector('th, dt, .label') || row
          const valueEl = row.querySelector('td, dd, .value') || row.nextElementSibling
          const key = keyEl?.textContent?.trim() || ''
          const value = valueEl?.textContent?.trim() || ''

          if (key.includes('フォーマット') || key.includes('形式') || key.includes('Format')) {
            result.format = value
          } else if (key.includes('発売日') || key.includes('Release') || key.includes('発売')) {
            result.released = value
          } else if (key.includes('レーベル') || key.includes('Label') || key.includes('厂牌')) {
            result.label = value
          } else if (key.includes('ジャンル') || key.includes('Genre') || key.includes('ジャンル')) {
            result.genre = value
          }
        }
      }

      // Look for description text with key:value patterns
      const descEl = document.querySelector('.productDescription, .itemDescription, [class*="description"], [class*="Description"]')
      if (descEl) {
        const text = descEl.textContent || ''
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

        for (const line of lines) {
          const colonMatch = line.match(/^(.+?)[:：]\s*(.+)$/)
          if (colonMatch) {
            const [, key, value] = colonMatch

            if (!result.format && (key.includes('フォーマット') || key.includes('形式') || key.includes('Format'))) {
              result.format = value
            } else if (!result.released && (key.includes('発売日') || key.includes('Release') || key.includes('発売'))) {
              result.released = value
            } else if (!result.label && (key.includes('レーベル') || key.includes('Label'))) {
              result.label = value
            } else if (!result.genre && (key.includes('ジャンル') || key.includes('Genre'))) {
              result.genre = value
            }
          }
        }
      }

      return result
    })

    if (productDetails.format) details.format = productDetails.format
    if (productDetails.released) details.released = productDetails.released
    if (productDetails.label) details.label = productDetails.label
    if (productDetails.genre) details.genre = productDetails.genre

    cacheProductData('yahoo', link, details)
    return details
  } catch (err) {
    throwIfAborted(signal)
    logger.warn('queries.yahoo', 'failed to get details from product page', { link, error: err instanceof Error ? err.message : String(err) })
    return details
  }
}

async function queryYahooWeb(catalogNumber: string, signal?: AbortSignal): Promise<QueryResult> {
  const { browser, page } = await browserPool.acquire(signal)

  try {
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8'
    })

    const searchUrl = `${YAHOO_SHOPPING_URL}/search/${encodeURIComponent(catalogNumber)}/0/?first=1&tab_ex=commerce`
    logger.debug('queries.yahoo', 'open search page', { catalogNumber, searchUrl })
    await gotoWithAbort(page, searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }, signal)

    // Wait for the first search result item.
    await waitForResultOrNoResult(page, { resultSelector: '.SearchResult_SearchResultItem__mJ7vY', timeoutMs: 4000 })
    const firstItem = await page.$('.SearchResult_SearchResultItem__mJ7vY')
    logger.debug('queries.yahoo', 'search result resolution', { catalogNumber, foundFirstItem: !!firstItem })
    if (!firstItem) {
      return notFound('yahoo')
    }

    const { name, link, coverUrl, priceText, storeName } = await firstItem.evaluate(el => {
      const text = (sel: string) => el.querySelector(sel)?.textContent?.trim() ?? null
      const attr = (sel: string, a: string) => el.querySelector(sel)?.getAttribute(a) ?? null
      return {
        name: text('.SearchResult_SearchResultItem__detailLink__G4Top'),
        link: attr('.SearchResult_SearchResultItem__detailLink__G4Top', 'href'),
        coverUrl: attr('.ItemImageLink_SearchResultItemImageLink__imageSource__RDUwW', 'src'),
        priceText: text('.ItemPrice_ItemPrice__2t7fx'),
        storeName: text('.ItemStore_SearchResultItemStore__Ft4En')
      }
    })

    let priceMin: number | null = null
    let priceMax: number | null = null

    if (priceText) {
      const priceUSD = await parseJPYPrice(priceText)
      if (priceUSD !== null) {
        priceMin = priceUSD
        priceMax = priceUSD
      }
    }

    logger.debug('queries.yahoo', 'search card extracted', {
      catalogNumber,
      hasName: !!name,
      link,
      coverUrl: !!coverUrl,
      priceText,
      storeName
    })

    if (!name) {
      return notFound('yahoo')
    }

    // Try to get details from product page. In fast mode we skip this second
    // navigation to keep traffic and latency low.
    let details: CDDetails | undefined
    if (link && !getSetting('fastMode')) {
      logger.debug('queries.yahoo', 'fetch product detail page', { catalogNumber, link })
      details = await getYahooProductDetails(page, link, signal)
      const hasDetails = details.label || details.format || details.released || details.genre
      if (!hasDetails) details = undefined
    }

    return {
      platform: 'yahoo',
      name,
      artist: storeName,
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

export async function queryYahoo(catalogNumber: string, signal?: AbortSignal): Promise<QueryResult> {
  throwIfAborted(signal)
  logger.debug('queries.yahoo', 'query start', { catalogNumber })
  const cacheContext = getSetting('fastMode') ? 'fast' : 'full'
  const cached = getCachedQueryResult('yahoo', catalogNumber, cacheContext)
  if (cached) return cached

  let result: QueryResult

  try {
    result = await queryYahooWeb(catalogNumber, signal)
  } catch (err) {
    throwIfAborted(signal)
    logger.warn('queries.yahoo', 'query failed', { catalogNumber, error: err instanceof Error ? err.message : String(err) })
    result = queryError('yahoo', err instanceof Error ? err.message : 'Unknown error')
  }

  throwIfAborted(signal)
  cacheQueryResult(catalogNumber, result, cacheContext)
  return result
}
