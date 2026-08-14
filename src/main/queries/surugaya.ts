import { acquireCloudflarePage, isCloudflareChallenge } from '../cloudflare'
import type { QueryResult, CDDetails } from './types'
import { notFound, queryError, cloudflareChallenge, parseJPYPrice } from './types'
import { tryLLMParse } from '../llm/parser'
import { getCachedQueryResult, cacheQueryResult } from './cache'
import { waitForResultOrNoResult } from './wait'

const SURUGAYA_WEB_URL = 'https://www.suruga-ya.jp'

/**
 * Suruga-ya is fully behind Cloudflare on every route. Searches run through the
 * real-Chrome session (see src/main/cloudflare/chrome.ts); when that browser is
 * not running/verified, or the challenge reappears mid-scrape, we surface a
 * `challenge` status instead of failing silently.
 */
async function querySurugayaWeb(catalogNumber: string): Promise<QueryResult> {
  const acquired = await acquireCloudflarePage()
  if (!acquired) {
    return cloudflareChallenge('surugaya')
  }

  const { page, release } = acquired
  try {
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8'
    })

    const searchUrl = `${SURUGAYA_WEB_URL}/search?search_word=${encodeURIComponent(catalogNumber)}`
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })

    if (await isCloudflareChallenge(page)) {
      return cloudflareChallenge('surugaya')
    }

    await waitForResultOrNoResult(page, {
      resultSelector: '.item, a[href*="/product/detail/"]',
      noResultSelectors: ['.search_no_result', '.no_result', '[class*="no-result"]'],
      timeoutMs: 4000
    })

    // Selectors mirror the site's real markup (title/thumb/price cells).
    const extracted = await page.evaluate(() => {
      const item = document.querySelector('.item')
      const anchor =
        item?.querySelector<HTMLAnchorElement>('.thum a') ||
        item?.querySelector<HTMLAnchorElement>('a[href*="/product/detail/"]') ||
        document.querySelector<HTMLAnchorElement>('a[href*="/product/detail/"]')

      if (!anchor) return null

      const name =
        item?.querySelector('.title a')?.textContent?.trim() ||
        anchor.getAttribute('title') ||
        anchor.textContent?.trim() ||
        null

      const img = item?.querySelector('.thum img') || item?.querySelector('img')
      const cover = img?.getAttribute('src') || img?.getAttribute('data-src') || null

      const priceText =
        item?.querySelector('.price_teika')?.textContent ||
        item?.textContent?.match(/[¥￥]\s?[\d,]+|[\d,]+円/)?.[0] ||
        null

      const link = anchor.getAttribute('href')

      return { name, cover, priceText, link }
    })

    if (!extracted) {
      return notFound('surugaya')
    }

    // DOM extraction first; only fall back to LLM when the key field is missing.
    if (!extracted.name) {
      const html = await page.content()
      const llmResult = await tryLLMParse('surugaya', catalogNumber, html, searchUrl)
      if (llmResult) return llmResult
      return notFound('surugaya')
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
    else if (coverUrl?.startsWith('/')) coverUrl = `${SURUGAYA_WEB_URL}${coverUrl}`

    let link = extracted.link
    if (link && link.startsWith('/')) link = `${SURUGAYA_WEB_URL}${link}`

    const details: CDDetails = {
      label: null,
      format: null,
      country: 'Japan',
      released: null,
      genre: null
    }

    return {
      platform: 'surugaya',
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

export async function querySurugaya(catalogNumber: string): Promise<QueryResult> {
  const cached = getCachedQueryResult('surugaya', catalogNumber)
  if (cached) return cached

  let result: QueryResult
  try {
    result = await querySurugayaWeb(catalogNumber)
  } catch (err) {
    result = queryError('surugaya', err instanceof Error ? err.message : 'Unknown error')
  }

  cacheQueryResult(catalogNumber, result)
  return result
}
