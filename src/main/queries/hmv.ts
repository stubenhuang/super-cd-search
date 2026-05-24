import { getSetting } from '../settings'
import { browserPool } from '../browser'
import type { QueryResult, CDDetails } from './types'
import { notFound, queryError, parseJPYPrice } from './types'
import { tryLLMParse } from '../llm/parser'

const HMV_WEB_URL = 'https://www.hmv.co.jp'

async function getHmvProductDetails(page: import('puppeteer').Page, link: string): Promise<{ price: number | null; details: CDDetails }> {
  const details: CDDetails = { label: null, format: null, country: null, released: null, genre: null }
  let price: number | null = null

  try {
    await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await new Promise(r => setTimeout(r, 2000))

    // Extract price
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
      price = await parseJPYPrice(productPriceText)
    }

    // Extract product details from the page
    const productDetails = await page.evaluate(() => {
      const result: { format?: string; released?: string; label?: string; genre?: string } = {}

      // Look for format/spec information
      const specSection = document.querySelector('.productSpec, .itemSpec, .specList, .detailInfo')
      if (specSection) {
        const rows = specSection.querySelectorAll('tr, li, .specRow, .detailRow')
        for (const row of rows) {
          const text = row.textContent?.trim() || ''
          const label = row.querySelector('th, .label, .specLabel, .detailLabel')?.textContent?.trim() || ''
          const value = row.querySelector('td, .value, .specValue, .detailValue')?.textContent?.trim() || ''

          if (label.includes('Format') || label.includes('形式') || label.includes('フォーマット')) {
            result.format = value || text.replace(/^(Format|形式|フォーマット)[:：]?\s*/i, '').trim()
          } else if (label.includes('Release') || label.includes('発売日') || label.includes('Release Date')) {
            result.released = value || text.replace(/^(Release|発売日|Release Date)[:：]?\s*/i, '').trim()
          } else if (label.includes('Label') || label.includes('レーベル') || label.includes('Label Name')) {
            result.label = value || text.replace(/^(Label|レーベル|Label Name)[:：]?\s*/i, '').trim()
          } else if (label.includes('Genre') || label.includes('ジャンル')) {
            result.genre = value || text.replace(/^(Genre|ジャンル)[:：]?\s*/i, '').trim()
          }
        }
      }

      // Try alternative selectors for product info
      if (!result.format) {
        const formatEl = document.querySelector('[class*="format"], [class*="spec"]')
        if (formatEl) {
          const text = formatEl.textContent?.trim() || ''
          if (text.includes('CD') || text.includes('SACD') || text.includes('DVD')) {
            result.format = text
          }
        }
      }

      // Look for release date in common patterns
      if (!result.released) {
        const datePatterns = [
          /\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}/,  // 2024/01/15 or 2024-01-15
          /\d{4}年\d{1,2}月\d{1,2}日/,            // 2024年1月15日
          /\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4}/,  // 01/15/2024
        ]
        const bodyText = document.body.innerText
        for (const pattern of datePatterns) {
          const match = bodyText.match(pattern)
          if (match) {
            result.released = match[0]
            break
          }
        }
      }

      // Look for genre/category
      if (!result.genre) {
        const breadcrumb = document.querySelector('.breadcrumb, .categoryPath, .genrePath')
        if (breadcrumb) {
          const items = breadcrumb.querySelectorAll('a, span')
          const genres = Array.from(items).map(el => el.textContent?.trim()).filter(Boolean).slice(-2)
          if (genres.length > 0) {
            result.genre = genres.join(' / ')
          }
        }
      }

      return result
    })

    if (productDetails.format) details.format = productDetails.format
    if (productDetails.released) details.released = productDetails.released
    if (productDetails.label) details.label = productDetails.label
    if (productDetails.genre) details.genre = productDetails.genre

    // HMV is Japan-based
    details.country = 'Japan'

  } catch (err) {
    console.warn('HMV: failed to get details from product page:', err)
  }

  return { price, details }
}

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

    // Try LLM parsing first
    const html = await page.content()
    const llmResult = await tryLLMParse('hmv', catalogNumber, html)
    if (llmResult) return llmResult

    let priceMin: number | null = null
    let priceMax: number | null = null
    let details: CDDetails | undefined

    const searchPriceText = await firstItem.$eval('.itemStates .price .right', el => el.textContent?.trim() || null).catch(() => null)
    if (searchPriceText) {
      const priceUSD = await parseJPYPrice(searchPriceText)
      if (priceUSD !== null) {
        priceMin = priceUSD
        priceMax = priceUSD
      }
    }

    // Navigate to product page for price (if not found) and details
    if (link) {
      const productData = await getHmvProductDetails(page, link)
      if (priceMin === null && productData.price !== null) {
        priceMin = productData.price
        priceMax = productData.price
      }
      if (productData.details.label || productData.details.format ||
          productData.details.released || productData.details.genre) {
        details = productData.details
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
      status: 'found',
      details
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