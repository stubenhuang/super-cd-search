import { getSetting } from '../settings'
import { browserPool } from '../browser'
import type { QueryResult, CDDetails } from './types'
import { notFound, queryError, parseJPYPrice } from './types'
import { tryLLMParse } from '../llm/parser'

const YAHOO_SHOPPING_URL = 'https://shopping.yahoo.co.jp'

async function getYahooProductDetails(page: import('puppeteer').Page, link: string): Promise<CDDetails> {
  const details: CDDetails = { label: null, format: null, country: null, released: null, genre: null }

  try {
    await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await new Promise(r => setTimeout(r, 2000))

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

  } catch (err) {
    console.warn('Yahoo: failed to get details from product page:', err)
  }

  return details
}

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
    if (bodyText.includes('見つかりません') || bodyText.includes('検索条件に一致する商品が見つかりませんでした')) {
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

    // Try LLM parsing first
    const html = await page.content()
    const llmResult = await tryLLMParse('yahoo', catalogNumber, html, searchUrl)
    if (llmResult) return llmResult

    // Try to get details from product page
    let details: CDDetails | undefined
    if (link) {
      details = await getYahooProductDetails(page, link)
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

export async function queryYahoo(catalogNumber: string): Promise<QueryResult> {
  const cookies = getSetting('cookies')?.yahoo

  try {
    return await queryYahooWeb(catalogNumber, cookies)
  } catch (err) {
    return queryError('yahoo', err instanceof Error ? err.message : 'Unknown error')
  }
}
