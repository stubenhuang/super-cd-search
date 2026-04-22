import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { type Browser, type Page, executablePath } from 'puppeteer'
import { generateFingerprint, type Fingerprint } from './fingerprint'

puppeteer.use(StealthPlugin())

const MAX_CONCURRENT = 2

interface BrowserInstance {
  browser: Browser
  fingerprint: Fingerprint
  inUse: boolean
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
      available.inUse = true
      const page = await available.browser.newPage()
      await this.applyFingerprint(page, available.fingerprint)
      return { browser: available.browser, page, fingerprint: available.fingerprint }
    }

    if (this.instances.length < MAX_CONCURRENT) {
      const instance = await this.createInstance()
      this.instances.push(instance)
      instance.inUse = true
      const page = await instance.browser.newPage()
      await this.applyFingerprint(page, instance.fingerprint)
      return { browser: instance.browser, page, fingerprint: instance.fingerprint }
    }

    return new Promise((resolve, reject) => {
      this.waitQueue.push({ resolve, reject })
    })
  }

  async release(browser: Browser): Promise<void> {
    const instance = this.instances.find(i => i.browser === browser)
    if (!instance) return

    instance.inUse = false

    if (this.waitQueue.length > 0) {
      const waiter = this.waitQueue.shift()
      if (waiter) {
        instance.inUse = true
        const page = await instance.browser.newPage()
        await this.applyFingerprint(page, instance.fingerprint)
        waiter.resolve({ browser: instance.browser, page, fingerprint: instance.fingerprint })
      }
    }
  }

  async closeAll(): Promise<void> {
    await Promise.all(this.instances.map(i => i.browser.close()))
    this.instances = []
    this.waitQueue.forEach(w => w.reject(new Error('Browser pool closed')))
    this.waitQueue = []
  }

  private async createInstance(): Promise<BrowserInstance> {
    const fingerprint = generateFingerprint()
    const browser = await puppeteer.launch({
      headless: false,
      executablePath: executablePath(),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ]
    })

    return { browser, fingerprint, inUse: false }
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
}

export const browserPool = new BrowserPool()
