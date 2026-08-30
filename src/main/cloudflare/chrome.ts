import { spawn, type ChildProcess } from 'child_process'
import { mkdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import puppeteer from 'puppeteer-core'
import type { Browser, Page } from 'puppeteer-core'
import { isCloudflareChallenge } from './detect'
import { LOGIN_DEFS, checkLoginState, isCloudflareLoginPlatform } from './login'
import { findChromeExecutable } from '../browser/chrome-path'
import { logger } from '../logger'
import type { LoginPlatform, CloudflareChallengeResult, CloudflareSessionStatus } from '../../shared/types'

/**
 * A real Chrome instance driven over the DevTools protocol (CDP).
 *
 * Modern Cloudflare Turnstile flags puppeteer-launched Chromium (even headed,
 * even with the legacy stealth plugin) and loops the challenge forever. A real
 * Chrome launched WITHOUT automation flags has no such markers, so the user can
 * complete the challenge once and the app scrapes through that same browser.
 *
 * The same browser also hosts the QR-code login sessions for the marketplace
 * channels (taobao/xianyu): both sites' cookies coexist in the single profile.
 */

const POLL_INTERVAL_MS = 500
const CHALLENGE_TIMEOUT_MS = 5 * 60 * 1000

/**
 * How the shared Chrome runs. Headless sessions serve automated scraping
 * (marketplace channels) with no visible window at all; headed sessions are
 * needed for anything a human must see or interact with (QR login, Cloudflare
 * challenge) and for the Cloudflare-protected scrapes whose cf_clearance
 * cookie is bound to the headed user agent.
 */
export type ChromeSessionMode = 'headed' | 'headless'

/**
 * Classify a real-Chrome browser from its own user agent. A headless Chrome
 * advertises "HeadlessChrome"; its pages must present the masked normal-Chrome
 * UA when scraping (goofish answers the raw headless UA with a 非法访问
 * bot-wall instead of results), so the masked UA is remembered per session and
 * applied on every page acquire. A headed browser needs no mask.
 */
export function describeBrowserSessionFromUa(ua: string): { maskedUa: string; mode: ChromeSessionMode } {
  if (ua.includes('HeadlessChrome')) {
    return { maskedUa: ua.replace('HeadlessChrome', 'Chrome'), mode: 'headless' }
  }
  return { maskedUa: '', mode: 'headed' }
}

interface Session {
  /** The Chrome we own (null when we reattached to an already-running one). */
  proc: ChildProcess | null
  browser: Browser
  page: Page
  lock: Promise<void>
  mode: ChromeSessionMode
  /** Headless UA with "HeadlessChrome" masked to a normal Chrome UA; empty for a headed browser. */
  maskedUa: string
}

let profileDir: string | null = null
let session: Session | null = null
let launching: Promise<Session> | null = null
let cancelRequested = false

/** Must be called once at startup with the app's userData directory. */
export function initCloudflareChrome(userDataDir: string): void {
  profileDir = join(userDataDir, 'cloudflare-chrome')
}

function waitForDevToolsPort(dir: string): Promise<number> {
  const file = join(dir, 'DevToolsActivePort')
  const deadline = Date.now() + 20000
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      try {
        const port = parseInt(readFileSync(file, 'utf-8').split('\n')[0], 10)
        if (port) {
          clearInterval(timer)
          resolve(port)
        }
      } catch {
        // DevToolsActivePort not written yet.
      }
      if (Date.now() > deadline) {
        clearInterval(timer)
        reject(new Error('Chrome 启动超时'))
      }
    }, 200)
  })
}

/**
 * The DevTools HTTP endpoint can lag the port file by a beat (and the file can
 * even belong to a Chrome that has since been replaced), so retry the connect
 * for a few seconds instead of failing the whole login on the first attempt.
 */
async function connectWithRetry(port: number): Promise<Browser> {
  const deadline = Date.now() + 10_000
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      return await puppeteer.connect({
        browserURL: `http://127.0.0.1:${port}`,
        defaultViewport: null
      })
    } catch (err) {
      lastError = err
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  logger.warn('cloudflare.chrome', 'CDP connect retries exhausted', { port, error: lastError instanceof Error ? lastError.message : String(lastError) })
  throw lastError instanceof Error ? lastError : new Error('连接真实 Chrome 失败')
}

/**
 * Reattach to a real Chrome that a previous session left running with the same
 * profile (its logins are still valid). Only trusts a LIVE endpoint: the port
 * file may be a leftover from a Chrome that has since exited, and connecting
 * to that dead port was the reason logins used to fail after an app restart.
 */
async function reattachToRunningChrome(dir: string): Promise<Session | null> {
  let port: number
  try {
    port = parseInt(readFileSync(join(dir, 'DevToolsActivePort'), 'utf-8').split('\n')[0], 10)
  } catch {
    return null
  }
  if (!port) return null

  // The live probe doubles as the headless classifier: /json/version reports
  // the browser's own User-Agent, which tells a headless Chrome (needs the UA
  // mask, restarted headed for interactive flows) from a visible one.
  let probeUa = ''
  try {
    const probe = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) })
    if (!probe.ok) return null
    probeUa = String(((await probe.json()) as Record<string, unknown>)['User-Agent'] ?? '')
  } catch {
    logger.debug('cloudflare.chrome', 'port file is stale, launching fresh Chrome', { port })
    return null
  }

  try {
    const browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${port}`,
      defaultViewport: null
    })
    const page = await browser.newPage()
    browser.once('disconnected', () => {
      logger.debug('cloudflare.chrome', 'reattached real Chrome disconnected')
      if (session?.browser === browser) {
        session = null
      }
    })
    // A reattached browser brings none of the launch-time session state, so
    // both the mode and the headless-UA mask must be derived from the browser
    // itself. Recording a reattached headless Chrome as headed left every
    // marketplace page with the raw HeadlessChrome UA, which goofish blocks.
    const { maskedUa, mode } = describeBrowserSessionFromUa(probeUa)
    logger.debug('cloudflare.chrome', 'reattached to running real Chrome', { port, mode })
    return { proc: null, browser, page, lock: Promise.resolve(), mode, maskedUa }
  } catch (err) {
    logger.debug('cloudflare.chrome', 'reattach connect failed, launching fresh', {
      port,
      error: err instanceof Error ? err.message : String(err)
    })
    return null
  }
}

async function launchChrome(mode: ChromeSessionMode): Promise<Session> {
  const dir = profileDir ?? join(tmpdir(), 'super-cd-search-chrome')
  mkdirSync(dir, { recursive: true })

  // Reuse the still-running Chrome (and its valid logins) when possible. Its
  // mode and UA mask come from the browser itself (see reattach), since a
  // leftover Chrome is not necessarily visible.
  const reattached = await reattachToRunningChrome(dir)
  if (reattached) return reattached

  const chromePath = findChromeExecutable()
  if (!chromePath) {
    logger.warn('cloudflare.chrome', 'Chrome executable not found')
    throw new Error('未找到 Google Chrome，请先安装（或将 CHROME_PATH 指向 Chrome 可执行文件）')
  }

  // Remove the previous session's port file so waitForDevToolsPort never
  // resolves with a dead port before the fresh Chrome writes its own.
  rmSync(join(dir, 'DevToolsActivePort'), { force: true })
  logger.debug('cloudflare.chrome', 'launching real Chrome', { chromePath, profileDir: dir, mode })

  const proc = spawn(
    chromePath,
    [
      '--remote-debugging-port=0',
      `--user-data-dir=${dir}`,
      '--no-first-run',
      '--no-default-browser-check',
      // Headless sessions have no window at all; headed ones get parked
      // off-screen right after connect (macOS keeps a sliver visible — that is
      // the best a headed window can do). The backgrounding flags keep a
      // parked/occluded window's page fully active (no timer throttling).
      ...(mode === 'headless' ? ['--headless', '--window-size=1280,1000'] : ['--window-position=-32000,-32000']),
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      'about:blank'
    ],
    { stdio: 'ignore' }
  )

  const port = await waitForDevToolsPort(dir)
  logger.debug('cloudflare.chrome', 'connected to real Chrome over CDP', { port })
  const browser = await connectWithRetry(port)
  const page = await browser.newPage()
  // Headless pages advertise "HeadlessChrome" in their UA; mask it so target
  // sites treat the scrape like a normal desktop Chrome client.
  const ua = await browser.userAgent().catch(() => '')
  const maskedUa = describeBrowserSessionFromUa(ua).maskedUa
  if (mode === 'headed') {
    // Park the window immediately so even the launch is not a disturbance.
    await setMainWindowVisible(page, false)
  }

  // If the user closes the Chrome window manually, clear the session so the
  // next search reports "challenge" instead of erroring on a dead connection.
  proc.once('exit', () => {
    logger.debug('cloudflare.chrome', 'real Chrome process exited')
    if (session?.proc === proc) {
      session = null
    }
  })
  browser.once('disconnected', () => {
    if (session?.browser === browser) {
      session = null
    }
  })

  return { proc, browser, page, lock: Promise.resolve(), mode, maskedUa }
}

/**
 * Ensure a session in the requested mode. Policy is sticky toward headed: a
 * headless session is restarted headed when an interactive flow (or a
 * Cloudflare-protected scrape) needs one, but a headed session is reused for
 * headless requests — otherwise concurrent platform queries would thrash
 * Chrome between modes mid-batch.
 */
async function ensureSession(mode: ChromeSessionMode = 'headed'): Promise<Session> {
  if (session) {
    if (session.mode === 'headed' && mode === 'headless') {
      return session
    }
    if (session.mode !== mode) {
      logger.debug('cloudflare.chrome', 'restarting real Chrome in headed mode for interactive use')
      await closeCloudflareChrome()
    } else {
      return session
    }
  }
  if (launching) return launching

  launching = launchChrome(mode)
    .then((s) => {
      session = s
      launching = null
      return s
    })
    .catch((err) => {
      launching = null
      throw err
    })
  return launching
}

/** Serialize access to the single shared scrape page (interactive flows only). */
async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const s = await ensureSession('headed')
  let release!: () => void
  const previous = s.lock
  s.lock = new Promise<void>((resolve) => {
    release = resolve
  })
  await previous
  try {
    return await fn(s.page)
  } finally {
    release()
  }
}

export function isCloudflareChromeRunning(): boolean {
  return session !== null
}

/** On-screen position used while an interactive flow needs a human. */
const WINDOW_ON_SCREEN = { left: 80, top: 80 }
/** Off-screen parking spot matching the --window-position launch flag. */
const WINDOW_OFF_SCREEN = { left: -32000, top: -32000 }

/**
 * Park/unpark the shared HEADED Chrome window. Best-effort and honest about
 * platform limits: macOS clamps window positions (a sliver always stays
 * visible) and ignores CDP minimize, so on Windows/Linux parking fully hides
 * the window while on macOS it only shrinks the footprint. Interactive flows
 * (QR login, Cloudflare challenge) restore the window while a human is needed,
 * then re-park. A failed move must never break the flow that triggered it.
 */
async function setMainWindowVisible(page: Page, visible: boolean): Promise<void> {
  try {
    const cdp = await page.createCDPSession()
    try {
      const { windowId, bounds } = await cdp.send('Browser.getWindowForTarget')
      if (visible && bounds.windowState && bounds.windowState !== 'normal') {
        // A maximized/fullscreen window ignores left/top until restored.
        await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } })
      }
      const target = visible ? WINDOW_ON_SCREEN : WINDOW_OFF_SCREEN
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { left: target.left, top: target.top } })
      logger.debug('cloudflare.chrome', 'window visibility moved', { visible })
    } finally {
      await cdp.detach().catch(() => {})
    }
  } catch (err) {
    logger.debug('cloudflare.chrome', 'window visibility move failed', {
      visible,
      error: err instanceof Error ? err.message : String(err)
    })
  }
}

/**
 * Whether the shared browser currently holds a valid login/verification for
 * the platform: the expected cookies exist (unexpired) and, for Cloudflare
 * platforms, the page is not sitting on a challenge. Cookies are queried with
 * the platform's own cookieUrl so the shared page's current location cannot
 * hide another platform's session.
 */
async function hasVerifiedSession(platform: LoginPlatform, page: Page): Promise<boolean> {
  const def = LOGIN_DEFS[platform]
  const cookies = await page.cookies(def.cookieUrl).catch(() => [])
  if (checkLoginState(cookies, def) !== 'logged_in') return false
  if (isCloudflareLoginPlatform(platform) && (await isCloudflareChallenge(page))) return false
  return true
}

/** Open the login page and wait for the user to pass the challenge / scan the QR code. */
export async function startCloudflareChallenge(platform: LoginPlatform): Promise<CloudflareChallengeResult> {
  cancelRequested = false
  const loginUrl = LOGIN_DEFS[platform].loginUrl
  logger.debug('cloudflare.chrome', 'start login flow', { platform, loginUrl })
  try {
    return await withPage(async (page) => {
      // Interactive flow: the user must see and operate the login window.
      await setMainWindowVisible(page, true)
      await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 45000 })

      const deadline = Date.now() + CHALLENGE_TIMEOUT_MS
      while (Date.now() < deadline) {
        if (cancelRequested) {
          logger.debug('cloudflare.chrome', 'login flow cancelled by user', { platform })
          return { status: 'cancelled' as const }
        }
        if (await hasVerifiedSession(platform, page)) {
          logger.debug('cloudflare.chrome', 'login verified', { platform })
          return { status: 'done' as const }
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
      }
      logger.warn('cloudflare.chrome', 'login verification timed out', { platform })
      return { status: 'error' as const, error: '验证超时：未检测到登录态' }
    })
  } catch (err) {
    logger.warn('cloudflare.chrome', 'login flow failed', { platform, error: err instanceof Error ? err.message : String(err) })
    return { status: 'error' as const, error: err instanceof Error ? err.message : 'Unknown error' }
  } finally {
    // Park the window off-screen again — scraping runs invisibly. Best-effort
    // on the session: a failed launch has nothing to move.
    if (session) await setMainWindowVisible(session.page, false)
  }
}

export function cancelCloudflareChallenge(): void {
  cancelRequested = true
}

export async function getCloudflareStatus(platform: LoginPlatform): Promise<CloudflareSessionStatus> {
  // The in-memory session is always empty right after an app restart, but the
  // profile on disk still holds the logins — bring Chrome up (reattach or
  // launch) before judging the platform instead of dead-ending on
  // not_started. Status checks launch headless (no window disturbance) and
  // concurrent callers share the same in-flight launch through ensureSession.
  if (!session) {
    try {
      await ensureSession('headless')
    } catch (err) {
      logger.debug('cloudflare.chrome', 'status could not launch real Chrome', {
        platform,
        error: err instanceof Error ? err.message : String(err)
      })
      return { state: 'not_started' }
    }
  }
  if (!session) return { state: 'starting' }

  const def = LOGIN_DEFS[platform]
  const cookies = await session.page.cookies(def.cookieUrl).catch(() => [])
  const state = checkLoginState(cookies, def)
  if (state === 'logged_out') return { state: 'unverified' }
  if (state === 'expired') return { state: 'expired' }

  const expiryCookie = cookies.find(
    c => def.cookieNames.includes(c.name) && c.domain.includes(def.domainSuffix) &&
         typeof c.expires === 'number' && c.expires > 0
  )
  return expiryCookie ? { state: 'verified', expiresAt: expiryCookie.expires * 1000 } : { state: 'verified' }
}

export interface AcquiredCloudflarePage {
  page: Page
  release: () => void
}

/**
 * Acquire the shared scrape page, or null when Chrome cannot run. Query
 * modules use this instead of the headless browser pool.
 *
 * `mode` selects the session: 'headless' (invisible, marketplace channels)
 * or 'headed' (Cloudflare-protected scrapes, whose cf_clearance cookie is
 * bound to the headed user agent). See ensureSession for the switching
 * policy — switching is sticky toward headed.
 */
export async function acquireCloudflarePage(mode: ChromeSessionMode = 'headed'): Promise<AcquiredCloudflarePage | null> {
  if (!session) {
    // Lazily restore the session (e.g. right after an app restart): the
    // profile on disk still holds the logins, so a scrape must be able to
    // launch/reattach Chrome. Each scrape re-checks its platform's cookies
    // and reports login-required itself when they are truly gone.
    try {
      await ensureSession(mode)
    } catch (err) {
      logger.debug('cloudflare.chrome', 'acquire could not launch real Chrome', {
        error: err instanceof Error ? err.message : String(err)
      })
      return null
    }
  }
  if (!session) return null

  let release!: () => void
  const previous = session.lock
  session.lock = new Promise<void>((resolve) => {
    release = resolve
  })
  await previous
  logger.debug('cloudflare.chrome', 'real-Chrome page acquired', { mode: session.mode })

  // Clear per-request headers (e.g. Accept-Language) a previous scrape set on
  // the shared page so they cannot leak into platforms that set none.
  await session.page.setExtraHTTPHeaders({}).catch(() => {})
  // Mask the headless UA so target sites see a normal desktop Chrome client.
  // maskedUa is non-empty only for an actually-headless browser — including a
  // reattached one — so no mode assumption is needed here. The override is
  // re-applied on every acquire because it is CDP-session-scoped: it vanishes
  // when the previous client detaches.
  if (session.maskedUa) {
    await session.page.setUserAgent(session.maskedUa).catch(() => {})
  }

  return { page: session.page, release }
}

/** Terminate the Chrome process (and its child processes on Windows). */
function killChrome(proc: ChildProcess): Promise<void> {
  if (!proc.pid) return Promise.resolve()

  if (process.platform === 'win32') {
    // SIGKILL on Windows only kills the main process, leaving renderer/network
    // child processes behind. taskkill /T /F kills the whole process tree.
    return new Promise((resolve) => {
      try {
        const killer = spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' })
        killer.once('exit', () => resolve())
        killer.once('error', () => resolve())
      } catch {
        resolve()
      }
    })
  }

  try {
    proc.kill('SIGKILL')
  } catch {
    // Already exited.
  }
  return Promise.resolve()
}

export async function closeCloudflareChrome(): Promise<void> {
  const s = session
  if (s) {
    // Detach first: browser.close() fires the 'disconnected' handler, which
    // nulls the module session — reading session.proc afterwards would crash.
    session = null
    logger.debug('cloudflare.chrome', 'closing real-Chrome session')
    await s.browser.close().catch(() => {})
    if (s.proc) {
      // Graceful close may leave the process tree behind on Windows.
      await killChrome(s.proc)
    }
  }
}
