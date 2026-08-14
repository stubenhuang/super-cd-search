import type { Page } from 'puppeteer'

/**
 * Wait for either the search-result selector or a "no results" marker to
 * appear, whichever comes first, so a page with zero hits fails fast instead of
 * idling until the full timeout.
 *
 * Return values:
 * - 'result'   the result selector matched
 * - 'no_result' a no-results marker matched
 * - 'timeout'  neither matched within `timeoutMs`
 */
export type WaitOutcome = 'result' | 'no_result' | 'timeout'

export interface WaitForResultOptions {
  resultSelector: string
  /**
   * CSS selectors that indicate the "no results" state. Empty by default, so
   * callers get a pure timeout reduction until each site's empty-state marker
   * is confirmed against its live DOM.
   */
  noResultSelectors?: string[]
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 4000

export async function waitForResultOrNoResult(
  page: Page,
  options: WaitForResultOptions
): Promise<WaitOutcome> {
  const { resultSelector, noResultSelectors = [], timeoutMs = DEFAULT_TIMEOUT_MS } = options

  const resultPromise = page
    .waitForSelector(resultSelector, { timeout: timeoutMs })
    .then(() => 'result' as const)

  if (noResultSelectors.length === 0) {
    return resultPromise.catch(() => 'timeout' as const)
  }

  const noResultPromise = page
    .waitForSelector(noResultSelectors.join(','), { timeout: timeoutMs })
    .then(() => 'no_result' as const)

  return Promise.race([resultPromise, noResultPromise]).catch(() => 'timeout' as const)
}
