import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'crypto'
import type { Settings, SettingsBackupEnvelope, SettingsTransferErrorCode } from '../../shared/types'

/**
 * Password-protected settings backup crypto.
 *
 * Deliberately independent of Electron and the machine-derived `getEncryptionKey()`
 * in ./index.ts: the backup key comes from the *user's* password, so a backup file
 * can be restored on any machine. AES-256-GCM is used instead of the store's CBC
 * because its auth tag lets us tell "wrong password" apart from a structurally
 * valid envelope (decryption throws exactly when the tag does not verify).
 */

export const BACKUP_FORMAT_VERSION = 1
export const MIN_PASSWORD_LENGTH = 8
export const PBKDF2_ITERATIONS = 210000

const PBKDF2_ALGORITHM = 'pbkdf2-sha512'
const CIPHER_ALGORITHM = 'aes-256-gcm'
const KEY_LENGTH = 32
const SALT_LENGTH = 16
const IV_LENGTH = 12

export class SettingsBackupError extends Error {
  readonly code: SettingsTransferErrorCode

  constructor(code: SettingsTransferErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'SettingsBackupError'
    this.code = code
  }
}

/** Returns an error code when the password is too weak, otherwise null. */
export function validateBackupPassword(password: string): SettingsTransferErrorCode | null {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return 'weak_password'
  }
  return null
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha512')
}

/**
 * Encrypt a settings snapshot into a self-describing envelope. Never mutates
 * the input; the LAN pairing token must already be excluded by the caller.
 */
export function encryptSettings(settings: Settings, password: string): SettingsBackupEnvelope {
  const weak = validateBackupPassword(password)
  if (weak) throw new SettingsBackupError(weak)

  const salt = randomBytes(SALT_LENGTH)
  const iv = randomBytes(IV_LENGTH)
  const key = deriveKey(password, salt)

  const plaintext = Buffer.from(JSON.stringify(settings), 'utf8')
  const cipher = createCipheriv(CIPHER_ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authTag = cipher.getAuthTag()

  return {
    app: 'super-cd-search',
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    kdf: { algorithm: PBKDF2_ALGORITHM, iterations: PBKDF2_ITERATIONS, salt: salt.toString('base64') },
    cipher: { algorithm: CIPHER_ALGORITHM, iv: iv.toString('base64'), authTag: authTag.toString('base64') },
    ciphertext: ciphertext.toString('base64')
  }
}

/**
 * Decrypt an envelope back into a settings snapshot.
 *
 * Throws `SettingsBackupError` with:
 *  - 'bad_password'        when the GCM auth tag fails (wrong password or tampered ciphertext)
 *  - 'corrupt_file'        when the envelope is structurally invalid or the plaintext is not JSON
 *  - 'unsupported_version' when formatVersion is newer than this build understands
 */
export function decryptSettings(envelope: SettingsBackupEnvelope, password: string): Settings {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new SettingsBackupError('corrupt_file')
  }
  if (envelope.app !== 'super-cd-search') {
    throw new SettingsBackupError('corrupt_file')
  }

  const version = envelope.formatVersion
  if (typeof version !== 'number' || !Number.isFinite(version)) {
    throw new SettingsBackupError('corrupt_file')
  }
  if (version > BACKUP_FORMAT_VERSION) {
    throw new SettingsBackupError('unsupported_version')
  }
  if (version < 1) {
    throw new SettingsBackupError('corrupt_file')
  }

  if (
    !envelope.kdf ||
    envelope.kdf.algorithm !== PBKDF2_ALGORITHM ||
    typeof envelope.kdf.salt !== 'string' ||
    typeof envelope.kdf.iterations !== 'number'
  ) {
    throw new SettingsBackupError('corrupt_file')
  }
  if (
    !envelope.cipher ||
    envelope.cipher.algorithm !== CIPHER_ALGORITHM ||
    typeof envelope.cipher.iv !== 'string' ||
    typeof envelope.cipher.authTag !== 'string'
  ) {
    throw new SettingsBackupError('corrupt_file')
  }
  if (typeof envelope.ciphertext !== 'string') {
    throw new SettingsBackupError('corrupt_file')
  }

  let salt: Buffer
  let iv: Buffer
  let authTag: Buffer
  let ciphertext: Buffer
  try {
    salt = Buffer.from(envelope.kdf.salt, 'base64')
    iv = Buffer.from(envelope.cipher.iv, 'base64')
    authTag = Buffer.from(envelope.cipher.authTag, 'base64')
    ciphertext = Buffer.from(envelope.ciphertext, 'base64')
  } catch {
    throw new SettingsBackupError('corrupt_file')
  }

  const key = deriveKey(password, salt)
  let plaintext: Buffer
  try {
    const decipher = createDecipheriv(CIPHER_ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch {
    throw new SettingsBackupError('bad_password')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(plaintext.toString('utf8'))
  } catch {
    throw new SettingsBackupError('corrupt_file')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SettingsBackupError('corrupt_file')
  }
  return parsed as Settings
}
