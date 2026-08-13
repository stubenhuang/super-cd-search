export type QueryStatus = 'found' | 'not_found' | 'error'

export type Platform = 'discogs' | 'ebay' | 'kojima' | 'hmv' | 'yahoo' | 'cdjapan' | 'tower'

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
}

export interface BatchQueryProgress {
  catalogNumber: string
  platform: string
  status: 'loading' | 'complete' | 'error' | 'not_found' | 'found'
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

export interface HistoryBatch {
  id: number
  catalogNumber: string
  createdAt: string
}

export interface HistoryEntry {
  query: {
    id: number
    catalogNumber: string
    createdAt: string
  }
  results: QueryResult[]
}
