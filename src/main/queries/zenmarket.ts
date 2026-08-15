import { acquireCloudflarePage, isCloudflareChallenge } from '../cloudflare'
import type { QueryResult, CDDetails } from './types'
import { notFound, queryError, cloudflareChallenge, parseJPYPrice } from './types'
import { getCachedQueryResult, cacheQueryResult } from './cache'
import { waitForResultOrNoResult } from './wait'
import { logger } from '../logger'

const ZENMARKET_WEB_URL = 'https://zenmarket.jp'

// ZenMarket's search is server-rendered .aspx HTML, also behind Cloudflare.
// The endpoint below (Yahoo Shopping via ZenMarket) is a best-effort default;
// TODO: confirm the exact search route + result selectors against the live DOM
// once a real-Chrome session is available.
const ZENMARKET_SEARCH_PATH = '/en/yshopping.aspx'

async function queryZenmarketWeb(catalogNumber: string): Promise<QueryResult> {
  const acquired = await acquireCloudflarePage()
  if (!acquired) {
    logger.debug('queries.zenmarket', 'real-Chrome session unavailable', { catalogNumber })
    return cloudflareChallenge('zenmarket')
  }

  const { page, release } = acquired
  try {
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9'
    })

    const searchUrl = `${ZENMARKET_WEB_URL}${ZENMARKET_SEARCH_PATH}?q=${encodeURIComponent(catalogNumber)}`
    logger.debug('queries.zenmarket', 'open search page', { catalogNumber, searchUrl })
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })

    if (await isCloudflareChallenge(page)) {
      logger.debug('queries.zenmarket', 'Cloudflare challenge detected', { catalogNumber })
      return cloudflareChallenge('zenmarket')
    }

    await waitForResultOrNoResult(page, {
      resultSelector: 'a[href*="itemCode"], a[href*="product.aspx"], a[href*="/product/"]',
      noResultSelectors: ['[class*="no-result"], [class*="noResult"], [class*="empty"]'],
      timeoutMs: 4000
    })

    const extracted = await page.evaluate(() => {
      const anchors = Array.from(
        document.querySelectorAll<HTMLAnchorElement>(
          'a[href*="itemCode"], a[href*="product.aspx"], a[href*="/product/"]'
        )
      )
      const anchor =
        anchors.find((a) => a.textContent?.trim() && !a.querySelector('img')) || anchors[0]
      if (!anchor) return null

      const card =
        anchor.closest('li, .item, [class*="item"], [class*="card"], [class*="result"]') ||
        anchor.parentElement

      const img = card?.querySelector('img')
      const name = anchor.getAttribute('title') || anchor.textContent?.trim() || null
      const cover = img?.getAttribute('src') || img?.getAttribute('data-src') || null
      const priceText = card?.textContent?.match(/[¥￥]\s?[\d,]+|[\d,]+円/)?.[0] || null
      const link = anchor.getAttribute('href')

      return { name, cover, priceText, link }
    })

    logger.debug('queries.zenmarket', 'search extraction done', {
      catalogNumber,
      hasResult: !!extracted,
      hasName: !!extracted?.name,
      priceText: extracted?.priceText
    })

    if (!extracted) {
      return notFound('zenmarket')
    }

    if (!extracted.name) {
      return notFound('zenmarket')
    }

    let priceMin: number | null = null
    let priceMax: number | null = null
    if (extracted.priceText) {
      const priceUSD = await parseJPYPrice(extracted.priceText)
      if (priceUSD !== null) {
        priceMin = priceUSD
        priceMax = priceUSD
      }
    }

    let coverUrl = extracted.cover
    if (coverUrl?.startsWith('//')) coverUrl = `https:${coverUrl}`
    else if (coverUrl?.startsWith('/')) coverUrl = `${ZENMARKET_WEB_URL}${coverUrl}`

    let link = extracted.link
    if (link && link.startsWith('/')) link = `${ZENMARKET_WEB_URL}${link}`

    const details: CDDetails = {
      label: null,
      format: null,
      country: 'Japan',
      released: null,
      genre: null
    }

    return {
      platform: 'zenmarket',
      name: extracted.name,
      artist: null,
      priceMin,
      priceMax,
      coverUrl,
      link,
      status: 'found',
      details
    }
  } finally {
    release()
  }
}

export async function queryZenmarket(catalogNumber: string): Promise<QueryResult> {
  logger.debug('queries.zenmarket', 'query start', { catalogNumber })
  const cached = getCachedQueryResult('zenmarket', catalogNumber)
  if (cached) return cached

  let result: QueryResult
  try {
    result = await queryZenmarketWeb(catalogNumber)
  } catch (err) {
    logger.warn('queries.zenmarket', 'query failed', { catalogNumber, error: err instanceof Error ? err.message : String(err) })
    result = queryError('zenmarket', err instanceof Error ? err.message : 'Unknown error')
  }

  cacheQueryResult(catalogNumber, result)
  return result
}
