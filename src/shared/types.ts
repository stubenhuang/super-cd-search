export type QueryStatus = 'found' | 'not_found' | 'error' | 'challenge'

export type DisplayCurrency = 'USD' | 'CNY'

export type ThemeMode = 'light' | 'dark' | 'system'

export type Language = 'zh' | 'en'

export type Platform =
  | 'discogs'
  | 'ebay'
  | 'kojima'
  | 'hmv'
  | 'yahoo'
  | 'cdjapan'
  | 'tower'
  | 'surugaya'
  | 'zenmarket'

export interface CDDetails {
  label: string | null
  format: string | null
  country: string | null
  released: string | null
  genre: string | null
}

export interface QueryResult {
  platform: Platform
  name: string | null
  artist: string | null
  priceMin: number | null
  priceMax: number | null
  coverUrl: string | null
  link: string | null
  status: QueryStatus
  error?: string
  details?: CDDetails
}

export interface Cookies {
  discogs?: string
  ebay?: string
  kojima?: string
  hmv?: string
  yahoo?: string
  cdjapan?: string
  tower?: string
}

/** Platforms that require a manual Cloudflare verification step. */
export type CloudflarePlatform = 'surugaya' | 'zenmarket'

/** Result of a manual Cloudflare challenge run (IPC-facing). */
export interface CloudflareChallengeResult {
  status: 'done' | 'error' | 'cancelled'
  error?: string
}

/**
 * Live status of the real-Chrome Cloudflare session for one platform. The
 * cookies live in the Chrome profile (not in app settings), so this is derived
 * from the running browser rather than persisted state.
 */
export interface CloudflareSessionStatus {
  state: 'not_started' | 'starting' | 'unverified' | 'verified' | 'expired'
  /** Absolute ms timestamp when the current clearance expires (when verified). */
  expiresAt?: number
}

export interface LLMSettings {
  enabled: boolean
  apiBaseUrl: string
  apiKey: string
  model: string
  temperature: number
  platformEnabled: {
    discogs: boolean
    ebay: boolean
    kojima: boolean
    hmv: boolean
    yahoo: boolean
    cdjapan: boolean
    tower: boolean
    surugaya: boolean
    zenmarket: boolean
  }
}

export interface Settings {
  discogsToken?: string
  ebayClientId?: string
  ebayClientSecret?: string
  cookies?: Cookies
  proxyEnabled?: boolean
  proxyHost?: string
  proxyPort?: number
  llm?: LLMSettings
  /** Platforms queried by the standard search mode. */
  standardPlatforms?: Platform[]
  /** Platforms queried by the deep search mode. */
  deepPlatforms?: Platform[]
  /** Skip product-detail page navigations for a faster, lower-traffic search. */
  fastMode?: boolean
  /** Currency used to display prices in the UI. */
  displayCurrency?: DisplayCurrency
  /** UI theme mode: light, dark, or follow the operating system. */
  theme?: ThemeMode
  /** UI language: Chinese or English. */
  language?: Language
}

export interface BatchQueryProgress {
  catalogNumber: string
  platform: string
  status: 'loading' | 'complete' | 'error' | 'not_found' | 'found' | 'challenge'
  results?: QueryResult[]
}

export interface BatchQueryResult {
  catalogNumber: string
  results: QueryResult[]
}

export interface ThrottleStatus {
  domains: Record<string, {
    pendingRequests: number
    active: boolean
    backoffAttempt: number | null
    nextBackoffDelay: number | null
  }>
}
