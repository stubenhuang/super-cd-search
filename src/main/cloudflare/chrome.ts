import { spawn, type ChildProcess } from 'child_process'
import { mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import puppeteer from 'puppeteer-core'
import type { Browser, Page } from 'puppeteer-core'
import { isCloudflareChallenge } from './detect'
import { findChromeExecutable } from '../browser/chrome-path'
import { logger } from '../logger'
import type { CloudflarePlatform, CloudflareChallengeResult, CloudflareSessionStatus } from '../../shared/types'

/**
 * A real Chrome instance driven over the DevTools protocol (CDP).
 *
 * Modern Cloudflare Turnstile flags puppeteer-launched Chromium (even headed,
 * even with the legacy stealth plugin) and loops the challenge forever. A real
 * Chrome launched WITHOUT automation flags has no such markers, so the user can
 * complete the challenge once and the app scrapes through that same browser.
 */

const CHALLENGE_URLS: Record<CloudflarePlatform, string> = {
  surugaya: 'https://www.suruga-ya.jp/',
  zenmarket: 'https://zenmarket.jp/'
}

const DOMAIN_SUFFIXES: Record<CloudflarePlatform, string> = {
  surugaya: 'suruga-ya.jp',
  zenmarket: 'zenmarket.jp'
}

const POLL_INTERVAL_MS = 500
const CHALLENGE_TIMEOUT_MS = 5 * 60 * 1000

interface Session {
  proc: ChildProcess
  browser: Browser
  page: Page
  lock: Promise<void>
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

async function launchChrome(): Promise<Session> {
  const chromePath = findChromeExecutable()
  if (!chromePath) {
    logger.warn('cloudflare.chrome', 'Chrome executable not found')
    throw new Error('未找到 Google Chrome，请先安装（或将 CHROME_PATH 指向 Chrome 可执行文件）')
  }

  const dir = profileDir ?? join(tmpdir(), 'super-cd-search-chrome')
  logger.debug('cloudflare.chrome', 'launching real Chrome', { chromePath, profileDir: dir })
  mkdirSync(dir, { recursive: true })

  const proc = spawn(
    chromePath,
    [
      '--remote-debugging-port=0',
      `--user-data-dir=${dir}`,
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank'
    ],
    { stdio: 'ignore' }
  )

  const port = await waitForDevToolsPort(dir)
  logger.debug('cloudflare.chrome', 'connected to real Chrome over CDP', { port })
  const browser = await puppeteer.connect({
    browserURL: `http://127.0.0.1:${port}`,
    defaultViewport: null
  })
  const page = await browser.newPage()

  // If the user closes the Chrome window manually, clear the session so the
  // next search reports "challenge" instead of erroring on a dead connection.
  proc.once('exit', () => {
    logger.debug('cloudflare.chrome', 'real Chrome process exited')
    if (session?.proc === proc) {
      session = null
    }
  })

  return { proc, browser, page, lock: Promise.resolve() }
}

async function ensureSession(): Promise<Session> {
  if (session) return session
  if (launching) return launching

  launching = launchChrome()
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

/** Serialize access to the single shared scrape page. */
async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const s = await ensureSession()
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

/** Open the platform home page and wait for the user to pass the challenge. */
export async function startCloudflareChallenge(platform: CloudflarePlatform): Promise<CloudflareChallengeResult> {
  cancelRequested = false
  logger.debug('cloudflare.chrome', 'start challenge flow', { platform, challengeUrl: CHALLENGE_URLS[platform] })
  try {
    return await withPage(async (page) => {
      await page.goto(CHALLENGE_URLS[platform], { waitUntil: 'domcontentloaded', timeout: 45000 })

      const deadline = Date.now() + CHALLENGE_TIMEOUT_MS
      while (Date.now() < deadline) {
        if (cancelRequested) {
          logger.debug('cloudflare.chrome', 'challenge cancelled by user', { platform })
          return { status: 'cancelled' as const }
        }
        const cookies = await page.cookies().catch(() => [])
        const clearance = cookies.find(
          (c) => c.name === 'cf_clearance' && c.domain.includes(DOMAIN_SUFFIXES[platform]) && c.value
        )
        if (clearance && !(await isCloudflareChallenge(page))) {
          logger.debug('cloudflare.chrome', 'challenge verified', { platform, expiresAt: clearance.expires ? clearance.expires * 1000 : undefined })
          return { status: 'done' as const }
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
      }
      logger.warn('cloudflare.chrome', 'challenge verification timed out', { platform })
      return { status: 'error' as const, error: '验证超时：未检测到 cf_clearance' }
    })
  } catch (err) {
    logger.warn('cloudflare.chrome', 'challenge flow failed', { platform, error: err instanceof Error ? err.message : String(err) })
    return { status: 'error' as const, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export function cancelCloudflareChallenge(): void {
  cancelRequested = true
}

export async function getCloudflareStatus(platform: CloudflarePlatform): Promise<CloudflareSessionStatus> {
  if (launching) return { state: 'starting' }
  if (!session) return { state: 'not_started' }

  const cookies = await session.page.cookies().catch(() => [])
  const clearance = cookies.find(
    (c) => c.name === 'cf_clearance' && c.domain.includes(DOMAIN_SUFFIXES[platform])
  )
  if (!clearance || !clearance.value) return { state: 'unverified' }

  if (clearance.expires && clearance.expires * 1000 <= Date.now()) {
    return { state: 'expired' }
  }
  return {
    state: 'verified',
    expiresAt: clearance.expires ? clearance.expires * 1000 : undefined
  }
}

export interface AcquiredCloudflarePage {
  page: Page
  release: () => void
}

/**
 * Acquire the shared scrape page, or null when Chrome is not running. Query
 * modules use this instead of the headless browser pool.
 */
export async function acquireCloudflarePage(): Promise<AcquiredCloudflarePage | null> {
  if (!session) {
    logger.debug('cloudflare.chrome', 'acquire requested but no real-Chrome session')
    return null
  }

  let release!: () => void
  const previous = session.lock
  session.lock = new Promise<void>((resolve) => {
    release = resolve
  })
  await previous
  logger.debug('cloudflare.chrome', 'real-Chrome page acquired')

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
  if (session) {
    logger.debug('cloudflare.chrome', 'closing real-Chrome session')
    await session.browser.disconnect().catch(() => {})
    await killChrome(session.proc)
    session = null
  }
}
