import { existsSync } from 'fs'
import { join } from 'path'
import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { ProgressInfo, UpdateInfo } from 'electron-updater'
import { logger } from './logger'
import { getSetting } from './settings'
import { GITHUB_REPO_URL, isNewerVersion, normalizeVersion, type UpdateState } from '../shared/updater'

/** IPC channel used to push state changes to every renderer window. */
export const UPDATE_STATE_CHANNEL = 'updater:state'

/** Grace period after launch before the silent background check runs. */
const STARTUP_CHECK_DELAY_MS = 5_000

/** Release notes are shown in a small panel; keep them bounded. */
const MAX_RELEASE_NOTES_LENGTH = 2_000

let state: UpdateState = { status: 'idle', currentVersion: app.getVersion() }
let initialized = false
let startupTimer: ReturnType<typeof setTimeout> | null = null

/**
 * The Windows portable build cannot replace itself (electron-builder only
 * writes update metadata for the NSIS target), so auto-update stays off there
 * and the UI points at the installer instead.
 */
function isPortableBuild(): boolean {
  return Boolean(process.env.PORTABLE_EXECUTABLE_DIR || process.env.PORTABLE_EXECUTABLE_APP_FILENAME)
}

function isSupportedBuild(): boolean {
  if (!app.isPackaged || isPortableBuild()) return false
  // electron-builder only writes `app-update.yml` for targets that can
  // self-update (NSIS / dmg / zip). Dev and portable builds have none, and
  // electron-updater would throw instead of silently doing nothing.
  const resourcesPath = process.resourcesPath
  if (!resourcesPath) return true
  return existsSync(join(resourcesPath, 'app-update.yml'))
}

function setState(next: Partial<UpdateState>): void {
  state = { ...state, ...next }
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) continue
    window.webContents.send(UPDATE_STATE_CHANNEL, state)
  }
}

export function getUpdateState(): UpdateState {
  return state
}

/**
 * Read the status without letting TypeScript narrow the module-level state
 * across `await` boundaries (handlers mutate it in between).
 */
function currentStatus(): UpdateState['status'] {
  return state.status
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return typeof err === 'string' ? err : 'unknown error'
}

function releaseUrlFor(version: string): string {
  return `${GITHUB_REPO_URL}/releases/tag/v${normalizeVersion(version)}`
}

function formatReleaseNotes(info: UpdateInfo): string | undefined {
  const notes = Array.isArray(info.releaseNotes)
    ? info.releaseNotes.map(entry => entry.note).filter(Boolean).join('\n')
    : typeof info.releaseNotes === 'string'
      ? info.releaseNotes
      : ''
  const trimmed = notes.trim()
  if (!trimmed) return undefined
  return trimmed.length > MAX_RELEASE_NOTES_LENGTH
    ? `${trimmed.slice(0, MAX_RELEASE_NOTES_LENGTH)}…`
    : trimmed
}

function attachUpdaterLogger(): void {
  autoUpdater.logger = {
    info: (message?: unknown) => logger.debug('updater', String(message ?? '').slice(0, 500)),
    warn: (message?: unknown) => logger.warn('updater', String(message ?? '').slice(0, 500)),
    error: (message?: unknown) => logger.error('updater', String(message ?? '').slice(0, 500)),
    debug: (message?: unknown) => logger.debug('updater', String(message ?? '').slice(0, 500))
  }
}

function registerUpdaterEvents(): void {
  autoUpdater.on('checking-for-update', () => {
    logger.debug('updater', 'checking for updates')
  })

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    logger.info('updater', 'update available', { version: info.version, current: state.currentVersion })
    setState({
      status: 'available',
      latestVersion: info.version,
      releaseNotes: formatReleaseNotes(info),
      releaseUrl: releaseUrlFor(info.version),
      progress: undefined,
      error: undefined
    })
    // Requirement: pull the new build in the background and only notify the
    // user once it is ready to install.
    void downloadUpdate()
  })

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    logger.debug('updater', 'already up to date', { version: info?.version })
    setState({ status: 'not-available', latestVersion: info?.version ?? state.currentVersion, error: undefined })
  })

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    setState({
      status: 'downloading',
      progress: Math.max(0, Math.min(100, Math.round(progress.percent)))
    })
  })

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    logger.info('updater', 'update downloaded', { version: info.version })
    setState({
      status: 'downloaded',
      latestVersion: info.version,
      releaseNotes: formatReleaseNotes(info),
      releaseUrl: releaseUrlFor(info.version),
      progress: 100,
      error: undefined
    })
  })

  autoUpdater.on('error', (err: Error) => {
    // "No published versions" / network hiccups are normal offline behaviour:
    // keep them out of the error log level to avoid noisy reports.
    const message = errorMessage(err)
    logger.warn('updater', 'update check failed', { error: message })
    setState({ status: 'error', error: message })
  })
}

/**
 * Wire up electron-updater. Safe to call once per app launch; dev and portable
 * builds report `unsupported` instead of attempting a check.
 */
export function initUpdater(): void {
  if (initialized) return
  initialized = true
  state = { status: 'idle', currentVersion: app.getVersion() }

  if (!isSupportedBuild()) {
    logger.info('updater', 'auto update not available for this build', {
      packaged: app.isPackaged,
      portable: isPortableBuild()
    })
    setState({ status: 'unsupported' })
    return
  }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowDowngrade = false
  attachUpdaterLogger()
  registerUpdaterEvents()

  if (getSetting('autoUpdateEnabled') === false) {
    logger.info('updater', 'startup update check disabled by settings')
    return
  }

  // Delay so the check never competes with startup work (cache load, LAN
  // server, browser prewarm).
  startupTimer = setTimeout(() => {
    startupTimer = null
    void checkForUpdates(false)
  }, STARTUP_CHECK_DELAY_MS)
}

/** Query GitHub for a newer release. `manual` checks always surface errors. */
export async function checkForUpdates(manual = false): Promise<UpdateState> {
  if (!isSupportedBuild()) {
    setState({ status: 'unsupported', manual })
    return state
  }
  if (state.status === 'checking' || state.status === 'downloading') return state
  if (state.status === 'downloaded') return state

  setState({ status: 'checking', manual, error: undefined })
  try {
    const result = await autoUpdater.checkForUpdates()
    if (!result) {
      setState({ status: 'error', error: 'no update information available' })
      return state
    }
    const latest = result.updateInfo?.version
    // `update-available` / `update-not-available` normally flip the state
    // first; this is the fallback for providers that resolve without events.
    if (currentStatus() === 'checking') {
      if (latest && isNewerVersion(latest, state.currentVersion)) {
        setState({
          status: 'available',
          latestVersion: latest,
          releaseUrl: releaseUrlFor(latest)
        })
        void downloadUpdate()
      } else {
        setState({ status: 'not-available', latestVersion: latest ?? state.currentVersion })
      }
    }
  } catch (err) {
    setState({ status: 'error', error: errorMessage(err), manual })
  }
  return state
}

/** Download the update found by the last check. */
export async function downloadUpdate(): Promise<UpdateState> {
  if (!isSupportedBuild()) {
    setState({ status: 'unsupported' })
    return state
  }
  if (state.status === 'downloading' || state.status === 'downloaded') return state

  setState({ status: 'downloading', progress: state.progress ?? 0, error: undefined })
  try {
    await autoUpdater.downloadUpdate()
  } catch (err) {
    // A manual retry after a failed check lands here when there is nothing to
    // download (e.g. check failed) — surface it instead of silently retrying.
    setState({ status: 'error', error: errorMessage(err) })
  }
  return state
}

/** Quit and install the downloaded update, then relaunch. */
export function installUpdate(): void {
  if (state.status !== 'downloaded') return
  logger.info('updater', 'installing update and restarting', { version: state.latestVersion })
  autoUpdater.quitAndInstall(false, true)
}

/** Cancel a pending startup check (used on shutdown / in tests). */
export function disposeUpdater(): void {
  if (startupTimer) {
    clearTimeout(startupTimer)
    startupTimer = null
  }
}
