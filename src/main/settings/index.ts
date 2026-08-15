import { app } from 'electron'
import { createHash, createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'crypto'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { hostname, userInfo } from 'os'
import electronStore from 'electron-store'
import type { Settings, Cookies, LLMSettings, Platform, DisplayCurrency, ThemeMode, Language } from '../../shared/types'
import { DEFAULT_STANDARD_PLATFORMS, DEFAULT_DEEP_PLATFORMS } from '../../shared/platforms'

export type { Settings, Cookies, LLMSettings }

const schema = {
  discogsToken: { type: 'string' as const, default: '' },
  ebayClientId: { type: 'string' as const, default: '' },
  ebayClientSecret: { type: 'string' as const, default: '' },
  cookies: {
    type: 'object' as const,
    properties: {
      discogs: { type: 'string' as const, default: '' },
      ebay: { type: 'string' as const, default: '' },
      kojima: { type: 'string' as const, default: '' },
      hmv: { type: 'string' as const, default: '' },
      yahoo: { type: 'string' as const, default: '' },
      cdjapan: { type: 'string' as const, default: '' },
      tower: { type: 'string' as const, default: '' }
    },
    default: {}
  },
  proxyEnabled: { type: 'boolean' as const, default: false },
  proxyHost: { type: 'string' as const, default: '' },
  proxyPort: { type: 'number' as const, default: 1080 },
  standardPlatforms: { type: 'array' as const, default: DEFAULT_STANDARD_PLATFORMS },
  deepPlatforms: { type: 'array' as const, default: DEFAULT_DEEP_PLATFORMS },
  fastMode: { type: 'boolean' as const, default: false },
  displayCurrency: { type: 'string' as const, default: 'USD' },
  theme: { type: 'string' as const, default: 'light' },
  language: { type: 'string' as const, default: 'zh' },
  llm: {
    type: 'object' as const,
    properties: {
      enabled: { type: 'boolean' as const, default: false },
      apiBaseUrl: { type: 'string' as const, default: 'https://api.openai.com/v1' },
      apiKey: { type: 'string' as const, default: '' },
      model: { type: 'string' as const, default: 'gpt-4o-mini' },
      platformEnabled: {
        type: 'object' as const,
        properties: {
          discogs: { type: 'boolean' as const, default: true },
          ebay: { type: 'boolean' as const, default: true },
          kojima: { type: 'boolean' as const, default: true },
          hmv: { type: 'boolean' as const, default: true },
          yahoo: { type: 'boolean' as const, default: true },
          cdjapan: { type: 'boolean' as const, default: true },
          tower: { type: 'boolean' as const, default: true },
          surugaya: { type: 'boolean' as const, default: true },
          zenmarket: { type: 'boolean' as const, default: true }
        },
        default: {}
      }
    },
    default: {}
  }
} as const

const Store = (electronStore as any).default || electronStore

function getEncryptionKey(): string {
  if (process.env.SETTINGS_ENCRYPTION_KEY) {
    return process.env.SETTINGS_ENCRYPTION_KEY
  }
  // Machine-specific key derived from OS identity. Using the os module (rather
  // than process.env.USER/HOSTNAME, which are shell-specific and undefined on
  // Windows) keeps the key stable across terminal/GUI launches.
  let user = 'unknown'
  let host = 'localhost'
  try {
    user = userInfo().username || 'unknown'
    host = hostname() || 'localhost'
  } catch {
    // Extremely rare; fall back to environment variables.
    user = process.env.USER || process.env.USERNAME || 'unknown'
    host = process.env.HOSTNAME || process.env.COMPUTERNAME || 'localhost'
  }
  const machineId = `${user}-${host}-super-cd-search`
  return createHash('sha256').update(machineId).digest('hex').slice(0, 32)
}

function hashMachineId(machineId: string): string {
  return createHash('sha256').update(machineId).digest('hex').slice(0, 32)
}

function osUsername(): string {
  try {
    return userInfo().username || 'unknown'
  } catch {
    return 'unknown'
  }
}

function osHostname(): string {
  try {
    return hostname() || 'localhost'
  } catch {
    return 'localhost'
  }
}

/**
 * Enumerate the machine-ids older versions of the key derivation could have
 * produced. The legacy code used process.env.USER/HOSTNAME, which are missing
 * (or different) under a GUI launch, producing several possible identities.
 */
function legacyMachineIds(): string[] {
  const osUser = osUsername()
  const osHost = osHostname()
  const envUser = process.env.USER || process.env.USERNAME || 'unknown'
  const envHost = process.env.HOSTNAME || process.env.COMPUTERNAME || 'localhost'

  const ids = new Set<string>()
  ids.add(`${envUser}-${envHost}-super-cd-search`)
  ids.add(`${envUser}-localhost-super-cd-search`)
  ids.add(`unknown-${envHost}-super-cd-search`)
  ids.add(`unknown-localhost-super-cd-search`)
  ids.add(`${osUser}-${osHost}-super-cd-search`)
  ids.add(`${osUser}-localhost-super-cd-search`)
  ids.add(`${envUser}-${osHost}-super-cd-search`)
  return [...ids]
}

const AES_ALGORITHM = 'aes-256-cbc'
const SEPARATOR = Buffer.from(':', 'utf8')

function derivePassword(encryptionKey: string, salt: Buffer | string): Buffer {
  return pbkdf2Sync(encryptionKey, salt, 10000, 32, 'sha512')
}

/** Decrypt conf's on-disk format: IV(16 bytes) + ':' + ciphertext. */
function decryptData(data: Buffer, key: string): string | null {
  if (data.length < 17 || data[16] !== SEPARATOR[0]) return null
  const iv = data.subarray(0, 16)
  const ciphertext = data.subarray(17)

  const tryDecrypt = (salt: Buffer | string): string | null => {
    try {
      const decipher = createDecipheriv(AES_ALGORITHM, derivePassword(key, salt), iv)
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    } catch {
      return null
    }
  }

  // Newer conf uses the IV buffer as the pbkdf2 salt; older versions used the
  // IV's string form. Try both.
  return tryDecrypt(iv) ?? tryDecrypt(iv.toString('utf8'))
}

function encryptData(plaintext: string, key: string): Buffer {
  const iv = randomBytes(16)
  const cipher = createCipheriv(AES_ALGORITHM, derivePassword(key, iv), iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return Buffer.concat([iv, SEPARATOR, encrypted])
}

/**
 * Re-encrypt a settings file left over from an older encryption key with the
 * current key. Must run BEFORE the ElectronStore below is constructed: conf's
 * `useDefaults` validator otherwise overwrites an undecryptable legacy file
 * with schema defaults, silently wiping the user's settings.
 */
function migrateSettingsFile(filePath: string): void {
  let raw: Buffer
  try {
    if (!existsSync(filePath)) return
    raw = readFileSync(filePath)
  } catch {
    return
  }

  const newKey = getEncryptionKey()

  const tryParse = (key: string): string | null => {
    const plaintext = decryptData(raw, key)
    if (plaintext === null) return null
    try {
      JSON.parse(plaintext)
      return plaintext
    } catch {
      return null
    }
  }

  // Already encrypted with the current key — nothing to migrate.
  if (tryParse(newKey) !== null) return

  for (const machineId of legacyMachineIds()) {
    const key = hashMachineId(machineId)
    if (key === newKey) continue
    const plaintext = tryParse(key)
    if (plaintext !== null) {
      try {
        writeFileSync(filePath, encryptData(plaintext, newKey))
      } catch {
        // Write failure: leave the file as-is; the store below will reset.
      }
      return
    }
  }
}

const settingsFilePath = join(app.getPath('userData'), 'settings.json')
migrateSettingsFile(settingsFilePath)

const store = new Store({
  schema,
  encryptionKey: getEncryptionKey(),
  name: 'settings',
  // If the store was encrypted with a different key (or the file is corrupt),
  // reset it instead of crashing the whole app on startup.
  clearInvalidConfig: true
})

export function getSettings(): Settings {
  return {
    discogsToken: store.get('discogsToken') as string || undefined,
    ebayClientId: store.get('ebayClientId') as string || undefined,
    ebayClientSecret: store.get('ebayClientSecret') as string || undefined,
    cookies: store.get('cookies') as Cookies || undefined,
    proxyEnabled: store.get('proxyEnabled') as boolean || undefined,
    proxyHost: store.get('proxyHost') as string || undefined,
    proxyPort: store.get('proxyPort') as number || undefined,
    llm: store.get('llm') as LLMSettings | undefined,
    standardPlatforms: store.get('standardPlatforms') as Platform[] || DEFAULT_STANDARD_PLATFORMS,
    deepPlatforms: store.get('deepPlatforms') as Platform[] || DEFAULT_DEEP_PLATFORMS,
    fastMode: store.get('fastMode') as boolean || undefined,
    displayCurrency: (store.get('displayCurrency') as DisplayCurrency) || 'USD',
    theme: (store.get('theme') as ThemeMode) || 'light',
    language: (store.get('language') as Language) || 'zh'
  }
}

export function getSetting<K extends keyof Settings>(key: K): Settings[K] | undefined {
  return store.get(key) as Settings[K] | undefined
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  store.set(key, value)
}

export function deleteSetting<K extends keyof Settings>(key: K): void {
  store.delete(key)
}
