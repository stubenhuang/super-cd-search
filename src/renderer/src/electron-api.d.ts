import type {
  QueryResult,
  QueryStatus,
  Platform,
  CDDetails,
  Settings,
  ThrottleStatus,
  BatchQueryProgress,
  BatchQueryResult,
  DisplayCurrency,
  ThemeMode,
  Language,
  CloudflarePlatform,
  CloudflareChallengeResult,
  CloudflareSessionStatus,
  DetailEnrichProgress,
  DetailEnrichmentResult,
  ExportFileResult,
  ExportProgress,
  ExcelExportPayload,
  ExcelExportRow,
  DirectorySelectResult,
  LanCandidate,
  LanServerStatus,
  LanCatalogAddedEvent,
  BarcodeProvider,
  BarcodeCatalogCandidate
} from '../../shared/types'

export type {
  QueryResult,
  QueryStatus,
  Platform,
  CDDetails,
  Settings,
  ThrottleStatus,
  BatchQueryResult,
  DisplayCurrency,
  ThemeMode,
  Language,
  CloudflarePlatform,
  CloudflareChallengeResult,
  CloudflareSessionStatus,
  DetailEnrichProgress,
  DetailEnrichmentResult,
  ExportFileResult,
  ExportProgress,
  ExcelExportPayload,
  ExcelExportRow,
  DirectorySelectResult,
  LanCandidate,
  LanServerStatus,
  LanCatalogAddedEvent,
  BarcodeProvider,
  BarcodeCatalogCandidate
}

// Extended progress type for received messages (includes event)
export interface BatchQueryProgressEvent extends BatchQueryProgress {
  event: string
}

export type { BatchQueryProgress }

export interface IElectronAPI {
  /** The host platform (e.g. 'darwin', 'win32', 'linux'). */
  platform: string
  send: (channel: string, data: unknown) => void
  receive: (channel: string, func: (...args: unknown[]) => void) => void
  log: (level: string, tag: string, message: string, meta?: Record<string, unknown>) => void
  getSettings: () => Promise<Settings>
  getSetting: <K extends keyof Settings>(key: K) => Promise<Settings[K] | undefined>
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => Promise<void>
  deleteSetting: <K extends keyof Settings>(key: K) => Promise<void>
  clearSearchCache: () => Promise<void>
  getThrottleStatus: () => Promise<ThrottleStatus>
  getUsdToDisplayRate: (target: DisplayCurrency) => Promise<number>
  executeBatchQuery: (catalogNumbers: string[], platforms?: Platform[]) => Promise<BatchQueryResult[]>
  enrichDetails: (
    catalogNumber: string,
    existingResults: QueryResult[],
    knownDetails?: CDDetails | null
  ) => Promise<DetailEnrichmentResult>
  cancelBatchQuery: () => Promise<void>
  exportExcel: (defaultFileName: string, payload: ExcelExportPayload, targetDirectory?: string) => Promise<ExportFileResult>
  selectExportDirectory: () => Promise<DirectorySelectResult>
  openExternal: (url: string) => Promise<void>
  fetchImage: (url: string, size?: number) => Promise<{ base64: string; mimeType: string } | null>
  startCloudflareChallenge: (platform: CloudflarePlatform) => Promise<CloudflareChallengeResult>
  cancelCloudflareChallenge: () => Promise<void>
  getCloudflareStatus: (platform: CloudflarePlatform) => Promise<CloudflareSessionStatus>
  closeCloudflareSession: () => Promise<void>
  getLanStatus: () => Promise<LanServerStatus>
  getLanCandidates: () => Promise<LanCandidate[]>
  applyLanServer: () => Promise<LanServerStatus>
  regenerateLanToken: () => Promise<LanServerStatus>
  setLanSearchAvailability: (available: boolean) => Promise<void>
  setLanSearchCatalogCount: (count: number) => Promise<void>
}

declare global {
  interface Window {
    electronAPI: IElectronAPI
  }
}

export {}
