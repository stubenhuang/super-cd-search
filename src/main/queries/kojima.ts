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
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 })

    const noResults = await page.$('.no-results, .search-empty')
    if (noResults) {
      return notFound('kojima')
    }

    const firstItem = await page.$('.product-item, .item-card, .search-result-item, article')
    if (!firstItem) {
      const bodyText = await page.evaluate(() => document.body.innerText)
      if (bodyText.includes('見つかりませんでした') || bodyText.includes('結果がありません')) {
        return notFound('kojima')
      }
      return notFound('kojima')
    }

    const nameSelectors = ['.product-name', '.item-title', 'h2', 'h3', '.title']
    let name: string | null = null
    for (const selector of nameSelectors) {
      name = await firstItem.$eval(selector, el => el.textContent?.trim() || null).catch(() => null)
      if (name) break
    }

    const artistSelectors = ['.artist-name', '.artist', '.by-artist']
    let artist: string | null = null
    for (const selector of artistSelectors) {
      artist = await firstItem.$eval(selector, el => el.textContent?.trim() || null).catch(() => null)
      if (artist) break
    }

    const coverSelectors = ['img.product-image', 'img.cover', 'img', '.image img']
    let coverUrl: string | null = null
    for (const selector of coverSelectors) {
      coverUrl = await firstItem.$eval(selector, el => el.getAttribute('src') || el.getAttribute('data-src')).catch(() => null)
      if (coverUrl) break
    }
    if (coverUrl && !coverUrl.startsWith('http')) {
      coverUrl = `${KOJIMA_WEB_URL}${coverUrl}`
    }

    const linkSelectors = ['a.product-link', 'a.item-link', 'a']
    let link: string | null = null
    for (const selector of linkSelectors) {
      link = await firstItem.$eval(selector, el => el.getAttribute('href')).catch(() => null)
      if (link) break
    }
    if (link && !link.startsWith('http')) {
      link = `${KOJIMA_WEB_URL}${link}`
    }

    const priceSelectors = ['.price', '.product-price', '.item-price']
    let priceMin: number | null = null
    let priceMax: number | null = null

    for (const selector of priceSelectors) {
      const priceText = await firstItem.$eval(selector, el => el.textContent?.trim() || null).catch(() => null)
      if (priceText) {
        const priceMatch = priceText.match(/[¥￥]([\d,]+)|([\d,]+)\s*円/)
        if (priceMatch) {
          const price = parseInt((priceMatch[1] || priceMatch[2]).replace(/,/g, ''), 10)
          priceMin = price
          priceMax = price
          break
        }
      }
    }

    return {
      platform: 'kojima',
      name,
      artist,
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
