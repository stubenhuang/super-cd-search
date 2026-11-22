import { readFileSync } from 'fs'
import { join } from 'path'
import puppeteer from 'puppeteer-core'
import type { Browser, Page } from 'puppeteer-core'
import { errorMessage } from '../../shared/utils'
import { logger } from '../logger'

/**
 * Launch/attach primitives for a real Chrome instance driven over the
 * DevTools protocol (CDP). Shared by the per-target publishing profiles (see
 * src/main/publish/profiles.ts) so every real-Chrome session behaves the same
 * way.
 */

/**
 * How a real Chrome runs. Headless sessions serve automation with no visible
 * window; headed sessions are needed for anything a human must see or
 * interact with (e.g. a QR-code login).
 */
export type ChromeSessionMode = 'headed' | 'headless'

/**
 * Classify a real-Chrome browser from its own user agent. A headless Chrome
 * advertises "HeadlessChrome"; its pages must present the masked normal-Chrome
 * UA when scraping (goofish answers the raw headless UA with a 非法访问
 * bot-wall instead of results), so the masked UA is returned for the caller to
 * apply on every page acquire. A headed browser needs no mask.
 */
export function describeBrowserSessionFromUa(ua: string): { maskedUa: string; mode: ChromeSessionMode } {
  if (ua.includes('HeadlessChrome')) {
    return { maskedUa: ua.replace('HeadlessChrome', 'Chrome'), mode: 'headless' }
  }
  return { maskedUa: '', mode: 'headed' }
}

export function waitForDevToolsPort(dir: string): Promise<number> {
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
 * for a few seconds instead of failing on the first attempt.
 */
export async function connectWithRetry(port: number): Promise<Browser> {
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
  logger.warn('browser.realChrome', 'CDP connect retries exhausted', { port, error: lastError instanceof Error ? lastError.message : String(lastError) })
  throw lastError instanceof Error ? lastError : new Error('连接真实 Chrome 失败')
}

/** On-screen position used while an interactive flow needs a human. */
const WINDOW_ON_SCREEN = { left: 80, top: 80 }
/** Off-screen parking spot matching the --window-position launch flag. */
const WINDOW_OFF_SCREEN = { left: -32000, top: -32000 }

/**
 * Park/unpark a real HEADED Chrome window. Best-effort and honest about
 * platform limits: macOS clamps window positions (a sliver always stays
 * visible) and ignores CDP minimize, so on Windows/Linux parking fully hides
 * the window while on macOS it only shrinks the footprint. A failed move must
 * never break the flow that triggered it.
 */
export async function setChromeWindowVisible(page: Page, visible: boolean): Promise<void> {
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
      logger.debug('browser.realChrome', 'window visibility moved', { visible })
    } finally {
      await cdp.detach().catch(() => {})
    }
  } catch (err) {
    logger.debug('browser.realChrome', 'window visibility move failed', {
      visible,
      error: errorMessage(err)
    })
  }
}
