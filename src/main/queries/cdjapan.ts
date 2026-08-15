import { getSetting } from '../settings'
import { browserPool } from '../browser'
import { convertToUSDWithFallback, type Currency } from '../currency'
import type { QueryResult, CDDetails } from './types'
import { notFound, queryError } from './types'
import { getCachedQueryResult, cacheQueryResult } from './cache'

const CDJAPAN_WEB_URL = 'https://www.cdjapan.co.jp'

const PRICE_CURRENCIES: Currency[] = ['JPY', 'USD', 'EUR', 'GBP', 'CNY']

/**
 * CDJapan exposes product pages at /product/{catalogNumber}, so no search step
 * is needed: the catalog number is the URL. The page carries schema.org
 * itemprop markers, which we read directly.
 */
async function queryCdjapanWeb(catalogNumber: string, cookies?: string): Promise<QueryResult> {
  const { browser, page } = await browserPool.acquire()

  try {
    if (cookies) {
      await page.setCookie({
        name: 'cdjapan',
        value: cookies,
        domain: '.cdjapan.co.jp',
        path: '/'
      })
    }

    const productUrl = `${CDJAPAN_WEB_URL}/product/${encodeURIComponent(catalogNumber)}`
    await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })

    const extracted = await page.evaluate(() => {
      const name = document.querySelector('h1 [itemprop="name"]')?.textContent?.trim() || null
      const artist = document.querySelector('h3.person a')?.textContent?.trim() || null
      const cover = document.querySelector('meta[property="og:image"]')?.getAttribute('content') || null
      const released = document.querySelector('span[itemprop="releaseDate"]')?.textContent?.trim() || null
      const priceEl = document.querySelector('span[itemprop="price"]')
      const visiblePrice = priceEl?.textContent?.trim() || null
      const priceContent = priceEl?.getAttribute('content') || null
      const priceCurrency = document.querySelector('meta[itemprop="priceCurrency"]')?.getAttribute('content') || null
      // CDJapan puts the customer-localized conversion in the `content`
      // attribute (e.g. 18.83 USD) while the visible label still shows the
      // original yen amount (e.g. 3000yen). Always trust a visible yen label.
      const priceText = visiblePrice && /yen|円/i.test(visiblePrice)
        ? visiblePrice
        : (priceContent || visiblePrice)
      const formatEl = document.querySelector('.label.media') || document.querySelector('.product_info .label')
      const format = formatEl?.textContent?.trim() || null
      return { name, artist, cover, released, priceText, priceCurrency, format }
    })

    if (!extracted.name) {
      return notFound('cdjapan')
    }

    let priceMin: number | null = null
    let priceMax: number | null = null
    if (extracted.priceText) {
      const priceMatch = extracted.priceText.match(/\d[\d,.]*/)
      if (priceMatch) {
        const amount = parseFloat(priceMatch[0].replace(/,/g, ''))
        const currencyCode = extracted.priceCurrency?.toUpperCase() ?? ''
        const currency: Currency =
          /yen|円/i.test(extracted.priceText)
            ? 'JPY'
            : PRICE_CURRENCIES.includes(currencyCode as Currency)
              ? (currencyCode as Currency)
              : 'JPY'
        if (!isNaN(amount)) {
          const usd = await convertToUSDWithFallback(amount, currency)
          priceMin = usd
          priceMax = usd
        }
      }
    }

    let coverUrl = extracted.cover
    if (coverUrl?.startsWith('http://')) {
      coverUrl = coverUrl.replace('http://', 'https://')
    }

    const details: CDDetails = {
      label: null,
      format: extracted.format,
      country: null,
      released: extracted.released,
      genre: null
    }
    const hasDetails = details.format || details.released

    return {
      platform: 'cdjapan',
      name: extracted.name,
      artist: extracted.artist,
      priceMin,
      priceMax,
      coverUrl,
      link: productUrl,
      status: 'found',
      details: hasDetails ? details : undefined
    }
  } finally {
    await browserPool.release(browser, page)
  }
}

export async function queryCdjapan(catalogNumber: string): Promise<QueryResult> {
  const cached = getCachedQueryResult('cdjapan', catalogNumber)
  if (cached) return cached

  const cookies = getSetting('cookies')?.cdjapan

  let result: QueryResult

  try {
    result = await queryCdjapanWeb(catalogNumber, cookies)
  } catch (err) {
    result = queryError('cdjapan', err instanceof Error ? err.message : 'Unknown error')
  }

  cacheQueryResult(catalogNumber, result)
  return result
}
