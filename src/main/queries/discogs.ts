import { getSetting } from '../settings'
import { throttledFetch } from '../throttle'
import { browserPool } from '../browser'
import type { QueryResult } from './types'
import { notFound, queryError } from './types'

const DISCOGS_API_URL = 'https://api.discogs.com'
const DISCOGS_WEB_URL = 'https://www.discogs.com'

async function queryDiscogsApi(catalogNumber: string, token: string): Promise<QueryResult> {
  const url = `${DISCOGS_API_URL}/database/search?q=${encodeURIComponent(catalogNumber)}&type=release&token=${token}`

  try {
    const response = await throttledFetch('api.discogs.com', url)

    if (!response.ok) {
      throw new Error(`Discogs API returned ${response.status}`)
    }

    const data = await response.json()
    const results = data.results as Array<{
      title: string
      year?: string
      cover_image?: string
      uri?: string
      community?: { have: number; want: number }
    }>

    if (!results || results.length === 0) {
      return notFound('discogs')
    }

    const first = results[0]
    const titleParts = first.title.split(' - ')
    const artist = titleParts[0] || null
    const name = titleParts.slice(1).join(' - ') || first.title

    return {
      platform: 'discogs',
      name,
      artist,
      priceMin: null,
      priceMax: null,
      coverUrl: first.cover_image || null,
      link: first.uri ? `${DISCOGS_WEB_URL}${first.uri}` : null,
      status: 'found'
    }
  } catch (err) {
    throw err
  }
}

async function queryDiscogsWeb(catalogNumber: string, cookies?: string): Promise<QueryResult> {
  const { browser, page } = await browserPool.acquire()

  try {
    if (cookies) {
      await page.setCookie({
        name: 'discogs_dot_com',
        value: cookies,
        domain: '.discogs.com',
        path: '/'
      })
    }

    const searchUrl = `${DISCOGS_WEB_URL}/search/?q=${encodeURIComponent(catalogNumber)}&type=release`
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 })

    const noResults = await page.$('.no-results')
    if (noResults) {
      return notFound('discogs')
    }

    const firstResult = await page.$('#search_results .card')
    if (!firstResult) {
      return notFound('discogs')
    }

    const name = await firstResult.$eval('.card_title a', el => el.textContent?.trim() || null).catch(() => null)
    const artist = await firstResult.$eval('.card_artist a', el => el.textContent?.trim() || null).catch(() => null)
    const coverUrl = await firstResult.$eval('.card_image img', el => el.getAttribute('src')).catch(() => null)
    const link = await firstResult.$eval('.card_title a', el => el.getAttribute('href')).catch(() => null)

    const priceText = await firstResult.$eval('.card_price', el => el.textContent?.trim() || null).catch(() => null)
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
      platform: 'discogs',
      name,
      artist,
      priceMin,
      priceMax,
      coverUrl,
      link: link ? `${DISCOGS_WEB_URL}${link}` : null,
      status: 'found'
    }
  } finally {
    await browserPool.release(browser)
  }
}

export async function queryDiscogs(catalogNumber: string): Promise<QueryResult> {
  const token = getSetting('discogsToken')
  const cookies = getSetting('cookies')?.discogs

  if (token) {
    try {
      return await queryDiscogsApi(catalogNumber, token)
    } catch (err) {
      console.warn('Discogs API failed, falling back to web scraping:', err)
    }
  }

  try {
    return await queryDiscogsWeb(catalogNumber, cookies)
  } catch (err) {
    return queryError('discogs', err instanceof Error ? err.message : 'Unknown error')
  }
}
