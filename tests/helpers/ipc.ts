import { vi } from 'vitest'

/**
 * Small fixtures shared by the platform-query suites.
 *
 * The query modules wait on page state with 4s/20s/30s timeouts, so the suites
 * drive them with fake timers; the fetch stubs and the handler finders were
 * also copy-pasted between files.
 */

/** A `Response`-shaped stub for the throttled-fetch mocks. */
export function okJson(data: unknown) {
  return { ok: true, status: 200, json: async () => data }
}

/**
 * Run an async flow under fake timers, advancing far enough for every internal
 * `waitForSelector`/delay to settle. `totalMs` is generous by design: the
 * queries race several bounded waits, and a too-short budget turns them into
 * spurious timeouts.
 */
export async function runWithFakeTimers<T>(fn: () => Promise<T>, totalMs = 60000): Promise<T> {
  vi.useFakeTimers()
  const promise = fn()
  await vi.advanceTimersByTimeAsync(totalMs)
  vi.useRealTimers()
  return await promise
}

/**
 * Find the handler an `ipcMain.handle(channel, ...)` registered, so a suite can
 * invoke it directly without stubbing the whole Electron IPC layer.
 */
export function registeredHandler(ipcMainMock: { handle: { mock: { calls: unknown[][] } } }, channel: string) {
  const call = ipcMainMock.handle.mock.calls.find(([name]) => name === channel)
  return call?.[1] as ((...args: unknown[]) => unknown) | undefined
}
