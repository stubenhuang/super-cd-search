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

export interface ThrottleStatus {
  domains: Record<string, {
    pendingRequests: number
    active: boolean
    backoffAttempt: number | null
    nextBackoffDelay: number | null
  }>
}

export type QueryStatus = 'found' | 'not_found' | 'error'

export interface QueryResult {
  platform: 'discogs' | 'ebay' | 'kojima' | 'mercari'
  name: string | null
  artist: string | null
  priceMin: number | null
  priceMax: number | null
  coverUrl: string | null
  link: string | null
  status: QueryStatus
  error?: string
}

export interface BatchQueryProgress {
  event: string
  catalogNumber: string
  platform: string
  status: 'loading' | 'complete' | 'error' | 'not_found'
}

export interface BatchQueryResult {
  catalogNumber: string
  results: QueryResult[]
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

export interface IElectronAPI {
  send: (channel: string, data: unknown) => void
  receive: (channel: string, func: (...args: unknown[]) => void) => void
  getSettings: () => Promise<Settings>
  getSetting: (key: string) => Promise<unknown>
  setSetting: (key: string, value: unknown) => Promise<void>
  deleteSetting: (key: string) => Promise<void>
  getThrottleStatus: () => Promise<ThrottleStatus>
  executeBatchQuery: (catalogNumbers: string[]) => Promise<BatchQueryResult[]>
  getHistory: () => Promise<HistoryBatch[]>
  getHistoryEntry: (queryId: number) => Promise<HistoryEntry | null>
  deleteHistoryEntry: (queryId: number) => Promise<void>
  clearAllHistory: () => Promise<void>
  exportToExcel: (results: BatchQueryResult[]) => Promise<string | null>
}

declare global {
  interface Window {
    electronAPI: IElectronAPI
  }
}

export {}
