import { getSetting } from '../settings'
import { browserPool } from '../browser'
import type { QueryResult } from './types'
import { notFound, queryError, parseJPYPrice } from './types'

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

    const bodyText = await page.evaluate(() => document.body.innerText)
    if (
      bodyText.includes('0 results') ||
      bodyText.includes('No results') ||
      bodyText.includes('did not match any products')
    ) {
      return notFound('hmv')
    }

    // li.list alone matches navigation tabs; .clearfix identifies actual products
    const firstItem = await page.$('.resultList > li.list.clearfix, li.list.clearfix')
    if (!firstItem) {
      return notFound('hmv')
    }

    const name = await firstItem.$eval('.itemText h3 a, .itemText .title a', el => el.textContent?.trim() || null).catch(() => null)
    const artist = await firstItem.$eval('.itemStates .name a, .itemStates .name', el => el.textContent?.trim() || null).catch(() => null)

    let coverUrl = await firstItem.$eval('.itemImg img', el => el.getAttribute('src') || el.getAttribute('data-src')).catch(() => null)
    if (coverUrl && coverUrl.startsWith('//')) {
      coverUrl = `https:${coverUrl}`
    } else if (coverUrl && !coverUrl.startsWith('http')) {
      coverUrl = `${HMV_WEB_URL}${coverUrl}`
    }

    let link = await firstItem.$eval('.itemImg a, h3 a', el => el.getAttribute('href')).catch(() => null)
    if (link && !link.startsWith('http')) {
      link = `${HMV_WEB_URL}${link}`
    }

    let priceMin: number | null = null
    let priceMax: number | null = null

    const searchPriceText = await firstItem.$eval('.itemStates .price .right', el => el.textContent?.trim() || null).catch(() => null)
    if (searchPriceText) {
      const priceUSD = await parseJPYPrice(searchPriceText)
      if (priceUSD !== null) {
        priceMin = priceUSD
        priceMax = priceUSD
      }
    }

    // Fallback: navigate to product page if price not found on search page
    if (priceMin === null && link) {
      try {
        await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 20000 })
        await new Promise(r => setTimeout(r, 2000))

        const productPriceText = await page.evaluate(() => {
          const selectors = [
            '.priceInfoBlock.fontLarge .price',
            '.priceInfoBlock:not(.sale) .price',
            '.priceInfoRight .price'
          ]
          for (const sel of selectors) {
            const el = document.querySelector(sel)
            if (el && el.textContent && !el.textContent.includes('OFF')) {
              return el.textContent.trim()
            }
          }
          const el = document.querySelector('.price')
          return el?.textContent?.trim() || null
        })

        if (productPriceText) {
          const priceUSD = await parseJPYPrice(productPriceText)
          if (priceUSD !== null) {
            priceMin = priceUSD
            priceMax = priceUSD
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