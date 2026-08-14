import type {
  QueryResult,
  QueryStatus,
  Platform,
  CDDetails,
  Settings,
  Cookies,
  ThrottleStatus,
  BatchQueryProgress,
  BatchQueryResult,
  DisplayCurrency,
  ThemeMode,
  CloudflarePlatform,
  CloudflareChallengeResult,
  CloudflareSessionStatus
} from '../../shared/types'

export type {
  QueryResult,
  QueryStatus,
  Platform,
  CDDetails,
  Settings,
  Cookies,
  ThrottleStatus,
  BatchQueryResult,
  DisplayCurrency,
  ThemeMode,
  CloudflarePlatform,
  CloudflareChallengeResult,
  CloudflareSessionStatus
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
  getUsdToDisplayRate: (target: DisplayCurrency) => Promise<number>
  executeBatchQuery: (catalogNumbers: string[], platforms?: Platform[]) => Promise<BatchQueryResult[]>
  cancelBatchQuery: () => Promise<void>
  openExternal: (url: string) => Promise<void>
  fetchImage: (url: string, size?: number) => Promise<{ base64: string; mimeType: string } | null>
  startCloudflareChallenge: (platform: CloudflarePlatform) => Promise<CloudflareChallengeResult>
  cancelCloudflareChallenge: () => Promise<void>
  getCloudflareStatus: (platform: CloudflarePlatform) => Promise<CloudflareSessionStatus>
  closeCloudflareSession: () => Promise<void>
}

declare global {
  interface Window {
    electronAPI: IElectronAPI
  }
}

export {}
