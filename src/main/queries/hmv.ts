import { getSetting } from '../settings'
import { browserPool } from '../browser'
import { convertToUSDWithFallback } from '../currency'
import type { QueryResult } from './types'
import { notFound, queryError } from './types'

const HMV_WEB_URL = 'https://www.hmv.co.jp'

async function queryHmvWeb(catalogNumber: string, cookies?: string): Promise<QueryResult> {
  const { browser, page } = await browserPool.acquire()

  try {
    if (cookies) {
      await page.setCookie({
        name: 'hmv',
        value: cookies,
        domain: '.hmv.co.jp',
        path: '/'
      })
    }

    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9'
    })

    const searchUrl = `${HMV_WEB_URL}/en/search/keyword_${encodeURIComponent(catalogNumber)}/target_ALL/type_sr/`
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await new Promise(r => setTimeout(r, 3000))

    // Check for no results
    const bodyText = await page.evaluate(() => document.body.innerText)
    if (
      bodyText.includes('0 results') ||
      bodyText.includes('No results') ||
      bodyText.includes('did not match any products')
    ) {
      return notFound('hmv')
    }

    // Find first product item - HMV uses li.list.clearfix inside .resultList
    // Note: li.list alone matches many navigation tabs, need .clearfix to identify actual products
    const firstItem = await page.$('.resultList > li.list.clearfix, li.list.clearfix')
    if (!firstItem) {
      return notFound('hmv')
    }

    // Extract name from .itemText h3 a
    const name = await firstItem.$eval('.itemText h3 a, .itemText .title a', el => el.textContent?.trim() || null).catch(() => null)

    // Extract artist from .itemStates .name
    const artist = await firstItem.$eval('.itemStates .name a, .itemStates .name', el => el.textContent?.trim() || null).catch(() => null)

    // Extract cover image from .itemImg img
    let coverUrl = await firstItem.$eval('.itemImg img', el => el.getAttribute('src') || el.getAttribute('data-src')).catch(() => null)
    if (coverUrl && coverUrl.startsWith('//')) {
      coverUrl = `https:${coverUrl}`
    } else if (coverUrl && !coverUrl.startsWith('http')) {
      coverUrl = `${HMV_WEB_URL}${coverUrl}`
    }

    // Extract link to product page from .itemImg a or h3 a
    let link = await firstItem.$eval('.itemImg a, h3 a', el => el.getAttribute('href')).catch(() => null)
    if (link && !link.startsWith('http')) {
      link = `${HMV_WEB_URL}${link}`
    }

    // Extract price from search results page (HMV shows price in .itemStates .price .right)
    let priceMin: number | null = null
    let priceMax: number | null = null

    const priceText = await firstItem.$eval('.itemStates .price .right', el => el.textContent?.trim() || null).catch(() => null)

    if (priceText) {
      // Parse Japanese price format (e.g., "¥3,300")
      const match = priceText.match(/[\d,]+/)
      if (match) {
        const priceJPY = parseInt(match[0].replace(/,/g, ''), 10)
        if (!isNaN(priceJPY)) {
          const priceUSD = await convertToUSDWithFallback(priceJPY, 'JPY')
          priceMin = priceUSD
          priceMax = priceUSD
        }
      }
    }

    // Fallback: navigate to product page if price not found on search page
    if (priceMin === null && link) {
      try {
        await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 20000 })
        await new Promise(r => setTimeout(r, 2000))

        // Try multiple price selectors - HMV uses .price inside .priceInfoBlock
        const priceText = await page.evaluate(() => {
          // Try specific selectors first (main price)
          const mainPriceSelectors = [
            '.priceInfoBlock.fontLarge .price',
            '.priceInfoBlock:not(.sale) .price',
            '.priceInfoRight .price'
          ]
          for (const sel of mainPriceSelectors) {
            const el = document.querySelector(sel)
            if (el && el.textContent && !el.textContent.includes('OFF')) {
              return el.textContent.trim()
            }
          }
          // Fallback to any .price
          const el = document.querySelector('.price')
          return el?.textContent?.trim() || null
        })

        if (priceText) {
          // Parse Japanese price format (e.g., "¥1,980" or "1,980円")
          const match = priceText.match(/[\d,]+/)
          if (match) {
            const priceJPY = parseInt(match[0].replace(/,/g, ''), 10)
            if (!isNaN(priceJPY)) {
              // Convert JPY to USD
              const priceUSD = await convertToUSDWithFallback(priceJPY, 'JPY')
              priceMin = priceUSD
              priceMax = priceUSD
            }
          }
        }
      } catch (err) {
        console.warn('HMV: failed to get price from product page:', err)
      }
    }

    return {
      platform: 'hmv',
      name,
      artist,
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

export async function queryHmv(catalogNumber: string): Promise<QueryResult> {
  const cookies = getSetting('cookies')?.hmv

  try {
    return await queryHmvWeb(catalogNumber, cookies)
  } catch (err) {
    return queryError('hmv', err instanceof Error ? err.message : 'Unknown error')
  }
}