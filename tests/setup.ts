import { vi } from 'vitest'

// Electron cannot run under plain Node; provide module-level stubs for the
// pieces imported by main/preload modules so unit tests can run in isolation.
vi.mock('electron', () => {
  const handle = vi.fn()
  return {
    app: {
      getPath: vi.fn(() => '/tmp'),
      getVersion: vi.fn(() => '1.0.0'),
      isPackaged: true,
      whenReady: vi.fn(() => Promise.resolve()),
      on: vi.fn(),
      quit: vi.fn()
    },
    BrowserWindow: {
      getAllWindows: vi.fn(() => []),
      getFocusedWindow: vi.fn(() => null)
    },
    ipcMain: { handle, on: vi.fn() },
    dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() },
    shell: { openExternal: vi.fn() },
    contextBridge: { exposeInMainWorld: vi.fn() },
    ipcRenderer: {
      invoke: vi.fn(),
      send: vi.fn(),
      on: vi.fn()
    },
    nativeImage: {
      createFromBuffer: vi.fn(() => ({
        isEmpty: () => true,
        resize: vi.fn(() => ({ toJPEG: vi.fn(() => Buffer.alloc(0)) }))
      }))
    }
  }
})

// electron-store requires a running Electron app; replace it with a tiny
// in-memory store so settings code is testable under Node.
vi.mock('electron-store', () => {
  class MockStore {
    private data: Record<string, unknown>

    constructor(init: { defaults?: Record<string, unknown> } = {}) {
      this.data = { ...(init.defaults || {}) }
    }

    get(key: string) {
      return this.data[key]
    }

    /**
     * electron-store accepts both `set(key, value)` and `set(object)`, and the
     * app relies on the object form (`updateSettings`). Supporting only the
     * two-argument form would silently drop those writes in tests.
     */
    set(key: string | Record<string, unknown>, value?: unknown) {
      if (typeof key === 'object' && key !== null) {
        Object.assign(this.data, key)
        return
      }
      this.data[key] = value
    }

    delete(key: string) {
      delete this.data[key]
    }

    get store() {
      return this.data
    }
  }

  return { default: MockStore }
})

// getEncryptionKey() short-circuits when this env var is present, avoiding a
// CommonJS-only require('crypto') call inside ESM test execution.
process.env.SETTINGS_ENCRYPTION_KEY = 'a'.repeat(32)
