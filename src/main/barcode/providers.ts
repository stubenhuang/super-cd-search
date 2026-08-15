import { getSetting } from '../settings'
import { browserPool } from '../browser'
import { acquireCloudflarePage, getCloudflareStatus, isCloudflareChallenge } from '../cloudflare'
import { waitForResultOrNoResult } from '../queries/wait'
import { queryDiscogsByBarcode } from '../queries/discogs'
import { logger } from '../logger'
import type { BarcodeCatalogCandidate } from '../../shared/types'
import type { BarcodeProviderOutcome } from './resolver'

const TOWER_WEB_URL = 'https://tower.jp'
const HMV_WEB_URL = 'https://www.hmv.co.jp'
const YAHOO_SHOPPING_URL = 'https://shopping.yahoo.co.jp'
const SURUGAYA_WEB_URL = 'https://www.suruga-ya.jp'

const CATNO_LABEL_PATTERN = /(?:規格品番|品番|カタログ番号|型番|Catalog\s*(?:No\.?|Number)?)\s*[:：]?\s*/i

function normalizeUrl(base: string, value: string | undefined | null): string | undefined {
  if (!value) return undefined
  if (value.startsWith('//')) return `https:${value}`
  if (value.startsWith('/')) return `${base}${value}`
  return value
}

function extractCatnoFromLabeledText(text: string): string | null {
  const match = text.match(CATNO_LABEL_PATTERN)
  if (!match) return null
  const rest = text.slice((match.index ?? 0) + match[0].length).split(/[\n|｜]/)[0]?.trim() || ''
  if (!rest) return null

  const tokenMatch = rest.match(/[A-Z0-9]{2,10}(?:[\s\-–—/][A-Z0-9]{1,10}){1,4}/)
  if (!tokenMatch) return null

  const token = tokenMatch[0].replace(/\s*[-–—]\s*/g, '-').replace(/\s+/g, '').toUpperCase()
  if (token.length < 4 || token.length > 32) return null
  return token
}

function extractCatnoFromText(text: string): string | null {
  const labeled = extractCatnoFromLabeledText(text)
  if (labeled) return labeled

  // Yahoo/retail titles often embed the catno as e.g. "CD/WPCS-11100".
  const embedded = text.match(/(?:^|[\/\s(（【])[A-Z]{2,6}[-–—]\d{2,6}(?=$|[\/\s)）】]|中古)/)
  if (embedded) {
    return embedded[0].replace(/^[\/\s(（【]+/, '').replace(/[-–—]/g, '-').toUpperCase()
  }
  return null
}

function pageContainsBarcode(text: string, barcode: string): boolean {
  return text.replace(/\D/g, '').includes(barcode)
}

function makeCandidate(
  source: BarcodeCatalogCandidate['source'],
  catalogNumber: string,
  title: string,
  confidence: 'high' | 'low',
  productUrl?: string
): BarcodeCatalogCandidate {
  return { catalogNumber, title: title || catalogNumber, source, productUrl, confidence }
}

// ---------------------------------------------------------------------------
// Discogs
// ---------------------------------------------------------------------------

export async function resolveDiscogsBarcode(barcode: string): Promise<BarcodeProviderOutcome> {
  const lookup = await queryDiscogsByBarcode(barcode)
  if (lookup.status === 'found' && lookup.catalogNumber) {
    return {
      status: 'found',
      candidate: makeCandidate('discogs', lookup.catalogNumber, lookup.title || lookup.catalogNumber, 'high', lookup.result?.link || undefined)
    }
  }
  if (lookup.status === 'no_token') return { status: 'no_token' }
  if (lookup.status === 'not_found') return { status: 'not_found' }
  return { status: 'error', message: lookup.message }
}

// ---------------------------------------------------------------------------
// Tower Records Japan
// ---------------------------------------------------------------------------

async function resolveTowerBarcode(barcode: string): Promise<BarcodeProviderOutcome> {
  const { browser, page } = await browserPool.acquire()
  try {
    const cookies = getSetting('cookies')?.tower
    if (cookies) {
      await page.setCookie({ name: 'tower', value: cookies, domain: '.tower.jp', path: '/' })
    }
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8' })

    const searchUrl = `${TOWER_WEB_URL}/search/item/${encodeURIComponent(barcode)}`
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await waitForResultOrNoResult(page, {
      resultSelector: '.TOL-item-search-result-PC-result-list-display-item',
      timeoutMs: 4000
    })

    const searchCard = await page.evaluate(() => {
      const card = document.querySelector('.TOL-item-search-result-PC-result-list-display-item')
      if (!card) return null
      const titleLink = card.querySelector('.tr-item-block-info-item-name h3 a')
      const title = titleLink?.textContent?.trim()
        || card.querySelector('.tr-item-block-info-item-name h3')?.textContent?.trim()
        || null
      const link = titleLink?.getAttribute('href')
        || card.querySelector('a.tr-item-block')?.getAttribute('href')
        || null
      const infoText = card.querySelector('.TOL-item-search-result-PC-result-display-contents-info')
        ?.textContent?.replace(/<!HS>|<!HE>/g, '') || ''
      return { title, link, infoText }
    })

    if (!searchCard) return { status: 'not_found' }

    let title = searchCard.title || ''
    let productUrl = normalizeUrl(TOWER_WEB_URL, searchCard.link)
    let catno = extractCatnoFromLabeledText(searchCard.infoText)
    let skuText = searchCard.infoText

    // The item page spec table is the authoritative JAN + 規格品番 pair.
    if (productUrl) {
      try {
        await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 20000 })
        await new Promise(resolve => setTimeout(resolve, 1200))
        const detail = await page.evaluate(() => {
          const bodyText = document.body.innerText
          const h1 = document.querySelector('h1')?.textContent?.trim()
            || document.querySelector('[class*="itemName"]')?.textContent?.trim()
            || document.querySelector('[class*="item-name"]')?.textContent?.trim()
            || null
          return { bodyText, title: h1 }
        })
        if (detail.title) title = detail.title
        if (detail.bodyText) {
          const detailCatno = extractCatnoFromLabeledText(detail.bodyText)
          if (detailCatno) catno = detailCatno
          skuText = `${skuText}\n${detail.bodyText}`
        }
      } catch (err) {
        logger.warn('barcode.tower', 'detail page failed, using search card only', { barcode, error: err instanceof Error ? err.message : String(err) })
      }
    }

    if (!catno) return { status: 'not_found' }
    const high = pageContainsBarcode(skuText, barcode)
    return { status: 'found', candidate: makeCandidate('tower', catno, title, high ? 'high' : 'low', productUrl) }
  } finally {
    await browserPool.release(browser, page)
  }
}

// ---------------------------------------------------------------------------
// HMV Japan
// ---------------------------------------------------------------------------

async function resolveHmvBarcode(barcode: string): Promise<BarcodeProviderOutcome> {
  const { browser, page } = await browserPool.acquire()
  try {
    const cookies = getSetting('cookies')?.hmv
    if (cookies) {
      await page.setCookie({ name: 'hmv', value: cookies, domain: '.hmv.co.jp', path: '/' })
    }
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8' })

    const searchUrl = `${HMV_WEB_URL}/en/search/keyword_${encodeURIComponent(barcode)}/target_ALL/type_sr/`
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await waitForResultOrNoResult(page, { resultSelector: '.resultList > li.list.clearfix, li.list.clearfix', timeoutMs: 4000 })

    const firstItem = await page.$('.resultList > li.list.clearfix, li.list.clearfix')
    if (!firstItem) return { status: 'not_found' }

    const searchData = await firstItem.evaluate(item => {
      const titleLink = item.querySelector('.itemText h3 a, .itemText .title a')
      return {
        title: titleLink?.textContent?.trim() || null,
        link: titleLink?.getAttribute('href') || item.querySelector('.itemImg a, h3 a')?.getAttribute('href') || null
      }
    })

    let title = searchData.title || ''
    const productUrl = normalizeUrl(HMV_WEB_URL, searchData.link)
    let catno: string | null = null
    let bodyText = ''

    if (productUrl) {
      try {
        await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 20000 })
        await page.waitForSelector('.productSpec, .itemSpec, .specList, .detailInfo, .product-spec', { timeout: 3000 }).catch(() => null)
        await new Promise(resolve => setTimeout(resolve, 800))
        bodyText = await page.evaluate(() => document.body.innerText)
        const detailTitle = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || null)
        if (detailTitle) title = detailTitle
        catno = extractCatnoFromLabeledText(bodyText)
      } catch (err) {
        logger.warn('barcode.hmv', 'detail page failed, using search card only', { barcode, error: err instanceof Error ? err.message : String(err) })
      }
    }

    if (!catno) catno = extractCatnoFromText(title)

    if (!catno) return { status: 'not_found' }
    const high = pageContainsBarcode(bodyText || title, barcode)
    return { status: 'found', candidate: makeCandidate('hmv', catno, title, high ? 'high' : 'low', productUrl) }
  } finally {
    await browserPool.release(browser, page)
  }
}

// ---------------------------------------------------------------------------
// Yahoo Shopping Japan
// ---------------------------------------------------------------------------

async function resolveYahooBarcode(barcode: string): Promise<BarcodeProviderOutcome> {
  const { browser, page } = await browserPool.acquire()
  try {
    const cookies = getSetting('cookies')?.yahoo
    if (cookies) {
      await page.setCookie({ name: 'yahoo', value: cookies, domain: '.shopping.yahoo.co.jp', path: '/' })
    }
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8' })

    const searchUrl = `${YAHOO_SHOPPING_URL}/search/${encodeURIComponent(barcode)}/0/?first=1&tab_ex=commerce`
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await waitForResultOrNoResult(page, { resultSelector: '.SearchResult_SearchResultItem__mJ7vY', timeoutMs: 4000 })

    const firstItem = await page.$('.SearchResult_SearchResultItem__mJ7vY')
    if (!firstItem) return { status: 'not_found' }

    const extracted = await firstItem.evaluate(item => {
      const anchor = item.querySelector('a')
      const name = anchor?.getAttribute('aria-label')
        || item.querySelector('[class*="Title"], [class*="title"]')?.textContent?.trim()
        || anchor?.textContent?.trim()
        || null
      return { name, link: anchor?.getAttribute('href') || null }
    })

    const bodyText = await page.evaluate(() => document.body.innerText)
    const catno = extractCatnoFromText(`${extracted.name || ''}\n${bodyText}`)
    if (!catno) return { status: 'not_found' }

    const high = pageContainsBarcode(bodyText, barcode)
    return {
      status: 'found',
      candidate: makeCandidate('yahoo', catno, extracted.name || catno, high ? 'high' : 'low', normalizeUrl(YAHOO_SHOPPING_URL, extracted.link))
    }
  } finally {
    await browserPool.release(browser, page)
  }
}

// ---------------------------------------------------------------------------
// Suruga-ya (only after a verified Cloudflare session)
// ---------------------------------------------------------------------------

async function resolveSurugayaBarcode(barcode: string): Promise<BarcodeProviderOutcome> {
  const status = await getCloudflareStatus('surugaya')
  if (status.state !== 'verified') {
    return { status: 'skipped', reason: 'surugaya Cloudflare session not verified' }
  }

  const acquired = await acquireCloudflarePage()
  if (!acquired) {
    return { status: 'skipped', reason: 'surugaya real-Chrome session unavailable' }
  }

  const { page, release } = acquired
  try {
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8' })

    const searchUrl = `${SURUGAYA_WEB_URL}/search?search_word=${encodeURIComponent(barcode)}`
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })

    if (await isCloudflareChallenge(page)) {
      return { status: 'skipped', reason: 'surugaya Cloudflare challenge reappeared' }
    }

    await waitForResultOrNoResult(page, {
      resultSelector: '.item, a[href*="/product/detail/"]',
      noResultSelectors: ['.search_no_result', '.no_result', '[class*="no-result"]'],
      timeoutMs: 4000
    })

    const searchData = await page.evaluate(() => {
      const item = document.querySelector('.item')
      const anchor =
        item?.querySelector<HTMLAnchorElement>('.thum a') ||
        item?.querySelector<HTMLAnchorElement>('a[href*="/product/detail/"]') ||
        document.querySelector<HTMLAnchorElement>('a[href*="/product/detail/"]')
      if (!anchor) return null
      const title = item?.querySelector('.title a')?.textContent?.trim() || anchor.getAttribute('title') || anchor.textContent?.trim() || null
      return { title, link: anchor.getAttribute('href') }
    })

    if (!searchData) return { status: 'not_found' }

    let title = searchData.title || ''
    let bodyText = ''
    let catno: string | null = null
    const productUrl = normalizeUrl(SURUGAYA_WEB_URL, searchData.link)

    if (productUrl) {
      try {
        await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 20000 })
        await new Promise(resolve => setTimeout(resolve, 1000))
        bodyText = await page.evaluate(() => document.body.innerText)
        const detailTitle = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || null)
        if (detailTitle) title = detailTitle
        catno = extractCatnoFromLabeledText(bodyText)
      } catch (err) {
        logger.warn('barcode.surugaya', 'detail page failed', { barcode, error: err instanceof Error ? err.message : String(err) })
      }
    }

    if (!catno) catno = extractCatnoFromText(title)
    if (!catno) return { status: 'not_found' }

    const high = pageContainsBarcode(bodyText || title, barcode)
    return { status: 'found', candidate: makeCandidate('surugaya', catno, title, high ? 'high' : 'low', productUrl) }
  } finally {
    release()
  }
}

export {
  resolveTowerBarcode,
  resolveHmvBarcode,
  resolveYahooBarcode,
  resolveSurugayaBarcode
}
