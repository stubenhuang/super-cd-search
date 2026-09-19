import { app } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElementHandle, Page } from 'puppeteer'
import {
  acquirePublishPage,
  isPublishProfileRunning,
  parkPublishWindow,
  peekPublishProfileLogin,
  publishProfileId,
  readXianyuLogin,
  revealPublishWindow
} from './profiles'
import type { LoginState } from '../login/defs'
import { abortableDelay, gotoWithAbort, throwIfAborted } from '../browser/abort'
import { downloadImage } from '../image'
import { logger } from '../logger'

/**
 * 闲鱼 has no public listing API (the only supported channel is 闲管家, which
 * needs a paid ERP subscription and a whitelisted public server IP), so
 * publishing drives the seller workbench in the shared real-Chrome session.
 *
 * Because the workspace only exists behind a login, its DOM cannot be pinned
 * down ahead of time: every field is filled by trying a list of candidate
 * selectors, misses are reported instead of failing, and the page is always
 * dumped (screenshot + HTML) so the selector maps below can be hardened from
 * a real run. The final「发布」click intentionally stays with the user.
 */

const XIANYU_SELLER_URL = 'https://seller.goofish.com/'
/** Link/button labels that open the publishing form from the workbench home. */
const PUBLISH_ENTRY_TEXTS = ['发布闲置', '发布商品', '卖闲置', '我要卖', '发布宝贝', '发布']
/** Text that appears once the listing is live. */
const SUCCESS_TEXTS = ['发布成功', '已发布', '上架成功', '发布完成', '已上架']

/**
 * Candidate selectors per field, tried in order. Extend these from the dumps
 * written to `<userData>/publish-artifacts/` when 闲鱼 changes its DOM.
 */
const SELECTORS: Record<string, string[]> = {
  title: [
    'input[placeholder*="标题"]',
    'input[placeholder*="宝贝名称"]',
    'input[placeholder*="名称"]',
    'input[name="title"]',
    '#title'
  ],
  description: [
    'textarea[placeholder*="描述"]',
    'textarea[placeholder*="宝贝"]',
    'textarea[placeholder*="介绍"]',
    'textarea[name="description"]',
    'textarea'
  ],
  price: [
    'input[placeholder*="价格"]',
    'input[placeholder*="售价"]',
    'input[placeholder*="出手价"]',
    'input[name="price"]',
    '#price'
  ],
  condition: [
    'select[name*="condition"]',
    '[class*="condition"] select',
    '[class*="成色"] select',
    '[data-spm*="condition"]'
  ],
  imageInput: ['input[type="file"][accept*="image"]', 'input[type="file"]'],
  imageUrlInput: ['input[placeholder*="图片链接"]', 'input[placeholder*="图片地址"]'],
  /** Reserved for a future fully-automatic mode; the half-automatic flow never clicks it. */
  submit: ['button[type="submit"]', '[class*="publish"] button', '[class*="发布"]']
}

const USER_SUBMIT_TIMEOUT_MS = 10 * 60 * 1000
const POLL_INTERVAL_MS = 2000
/** How long a「扫码登录」waits for the human to finish scanning. */
const LOGIN_WAIT_TIMEOUT_MS = 5 * 60 * 1000
const LOGIN_POLL_INTERVAL_MS = 1000

export interface XianyuPublishInput {
  /** Publishing target id: each target owns its own Chrome profile/login. */
  targetId: string
  catalogNumber: string
  title: string
  description: string
  price: string
  condition: string
  imageUrl: string
  uploadCover: boolean
  signal: AbortSignal
  /** Progress for the UI; `needsUserAction` marks the manual-submit handoff. */
  onProgress: (message: string, needsUserAction?: boolean) => void
}

export interface XianyuPublishResult {
  status: 'published' | 'cancelled'
  listingUrl?: string
  artifacts: string[]
  filled: string[]
  missed: string[]
  message?: string
}

function artifactDir(): string {
  return join(app.getPath('userData'), 'publish-artifacts')
}

/** Always capture the page: it is the only way to harden the selector maps. */
export async function dumpPage(page: Page, label: string): Promise<string[]> {
  const dir = artifactDir()
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const base = join(dir, `${label}-${stamp}`)
  const paths: string[] = []

  try {
    const png = `${base}.png`
    await page.screenshot({ path: png })
    paths.push(png)
  } catch (err) {
    logger.debug('publish.xianyu', 'screenshot dump failed', { error: String(err) })
  }
  try {
    const html = `${base}.html`
    // The DOM is far smaller than this in practice; the cap only guards against
    // dumping something pathological to disk.
    writeFileSync(html, (await page.content()).slice(0, 2_000_000), 'utf8')
    paths.push(html)
  } catch (err) {
    logger.debug('publish.xianyu', 'html dump failed', { error: String(err) })
  }

  logger.info('publish.xianyu', 'page dumped', { label, files: paths.length })
  return paths
}

async function firstMatching(page: Page, selectors: readonly string[]): Promise<{ selector: string; handle: ElementHandle } | null> {
  for (const selector of selectors) {
    const handle = await page.$(selector).catch(() => null)
    if (handle) return { selector, handle }
  }
  return null
}

/**
 * Write a value into a framework-controlled input.
 *
 * React/Vue inputs ignore a plain `element.value = …`; the native setter plus
 * input/change events is what their listeners see. Falls back to real key
 * events when the value does not stick.
 */
export async function fillTextInput(page: Page, selectors: readonly string[], value: string): Promise<boolean> {
  if (!value) return false
  const match = await firstMatching(page, selectors)
  if (!match) return false

  const applied = await page.evaluate((selector, next) => {
    const element = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null
    if (!element) return false
    const prototype = element instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    if (!setter) return false
    setter.call(element, next)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
    return element.value === next
  }, match.selector, value).catch(() => false)

  if (applied) return true

  // Fallback: real key events (handles editors that only listen to keystrokes).
  try {
    await match.handle.click({ clickCount: 3 })
    await page.keyboard.type(value, { delay: 10 })
    return true
  } catch (err) {
    logger.debug('publish.xianyu', 'typing fallback failed', { selector: match.selector, error: String(err) })
    return false
  }
}

/** Pick a 成色 option whose visible text matches the requested label. */
export async function selectCondition(page: Page, selectors: readonly string[], label: string): Promise<boolean> {
  if (!label) return false
  const match = await firstMatching(page, selectors)
  if (!match) return false

  const selected = await page.evaluate((selector, wanted) => {
    const root = document.querySelector(selector)
    if (!root) return false
    // Native <select>: match the option text.
    const select = root instanceof HTMLSelectElement ? root : root.querySelector('select')
    if (select) {
      const option = Array.from(select.options).find(item => item.textContent?.includes(wanted))
      if (!option) return false
      select.value = option.value
      select.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    }
    // Custom dropdown: click the container to open it, then the matching item.
    if (root instanceof HTMLElement) {
      root.click()
      const candidate = Array.from(document.querySelectorAll('li, [role="option"], [class*="option"]'))
        .find(item => item.textContent?.includes(wanted))
      if (candidate instanceof HTMLElement) {
        candidate.click()
        return true
      }
    }
    return false
  }, match.selector, label).catch(() => false)

  return selected
}

/** Download the cover and hand it to the page's file input. */
export async function uploadCoverImage(page: Page, selectors: readonly string[], imageUrl: string): Promise<boolean> {
  if (!imageUrl) return false
  const match = await firstMatching(page, selectors)
  if (!match) return false

  const image = await downloadImage(imageUrl, 1000, true)
  if (!image) return false

  const dir = artifactDir()
  mkdirSync(dir, { recursive: true })
  const extension = image.mimeType === 'image/png' ? 'png' : 'jpg'
  const file = join(dir, `cover-${Date.now()}.${extension}`)
  writeFileSync(file, Buffer.from(image.base64, 'base64'))

  try {
    // The selector map targets file inputs, but `page.$` widens the handle type.
    await (match.handle as ElementHandle<HTMLInputElement>).uploadFile(file)
    return true
  } catch (err) {
    logger.debug('publish.xianyu', 'cover upload failed', { error: String(err) })
    return false
  }
}

/**
 * Whether the browser is already on the publishing form.
 *
 * Matched against the URL *path* (and SPA hash), never the raw string:
 * `https://seller.goofish.com/` contains `/sell` inside `//seller`, so a naive
 * substring test would think the home page is already the form and skip the
 * click that opens it.
 */
export function isPublishPath(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    if (/\/(publish|sell)(\/|$)/.test(parsed.pathname)) return true
    return /(publish|sell)/.test(parsed.hash)
  } catch {
    return false
  }
}

async function findPublishEntry(page: Page): Promise<boolean> {
  const clicked = await page.evaluate((labels: string[]) => {
    const candidates = Array.from(document.querySelectorAll('a, button, [role="button"], [class*="publish"], [class*="sell"]'))
    for (const label of labels) {
      const hit = candidates.find(node => (node.textContent ?? '').trim().includes(label))
      if (hit instanceof HTMLElement) {
        hit.click()
        return label
      }
    }
    return ''
  }, PUBLISH_ENTRY_TEXTS).catch(() => '')

  if (clicked) logger.debug('publish.xianyu', 'publish entry clicked', { label: clicked })
  return Boolean(clicked)
}

async function detectPublished(page: Page): Promise<{ published: boolean; url?: string }> {
  const text = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '')
  const marker = SUCCESS_TEXTS.find(item => text.includes(item))
  if (marker) return { published: true, url: page.url() }
  return { published: false }
}

/**
 * Login snapshot of one publishing target's OWN browser profile.
 *
 * Never launches Chrome: when the target's session is not running there is
 * nothing to inspect, and the caller reports「未启动」instead.
 */
export async function peekTargetLogin(targetId: string): Promise<{ running: boolean; state: LoginState | 'not_started'; account: string }> {
  const snapshot = await peekPublishProfileLogin(publishProfileId(targetId))
  if (!snapshot) return { running: false, state: 'not_started', account: '' }
  return { running: true, state: snapshot.state, account: snapshot.account }
}

/**
 * Open the target's own Chrome on the seller workbench and wait for the user to
 * scan the QR code. Resolves once goofish reports a valid session, when the
 * window is closed, or after the timeout.
 */
export async function loginTargetProfile(targetId: string): Promise<{ ok: boolean; account?: string; message: string }> {
  const profileId = publishProfileId(targetId)
  const acquired = await acquirePublishPage(profileId, 'headed')
  if (!acquired) {
    return { ok: false, message: '无法启动真实 Chrome：请先安装 Google Chrome，或将 CHROME_PATH 指向 Chrome 可执行文件' }
  }

  const { page, release } = acquired
  try {
    await revealPublishWindow(profileId).catch(() => {})
    await gotoWithAbort(page, XIANYU_SELLER_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})

    const deadline = Date.now() + LOGIN_WAIT_TIMEOUT_MS
    let lastAccount = ''
    while (Date.now() < deadline) {
      const snapshot = await readXianyuLogin(page)
      if (snapshot.state === 'logged_in') {
        lastAccount = snapshot.account
        logger.info('publish.xianyu', 'publish target logged in', { targetId, hasAccount: Boolean(lastAccount) })
        return {
          ok: true,
          ...(lastAccount ? { account: lastAccount } : {}),
          message: lastAccount ? `已登录：${lastAccount}` : '已登录闲鱼'
        }
      }
      if (!isPublishProfileRunning(profileId)) {
        return { ok: false, message: 'Chrome 窗口已关闭，登录未完成' }
      }
      await abortableDelay(LOGIN_POLL_INTERVAL_MS).catch(() => {})
    }

    return { ok: false, message: '等待扫码超时（5 分钟），请重试并在这个目标自己的 Chrome 窗口里扫码' }
  } finally {
    release()
    // The window served its purpose; leaving it parked keeps the session alive
    // for publishing without cluttering the desktop.
    await parkPublishWindow(profileId).catch(() => {})
  }
}

/**
 * Fill the seller form, hand the window to the user for the final click, then
 * watch the page until the listing appears live (or the wait times out).
 */
export async function publishToXianyu(input: XianyuPublishInput): Promise<XianyuPublishResult> {
  const profileId = publishProfileId(input.targetId)
  const acquired = await acquirePublishPage(profileId, 'headed')
  if (!acquired) {
    throw new Error('无法启动真实 Chrome：请先安装 Google Chrome，或将 CHROME_PATH 指向 Chrome 可执行文件')
  }

  const { page, release } = acquired
  const artifacts: string[] = []
  const filled: string[] = []
  const missed: string[] = []

  try {
    throwIfAborted(input.signal)

    // Each target owns its own login; the search channel's session is unrelated.
    const snapshot = await readXianyuLogin(page)
    if (snapshot.state !== 'logged_in') {
      throw new Error('该发布目标尚未登录闲鱼：请到「设置 → 发布目标」里点它自己的「扫码登录」')
    }

    await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-CN,zh;q=0.9' })

    input.onProgress('正在打开发布页…')
    try {
      await gotoWithAbort(page, XIANYU_SELLER_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }, input.signal)
    } catch (err) {
      throw new Error(`打不开闲鱼卖家工作台：${err instanceof Error ? err.message : String(err)}`)
    }
    await abortableDelay(1500, input.signal)

    const landed = page.url()
    if (/login|passport/i.test(landed)) {
      throw new Error('闲鱼登录已失效：请到「设置 → 登录」重新扫码登录闲鱼')
    }

    // The workbench home usually needs one more click to reach the form; a miss
    // is not fatal (the user can navigate by hand in the revealed window), so it
    // is only reported through the dump + progress text.
    if (!isPublishPath(landed)) {
      const clicked = await findPublishEntry(page)
      await abortableDelay(1500, input.signal)
      if (!clicked) logger.info('publish.xianyu', 'publish entry not found; leaving navigation to the user', { url: page.url() })
    }

    input.onProgress('正在填写发布表单…')
    if (await fillTextInput(page, SELECTORS.title!, input.title)) filled.push('title')
    else missed.push('title')
    if (await fillTextInput(page, SELECTORS.description!, input.description)) filled.push('description')
    else missed.push('description')
    if (await fillTextInput(page, SELECTORS.price!, input.price)) filled.push('price')
    else missed.push('price')
    if (await selectCondition(page, SELECTORS.condition!, input.condition)) filled.push('condition')
    else missed.push('condition')

    if (input.uploadCover && input.imageUrl) {
      if (await uploadCoverImage(page, SELECTORS.imageInput!, input.imageUrl)) filled.push('image')
      else if (await fillTextInput(page, SELECTORS.imageUrlInput!, input.imageUrl)) filled.push('image')
      else missed.push('image')
    }

    logger.info('publish.xianyu', 'form filled', { filled, missed, url: page.url() })
    artifacts.push(...await dumpPage(page, `xianyu-${input.catalogNumber}-filled`))

    // Hand the window back to the user for the final「发布」click.
    await revealPublishWindow(profileId)
    input.onProgress('请在浏览器窗口中确认并点击「发布」', true)

    const deadline = Date.now() + USER_SUBMIT_TIMEOUT_MS
    while (Date.now() < deadline) {
      throwIfAborted(input.signal)
      await abortableDelay(POLL_INTERVAL_MS, input.signal)
      const result = await detectPublished(page)
      if (result.published) {
        artifacts.push(...await dumpPage(page, `xianyu-${input.catalogNumber}-published`))
        input.onProgress('已检测到发布成功')
        return { status: 'published', listingUrl: result.url, artifacts, filled, missed }
      }
    }

    artifacts.push(...await dumpPage(page, `xianyu-${input.catalogNumber}-timeout`))
    return {
      status: 'cancelled',
      artifacts,
      filled,
      missed,
      message: '等待超时：没有检测到发布成功，请确认是否已在浏览器中完成发布'
    }
  } finally {
    release()
    // The window was revealed for the manual submit; hand it back off-screen so
    // the resident session does not leave a stray window on the desktop.
    await parkPublishWindow(profileId).catch(() => {})
  }
}
