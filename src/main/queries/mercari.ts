import { getSetting } from '../settings'
import { browserPool } from '../browser'
import type { QueryResult } from './types'
import { notFound, queryError } from './types'

const MERCARI_WEB_URL = 'https://www.mercari.com/jp'

async function queryMercariWeb(catalogNumber: string, cookies?: string): Promise<QueryResult> {
  const { browser, page } = await browserPool.acquire()

  try {
    if (cookies) {
      await page.setCookie({
        name: 'mercari',
        value: cookies,
        domain: '.mercari.com',
        path: '/'
      })
    }

    const searchUrl = `${MERCARI_WEB_URL}/search/?keyword=${encodeURIComponent(catalogNumber)}`
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 })

    const firstItem = await page.$('.items-box, [data-testid="item-card"], .item-grid-item, article')
    if (!firstItem) {
      const bodyText = await page.evaluate(() => document.body.innerText)
      if (bodyText.includes('見つかりませんでした') || bodyText.includes('該当する商品がありません')) {
        return notFound('mercari')
      }
      return notFound('mercari')
    }

    const nameSelectors = ['.items-box-name', '[data-testid="item-name"]', 'h3', '.item-name', '.title']
    let name: string | null = null
    for (const selector of nameSelectors) {
      name = await firstItem.$eval(selector, el => el.textContent?.trim() || null).catch(() => null)
      if (name) break
    }

    const coverSelectors = ['.items-box-photo img', '[data-testid="item-image"] img', 'img', '.image img']
    let coverUrl: string | null = null
    for (const selector of coverSelectors) {
      coverUrl = await firstItem.$eval(selector, el => el.getAttribute('src') || el.getAttribute('data-src')).catch(() => null)
      if (coverUrl) break
    }

    const linkSelectors = ['a.items-box', 'a[href*="/items/"]', 'a']
    let link: string | null = null
    for (const selector of linkSelectors) {
      link = await firstItem.$eval(selector, el => el.getAttribute('href')).catch(() => null)
      if (link) break
    }
    if (link && !link.startsWith('http')) {
      link = link.startsWith('/') ? `${MERCARI_WEB_URL}${link}` : `${MERCARI_WEB_URL}/${link}`
    }

    const priceSelectors = ['.items-box-price', '[data-testid="item-price"]', '.price', '.item-price']
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
      platform: 'mercari',
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

export async function queryMercari(catalogNumber: string): Promise<QueryResult> {
  const cookies = getSetting('cookies')?.mercari

  try {
    return await queryMercariWeb(catalogNumber, cookies)
  } catch (err) {
    return queryError('mercari', err instanceof Error ? err.message : 'Unknown error')
  }
}
