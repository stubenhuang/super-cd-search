import { getSetting } from '../settings'
import { throttledFetch } from '../throttle'
import { browserPool } from '../browser'
import type { QueryResult } from './types'
import { notFound, queryError } from './types'

const EBAY_API_URL = 'https://api.ebay.com'
const EBAY_WEB_URL = 'https://www.ebay.com'

let accessToken: string | null = null
let tokenExpiry: number = 0

async function getEbayAccessToken(): Promise<string | null> {
  if (accessToken && Date.now() < tokenExpiry) {
    return accessToken
  }

  const clientId = getSetting('ebayClientId')
  const clientSecret = getSetting('ebayClientSecret')

  if (!clientId || !clientSecret) {
    return null
  }

  try {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    const response = await throttledFetch('api.ebay.com', `${EBAY_API_URL}/identity/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope'
    })

    if (!response.ok) {
      return null
    }

    const data = await response.json()
    accessToken = data.access_token
    tokenExpiry = Date.now() + (data.expires_in - 60) * 1000
    return accessToken
  } catch {
    return null
  }
}

async function queryEbayApi(catalogNumber: string): Promise<QueryResult> {
  const token = await getEbayAccessToken()
  if (!token) {
    throw new Error('No eBay API credentials')
  }

  const url = `${EBAY_API_URL}/buy/browse/v1/item_summary/search?q=${encodeURIComponent(catalogNumber)}&limit=5`

  const response = await throttledFetch('api.ebay.com', url, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })

  if (!response.ok) {
    throw new Error(`eBay API returned ${response.status}`)
  }

  const data = await response.json()
  const items = data.itemSummaries as Array<{
    title: string
    price?: { value: string; currency: string }
    image?: { imageUrl: string }
    itemWebUrl?: string
  }> | undefined

  if (!items || items.length === 0) {
    return notFound('ebay')
  }

  const first = items[0]
  const prices = items
    .map(i => parseFloat(i.price?.value || '0'))
    .filter(p => p > 0)

  return {
    platform: 'ebay',
    name: first.title,
    artist: null,
    priceMin: prices.length > 0 ? Math.min(...prices) : null,
    priceMax: prices.length > 0 ? Math.max(...prices) : null,
    coverUrl: first.image?.imageUrl || null,
    link: first.itemWebUrl || null,
    status: 'found'
  }
}

async function queryEbayWeb(catalogNumber: string, cookies?: string): Promise<QueryResult> {
  const { browser, page } = await browserPool.acquire()

  try {
    if (cookies) {
      await page.setCookie({
        name: 'ebay',
        value: cookies,
        domain: '.ebay.com',
        path: '/'
      })
    }

    const searchUrl = `${EBAY_WEB_URL}/sch/i.html?_nkw=${encodeURIComponent(catalogNumber)}`
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 })

    const noResults = await page.$('.srp-rail__no-results')
    if (noResults) {
      return notFound('ebay')
    }

    const firstItem = await page.$('.srp-results .s-item')
    if (!firstItem) {
      return notFound('ebay')
    }

    const name = await firstItem.$eval('.s-item__title', el => el.textContent?.trim() || null).catch(() => null)
    const coverUrl = await firstItem.$eval('.s-item__image-img', el => el.getAttribute('src')).catch(() => null)
    const link = await firstItem.$eval('.s-item__link', el => el.getAttribute('href')).catch(() => null)

    const priceText = await firstItem.$eval('.s-item__price', el => el.textContent?.trim() || null).catch(() => null)
    let priceMin: number | null = null
    let priceMax: number | null = null

    if (priceText) {
      const priceMatch = priceText.match(/[\$€£¥]([\d,.]+)/)
      if (priceMatch) {
        const price = parseFloat(priceMatch[1].replace(/,/g, ''))
        priceMin = price
        priceMax = price
      }
    }

    return {
      platform: 'ebay',
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

export async function queryEbay(catalogNumber: string): Promise<QueryResult> {
  const cookies = getSetting('cookies')?.ebay

  try {
    return await queryEbayApi(catalogNumber)
  } catch (err) {
    console.warn('eBay API failed, falling back to web scraping:', err)
  }

  try {
    return await queryEbayWeb(catalogNumber, cookies)
  } catch (err) {
    return queryError('ebay', err instanceof Error ? err.message : 'Unknown error')
  }
}
