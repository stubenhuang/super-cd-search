import electronStore from 'electron-store'
import type { Settings, Cookies, LLMSettings } from '../../shared/types'

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
  llm: {
    type: 'object' as const,
    properties: {
      enabled: { type: 'boolean' as const, default: false },
      apiBaseUrl: { type: 'string' as const, default: 'https://api.openai.com/v1' },
      apiKey: { type: 'string' as const, default: '' },
      model: { type: 'string' as const, default: 'gpt-4o-mini' },
      temperature: { type: 'number' as const, default: 0 },
      platformEnabled: {
        type: 'object' as const,
        properties: {
          discogs: { type: 'boolean' as const, default: true },
          ebay: { type: 'boolean' as const, default: true },
          kojima: { type: 'boolean' as const, default: true },
          hmv: { type: 'boolean' as const, default: true },
          yahoo: { type: 'boolean' as const, default: true },
          cdjapan: { type: 'boolean' as const, default: true },
          tower: { type: 'boolean' as const, default: true }
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
  // Generate a machine-specific key based on username and hostname
  // This provides some obfuscation without requiring user setup
  const crypto = require('crypto')
  const machineId = `${process.env.USER || 'unknown'}-${process.env.HOSTNAME || 'localhost'}-super-cd-search`
  return crypto.createHash('sha256').update(machineId).digest('hex').slice(0, 32)
}

const store = new Store({ schema, encryptionKey: getEncryptionKey(), name: 'settings' })

export function getSettings(): Settings {
  return {
    discogsToken: store.get('discogsToken') as string || undefined,
    ebayClientId: store.get('ebayClientId') as string || undefined,
    ebayClientSecret: store.get('ebayClientSecret') as string || undefined,
    cookies: store.get('cookies') as Cookies || undefined,
    proxyEnabled: store.get('proxyEnabled') as boolean || undefined,
    proxyHost: store.get('proxyHost') as string || undefined,
    proxyPort: store.get('proxyPort') as number || undefined,
    llm: store.get('llm') as LLMSettings | undefined
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
