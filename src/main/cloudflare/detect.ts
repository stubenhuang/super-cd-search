import type { Page } from 'puppeteer-core'

/**
 * Lightweight probe for a Cloudflare challenge page. Returns true when the
 * current document is the "Just a moment..." managed challenge, so query
 * modules can surface a distinct "needs verification" state.
 */
export async function isCloudflareChallenge(page: Page): Promise<boolean> {
  const probe = await page
    .evaluate(() => {
      const bodyText = (document.body?.textContent || '').slice(0, 1000)
      return `${document.title}\n${bodyText}`
    })
    .catch(() => '')

  return (
    probe.includes('Just a moment') ||
    probe.includes('Attention Required') ||
    probe.includes('Checking your browser') ||
    probe.includes('challenges.cloudflare.com')
  )
}
