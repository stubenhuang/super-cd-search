import { writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ElementHandle, Page } from 'puppeteer'
import { acquireCloudflarePage } from '../cloudflare'
import { LOGIN_DEFS, checkLoginState } from '../cloudflare/login'
import type { QueryResult } from './types'
import { notFound, queryError, loginRequired, parseCNYPrice } from './types'
import { getCachedQueryResult, cacheQueryResult } from './cache'
import { waitForResultOrNoResult } from './wait'
import { logger } from '../logger'
import { gotoWithAbort, throwIfAborted, abortableDelay } from '../browser/abort'

/**
 * Taobao image-search (web Pailitao) channel.
 *
 * Requires a QR-code login in the shared real-Chrome window; the SSO cookies
 * live in the Chrome profile like every other real-Chrome channel. The desktop
 * web image search takes a picture upload and returns visually-similar
 * marketplace listings — used to price CDs by their cover art.
 *
 * Live-calibrated flow (2026-08, against the real page):
 *   1. open taobao.com and WAIT for hydration — the hidden upload input only
 *      exists after the React app mounts (~1.5s), never at domcontentloaded;
 *   2. feed the cover to `#image-search-custom-file-input` — the 按图片搜索
 *      overlay opens with a local base64 preview;
 *   3. poll `#image-search-upload-button` until it reads 搜索. While the
 *      server-side upload is pending or failed it reads 上传图片, and clicking
 *      it is a no-op — re-feed the file and keep waiting;
 *   4. clicking 搜索 opens the results in a NEW TAB (s.taobao.com/search?…
 *      localImgKey=…), the shared page itself never navigates;
 *   5. scrape the result grid there, then close the tab.
 */

const TAOBAO_HOME = 'https://www.taobao.com/'

/**
 * Taobao's homepage ships a stable hidden file input for image search
 * (#image-search-custom-file-input, verified against the live DOM 2026-08);
 * it sits inside the search box's image-search panel and works without any
 * interaction. The generic fallbacks cover older/other page variants.
 */
const FILE_INPUT_SELECTORS = [
  '#image-search-custom-file-input',
  'input[type="file"][accept*="image"]',
  'input[type="file"]'
]

const CAMERA_ENTRY_SELECTORS = [
  '[class*="image-search-icon"]',
  '[class*="search-suggest-image-search"]',
  '[class*="camera"]',
  '[class*="imgSearch"]',
  '[class*="image-search"]'
]

/** The overlay's submit button; text 搜索 = server upload done, 上传图片 = not. */
const SEARCH_BUTTON_SELECTOR = '#image-search-upload-button'

/**
 * The result tab's URL carries the uploaded-image key (or an imgsearch spm);
 * the homepage's preloaded search tab (q=…) must not match.
 */
const IMAGE_SEARCH_RESULT_URL = /s\.taobao\.com\/search.*(localImgKey=|imgsearch|image_search)/i

/** How long to wait for the homepage React app to mount the upload input. */
const FILE_INPUT_TIMEOUT_MS = 15000

/** Poll cadence/limits for the 搜索 button and the result-tab appearance. */
const BUTTON_POLL_MS = 1000
const BUTTON_POLLS_PER_ATTEMPT = 8
const UPLOAD_ATTEMPTS = 3
const RESULT_TAB_TIMEOUT_MS = 30000

/** Image-search result cards link to item detail pages. */
const RESULT_SELECTORS = [
  'a[href*="item.htm?id="]',
  'a[href*="//item.taobao.com/item"]',
  'a[href*="detail.tmall.com/item"]'
].join(', ')

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
}

interface TaobaoCard {
  title: string | null
  priceText: string | null
  cover: string | null
  link: string | null
}

/**
 * Extract listing cards from the image-search result grid. Verified against
 * the live DOM (2026-08): each card IS an `a[href*="item.htm?id="]` whose
 * title sits in a `title--` node and whose price is split across `priceInt--`
 * (yuan) and `priceFloat--` (decimals) nodes beside a `realSales--` "N人付款"
 * count. Reading the structured nodes matters: the flattened card text
 * concatenates price and pay-count ("¥251" + "3人付款" → "¥2513"), so a text
 * regex alone misreads most prices. Hashed class suffixes change per build,
 * hence the attribute-contains selectors plus a whole-card-text fallback.
 */
export async function extractCards(page: Page): Promise<TaobaoCard[]> {
  return page.evaluate((selectors) => {
    const seen = new Set<string>()
    const found: Array<{ title: string | null; priceText: string | null; cover: string | null; link: string | null }> = []

    for (const anchor of document.querySelectorAll<HTMLAnchorElement>(selectors)) {
      const href = anchor.getAttribute('href') || anchor.href || ''
      const itemId = href.match(/id=(\d+)/)?.[1] || href
      if (!itemId || seen.has(itemId)) continue
      seen.add(itemId)

      const titleNode = anchor.querySelector('[class*="title"]')
      const intNode = anchor.querySelector('[class*="priceInt"]')
      const floatNode = anchor.querySelector('[class*="priceFloat"]')
      const wholeText = (anchor.textContent || '').replace(/\s+/g, ' ').trim()
      // Without a title node, everything before the first price-looking
      // fragment is the best title approximation (old card layouts).
      const flatPrice = wholeText.match(/[¥￥]\s*[\d,]+(?:\.\d+)?/)
      const fallbackTitle = flatPrice ? wholeText.slice(0, wholeText.indexOf(flatPrice[0])).trim() : wholeText
      const structuredPrice = intNode
        ? `¥${(intNode.textContent || '').trim()}${(floatNode?.textContent || '').trim()}`
        : null
      const img = anchor.querySelector('img')

      found.push({
        title: ((titleNode?.textContent || '').replace(/\s+/g, ' ').trim()) || fallbackTitle || null,
        priceText: structuredPrice || flatPrice?.[0] || null,
        cover: img?.getAttribute('src') || img?.getAttribute('data-src') || null,
        link: href
      })
    }
    return found.slice(0, 10)
  }, RESULT_SELECTORS)
}

/**
 * Wait for the homepage React app to mount the hidden upload input (it does
 * not exist at domcontentloaded). If hydration is unusually slow, try clicking
 * a camera entry to force the image-search panel open, then look again.
 */
async function waitForFileInput(page: Page): Promise<ElementHandle<HTMLInputElement> | null> {
  try {
    const input = await page.waitForSelector(FILE_INPUT_SELECTORS[0], { timeout: FILE_INPUT_TIMEOUT_MS })
    if (input) return input as ElementHandle<HTMLInputElement>
  } catch {
    // Input still absent — fall through to the camera-entry path.
  }

  for (const selector of CAMERA_ENTRY_SELECTORS) {
    const entry = await page.$(selector)
    if (!entry) continue
    await entry.click().catch(() => {})
    await new Promise((r) => setTimeout(r, 800))
    for (const inputSelector of FILE_INPUT_SELECTORS) {
      const input = (await page.$(inputSelector)) as ElementHandle<HTMLInputElement> | null
      if (input) return input
    }
  }
  return null
}

/**
 * Kick off the image search: poll the overlay button until it reads 搜索
 * (server-side upload finished) and click it. While it reads anything else
 * the uploader has dropped the file — re-feed it and keep waiting. Returns
 * false when the button never became ready.
 */
async function startImageSearch(
  page: Page,
  input: ElementHandle<HTMLInputElement>,
  tempPath: string,
  signal?: AbortSignal
): Promise<boolean> {
  for (let attempt = 0; attempt < UPLOAD_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      logger.debug('queries.taobao', 'server upload not ready, re-feeding image', { attempt })
      await input.uploadFile(tempPath).catch(() => {})
    }
    for (let poll = 0; poll < BUTTON_POLLS_PER_ATTEMPT; poll++) {
      await abortableDelay(BUTTON_POLL_MS, signal)
      const ready = await page.evaluate(() => {
        const btn = document.querySelector('#image-search-upload-button')
        return btn ? (btn.textContent || '').trim() === '搜索' : false
      }).catch(() => false)
      if (ready) {
        const button = await page.$(SEARCH_BUTTON_SELECTOR)
        if (button) {
          await button.click().catch(() => {})
          logger.debug('queries.taobao', 'search button clicked', { attempt, poll })
          return true
        }
      }
    }
  }
  return false
}

/**
 * The 搜索 click opens the results in a new tab while the shared page stays on
 * the homepage. Wait for either that tab (matched by its image-search URL, not
 * by opener — the association is unreliable over CDP) or an in-place
 * navigation of the shared page, whichever happens first.
 */
async function waitForResultPage(page: Page, signal?: AbortSignal): Promise<Page | null> {
  let settled = false

  const popupPromise = page
    .browser()
    .waitForTarget(target => IMAGE_SEARCH_RESULT_URL.test(target.url()), { timeout: RESULT_TAB_TIMEOUT_MS })
    .then(async (target) => {
      settled = true
      return (await target.page()) ?? null
    })
    .catch(() => null)

  const sameTabPromise = (async () => {
    const deadline = Date.now() + RESULT_TAB_TIMEOUT_MS
    while (!settled && Date.now() < deadline) {
      await abortableDelay(500, signal)
      if (IMAGE_SEARCH_RESULT_URL.test(page.url())) {
        settled = true
        return page
      }
    }
    return null
  })().catch(() => null)

  return Promise.race([popupPromise, sameTabPromise])
}

export async function queryTaobaoImage(
  catalogNumber: string,
  image: { buffer: Buffer; mimeType: string },
  signal?: AbortSignal
): Promise<QueryResult> {
  throwIfAborted(signal)
  logger.debug('queries.taobao', 'query start', { catalogNumber, mimeType: image.mimeType, bytes: image.buffer.length })
  const cached = getCachedQueryResult('taobao', catalogNumber)
  if (cached) return cached

  const result = await queryTaobaoImageWeb(catalogNumber, image, signal)
  throwIfAborted(signal)
  cacheQueryResult(catalogNumber, result)
  return result
}

async function queryTaobaoImageWeb(
  catalogNumber: string,
  image: { buffer: Buffer; mimeType: string },
  signal?: AbortSignal
): Promise<QueryResult> {
  throwIfAborted(signal)
  // Headless session: the marketplace scrape needs no visible window.
  const acquired = await acquireCloudflarePage('headless')
  if (!acquired) {
    logger.debug('queries.taobao', 'real-Chrome session unavailable', { catalogNumber })
    return loginRequired('taobao')
  }

  const { page, release } = acquired
  const extension = EXT_BY_MIME[image.mimeType] ?? 'jpg'
  const tempPath = join(tmpdir(), `super-cd-search-upload-${Date.now()}.${extension}`)
  let resultPage: Page | null = null

  try {
    await writeFile(tempPath, image.buffer)

    // Forced-login channel: verify the SSO session before scraping. Query the
    // platform's own cookieUrl — the shared page may currently sit on another
    // platform's domain.
    const cookies = await page.cookies(LOGIN_DEFS.taobao.cookieUrl).catch(() => [])
    if (checkLoginState(cookies, LOGIN_DEFS.taobao) !== 'logged_in') {
      logger.debug('queries.taobao', 'taobao login missing or expired', { catalogNumber })
      return loginRequired('taobao')
    }

    await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-CN,zh;q=0.9' })

    logger.debug('queries.taobao', 'open taobao home', { catalogNumber })
    await gotoWithAbort(page, TAOBAO_HOME, { waitUntil: 'domcontentloaded', timeout: 30000 }, signal)

    const input = await waitForFileInput(page)
    if (!input) {
      logger.warn('queries.taobao', 'image upload input not found', { catalogNumber })
      return queryError('taobao', '未找到图片上传入口，淘宝页面可能已改版')
    }

    await input.uploadFile(tempPath)
    logger.debug('queries.taobao', 'image uploaded', { catalogNumber, path: tempPath })

    if (!await startImageSearch(page, input, tempPath, signal)) {
      logger.warn('queries.taobao', 'image search never became ready', { catalogNumber })
      return queryError('taobao', '淘宝图搜上传未完成，请稍后重试')
    }

    resultPage = await waitForResultPage(page, signal)
    if (!resultPage) {
      logger.warn('queries.taobao', 'result tab never opened', { catalogNumber })
      return queryError('taobao', '淘宝图搜结果页未打开，可能触发了风控验证，请重试')
    }

    // Upload + server-side matching is slow; give it a generous window. No
    // no-result markers here: the live result page's loading skeleton trips
    // loose [class*="empty"] selectors long before the grid renders.
    const outcome = await waitForResultOrNoResult(resultPage, {
      resultSelector: RESULT_SELECTORS,
      timeoutMs: 25000
    })
    logger.debug('queries.taobao', 'result wait outcome', { catalogNumber, outcome, url: resultPage.url() })

    const cards = await extractCards(resultPage)
    logger.debug('queries.taobao', 'search extraction done', { catalogNumber, cardCount: cards.length })

    const usable = cards.filter(c => c.title || c.priceText)
    if (usable.length === 0) {
      // A risk-control intercept redirects to a punish page instead of the grid.
      const punished = /punish/.test(resultPage.url())
      return punished
        ? queryError('taobao', '淘宝弹出滑块验证，请在浏览器窗口中手动完成后重试')
        : notFound('taobao')
    }

    const first = usable[0]
    // Fixed-price channel: only the first listing counts, so the app shows a
    // single stable price instead of a min/max spread across the grid.
    const fixedPrice = first.priceText ? await parseCNYPrice(first.priceText) : null

    let link = first.link
    if (link && link.startsWith('//')) link = `https:${link}`
    if (!link) link = resultPage.url()
    let coverUrl = first.cover
    if (coverUrl?.startsWith('//')) coverUrl = `https:${coverUrl}`

    return {
      platform: 'taobao',
      name: first.title,
      artist: null,
      priceMin: fixedPrice,
      priceMax: fixedPrice,
      coverUrl: coverUrl ?? null,
      link,
      status: 'found'
    }
  } catch (err) {
    throwIfAborted(signal)
    logger.warn('queries.taobao', 'query failed', { catalogNumber, error: err instanceof Error ? err.message : String(err) })
    return queryError('taobao', err instanceof Error ? err.message : 'Unknown error')
  } finally {
    if (resultPage && resultPage !== page) {
      await resultPage.close().catch(() => {})
    }
    release()
    await rm(tempPath, { force: true }).catch(() => {})
  }
}
