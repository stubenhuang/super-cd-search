import { spawn, type ChildProcess } from 'child_process'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import puppeteer from 'puppeteer-core'
import type { Browser, Page } from 'puppeteer-core'
import { isCloudflareChallenge } from './detect'
import type { CloudflarePlatform, CloudflareChallengeResult, CloudflareSessionStatus } from '../../shared/types'

/**
 * A real Chrome instance driven over the DevTools protocol (CDP).
 *
 * Modern Cloudflare Turnstile flags puppeteer-launched Chromium (even headed,
 * even with the legacy stealth plugin) and loops the challenge forever. A real
 * Chrome launched WITHOUT automation flags has no such markers, so the user can
 * complete the challenge once and the app scrapes through that same browser.
 */

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
]

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

function getChromePath(): string | null {
  const fromEnv = process.env.CHROME_PATH
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  for (const candidate of CHROME_CANDIDATES) {
    if (existsSync(candidate)) return candidate
  }
  return null
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
  const chromePath = getChromePath()
  if (!chromePath) {
    throw new Error('未找到 Google Chrome，请先安装（或将 CHROME_PATH 指向 Chrome 可执行文件）')
  }

  const dir = profileDir ?? join(tmpdir(), 'super-cd-search-chrome')
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
  const browser = await puppeteer.connect({
    browserURL: `http://127.0.0.1:${port}`,
    defaultViewport: null
  })
  const page = await browser.newPage()

  // If the user closes the Chrome window manually, clear the session so the
  // next search reports "challenge" instead of erroring on a dead connection.
  proc.once('exit', () => {
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
  try {
    return await withPage(async (page) => {
      await page.goto(CHALLENGE_URLS[platform], { waitUntil: 'domcontentloaded', timeout: 45000 })

      const deadline = Date.now() + CHALLENGE_TIMEOUT_MS
      while (Date.now() < deadline) {
        if (cancelRequested) {
          return { status: 'cancelled' as const }
        }
        const cookies = await page.cookies().catch(() => [])
        const clearance = cookies.find(
          (c) => c.name === 'cf_clearance' && c.domain.includes(DOMAIN_SUFFIXES[platform]) && c.value
        )
        if (clearance && !(await isCloudflareChallenge(page))) {
          return { status: 'done' as const }
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
      }
      return { status: 'error' as const, error: '验证超时：未检测到 cf_clearance' }
    })
  } catch (err) {
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
  if (!session) return null

  let release!: () => void
  const previous = session.lock
  session.lock = new Promise<void>((resolve) => {
    release = resolve
  })
  await previous

  return { page: session.page, release }
}

export async function closeCloudflareChrome(): Promise<void> {
  if (session) {
    await session.browser.disconnect().catch(() => {})
    try {
      session.proc.kill('SIGKILL')
    } catch {
      // Already exited.
    }
    session = null
  }
}
