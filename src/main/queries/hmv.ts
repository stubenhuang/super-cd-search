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

    // Find first product item using multiple possible selectors
    const firstItem = await page.$('.liItem, .product-item, .item, .result-item')
    if (!firstItem) {
      return notFound('hmv')
    }

    // Extract name
    const name = await firstItem.$eval('h3, .product-name, .item-name, .title, a', el => el.textContent?.trim() || null).catch(() => null)

    // Extract artist
    const artist = await firstItem.$eval('.artist, .product-artist, .item-artist, .artist-name', el => el.textContent?.trim() || null).catch(() => null)

    // Extract cover image
    let coverUrl = await firstItem.$eval('img', el => el.getAttribute('src') || el.getAttribute('data-src')).catch(() => null)
    if (coverUrl && coverUrl.startsWith('//')) {
      coverUrl = `https:${coverUrl}`
    } else if (coverUrl && !coverUrl.startsWith('http')) {
      coverUrl = `${HMV_WEB_URL}${coverUrl}`
    }

    // Extract link
    let link = await firstItem.$eval('a', el => el.getAttribute('href')).catch(() => null)
    if (link && !link.startsWith('http')) {
      link = `${HMV_WEB_URL}${link}`
    }

    // Navigate to product page to get price
    let priceMin: number | null = null
    let priceMax: number | null = null

    if (link) {
      try {
        await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 20000 })
        await new Promise(r => setTimeout(r, 2000))

        // Try multiple price selectors
        const priceText = await page.evaluate(() => {
          const selectors = [
            '.price',
            '.product-price',
            '.item-price',
            '.price-value',
            '[data-price]',
            '.price-text',
            '.basePrice'
          ]
          for (const sel of selectors) {
            const el = document.querySelector(sel)
            if (el && el.textContent) {
              return el.textContent.trim()
            }
          }
          return null
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