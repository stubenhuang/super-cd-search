import { browserPool } from '../browser'
import { gotoWithAbort, throwIfAborted } from '../browser/abort'
import { convertToUSDWithFallback } from '../currency'
import type { QueryResult, CDDetails } from './types'
import { notFound, queryError, parseJPYPrice } from './types'
import { getCachedQueryResult, cacheQueryResult } from './cache'
import { waitForResultOrNoResult } from './wait'
import { logger } from '../logger'

const TOWER_WEB_URL = 'https://tower.jp'

/**
 * Tower Records Japan exposes an item search at /search/item/{catalogNumber}.
 * The result list is server-rendered; we read the first result card directly.
 */
async function queryTowerWeb(catalogNumber: string, signal?: AbortSignal): Promise<QueryResult> {
  const { browser, page } = await browserPool.acquire(signal)

  try {
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8'
    })

    const searchUrl = `${TOWER_WEB_URL}/search/item/${encodeURIComponent(catalogNumber)}`
    logger.debug('queries.tower', 'open search page', { catalogNumber, searchUrl })
    await gotoWithAbort(page, searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }, signal)

    // Wait briefly for the server-rendered result list to settle.
    await waitForResultOrNoResult(page, {
      resultSelector: '.TOL-item-search-result-PC-result-list-display-item, .TOL-search-result-PC-search-result-number',
      timeoutMs: 4000
    })

    const extracted = await page.evaluate(() => {
      const card = document.querySelector('.TOL-item-search-result-PC-result-list-display-item')
      if (!card) return null

      const titleLink = card.querySelector('.tr-item-block-info-item-name h3 a')
      const name = titleLink?.textContent?.trim() || null
      const artist = card.querySelector('.artist-link a')?.textContent?.trim()
        || card.querySelector('.tr-item-block-info-artist-name p a')?.textContent?.trim()
        || null
      const cover = card.querySelector('.tr-item-block-img img')?.getAttribute('src') || null
      const link = titleLink?.getAttribute('href')
        || card.querySelector('a.tr-item-block')?.getAttribute('href')
        || null
      const priceText = card.querySelector('.tr-item-block-info-price .is-text-amount')?.textContent?.trim() || null
      const format = card.querySelector('.result-display-contents-category-text')?.textContent?.trim() || null

      // The info tag carries the release metadata the same way the item page's
      // spec table does: "発売日：2015年06月17日 | 規格品番：PROC-1721 |
      // レーベル：TOWER RECORDS UNIVERSAL VINTAGE COLLECTION +plus".
      const infoText = card.querySelector('.TOL-item-search-result-PC-result-display-contents-info')
        ?.textContent?.replace(/<!HS>|<!HE>/g, '') || ''
      const releasedMatch = infoText.match(/発売日[:：]\s*([0-9０-９]{4})[年.\/-]([0-9０-９]{1,2})[月.\/-]([0-9０-９]{1,2})日?/)
      const labelMatch = infoText.match(/レーベル[:：]\s*([^|]+)/)
      const released = releasedMatch
        ? `${releasedMatch[1]}-${releasedMatch[2].padStart(2, '0')}-${releasedMatch[3].padStart(2, '0')}`
        : null
      const label = labelMatch?.[1]?.trim() || null

      // The tag next to the info shows the domestic/import flag ("国内" =
      // domestic Japanese release). The same convention Discogs reports as the
      // release country, so map 国内 to "Japan"; imports stay unknown here.
      const countryTag = card.querySelector('.TOL-item-search-result-PC-result-display-contents-info-tag .common-tag')
        ?.textContent?.trim() || null
      const country = countryTag === '国内' ? 'Japan' : null

      return { name, artist, cover, link, priceText, format, released, label, country }
    })

    logger.debug('queries.tower', 'DOM extraction done', {
      catalogNumber,
      hasCard: !!extracted,
      hasName: !!extracted?.name,
      priceText: extracted?.priceText,
      format: extracted?.format,
      released: extracted?.released
    })

    if (!extracted) {
      return notFound('tower')
    }

    if (!extracted.name) {
      return notFound('tower')
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
    if (coverUrl?.startsWith('//')) {
      coverUrl = `https:${coverUrl}`
    }

    let link = extracted.link
    if (link && link.startsWith('/')) {
      link = `${TOWER_WEB_URL}${link}`
    }

    const details: CDDetails = {
      label: extracted.label,
      format: extracted.format,
      country: extracted.country,
      released: extracted.released,
      genre: null
    }

    const hasDetails = details.label || details.format || details.country || details.released

    return {
      platform: 'tower',
      name: extracted.name,
      artist: extracted.artist,
      priceMin,
      priceMax,
      coverUrl,
      link,
      status: 'found',
      details: hasDetails ? details : undefined
    }
  } finally {
    await browserPool.release(browser, page)
  }
}

export async function queryTower(catalogNumber: string, signal?: AbortSignal): Promise<QueryResult> {
  throwIfAborted(signal)
  logger.debug('queries.tower', 'query start', { catalogNumber })
  const cached = getCachedQueryResult('tower', catalogNumber)
  if (cached) return cached

  let result: QueryResult

  try {
    result = await queryTowerWeb(catalogNumber, signal)
  } catch (err) {
    throwIfAborted(signal)
    logger.warn('queries.tower', 'query failed', { catalogNumber, error: err instanceof Error ? err.message : String(err) })
    result = queryError('tower', err instanceof Error ? err.message : 'Unknown error')
  }

  throwIfAborted(signal)
  cacheQueryResult(catalogNumber, result)
  return result
}
