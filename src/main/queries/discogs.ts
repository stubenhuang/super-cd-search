import { getSetting } from '../settings'
import { throttledFetch } from '../throttle'
import { browserPool } from '../browser'
import type { QueryResult } from './types'
import { notFound, queryError } from './types'

const DISCOGS_API_URL = 'https://api.discogs.com'
const DISCOGS_WEB_URL = 'https://www.discogs.com'

async function queryDiscogsApi(catalogNumber: string, token: string): Promise<QueryResult> {
  const url = `${DISCOGS_API_URL}/database/search?catno=${encodeURIComponent(catalogNumber)}&type=release&token=${token}`

  try {
    const response = await throttledFetch('api.discogs.com', url)

    if (!response.ok) {
      throw new Error(`Discogs API returned ${response.status}`)
    }

    const data = await response.json()
    const results = data.results as Array<{
      title: string
      catno?: string
      year?: string
      cover_image?: string
      uri?: string
      community?: { have: number; want: number }
    }>

    if (!results || results.length === 0) {
      return notFound('discogs')
    }

    // Prioritize exact catalog number match
    const exactMatch = results.find(r =>
      r.catno && r.catno.toUpperCase() === catalogNumber.toUpperCase()
    )
    const first = exactMatch || results[0]
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

    const searchUrl = `${DISCOGS_WEB_URL}/search/?q=&type=release&catno=${encodeURIComponent(catalogNumber)}`
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 })

    // Wait for results to load
    await page.waitForSelector('div[role="listitem"]', { timeout: 10000 }).catch(() => null)

    // Check for no results text
    const bodyText = await page.evaluate(() => document.body.innerText)
    if (bodyText.includes('No results')) {
      return notFound('discogs')
    }

    // Find first result item
    const firstResult = await page.$('div[role="listitem"]')
    if (!firstResult) {
      return notFound('discogs')
    }

    // Extract data using updated selectors for new Discogs layout
    const name = await firstResult.$eval('a[aria-label^="Release:"]', el => el.textContent?.trim() || null).catch(() => null)
    const artist = await firstResult.$eval('a[aria-label^="Artist:"]', el => el.textContent?.trim() || null).catch(() => null)
    const coverUrl = await firstResult.$eval('img', el => el.getAttribute('src')).catch(() => null)
    const link = await firstResult.$eval('a[href*="/release/"]', el => el.getAttribute('href')).catch(() => null)

    // Discogs search results don't show price (that's in marketplace)
    const priceMin: number | null = null
    const priceMax: number | null = null

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
