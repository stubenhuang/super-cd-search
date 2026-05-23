import { getSetting } from '../settings'
import { browserPool } from '../browser'
import type { QueryResult } from './types'
import { notFound, queryError, parseJPYPrice } from './types'

const YAHOO_SHOPPING_URL = 'https://shopping.yahoo.co.jp'

async function queryYahooWeb(catalogNumber: string, cookies?: string): Promise<QueryResult> {
  const { browser, page } = await browserPool.acquire()

  try {
    if (cookies) {
      await page.setCookie({
        name: 'yahoo',
        value: cookies,
        domain: '.shopping.yahoo.co.jp',
        path: '/'
      })
    }

    await page.setExtraHTTPHeaders({
      'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8'
    })

    const searchUrl = `${YAHOO_SHOPPING_URL}/search/${encodeURIComponent(catalogNumber)}/0/?first=1&tab_ex=commerce`
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await new Promise(r => setTimeout(r, 3000))

    const bodyText = await page.evaluate(() => document.body.innerText)
    if (bodyText.includes('見つかりません') || bodyText.includes('検索条件��一致する商品が見つかりませんでした')) {
      return notFound('yahoo')
    }

    const firstItem = await page.$('.SearchResult_SearchResultItem__mJ7vY')
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

    return {
      platform: 'yahoo',
      name,
      artist: storeName,
      priceMin,
      priceMax,
      coverUrl,
      link,
      status: 'found'
    }
  } finally {
    await browserPool.release(browser, page)
  }
}

export async function queryYahoo(catalogNumber: string): Promise<QueryResult> {
  const cookies = getSetting('cookies')?.yahoo

  try {
    return await queryYahooWeb(catalogNumber, cookies)
  } catch (err) {
    return queryError('yahoo', err instanceof Error ? err.message : 'Unknown error')
  }
}