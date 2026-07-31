import { vi } from 'vitest'
import { JSDOM } from 'jsdom'

/**
 * Build a page.evaluate mock that actually runs the callback against a jsdom
 * window, so the DOM-extraction logic inside the query modules is exercised
 * instead of being skipped by a canned return value.
 */
export function createDomEvaluate(htmls: string[]) {
  let index = 0
  return vi.fn(async (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => {
    const html = htmls[Math.min(index, htmls.length - 1)]
    index++

    const dom = new JSDOM(html)
    // jsdom does not implement innerText; the scrapers rely on it.
    Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', {
      configurable: true,
      get() {
        return this.textContent || ''
      }
    })

    const g = globalThis as Record<string, unknown>
    const prevDocument = g.document
    const prevWindow = g.window
    g.document = dom.window.document
    g.window = dom.window
    try {
      return await fn(...args)
    } finally {
      if (prevDocument === undefined) delete g.document
      else g.document = prevDocument
      if (prevWindow === undefined) delete g.window
      else g.window = prevWindow
    }
  })
}
