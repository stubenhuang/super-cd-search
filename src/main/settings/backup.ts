import { BrowserWindow, dialog } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { Settings, SettingsBackupEnvelope, SettingsTransferResult } from '../../shared/types'
import { logger } from '../logger'
import { getSetting, getSettings, setSetting, updateSettings, PUBLIC_SETTING_KEYS } from './index'
import { decryptSettings, encryptSettings, SettingsBackupError, validateBackupPassword } from './transfer'

const BACKUP_EXTENSION = 'scdset'
const BACKUP_FILTER = { name: 'Super CD Search 设置备份', extensions: [BACKUP_EXTENSION] }

function defaultFileName(): string {
  const stamp = new Date().toISOString().slice(0, 10)
  return `super-cd-search-settings-${stamp}.${BACKUP_EXTENSION}`
}

/** Pick the focused window as the dialog parent so the dialog stays on top. */
function dialogParent(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? undefined
}

/**
 * Encrypt the full public settings to a user-chosen `.scdset` file.
 * The LAN pairing token is never included (`getSettings()` omits it).
 */
export async function exportSettingsBackup(password: string): Promise<SettingsTransferResult> {
  const weak = validateBackupPassword(password)
  if (weak) {
    return { status: 'error', errorCode: weak, message: 'password is too short' }
  }

  const lastDirectory = getSetting('lastExportDirectory')
  const save = await dialog.showSaveDialog(dialogParent() as BrowserWindow, {
    title: '导出设置文件',
    defaultPath:
      lastDirectory && existsSync(lastDirectory) ? join(lastDirectory, defaultFileName()) : defaultFileName(),
    filters: [BACKUP_FILTER]
  })
  if (save.canceled || !save.filePath) {
    return { status: 'cancelled' }
  }

  try {
    const settings = getSettings()
    const envelope = encryptSettings(settings, password)
    writeFileSync(save.filePath, JSON.stringify(envelope, null, 2), 'utf8')
    setSetting('lastExportDirectory', dirname(save.filePath))
    logger.debug('settings.backup', 'settings exported', {
      filePath: save.filePath,
      keys: Object.keys(settings)
    })
    return { status: 'ok', filePath: save.filePath }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.warn('settings.backup', 'export failed', { error: message })
    return { status: 'error', errorCode: 'io_error', message }
  }
}

/**
 * Decrypt a `.scdset` file and apply only the keys it actually contains.
 * Keys absent from the file keep their current values.
 */
export async function importSettingsBackup(password: string): Promise<SettingsTransferResult> {
  const open = await dialog.showOpenDialog(dialogParent() as BrowserWindow, {
    title: '导入设置文件',
    properties: ['openFile'],
    filters: [BACKUP_FILTER]
  })
  if (open.canceled || open.filePaths.length === 0) {
    return { status: 'cancelled' }
  }
  const filePath = open.filePaths[0]

  let envelope: SettingsBackupEnvelope
  try {
    const raw = readFileSync(filePath, 'utf8')
    envelope = JSON.parse(raw) as SettingsBackupEnvelope
  } catch {
    logger.warn('settings.backup', 'backup file unreadable', { filePath })
    return { status: 'error', errorCode: 'corrupt_file', message: 'file is not a valid backup' }
  }

  let decoded: Settings
  try {
    decoded = decryptSettings(envelope, password)
  } catch (err) {
    const code = err instanceof SettingsBackupError ? err.code : 'corrupt_file'
    logger.warn('settings.backup', 'backup decryption failed', { filePath, code })
    return { status: 'error', errorCode: code, message: err instanceof Error ? err.message : code }
  }

  const imported: Partial<Settings> = {}
  for (const key of Object.keys(decoded)) {
    if (PUBLIC_SETTING_KEYS.has(key as keyof Settings)) {
      ;(imported as Record<string, unknown>)[key] = (decoded as Record<string, unknown>)[key]
    }
  }

  const importedKeys = Object.keys(imported)
  if (importedKeys.length > 0) {
    updateSettings(imported)
  }
  logger.debug('settings.backup', 'settings imported', { filePath, keys: importedKeys })
  return { status: 'ok', filePath, importedKeys }
}
