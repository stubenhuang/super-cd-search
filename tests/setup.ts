import { vi } from 'vitest'

// Electron cannot run under plain Node; provide module-level stubs for the
// pieces imported by main/preload modules so unit tests can run in isolation.
vi.mock('electron', () => {
  const handle = vi.fn()
  return {
    app: {
      getPath: vi.fn(() => '/tmp'),
      whenReady: vi.fn(() => Promise.resolve()),
      on: vi.fn(),
      quit: vi.fn()
    },
    BrowserWindow: {
      getAllWindows: vi.fn(() => []),
      getFocusedWindow: vi.fn(() => null)
    },
    ipcMain: { handle, on: vi.fn() },
    dialog: { showSaveDialog: vi.fn() },
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

    set(key: string, value: unknown) {
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
