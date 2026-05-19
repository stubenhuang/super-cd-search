import { getSetting } from '../settings'
import { throttledFetch } from '../throttle'
import { browserPool } from '../browser'
import { convertToUSDWithFallback, type Currency } from '../currency'
import type { QueryResult } from './types'
import { notFound, queryError } from './types'
import { type Page, type ElementHandle } from 'puppeteer'

const EBAY_API_URL = 'https://api.ebay.com'
const EBAY_WEB_URL = 'https://www.ebay.com'

// Alternative eBay domains to try if main domain blocks
const EBAY_ALT_DOMAINS = [
  'https://www.ebay.co.uk',
  'https://www.ebay.de',
  'https://www.ebay.ca'
]

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

  // Convert prices to USD
  const pricePromises = items
    .filter(i => i.price && parseFloat(i.price.value) > 0)
    .map(async i => {
      const amount = parseFloat(i.price!.value)
      const currency = i.price!.currency as Currency
      return await convertToUSDWithFallback(amount, currency)
    })

  const prices = await Promise.all(pricePromises)

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

// Mimic human-like mouse movements
async function humanMouseMove(page: Page, targetX: number, targetY: number): Promise<void> {
  const viewport = page.viewport()
  if (!viewport) return

  const startX = Math.random() * viewport.width
  const startY = Math.random() * viewport.height

  // Create a curved path with multiple steps
  const steps = 10 + Math.floor(Math.random() * 10)
  for (let i = 0; i <= steps; i++) {
    const progress = i / steps
    const curveProgress = Math.sin(progress * Math.PI / 2) // Ease-out curve
    const x = startX + (targetX - startX) * curveProgress + (Math.random() - 0.5) * 20
    const y = startY + (targetY - startY) * curveProgress + (Math.random() - 0.5) * 20
    await page.mouse.move(x, y)
    await new Promise(r => setTimeout(r, 20 + Math.random() * 30))
  }
}

// Random scroll to mimic reading behavior
async function humanScroll(page: Page): Promise<void> {
  const scrollAmount = 100 + Math.floor(Math.random() * 200)
  await page.evaluate((amount: number) => {
    window.scrollBy(0, amount)
  }, scrollAmount)
  await new Promise(r => setTimeout(r, 500 + Math.random() * 1000))
}

// Check if page is blocked
async function isPageBlocked(page: Page): Promise<boolean> {
  const bodyText = await page.evaluate(() => document.body.innerText)
  return bodyText.includes('Access Denied') ||
         bodyText.includes('Checking your browser') ||
         bodyText.includes('Just a moment') ||
         bodyText.includes('blocked') ||
         bodyText.includes('captcha')
}

// Accept cookie consent banners
async function acceptCookies(page: Page): Promise<void> {
  const consentSelectors = [
    '#gdpr-banner-accept',
    '.gdpr-banner .accept',
    'button[data-testid="uc-accept-all"]',
    '[id*="accept-all"]',
    '[class*="accept-all"]',
    'button[title*="Accept"]',
    '[id*="consent"] button',
    '#onetrust-accept-btn-handler',
    '.cc-accept',
    '.cookie-accept'
  ]

  for (const selector of consentSelectors) {
    const btn = await page.$(selector)
    if (btn) {
      try {
        await btn.click()
        await new Promise(r => setTimeout(r, 1000))
        return
      } catch {}
    }
  }
}

async function queryEbayDomain(page: Page, domain: string, catalogNumber: string): Promise<{ success: boolean; result?: QueryResult }> {
  try {
    console.log(`eBay: trying domain ${domain}`)

    // Navigate to homepage first to establish session
    await page.goto(domain, { waitUntil: 'networkidle2', timeout: 30000 })

    // Check if blocked on homepage
    if (await isPageBlocked(page)) {
      console.warn(`eBay: ${domain} blocked on homepage`)
      return { success: false }
    }

    // Accept cookies if present
    await acceptCookies(page)

    // Random delay mimicking human reading
    await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000))

    // Do some random scrolling on homepage
    await humanScroll(page)
    await new Promise(r => setTimeout(r, 500 + Math.random() * 1000))

    // Use direct URL navigation (more reliable than search box interaction)
    const searchUrl = `${domain}/sch/i.html?_nkw=${encodeURIComponent(catalogNumber)}`
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 45000 })

    // Wait for results
    await new Promise(r => setTimeout(r, 3000 + Math.random() * 2000))

    // Check if blocked
    if (await isPageBlocked(page)) {
      console.warn(`eBay: ${domain} blocked on search results`)
      return { success: false }
    }

    // Check for no results
    const noResults = await page.$('.srp-rail__no-results, .srp-no-results')
    if (noResults) {
      return { success: true, result: notFound('ebay') }
    }

    // Scroll down to load results
    await humanScroll(page)
    await new Promise(r => setTimeout(r, 1000))

    // Try to find items
    const itemSelectors = [
      '.srp-results .s-item',
      'li.s-item',
      '.s-item',
      '.brw-river-item',
      '[data-listing-id]',
      'li[class*="item"]:not([class*="gh-"])'
    ]

    let firstItem: ElementHandle<Element> | null = null
    for (const selector of itemSelectors) {
      const items = await page.$$(selector)
      if (items.length > 0) {
        firstItem = items[0]
        console.log(`eBay: found ${items.length} items with selector: ${selector}`)
        break
      }
    }

    if (!firstItem) {
      // Try to find any item link
      const itemLink = await page.$('a[href*="/itm/"]')
      if (itemLink) {
        const handle = await itemLink.evaluateHandle((el: Element) => {
          let parent = el.parentElement
          for (let i = 0; i < 5 && parent; i++) {
            if (parent.tagName === 'LI') return parent
            parent = parent.parentElement
          }
          return el.parentElement?.parentElement?.parentElement
        })
        // Cast the JSHandle to ElementHandle
        firstItem = handle as ElementHandle<Element>
        console.log('eBay: found item via link traversal')
      }
    }

    if (!firstItem) {
      console.warn('eBay: no items found on page')
      return { success: true, result: notFound('ebay') }
    }

    // Extract title
    const name = await firstItem.$eval('.s-item__title, h3, [class*="title"]', (el: Element) => el.textContent?.trim() || null).catch(() => null)

    // Extract image
    const coverUrl = await firstItem.$eval('img', (el: Element) => el.getAttribute('src') || el.getAttribute('data-src')).catch(() => null)

    // Extract link
    const link = await firstItem.$eval('a[href*="/itm/"], a', (el: Element) => el.getAttribute('href')).catch(() => null)

    // Extract price
    const priceText = await firstItem.$eval('.s-item__price, [class*="price"]', (el: Element) => el.textContent?.trim() || '').catch(() => '')
    let priceMin: number | null = null
    let priceMax: number | null = null

    if (priceText) {
      // Detect currency from symbol
      let currency: Currency = 'USD'
      if (priceText.includes('€')) currency = 'EUR'
      else if (priceText.includes('£')) currency = 'GBP'
      else if (priceText.includes('¥')) currency = 'JPY'

      const prices = priceText.match(/[\$€£¥][\d,.]+/g)
      if (prices) {
        const nums = prices.map(p => parseFloat(p.replace(/[^0-9.]/g, ''))).filter(n => n > 0)
        if (nums.length > 0) {
          const minJPY = Math.min(...nums)
          const maxJPY = Math.max(...nums)
          priceMin = await convertToUSDWithFallback(minJPY, currency)
          priceMax = await convertToUSDWithFallback(maxJPY, currency)
        }
      }
    }

    return {
      success: true,
      result: {
        platform: 'ebay',
        name,
        artist: null,
        priceMin,
        priceMax,
        coverUrl,
        link,
        status: 'found'
      }
    }
  } catch (err) {
    console.warn(`eBay: ${domain} error:`, err)
    return { success: false }
  }
}

async function queryEbayWeb(catalogNumber: string, cookies?: string): Promise<QueryResult> {
  const { browser, page } = await browserPool.acquire()

  try {
    // Platform-specific headers for realistic browser fingerprint
    const platform = process.platform === 'win32' ? 'Windows' : 'macOS'
    const userAgent = process.platform === 'win32'
      ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

    // Set realistic headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br, zstd',
      'Cache-Control': 'max-age=0',
      'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': `"${platform}"`,
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'User-Agent': userAgent
    })

    if (cookies) {
      await page.setCookie({
        name: 'ebay',
        value: cookies,
        domain: '.ebay.com',
        path: '/'
      })
    }

    // Try main domain first
    let result = await queryEbayDomain(page, EBAY_WEB_URL, catalogNumber)

    // If blocked, try alternative domains
    if (!result.success) {
      for (const altDomain of EBAY_ALT_DOMAINS) {
        result = await queryEbayDomain(page, altDomain, catalogNumber)
        if (result.success) break
      }
    }

    return result.result || notFound('ebay')
  } finally {
    await browserPool.release(browser, page)
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
