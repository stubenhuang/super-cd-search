import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BrowserWindow } from 'electron'
import { createServer } from 'net'
import type { AddressInfo } from 'net'
import type { LanSearchState } from '../src/shared/types'

const { mockIsBatchQueryRunning } = vi.hoisted(() => ({
  mockIsBatchQueryRunning: vi.fn(() => false)
}))

vi.mock('../src/main/orchestrator', () => ({
  isBatchQueryRunning: mockIsBatchQueryRunning
}))

import {
  applyLanServer,
  closeLanServer,
  getLanSearchState,
  handleLanFlowAction,
  handleLanSearchInput,
  handleLanSearchMode,
  handleLanSearchRun,
  setLanSearchAvailability,
  setLanSearchCatalogCount,
  setLanSearchState
} from '../src/main/lan'
import { setLanToken, setSetting } from '../src/main/settings'

async function getFreePort(): Promise<number> {
  return new Promise(resolve => {
    const probe = createServer()
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address() as AddressInfo
      probe.close(() => resolve(address.port))
    })
  })
}

function mockDesktopWindow(send = vi.fn()) {
  return { isDestroyed: () => false, webContents: { send } }
}

function mockSearchState(overrides: Partial<LanSearchState> = {}): LanSearchState {
  return {
    phase: 'idle',
    input: '',
    busy: false,
    searchMode: 'standard',
    catalogs: [],
    platforms: [],
    total: 0,
    completed: 0,
    percent: 0,
    progress: [],
    inserted: 0,
    updated: 0,
    error: null,
    ...overrides
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  mockIsBatchQueryRunning.mockReturnValue(false)
  setLanSearchAvailability(false)
  setLanSearchCatalogCount(0)
  setSetting('lanEnabled', true)
  setSetting('lanHost', '127.0.0.1')
  // A free port avoids EADDRINUSE races with other LAN test files that bind
  // the default port in parallel workers.
  setSetting('lanPort', await getFreePort())
  setLanToken('')
})

afterEach(async () => {
  setLanSearchAvailability(false)
  setLanSearchCatalogCount(0)
  setSetting('lanEnabled', false)
  await closeLanServer()
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([])
})

describe('setLanSearchState / getLanSearchState', () => {
  it('round-trips the snapshot pushed by the renderer', () => {
    setLanSearchState(mockSearchState({ phase: 'searching', input: 'TOCP-1', inserted: 2, updated: 1 }))
    expect(getLanSearchState()).toMatchObject({
      phase: 'searching',
      input: 'TOCP-1',
      inserted: 2,
      updated: 1
    })
  })
})

describe('handleLanSearchInput', () => {
  it('rejects edits while the desktop search controls are unavailable', async () => {
    await applyLanServer()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockDesktopWindow() as never])

    expect(handleLanSearchInput('TOCP-1')).toMatchObject({
      status: 'unavailable',
      message: expect.stringContaining('搜索')
    })
  })

  it('rejects text that is too long', async () => {
    await applyLanServer()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockDesktopWindow() as never])
    setLanSearchAvailability(true)

    expect(handleLanSearchInput('x'.repeat(501))).toMatchObject({ status: 'error' })
  })

  it('forwards the phone text to every desktop window', async () => {
    await applyLanServer()
    const send = vi.fn()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockDesktopWindow(send) as never])
    setLanSearchAvailability(true)

    expect(handleLanSearchInput('TOCP-1, VICP-2')).toEqual({ status: 'ok' })
    expect(send).toHaveBeenCalledWith('lan:input-changed', 'TOCP-1, VICP-2')
  })

  it('rejects edits when no desktop window is open', async () => {
    await applyLanServer()
    setLanSearchAvailability(true)

    expect(handleLanSearchInput('TOCP-1')).toMatchObject({ status: 'unavailable' })
  })
})

describe('handleLanSearchRun', () => {
  it('rejects when the desktop search box is empty', async () => {
    await applyLanServer()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockDesktopWindow() as never])
    setLanSearchAvailability(true)

    expect(await handleLanSearchRun()).toMatchObject({
      status: 'error',
      message: expect.stringContaining('搜索框为空')
    })
  })

  it('rejects while the desktop is busy', async () => {
    await applyLanServer()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockDesktopWindow() as never])
    setLanSearchCatalogCount(1)

    expect(await handleLanSearchRun()).toMatchObject({ status: 'unavailable' })
  })

  it('triggers the desktop search pipeline', async () => {
    await applyLanServer()
    const send = vi.fn()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockDesktopWindow(send) as never])
    setLanSearchAvailability(true)
    setLanSearchCatalogCount(1)

    expect(await handleLanSearchRun()).toEqual({ status: 'ok' })
    expect(send).toHaveBeenCalledWith('lan:search-requested')
  })

  it('waits briefly for an in-flight phone edit before rejecting an empty box', async () => {
    await applyLanServer()
    const send = vi.fn()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockDesktopWindow(send) as never])
    setLanSearchAvailability(true)

    const pending = handleLanSearchRun()
    // The catalog count arrives while the grace period is running.
    setTimeout(() => setLanSearchCatalogCount(1), 50)
    expect(await pending).toEqual({ status: 'ok' })
    expect(send).toHaveBeenCalledWith('lan:search-requested')
  })
})

describe('handleLanSearchMode', () => {
  it('rejects invalid modes', async () => {
    await applyLanServer()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockDesktopWindow() as never])
    setLanSearchAvailability(true)

    expect(handleLanSearchMode('bogus')).toMatchObject({ status: 'error' })
  })

  it('rejects mode switches while the desktop is busy', async () => {
    await applyLanServer()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockDesktopWindow() as never])

    expect(handleLanSearchMode('deep')).toMatchObject({
      status: 'unavailable',
      message: expect.stringContaining('搜索')
    })
  })

  it('forwards the mode to every desktop window', async () => {
    await applyLanServer()
    const send = vi.fn()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockDesktopWindow(send) as never])
    setLanSearchAvailability(true)

    expect(handleLanSearchMode('deep')).toEqual({ status: 'ok' })
    expect(send).toHaveBeenCalledWith('lan:mode-changed', 'deep')
  })
})

describe('handleLanFlowAction', () => {
  it('rejects flow actions while the desktop is busy', async () => {
    await applyLanServer()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockDesktopWindow() as never])

    expect(handleLanFlowAction('confirm')).toMatchObject({
      status: 'unavailable',
      message: expect.stringContaining('搜索')
    })
  })

  it('forwards confirm / skip / close to the matching channels', async () => {
    await applyLanServer()
    const send = vi.fn()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockDesktopWindow(send) as never])
    setLanSearchAvailability(true)

    expect(handleLanFlowAction('confirm')).toEqual({ status: 'ok' })
    expect(handleLanFlowAction('skip')).toEqual({ status: 'ok' })
    expect(handleLanFlowAction('close')).toEqual({ status: 'ok' })
    expect(send).toHaveBeenNthCalledWith(1, 'lan:flow-confirm')
    expect(send).toHaveBeenNthCalledWith(2, 'lan:flow-skip')
    expect(send).toHaveBeenNthCalledWith(3, 'lan:flow-close')
  })
})
