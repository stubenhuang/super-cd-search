import type { Page, WaitForOptions } from 'puppeteer'

export function createAbortError(): Error {
  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError()
}

/**
 * Puppeteer does not accept an AbortSignal for page.goto. Race navigation with
 * the batch signal and stop the document so a cancelled task releases its pool
 * slot promptly instead of waiting for the full navigation timeout.
 */
export async function gotoWithAbort(
  page: Page,
  url: string,
  options: WaitForOptions,
  signal?: AbortSignal
): Promise<void> {
  throwIfAborted(signal)
  if (!signal) {
    await page.goto(url, options)
    return
  }

  let onAbort: (() => void) | undefined
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => {
      void page.evaluate(() => window.stop()).catch(() => {})
      reject(createAbortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })

  try {
    await Promise.race([page.goto(url, options), aborted])
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}

export async function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal)
  if (!signal) {
    await new Promise(resolve => setTimeout(resolve, ms))
    return
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(createAbortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
