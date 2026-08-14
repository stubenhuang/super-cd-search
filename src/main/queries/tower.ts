import { getSetting } from '../settings'
import { browserPool } from '../browser'
import { convertToUSDWithFallback } from '../currency'
import type { QueryResult, CDDetails } from './types'
import { notFound, queryError, parseJPYPrice } from './types'
import { tryLLMParse } from '../llm/parser'
import { getCachedQueryResult, cacheQueryResult } from './cache'
import { waitForResultOrNoResult } from './wait'

const TOWER_WEB_URL = 'https://tower.jp'

/**
 * Tower Records Japan exposes an item search at /search/item/{catalogNumber}.
 * The result list is server-rendered; we read the first result card directly.
 */
async function queryTowerWeb(catalogNumber: string, cookies?: string): Promise<QueryResult> {
  const { browser, page } = await browserPool.acquire()

  try {
    if (cookies) {
      await page.setCookie({
        name: 'tower',
        value: cookies,
        domain: '.tower.jp',
        path: '/'
      })
    }

    await page.setExtraHTTPHeaders({
      'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8'
    })

    const searchUrl = `${TOWER_WEB_URL}/search/item/${encodeURIComponent(catalogNumber)}`
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })

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
      return { name, artist, cover, link, priceText, format }
    })

    if (!extracted) {
      return notFound('tower')
    }

    // DOM extraction first; only fall back to LLM when the key field is missing.
    if (!extracted.name) {
      const html = await page.content()
      const llmResult = await tryLLMParse('tower', catalogNumber, html, searchUrl)
      if (llmResult) return llmResult
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
      label: null,
      format: extracted.format,
      country: null,
      released: null,
      genre: null
    }

    return {
      platform: 'tower',
      name: extracted.name,
      artist: extracted.artist,
      priceMin,
      priceMax,
      coverUrl,
      link,
      status: 'found',
      details: details.format ? details : undefined
    }
  } finally {
    await browserPool.release(browser, page)
  }
}

export async function queryTower(catalogNumber: string): Promise<QueryResult> {
  const cached = getCachedQueryResult('tower', catalogNumber)
  if (cached) return cached

  const cookies = getSetting('cookies')?.tower

  let result: QueryResult

  try {
    result = await queryTowerWeb(catalogNumber, cookies)
  } catch (err) {
    result = queryError('tower', err instanceof Error ? err.message : 'Unknown error')
  }

  cacheQueryResult(catalogNumber, result)
  return result
}
