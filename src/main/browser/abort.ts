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
 * A distinguishable timeout error. `withTimeout` rejects with it so callers can
 * tell "the whole operation overran its budget" apart from "the user cancelled".
 */
export function createTimeoutError(message: string): Error {
  const error = new Error(message)
  error.name = 'TimeoutError'
  return error
}

/** Whether an error was raised by `withTimeout`'s deadline. */
export function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.name === 'TimeoutError'
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

/**
 * Put a wall-clock ceiling on a whole operation, not just on its individual
 * waits. Channels such as Taobao's image search chain several bounded steps
 * (navigation, upload polling, result-tab wait, grid wait) whose timeouts add
 * up to more than any one of them; this is the single hard cap.
 *
 * `work` receives a derived signal so hitting the deadline does not merely
 * abandon the promise — it stops what is still running: `gotoWithAbort` halts
 * the navigation and `abortableDelay` breaks out of its poll loops, which lets
 * the channel's `finally` release the shared Chrome page immediately instead of
 * blocking the next catalog number on a scrape nobody is waiting for anymore.
 *
 * Resolution rules:
 * - completed in time → its value is returned unchanged;
 * - deadline hit → rejects with a TimeoutError carrying `message`. Any
 *   AbortError the aborted child signal provokes is normalised into that
 *   TimeoutError: `controller.abort()` rejects pending `abortableDelay`s
 *   synchronously, so the race would otherwise surface an AbortError first;
 * - `parent` (the batch signal) aborted → that AbortError propagates untouched
 *   so the orchestrator still treats it as a user cancellation.
 */
export async function withTimeout<T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  message: string,
  parent?: AbortSignal
): Promise<T> {
  throwIfAborted(parent)

  const controller = new AbortController()
  let timedOut = false
  const forwardAbort = () => controller.abort()
  parent?.addEventListener('abort', forwardAbort, { once: true })

  // The work is abandoned (not awaited) once the deadline fires, so swallow its
  // late rejection here — otherwise it surfaces as an unhandled rejection.
  const workPromise = work(controller.signal)
  workPromise.catch(() => {})

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      controller.abort()
      reject(createTimeoutError(message))
    }, timeoutMs)
  })

  try {
    return await Promise.race([workPromise, timeoutPromise])
  } catch (err) {
    // A parent cancellation wins over the deadline when both fire together.
    if (timedOut && !parent?.aborted) throw createTimeoutError(message)
    throw err
  } finally {
    if (timer) clearTimeout(timer)
    parent?.removeEventListener('abort', forwardAbort)
  }
}
