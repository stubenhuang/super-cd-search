import { getSetting } from '../settings'
import { browserPool } from '../browser'
import type { QueryResult } from './types'
import { notFound, queryError } from './types'

const KOJIMA_WEB_URL = 'https://kojimarokuon.com'

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
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await new Promise(r => setTimeout(r, 3000))

    // Check for no results
    const bodyText = await page.evaluate(() => document.body.innerText)
    if (bodyText.includes('見つかりませんでした') || bodyText.includes('結果がありません') || bodyText.includes('0件の結果')) {
      return notFound('kojima')
    }

    // Shopify standard card structure
    const firstItem = await page.$('.card')
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

    // Kojima typically doesn't show price on search results
    // Price is on the product page
    const priceMin: number | null = null
    const priceMax: number | null = null

    // Artist info not typically shown in search results

    return {
      platform: 'kojima',
      name,
      artist: null,
      priceMin,
      priceMax,
      coverUrl,
      link,
      status: 'found'
    }
  } finally {
    await browserPool.release(browser)
  }
}

export async function queryKojima(catalogNumber: string): Promise<QueryResult> {
  const cookies = getSetting('cookies')?.kojima

  try {
    return await queryKojimaWeb(catalogNumber, cookies)
  } catch (err) {
    return queryError('kojima', err instanceof Error ? err.message : 'Unknown error')
  }
}
