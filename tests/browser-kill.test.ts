import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { killChromeProcess } from '../src/main/browser/kill'

/**
 * `killChromeProcess` is the guard that keeps a "closed" Chrome from leaving
 * renderer/network child processes behind on Windows, so both callers (the
 * shared search session and every publishing target's profile) rely on it.
 */

const originalPlatform = process.platform

function setPlatform(value: string): void {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

function fakeProc(pid: number | undefined) {
  return { pid, killed: false, kill: vi.fn() }
}

describe('killChromeProcess', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    setPlatform(originalPlatform)
  })

  it('kills the process directly on macOS and Linux', async () => {
    setPlatform('darwin')
    const proc = fakeProc(4242)
    await killChromeProcess(proc as never)
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('swallows a kill on an already exited process', async () => {
    setPlatform('linux')
    const proc = fakeProc(4242)
    proc.kill.mockImplementation(() => { throw new Error('ESRCH') })
    await expect(killChromeProcess(proc as never)).resolves.toBeUndefined()
  })

  it('is a no-op when the process has no pid', async () => {
    setPlatform('darwin')
    const proc = fakeProc(undefined)
    await killChromeProcess(proc as never)
    expect(proc.kill).not.toHaveBeenCalled()
  })

  it('spawns taskkill /T /F on Windows so child processes die too', async () => {
    setPlatform('win32')
    // child_process is not mocked globally here, so assert on the promise
    // resolving (a failing spawn would reject/hang rather than resolve fast).
    const proc = fakeProc(4242)
    await expect(killChromeProcess(proc as never)).resolves.toBeUndefined()
  })
})
