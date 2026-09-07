import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { app } from 'electron'
import {
  compareVersions,
  isNewerVersion,
  isVisibleUpdateStatus,
  normalizeVersion,
  parseVersion
} from '../src/shared/updater'

const { autoUpdater, emit } = vi.hoisted(() => {
  const listeners: Record<string, (arg?: unknown) => void> = {}
  const autoUpdater = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowDowngrade: true,
    logger: null as unknown,
    on: vi.fn((event: string, cb: (arg?: unknown) => void) => {
      listeners[event] = cb
    }),
    checkForUpdates: vi.fn(async () => ({ updateInfo: { version: '1.0.1' } })),
    downloadUpdate: vi.fn(async () => []),
    quitAndInstall: vi.fn()
  }
  return {
    autoUpdater,
    emit: (event: string, arg?: unknown) => {
      listeners[event]?.(arg)
    }
  }
})

vi.mock('electron-updater', () => ({ autoUpdater }))
vi.mock('../src/main/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))
vi.mock('../src/main/settings', () => ({
  getSetting: vi.fn(() => true)
}))

async function loadUpdater() {
  vi.resetModules()
  return import('../src/main/updater')
}

describe('shared updater helpers', () => {
  it('normalizes tag-style versions', () => {
    expect(normalizeVersion('v1.2.3')).toBe('1.2.3')
    expect(normalizeVersion('  V2.0.0 ')).toBe('2.0.0')
    expect(normalizeVersion(undefined)).toBe('')
  })

  it('parses versions with optional segments and pre-release tags', () => {
    expect(parseVersion('1.2.3')).toEqual({ numbers: [1, 2, 3], prerelease: null })
    expect(parseVersion('v2.0')).toEqual({ numbers: [2, 0, 0], prerelease: null })
    expect(parseVersion('1.0.0-beta.1')?.prerelease).toBe('beta.1')
    expect(parseVersion('not-a-version')).toBeNull()
  })

  it('compares versions semver-style', () => {
    expect(compareVersions('1.0.1', '1.0.0')).toBe(1)
    expect(compareVersions('1.0.0', '1.0.1')).toBe(-1)
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1)
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.0.0', '1.0.0-beta.1')).toBe(1)
    expect(compareVersions('1.0.0-beta.1', '1.0.0-beta.2')).toBe(-1)
    expect(compareVersions('garbage', '1.0.0')).toBe(-1)
    expect(compareVersions('garbage', 'also-garbage')).toBe(0)
  })

  it('detects newer versions only', () => {
    expect(isNewerVersion('1.0.1', '1.0.0')).toBe(true)
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false)
    expect(isNewerVersion('0.9.9', '1.0.0')).toBe(false)
  })

  it('only surfaces statuses worth showing in the banner', () => {
    expect(isVisibleUpdateStatus('available')).toBe(true)
    expect(isVisibleUpdateStatus('downloading')).toBe(true)
    expect(isVisibleUpdateStatus('downloaded')).toBe(true)
    expect(isVisibleUpdateStatus('idle')).toBe(false)
    expect(isVisibleUpdateStatus('not-available')).toBe(false)
  })
})

describe('main updater', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(app as unknown as { isPackaged: boolean }).isPackaged = true
    delete process.env.PORTABLE_EXECUTABLE_DIR
    delete process.env.PORTABLE_EXECUTABLE_APP_FILENAME
    autoUpdater.checkForUpdates.mockResolvedValue({ updateInfo: { version: '1.0.1' } })
    autoUpdater.downloadUpdate.mockResolvedValue([])
  })

  afterEach(async () => {
    const { disposeUpdater } = await import('../src/main/updater')
    disposeUpdater()
  })

  it('reports unsupported for dev builds', async () => {
    ;(app as unknown as { isPackaged: boolean }).isPackaged = false
    const { initUpdater, checkForUpdates, getUpdateState } = await loadUpdater()
    initUpdater()
    await checkForUpdates(true)
    expect(getUpdateState().status).toBe('unsupported')
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('reports unsupported for the Windows portable build', async () => {
    process.env.PORTABLE_EXECUTABLE_DIR = 'C:\\tmp\\portable'
    const { initUpdater, getUpdateState } = await loadUpdater()
    initUpdater()
    expect(getUpdateState().status).toBe('unsupported')
  })

  it('reports unsupported when the build has no app-update.yml', async () => {
    process.resourcesPath = '/nonexistent-resources'
    try {
      const { initUpdater, getUpdateState } = await loadUpdater()
      initUpdater()
      expect(getUpdateState().status).toBe('unsupported')
    } finally {
      delete process.resourcesPath
    }
  })

  it('downloads an available update automatically and reports progress', async () => {
    const { initUpdater, checkForUpdates, getUpdateState } = await loadUpdater()
    initUpdater()

    autoUpdater.checkForUpdates.mockImplementation(async () => {
      emit('update-available', { version: '1.0.1', releaseNotes: 'fixes' })
      return { updateInfo: { version: '1.0.1' } }
    })

    await checkForUpdates(false)
    expect(getUpdateState().status).toBe('downloading')
    expect(getUpdateState().latestVersion).toBe('1.0.1')
    expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1)

    emit('download-progress', { percent: 42.4 })
    expect(getUpdateState().progress).toBe(42)

    emit('update-downloaded', { version: '1.0.1' })
    expect(getUpdateState().status).toBe('downloaded')
    expect(getUpdateState().progress).toBe(100)
  })

  it('falls back to the resolved update info when no event fires', async () => {
    const { initUpdater, checkForUpdates, getUpdateState } = await loadUpdater()
    initUpdater()
    await checkForUpdates(true)
    expect(getUpdateState().status).toBe('downloading')
    expect(getUpdateState().latestVersion).toBe('1.0.1')
  })

  it('marks the app as up to date when the version matches', async () => {
    autoUpdater.checkForUpdates.mockResolvedValue({ updateInfo: { version: '1.0.0' } })
    const { initUpdater, checkForUpdates, getUpdateState } = await loadUpdater()
    initUpdater()
    await checkForUpdates(true)
    expect(getUpdateState().status).toBe('not-available')
    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('records errors from the updater', async () => {
    autoUpdater.checkForUpdates.mockRejectedValue(new Error('network down'))
    const { initUpdater, checkForUpdates, getUpdateState } = await loadUpdater()
    initUpdater()
    await checkForUpdates(true)
    expect(getUpdateState().status).toBe('error')
    expect(getUpdateState().error).toBe('network down')
  })

  it('installs only a downloaded update', async () => {
    const { initUpdater, checkForUpdates, installUpdate } = await loadUpdater()
    initUpdater()
    autoUpdater.checkForUpdates.mockImplementation(async () => {
      emit('update-available', { version: '1.0.1' })
      return { updateInfo: { version: '1.0.1' } }
    })
    await checkForUpdates(false)

    installUpdate()
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled()

    emit('update-downloaded', { version: '1.0.1' })
    installUpdate()
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true)
  })
})
