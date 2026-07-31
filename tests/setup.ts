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
    ipcMain: { handle },
    dialog: { showSaveDialog: vi.fn() },
    shell: { openExternal: vi.fn() },
    contextBridge: { exposeInMainWorld: vi.fn() },
    ipcRenderer: {
      invoke: vi.fn(),
      send: vi.fn(),
      on: vi.fn()
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

// better-sqlite3 in node_modules is compiled for Electron's Node ABI, which
// plain Node (and therefore vitest) cannot load. Node 24 ships a built-in
// SQLite engine with a very similar API, so tests run against real SQLite
// through this thin compatibility wrapper.
vi.mock('better-sqlite3', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DatabaseSync } = require('node:sqlite')

  class BetterSqlite3Compat {
    private db: InstanceType<typeof DatabaseSync>

    constructor(path: string) {
      this.db = new DatabaseSync(path)
    }

    pragma(sql: string) {
      return this.db.exec(`PRAGMA ${sql}`)
    }

    exec(sql: string) {
      return this.db.exec(sql)
    }

    prepare(sql: string) {
      const stmt = this.db.prepare(sql)
      return {
        run: (...args: unknown[]) => {
          const result = stmt.run(...(args as never[]))
          return {
            lastInsertRowid: Number(result.lastInsertRowid),
            changes: Number(result.changes)
          }
        },
        get: (...args: unknown[]) => stmt.get(...(args as never[])),
        all: (...args: unknown[]) => stmt.all(...(args as never[]))
      }
    }

    transaction(fn: (...args: never[]) => unknown) {
      return (...args: never[]) => {
        this.db.exec('BEGIN')
        try {
          const result = fn(...args)
          this.db.exec('COMMIT')
          return result
        } catch (err) {
          this.db.exec('ROLLBACK')
          throw err
        }
      }
    }

    close() {
      this.db.close()
    }
  }

  return { default: BetterSqlite3Compat }
})

// getEncryptionKey() short-circuits when this env var is present, avoiding a
// CommonJS-only require('crypto') call inside ESM test execution.
process.env.SETTINGS_ENCRYPTION_KEY = 'a'.repeat(32)
