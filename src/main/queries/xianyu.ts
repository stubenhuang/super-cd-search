import { acquireCloudflarePage } from '../cloudflare'
import { LOGIN_DEFS, checkLoginState } from '../cloudflare/login'
import type { QueryResult } from './types'
import { notFound, queryError, loginRequired, parseCNYPrice } from './types'
import { getCachedQueryResult, cacheQueryResult } from './cache'
import { waitForResultOrNoResult } from './wait'
import { logger } from '../logger'
import { gotoWithAbort, throwIfAborted, withTimeout, isTimeoutError } from '../browser/abort'

const GOOFISH_WEB_URL = 'https://www.goofish.com'

/**
 * Xianyu (goofish.com) text-search channel.
 *
 * Requires a QR-code login in the shared real-Chrome window: without the SSO
 * session the channel reports login-required by design (user opt-in, forced
 * login). The cookies live in the Chrome profile, same as the Cloudflare
 * platforms.
 *
 * goofish.com is a React SPA with frequently-shuffled class names, so the
 * extraction is deliberately defensive: item cards are identified by their
 * item links, and the title/price are read from card text rather than exact
 * selectors. Calibrate against the live DOM when the markup changes.
 */

/** Selectors for the search-result grid; broad on purpose (SPA class churn). */
const RESULT_SELECTORS = [
  'a[href*="/item?id="]',
  'a[href*="goofish.com/item"]'
].join(', ')

const NO_RESULT_SELECTORS = ['[class*="empty"]', '[class*="noResult"]', '[class*="no-result"]']

/** Bound on how long to wait for lazy-loaded card images to hydrate. */
const COVER_HYDRATION_TIMEOUT_MS = 5000

/**
 * Wall-clock ceiling for the whole search (navigation + result wait + cover
 * hydration + extraction). The per-stage limits alone can stack up to ~55s and
 * a wedged SPA navigation can outlast them, so this cap guarantees the shared
 * Chrome page is handed back promptly. Per-channel knob: tune independently of
 * taobao.
 */
const QUERY_TIMEOUT_MS = 90_000
const TIMEOUT_MESSAGE = `闲鱼搜索超过 ${QUERY_TIMEOUT_MS / 1000} 秒未完成，请稍后重试`

interface GoofishCard {
  title: string | null
  priceText: string | null
  cover: string | null
  link: string | null
}

/**
 * Extract listing cards from the search page. Verified against the live DOM
 * (2026-08): each card is an `a[href*="/item?id="]` whose title sits in a
 * `main-title` node and whose price row (`price-wrap`) contains only the
 * sign/integer/decimal spans — the "N人想要" count and the struck original
 * price live outside it, so its plain textContent is already clean.
 * Class-name hashes (e.g. `feeds-item-wrap--rGdH_KoF`) change per build, hence
 * the attribute-contains selectors with a whole-card-text fallback.
 */
export async function extractCards(page: import('puppeteer').Page): Promise<GoofishCard[]> {
  return page.evaluate((selectors) => {
    const seen = new Set<string>()
    const found: Array<{ title: string | null; priceText: string | null; cover: string | null; link: string | null }> = []

    // Lazy-load guard: at first paint a card's `src` holds a placeholder
    // (black LQIP / data URI) and the real CDN URL only sits in `data-src` or
    // `srcset`. A candidate counts as real only when it is a network URL —
    // letting a placeholder through renders as a solid-black cover.
    const isRealImageUrl = (url: string | null | undefined): url is string =>
      !!url && /^(https?:)?\/\//.test(url)

    const readCover = (img: HTMLImageElement | null): string | null => {
      if (!img) return null
      const src = img.getAttribute('src')
      if (isRealImageUrl(src)) return src
      const dataSrc = img.getAttribute('data-src')
      if (isRealImageUrl(dataSrc)) return dataSrc
      for (const candidate of (img.getAttribute('srcset') || '').split(',')) {
        const url = candidate.trim().split(/\s+/)[0]
        if (isRealImageUrl(url)) return url
      }
      return null
    }

    for (const anchor of document.querySelectorAll<HTMLAnchorElement>(selectors)) {
      const href = anchor.getAttribute('href') || anchor.href || ''
      // Deduplicate per listing (each card can contain several nested anchors).
      const itemId = href.match(/item\?id=(\d+)/)?.[1] || href
      if (!itemId || seen.has(itemId)) continue
      seen.add(itemId)

      const titleNode = anchor.querySelector('[class*="main-title"]')
      const priceNode = anchor.querySelector('[class*="price-wrap"]')
      const wholeText = (anchor.textContent || '').replace(/\s+/g, ' ').trim()
      const priceMatch = wholeText.match(/[¥￥]\s*[\d,]+(?:\.\d+)?/)
      const fallbackTitle = priceMatch ? wholeText.slice(0, wholeText.indexOf(priceMatch[0])).trim() : wholeText
      const title = ((titleNode?.textContent || '').replace(/\s+/g, ' ').trim()) || fallbackTitle
      const priceText = (priceNode?.textContent || '').replace(/\s+/g, '') || (priceMatch ? priceMatch[0] : null)
      const img = anchor.querySelector('img')

      found.push({
        title: title || null,
        priceText,
        cover: readCover(img),
        link: href
      })
    }
    return found.slice(0, 10)
  }, RESULT_SELECTORS)
}

/**
 * Card images lazy-load: at first paint `src` holds a placeholder (black LQIP
 * / data URI) and the real CDN URL lands in `src` only after hydration. Bounded
 * wait so extraction sees real URLs; on timeout or navigation extraction
 * proceeds anyway — readCover already prefers data-src/srcset over a
 * placeholder src.
 */
async function waitForCoverHydration(page: import('puppeteer').Page): Promise<void> {
  try {
    await page.waitForFunction(
      (selectors: string) => {
        const img = document.querySelector<HTMLImageElement>(`${selectors} img`)
        return !!img && !/^(data|blob):/i.test(img.getAttribute('src') || '')
      },
      { timeout: COVER_HYDRATION_TIMEOUT_MS, polling: 300 },
      RESULT_SELECTORS
    )
  } catch {
    // Placeholder never resolved — extract whatever the DOM currently has.
  }
}

async function queryXianyuWeb(catalogNumber: string, signal?: AbortSignal): Promise<QueryResult> {
  throwIfAborted(signal)
  // Headless session: the marketplace scrape needs no visible window.
  const acquired = await acquireCloudflarePage('headless')
  if (!acquired) {
    logger.debug('queries.xianyu', 'real-Chrome session unavailable', { catalogNumber })
    return loginRequired('xianyu')
  }

  const { page, release } = acquired
  try {
    // Forced-login channel: verify the SSO session before scraping. Query the
    // platform's own cookieUrl — the shared page may currently sit on another
    // platform's domain.
    const cookies = await page.cookies(LOGIN_DEFS.xianyu.cookieUrl).catch(() => [])
    if (checkLoginState(cookies, LOGIN_DEFS.xianyu) !== 'logged_in') {
      logger.debug('queries.xianyu', 'goofish login missing or expired', { catalogNumber })
      return loginRequired('xianyu')
    }

    await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-CN,zh;q=0.9' })

    const searchUrl = `${GOOFISH_WEB_URL}/search?q=${encodeURIComponent(catalogNumber)}`
    logger.debug('queries.xianyu', 'open search page', { catalogNumber, searchUrl })
    await gotoWithAbort(page, searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }, signal)

    const outcome = await waitForResultOrNoResult(page, {
      resultSelector: RESULT_SELECTORS,
      noResultSelectors: NO_RESULT_SELECTORS,
      timeoutMs: 20000
    })
    logger.debug('queries.xianyu', 'result wait outcome', { catalogNumber, outcome })
    if (outcome === 'result') await waitForCoverHydration(page)

    const cards = await extractCards(page)
    logger.debug('queries.xianyu', 'search extraction done', {
      catalogNumber,
      cardCount: cards.length,
      firstCover: cards[0]?.cover
    })

    const usable = cards.filter(c => c.title || c.priceText)
    if (usable.length === 0) return notFound('xianyu')

    const first = usable[0]
    // Fixed-price channel: only the first listing counts, so the app shows a
    // single stable price instead of a min/max spread across the grid.
    const fixedPrice = first.priceText ? await parseCNYPrice(first.priceText) : null

    let coverUrl = first.cover
    if (coverUrl?.startsWith('//')) coverUrl = `https:${coverUrl}`
    else if (coverUrl?.startsWith('/')) coverUrl = `${GOOFISH_WEB_URL}${coverUrl}`

    let link = first.link
    if (link && link.startsWith('/')) link = `${GOOFISH_WEB_URL}${link}`
    if (!link) link = searchUrl

    return {
      platform: 'xianyu',
      name: first.title,
      artist: null,
      priceMin: fixedPrice,
      priceMax: fixedPrice,
      coverUrl,
      link,
      status: 'found'
    }
  } finally {
    release()
  }
}

export async function queryXianyu(catalogNumber: string, signal?: AbortSignal): Promise<QueryResult> {
  throwIfAborted(signal)
  logger.debug('queries.xianyu', 'query start', { catalogNumber })
  const cached = getCachedQueryResult('xianyu', catalogNumber)
  if (cached) return cached

  let result: QueryResult
  try {
    result = await withTimeout(
      (timeoutSignal) => queryXianyuWeb(catalogNumber, timeoutSignal),
      QUERY_TIMEOUT_MS,
      TIMEOUT_MESSAGE,
      signal
    )
  } catch (err) {
    // A batch cancellation must stay a cancellation; only our own deadline
    // turns into a retryable error result (never cached).
    throwIfAborted(signal)
    if (isTimeoutError(err)) {
      logger.warn('queries.xianyu', 'query timed out', { catalogNumber, timeoutMs: QUERY_TIMEOUT_MS })
      result = queryError('xianyu', TIMEOUT_MESSAGE)
    } else {
      logger.warn('queries.xianyu', 'query failed', { catalogNumber, error: err instanceof Error ? err.message : String(err) })
      result = queryError('xianyu', err instanceof Error ? err.message : 'Unknown error')
    }
  }

  throwIfAborted(signal)
  cacheQueryResult(catalogNumber, result)
  return result
}
