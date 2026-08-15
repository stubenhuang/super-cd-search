import { type Browser, type Page } from 'puppeteer'
import { puppeteer } from './puppeteer'
import { findChromeExecutable } from './chrome-path'
import { generateFingerprint, type Fingerprint } from './fingerprint'
import { getSetting } from '../settings'
import { logger } from '../logger'

const MAX_CONCURRENT = 3

// Resource types that are never needed for scraping: the cover URL is read
// from the DOM attribute, so the actual bytes can be skipped.
const BLOCKED_RESOURCE_TYPES = new Set(['image', 'media', 'font'])

// A 1x1 transparent GIF served in place of real images. Aborting the request
// instead would make <img> elements fire their `onerror` handler — Tower
// Records uses onerror to swap the cover `src` for a placeholder, corrupting
// the URL we later read from the DOM. Responding with a valid image keeps the
// original `src` attribute intact.
const EMPTY_IMAGE_BODY = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
)

interface BrowserInstance {
  browser: Browser
  fingerprint: Fingerprint
  inUse: boolean
  page: Page | null
}

interface AcquiredInstance {
  browser: Browser
  page: Page
  fingerprint: Fingerprint
}

class BrowserPool {
  private instances: BrowserInstance[] = []
  private waitQueue: Array<{
    resolve: (instance: AcquiredInstance) => void
    reject: (error: Error) => void
  }> = []

  async acquire(): Promise<AcquiredInstance> {
    const available = this.instances.find(i => !i.inUse)

    if (available) {
      logger.debug('browser.pool', 'reusing available instance', { activeInstances: this.instances.length, queueLength: this.waitQueue.length })
      available.inUse = true
      const page = available.page ?? await this.createPage(available)
      available.page = page
      return { browser: available.browser, page, fingerprint: available.fingerprint }
    }

    if (this.instances.length < MAX_CONCURRENT) {
      logger.debug('browser.pool', 'creating new browser instance', { activeInstances: this.instances.length, maxConcurrent: MAX_CONCURRENT })
      const instance = await this.createInstance()
      this.instances.push(instance)
      instance.inUse = true
      const page = await this.createPage(instance)
      instance.page = page
      return { browser: instance.browser, page, fingerprint: instance.fingerprint }
    }

    logger.debug('browser.pool', 'all instances busy, queueing acquire', { activeInstances: this.instances.length, queueLength: this.waitQueue.length })
    return new Promise((resolve, reject) => {
      this.waitQueue.push({ resolve, reject })
    })
  }

  async release(browser: Browser, page: Page): Promise<void> {
    // Reuse the page instead of closing it: creating/destroying a page on every
    // lookup is wasted Chromium IPC. Only page-level state that persists across
    // navigations (extra HTTP headers) needs resetting.
    await this.resetPage(page)

    const instance = this.instances.find(i => i.browser === browser)
    if (!instance) {
      logger.debug('browser.pool', 'release for unknown instance', { activeInstances: this.instances.length })
      return
    }

    instance.inUse = false

    if (this.waitQueue.length > 0) {
      const waiter = this.waitQueue.shift()
      if (waiter) {
        logger.debug('browser.pool', 'handing released instance to queued waiter', { queueLength: this.waitQueue.length })
        instance.inUse = true
        waiter.resolve({ browser: instance.browser, page, fingerprint: instance.fingerprint })
      }
    } else {
      logger.debug('browser.pool', 'instance released', { activeInstances: this.instances.length, queueLength: this.waitQueue.length })
    }
  }

  async closeAll(): Promise<void> {
    logger.debug('browser.pool', 'closing all browser instances', { activeInstances: this.instances.length })
    await Promise.all(this.instances.map(i => i.browser.close()))
    this.instances = []
    this.waitQueue.forEach(w => w.reject(new Error('Browser pool closed')))
    this.waitQueue = []
  }

  private async createInstance(): Promise<BrowserInstance> {
    const fingerprint = generateFingerprint()
    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu'
    ]

    const proxyEnabled = getSetting('proxyEnabled')
    const proxyHost = getSetting('proxyHost')
    const proxyPort = getSetting('proxyPort')

    if (proxyEnabled && proxyHost && proxyPort) {
      args.push(`--proxy-server=socks5://${proxyHost}:${proxyPort}`)
      logger.debug('browser.pool', 'launching browser with SOCKS proxy', { proxyHost, proxyPort })
    }

    // Prefer a system Chrome/Edge install so headless scraping works even when
    // the bundled puppeteer Chromium is not shipped with the packaged app.
    // Fall back to puppeteer's default Chromium when no system browser exists.
    const chromePath = findChromeExecutable()
    logger.debug('browser.pool', 'launching browser', { chromePath: chromePath ?? 'puppeteer-bundled' })
    const browser = await puppeteer.launch({
      headless: true,
      ...(chromePath ? { executablePath: chromePath } : {}),
      args
    })

    return { browser, fingerprint, inUse: false, page: null }
  }

  /**
   * Reset page-level state that persists across navigations. Extra HTTP headers
   * set by one platform (e.g. eBay's UA/Accept-Language) would otherwise leak
   * into the next platform's requests and pollute its fingerprint.
   */
  private async resetPage(page: Page): Promise<void> {
    await page.setExtraHTTPHeaders({}).catch(() => {})
  }

  private async applyFingerprint(page: Page, fingerprint: Fingerprint): Promise<void> {
    await page.setUserAgent(fingerprint.userAgent)
    await page.setViewport(fingerprint.viewport)

    await page.evaluateOnNewDocument((webgl) => {
      const getParameter = WebGLRenderingContext.prototype.getParameter
      WebGLRenderingContext.prototype.getParameter = function(parameter) {
        if (parameter === 37445) return webgl.vendor
        if (parameter === 37446) return webgl.renderer
        return getParameter.call(this, parameter)
      }
    }, fingerprint.webgl)
  }

  private async createPage(instance: BrowserInstance): Promise<Page> {
    const page = await instance.browser.newPage()
    await this.applyFingerprint(page, instance.fingerprint)
    await this.configurePage(page)
    return page
  }

  private async configurePage(page: Page): Promise<void> {
    await page.setRequestInterception(true)
    page.on('request', (request) => {
      const type = request.resourceType()
      if (type === 'image') {
        request.respond({
          status: 200,
          contentType: 'image/gif',
          body: EMPTY_IMAGE_BODY
        }).catch(() => {})
      } else if (BLOCKED_RESOURCE_TYPES.has(type)) {
        request.abort().catch(() => {})
      } else {
        request.continue().catch(() => {})
      }
    })
  }
}

export const browserPool = new BrowserPool()
