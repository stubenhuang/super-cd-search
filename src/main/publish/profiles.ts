import { spawn, type ChildProcess } from 'child_process'
import { mkdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import puppeteer from 'puppeteer-core'
import type { Browser, Page } from 'puppeteer-core'
import { restrictedHostChromeArgs, findChromeExecutable } from '../browser/chrome-path'
import {
  connectWithRetry,
  describeBrowserSessionFromUa,
  setChromeWindowVisible,
  waitForDevToolsPort,
  type ChromeSessionMode
} from '../login/session'
import { LOGIN_DEFS, checkLoginState, type LoginState } from '../login/defs'
import { logger } from '../logger'

/**
 * Multi-profile real-Chrome sessions, one profile per publishing target.
 *
 * 闲鱼 publishing must NOT share the search channel's login: every target is an
 * independent account, so each gets its own `--user-data-dir` (its own cookie
 * jar) and its own Chrome process. Sessions stay resident until the user logs
 * the target out or deletes it, which is what makes switching targets instant.
 *
 * The launch/attach primitives are shared with the single-profile search
 * session (see src/main/login/session.ts) so both behave identically.
 */

interface ProfileSession {
  profileId: string
  dir: string
  /** The Chrome we own; null when we reattached to one that was still running. */
  proc: ChildProcess | null
  browser: Browser
  page: Page
  lock: Promise<void>
  mode: ChromeSessionMode
  /** Headless UA with "HeadlessChrome" masked; empty for headed sessions. */
  maskedUa: string
}

const sessions = new Map<string, ProfileSession>()
const launching = new Map<string, Promise<ProfileSession>>()
let rootDir: string | null = null

/** Must be called once at startup with the app's userData directory. */
export function initPublishProfiles(userDataDir: string): void {
  rootDir = join(userDataDir, 'publish-profiles')
}

/**
 * Chrome profile id of one publishing target. One profile per target is what
 * makes two 闲鱼 targets two independent accounts; the prefix keeps these
 * directories distinguishable from any other profile kind added later.
 */
export function publishProfileId(targetId: string): string {
  return `target-${targetId}`
}

/** Directory of one target's Chrome profile (also its login store). */
export function publishProfileDir(profileId: string): string {
  // Profile ids come from target UUIDs, but they end up in a path: keep only
  // characters that can never escape the root directory.
  const safe = profileId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return join(rootDir ?? join(tmpdir(), 'super-cd-search-publish'), safe)
}

function rememberDisconnect(profileId: string, browser: Browser): void {
  browser.once('disconnected', () => {
    logger.debug('publish.profiles', 'chrome disconnected', { profileId })
    const current = sessions.get(profileId)
    if (current?.browser === browser) sessions.delete(profileId)
  })
}

/**
 * Reuse a Chrome that is still running on this profile (its logins are valid).
 * Only a LIVE DevTools endpoint is trusted: the port file can be a leftover
 * from a Chrome that has since exited.
 */
async function reattach(dir: string, profileId: string): Promise<ProfileSession | null> {
  let port: number
  try {
    port = parseInt(readFileSync(join(dir, 'DevToolsActivePort'), 'utf-8').split('\n')[0], 10)
  } catch {
    return null
  }
  if (!port) return null

  let probeUa = ''
  try {
    const probe = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) })
    if (!probe.ok) return null
    probeUa = String(((await probe.json()) as Record<string, unknown>)['User-Agent'] ?? '')
  } catch {
    logger.debug('publish.profiles', 'stale port file, launching fresh Chrome', { profileId, port })
    return null
  }

  try {
    const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport: null })
    const page = await browser.newPage()
    const { maskedUa, mode } = describeBrowserSessionFromUa(probeUa)
    rememberDisconnect(profileId, browser)
    logger.debug('publish.profiles', 'reattached to running chrome', { profileId, port, mode })
    return { profileId, dir, proc: null, browser, page, lock: Promise.resolve(), mode, maskedUa }
  } catch (err) {
    logger.debug('publish.profiles', 'reattach failed, launching fresh', {
      profileId,
      error: err instanceof Error ? err.message : String(err)
    })
    return null
  }
}

async function launchChrome(profileId: string, dir: string, mode: ChromeSessionMode): Promise<ProfileSession> {
  mkdirSync(dir, { recursive: true })

  const reattached = await reattach(dir, profileId)
  if (reattached) return reattached

  const chromePath = findChromeExecutable()
  if (!chromePath) {
    throw new Error('未找到 Google Chrome，请先安装（或将 CHROME_PATH 指向 Chrome 可执行文件）')
  }

  // Drop the previous port file so waitForDevToolsPort can never resolve with a
  // dead port before the fresh Chrome writes its own.
  rmSync(join(dir, 'DevToolsActivePort'), { force: true })
  logger.info('publish.profiles', 'launching chrome for publish target', { profileId, dir, mode })

  const proc = spawn(
    chromePath,
    [
      '--remote-debugging-port=0',
      `--user-data-dir=${dir}`,
      ...restrictedHostChromeArgs(),
      '--no-first-run',
      '--no-default-browser-check',
      ...(mode === 'headless' ? ['--headless', '--window-size=1280,1000'] : ['--window-position=-32000,-32000']),
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      'about:blank'
    ],
    { stdio: 'ignore' }
  )

  const port = await waitForDevToolsPort(dir)
  const browser = await connectWithRetry(port)
  const page = await browser.newPage()
  const { maskedUa } = describeBrowserSessionFromUa(await browser.userAgent())
  if (maskedUa) await page.setUserAgent(maskedUa)
  rememberDisconnect(profileId, browser)

  return { profileId, dir, proc, browser, page, lock: Promise.resolve(), mode, maskedUa }
}

async function ensureProfile(profileId: string, mode: ChromeSessionMode): Promise<ProfileSession> {
  const existing = sessions.get(profileId)
  if (existing) {
    if (existing.mode === 'headed' && mode === 'headless') return existing
    if (existing.mode === mode) return existing
    // A headless profile cannot serve an interactive flow (no window), so it is
    // replaced by a headed one.
    await closePublishProfile(profileId)
  }

  const pending = launching.get(profileId)
  if (pending) return pending

  const dir = publishProfileDir(profileId)
  const promise = launchChrome(profileId, dir, mode)
    .then((created) => {
      sessions.set(profileId, created)
      return created
    })
    .finally(() => {
      launching.delete(profileId)
    })

  launching.set(profileId, promise)
  return promise
}

export interface AcquiredProfilePage {
  page: Page
  release: () => void
}

/**
 * Acquire this profile's page, serialized against other users of the same
 * profile. Returns null when Chrome cannot run (not installed, launch failed).
 */
export async function acquirePublishPage(
  profileId: string,
  mode: ChromeSessionMode = 'headed'
): Promise<AcquiredProfilePage | null> {
  let session: ProfileSession
  try {
    session = await ensureProfile(profileId, mode)
  } catch (err) {
    logger.warn('publish.profiles', 'could not start chrome for profile', {
      profileId,
      error: err instanceof Error ? err.message : String(err)
    })
    return null
  }

  let release!: () => void
  const previous = session.lock
  session.lock = new Promise<void>((resolve) => {
    release = resolve
  })
  await previous

  // Headless sessions must present a normal Chrome UA (goofish otherwise serves
  // a bot-wall), exactly like the search channel does.
  if (session.maskedUa) await session.page.setUserAgent(session.maskedUa).catch(() => {})

  return { page: session.page, release }
}

/** Bring this profile's window on screen so a human can log in. */
export async function revealPublishWindow(profileId: string): Promise<void> {
  const session = sessions.get(profileId)
  if (!session) return
  await setChromeWindowVisible(session.page, true)
}

/** Park this profile's window off-screen again. */
export async function parkPublishWindow(profileId: string): Promise<void> {
  const session = sessions.get(profileId)
  if (!session) return
  await setChromeWindowVisible(session.page, false)
}

export function isPublishProfileRunning(profileId: string): boolean {
  return sessions.has(profileId)
}

export function listRunningPublishProfiles(): string[] {
  return [...sessions.keys()]
}

/**
 * Close one profile's Chrome. `wipe` also deletes the profile directory, which
 * is what「退出登录」means: the target loses its stored login.
 */
export async function closePublishProfile(profileId: string, options: { wipe?: boolean } = {}): Promise<void> {
  const session = sessions.get(profileId)
  sessions.delete(profileId)
  if (session) {
    logger.info('publish.profiles', 'closing chrome for publish target', { profileId, wipe: Boolean(options.wipe), owned: Boolean(session.proc) })
    try {
      await session.browser.close()
    } catch {
      // The browser may already be gone; the kill below is the real cleanup.
    }
    if (session.proc && !session.proc.killed) session.proc.kill()
  }

  if (options.wipe) {
    rmSync(publishProfileDir(profileId), { recursive: true, force: true })
  }
}

export async function closeAllPublishProfiles(): Promise<void> {
  // Settle in-flight launches first: their Chrome is registered only once the
  // launch resolves, and an unregistered process would outlive the app.
  await Promise.allSettled([...launching.values()])
  await Promise.all([...sessions.keys()].map(id => closePublishProfile(id)))
}

export interface ProfileLoginSnapshot {
  state: LoginState
  /** 闲鱼 nickname (tracknick) when present, otherwise the member id (unb). */
  account: string
}

/**
 * Read the goofish login out of an acquired page's cookie jar.
 *
 * `tracknick` is the nickname and `unb` the member id; both are URL-encoded by
 * goofish. The nickname is preferred because it is what the user recognises.
 */
export async function readXianyuLogin(page: Page): Promise<ProfileLoginSnapshot> {
  const def = LOGIN_DEFS.xianyu
  const cookies = await page.cookies(def.cookieUrl).catch(() => [])
  const state = checkLoginState(cookies, def)
  const pick = (name: string): string => {
    const cookie = cookies.find(item => item.name === name && item.value)
    if (!cookie) return ''
    try {
      return decodeURIComponent(cookie.value)
    } catch {
      return cookie.value
    }
  }
  return { state, account: pick('tracknick') || pick('unb') }
}

/** Login state of a profile that is already running (never launches Chrome). */
export async function peekPublishProfileLogin(profileId: string): Promise<ProfileLoginSnapshot | null> {
  const session = sessions.get(profileId)
  if (!session) return null
  try {
    return await readXianyuLogin(session.page)
  } catch (err) {
    logger.debug('publish.profiles', 'login peek failed', {
      profileId,
      error: err instanceof Error ? err.message : String(err)
    })
    return null
  }
}
