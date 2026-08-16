import { describe, expect, it, vi } from 'vitest'
import type { Page } from 'puppeteer'
import { abortableDelay, createAbortError, gotoWithAbort, throwIfAborted } from '../src/main/browser/abort'

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
