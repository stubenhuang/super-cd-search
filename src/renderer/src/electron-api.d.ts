import type {
  QueryResult,
  QueryStatus,
  Platform,
  Settings,
  Cookies,
  ThrottleStatus,
  BatchQueryProgress,
  BatchQueryResult,
  HistoryBatch,
  HistoryEntry
} from '../../shared/types'

export type {
  QueryResult,
  QueryStatus,
  Platform,
  Settings,
  Cookies,
  ThrottleStatus,
  BatchQueryResult,
  HistoryBatch,
  HistoryEntry
}

// Extended progress type for received messages (includes event)
export interface BatchQueryProgressEvent extends BatchQueryProgress {
  event: string
}

export type { BatchQueryProgress }

export interface IElectronAPI {
  send: (channel: string, data: unknown) => void
  receive: (channel: string, func: (...args: unknown[]) => void) => void
  getSettings: () => Promise<Settings>
  getSetting: <K extends keyof Settings>(key: K) => Promise<Settings[K] | undefined>
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => Promise<void>
  deleteSetting: <K extends keyof Settings>(key: K) => Promise<void>
  getThrottleStatus: () => Promise<ThrottleStatus>
  executeBatchQuery: (catalogNumbers: string[], includeKojima?: boolean) => Promise<BatchQueryResult[]>
  cancelBatchQuery: () => Promise<void>
  getHistory: () => Promise<HistoryBatch[]>
  getHistoryEntry: (queryId: number) => Promise<HistoryEntry | null>
  deleteHistoryEntry: (queryId: number) => Promise<void>
  clearAllHistory: () => Promise<void>
  exportToExcel: (results: BatchQueryResult[]) => Promise<string | null>
  openExternal: (url: string) => Promise<void>
}

declare global {
  interface Window {
    electronAPI: IElectronAPI
  }
}

export {}
