import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Page } from 'puppeteer'
import {
  abortableDelay,
  createAbortError,
  createTimeoutError,
  gotoWithAbort,
  isTimeoutError,
  throwIfAborted,
  withTimeout
} from '../src/main/browser/abort'

function pageWithGoto(goto: ReturnType<typeof vi.fn>) {
  return {
    goto,
    evaluate: vi.fn().mockResolvedValue(undefined)
  } as unknown as Page
}

describe('browser abort helpers', () => {
  it('creates and throws a named abort error', () => {
    expect(createAbortError()).toMatchObject({ name: 'AbortError', message: 'Aborted' })
    expect(() => throwIfAborted()).not.toThrow()
    const controller = new AbortController()
    controller.abort()
    expect(() => throwIfAborted(controller.signal)).toThrow(expect.objectContaining({ name: 'AbortError' }))
  })

  it('navigates normally without a signal', async () => {
    const goto = vi.fn().mockResolvedValue(null)
    await gotoWithAbort(pageWithGoto(goto), 'https://example.com', { timeout: 100 })
    expect(goto).toHaveBeenCalledWith('https://example.com', { timeout: 100 })
  })

  it('stops an active navigation when cancelled', async () => {
    const goto = vi.fn(() => new Promise(() => {}))
    const page = pageWithGoto(goto)
    const controller = new AbortController()
    const navigation = gotoWithAbort(page, 'https://example.com', { timeout: 100 }, controller.signal)
    const assertion = expect(navigation).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await assertion
    expect(page.evaluate).toHaveBeenCalled()
  })

  it('supports normal and cancelled delays', async () => {
    vi.useFakeTimers()
    try {
      const normal = abortableDelay(10)
      await vi.advanceTimersByTimeAsync(10)
      await normal

      const controller = new AbortController()
      const cancelled = abortableDelay(100, controller.signal)
      const assertion = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
      controller.abort()
      await assertion

      const completed = abortableDelay(20, new AbortController().signal)
      await vi.advanceTimersByTimeAsync(20)
      await completed
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('timeout errors', () => {
  it('creates a named timeout error and recognises only those', () => {
    const error = createTimeoutError('淘宝图搜超时')
    expect(error).toMatchObject({ name: 'TimeoutError', message: '淘宝图搜超时' })
    expect(isTimeoutError(error)).toBe(true)
    // A user cancellation is not a timeout; neither is a plain failure.
    expect(isTimeoutError(createAbortError())).toBe(false)
    expect(isTimeoutError(new Error('boom'))).toBe(false)
    expect(isTimeoutError('boom')).toBe(false)
  })
})

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the work value untouched when it finishes before the deadline', async () => {
    const pending = withTimeout(async () => {
      await abortableDelay(10)
      return 'scraped'
    }, 90_000, 'slow')
    await vi.advanceTimersByTimeAsync(10)
    await expect(pending).resolves.toBe('scraped')
  })

  it('rejects with a TimeoutError carrying the caller message once the deadline passes', async () => {
    const pending = withTimeout(() => new Promise<string>(() => {}), 90_000, '淘宝图搜超时')
    const assertion = expect(pending).rejects.toMatchObject({ name: 'TimeoutError', message: '淘宝图搜超时' })
    await vi.advanceTimersByTimeAsync(90_000)
    await assertion
  })

  it('aborts the derived signal so in-flight waits stop, yet still reports a timeout', async () => {
    let childSignal: AbortSignal | undefined
    const pending = withTimeout(async (signal) => {
      childSignal = signal
      // Outlives the deadline: abortableDelay rejects synchronously when the
      // signal aborts, so this AbortError would win the race (and be reported
      // to the caller) without the timeout normalisation.
      await abortableDelay(120_000, signal)
      return 'never'
    }, 90_000, '淘宝图搜超时')

    const assertion = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(90_000)
    await assertion
    expect(childSignal?.aborted).toBe(true)
  })

  it('propagates a parent cancellation as an AbortError instead of a timeout', async () => {
    const parent = new AbortController()
    const pending = withTimeout(
      (signal) => new Promise<string>((_, reject) => {
        signal.addEventListener('abort', () => reject(createAbortError()), { once: true })
      }),
      90_000,
      '淘宝图搜超时',
      parent.signal
    )

    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(30_000)
    parent.abort()
    await assertion
  })

  it('refuses to start when the parent is already aborted', async () => {
    const parent = new AbortController()
    parent.abort()
    await expect(withTimeout(async () => 'scraped', 90_000, 'slow', parent.signal))
      .rejects.toMatchObject({ name: 'AbortError' })
  })

  it('swallows the abandoned work rejection so it never becomes an unhandled rejection', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const pending = withTimeout(
        () => new Promise<string>((_, reject) => {
          // Rejects long after the deadline fired — the work is already abandoned.
          setTimeout(() => reject(new Error('late failure')), 120_000)
        }),
        90_000,
        '淘宝图搜超时'
      )

      const assertion = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' })
      await vi.advanceTimersByTimeAsync(90_000)
      await assertion

      await vi.advanceTimersByTimeAsync(120_000)
      for (let tick = 0; tick < 5; tick++) await new Promise(resolve => process.nextTick(resolve))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })
})
