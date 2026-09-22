import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'

const { mockClearShimoSession } = vi.hoisted(() => ({
  mockClearShimoSession: vi.fn()
}))

vi.mock('../src/main/shimo/session', () => ({
  clearShimoSession: mockClearShimoSession
}))

import { registerShimoIpc } from '../src/main/ipc/shimo'

type Handler = (...args: unknown[]) => Promise<unknown>

function shimoHandler(): Handler {
  registerShimoIpc()
  const calls = vi.mocked(ipcMain.handle).mock.calls.filter(([channel]) => channel === 'shimo:clear-session')
  expect(calls.length).toBe(1)
  return calls[0][1] as Handler
}

describe('shimo IPC', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockClearShimoSession.mockResolvedValue(undefined)
  })

  it('registers shimo:clear-session exactly once', () => {
    shimoHandler()
    expect(vi.mocked(ipcMain.handle)).toHaveBeenCalledTimes(1)
  })

  it('clears the embedded page session and reports ok', async () => {
    const handler = shimoHandler()
    await expect(handler({})).resolves.toEqual({ ok: true })
    expect(mockClearShimoSession).toHaveBeenCalledTimes(1)
  })

  it('never rejects: failures come back as ok:false with a message', async () => {
    mockClearShimoSession.mockRejectedValue(new Error('session busy'))
    const handler = shimoHandler()
    await expect(handler({})).resolves.toEqual({ ok: false, message: 'session busy' })
  })
})
