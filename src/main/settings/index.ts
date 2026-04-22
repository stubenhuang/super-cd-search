import Store from 'electron-store'

export interface Cookies {
  discogs?: string
  ebay?: string
  kojima?: string
  mercari?: string
}

export interface Settings {
  discogsToken?: string
  ebayClientId?: string
  ebayClientSecret?: string
  cookies?: Cookies
}

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
      mercari: { type: 'string' as const, default: '' }
    },
    default: {}
  }
} as const

const store = new Store({ schema, encryptionKey: 'super-cd-search-enc-key', name: 'settings' })

export function getSettings(): Settings {
  return {
    discogsToken: store.get('discogsToken') as string || undefined,
    ebayClientId: store.get('ebayClientId') as string || undefined,
    ebayClientSecret: store.get('ebayClientSecret') as string || undefined,
    cookies: store.get('cookies') as Cookies || undefined
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
