import { createServer } from 'net'
import type { AddressInfo } from 'net'
import { vi } from 'vitest'
import type { LanSearchState } from '../../src/shared/types'
import { closeLanServer, setLanSearchAvailability, setLanSearchCatalogCount } from '../../src/main/lan'
import { deleteSetting, setLanToken, setSetting } from '../../src/main/settings'

/**
 * Fixtures shared by the LAN manager suites.
 *
 * The four LAN files each used to carry their own copy of the port probe, the
 * BrowserWindow stub and the reset teardown; keeping them here means a new LAN
 * test only writes what is actually specific to it.
 */

/** Bind a free port so parallel LAN suites cannot collide on the default one. */
export async function getFreePort(): Promise<number> {
  return new Promise(resolve => {
    const probe = createServer()
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address() as AddressInfo
      probe.close(() => resolve(address.port))
    })
  })
}

/** A live desktop window, which is what the LAN guards and broadcasts expect. */
export function mockDesktopWindow(send = vi.fn()) {
  return { isDestroyed: () => false, webContents: { send } }
}

/** A full LAN search snapshot; pass overrides for the fields under test. */
export function mockSearchState(overrides: Partial<LanSearchState> = {}): LanSearchState {
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
    error: null,
    ...overrides
  }
}

/** Reset the settings and the search-availability flags every LAN test needs. */
export async function resetLanSettings(): Promise<void> {
  setLanSearchAvailability(false)
  setLanSearchCatalogCount(0)
  setSetting('lanEnabled', false)
  setSetting('lanHost', '')
  deleteSetting('lanPort')
  setLanToken('')
}

/** Standard teardown: stop the server and forget the search availability. */
export async function closeLanAfterTest(): Promise<void> {
  setLanSearchAvailability(false)
  setLanSearchCatalogCount(0)
  setSetting('lanEnabled', false)
  await closeLanServer()
}
