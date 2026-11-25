import type {
  QueryResult,
  Platform,
  CDDetails,
  Settings,
  ThrottleStatus,
  BatchQueryProgress,
  BatchQueryResult,
  DisplayCurrency,
  DetailEnrichProgress,
  DetailEnrichProgressStatus,
  DetailEnrichmentResult,
  LanCandidate,
  LanServerStatus,
  LanCatalogAddedEvent,
  LanSearchPhase,
  LanSearchState,
  BarcodeProvider,
  SettingsTransferResult,
  FeishuSettings
} from '../../shared/types'
import type { UpdateState } from '../../shared/updater'
import type { FeishuSyncPayload, FeishuSyncResult, FeishuTestResult } from '../../shared/feishu'

export type {
  UpdateState,
  QueryResult,
  Platform,
  CDDetails,
  Settings,
  ThrottleStatus,
  BatchQueryResult,
  DisplayCurrency,
  DetailEnrichProgress,
  DetailEnrichProgressStatus,
  DetailEnrichmentResult,
  LanCandidate,
  LanServerStatus,
  LanCatalogAddedEvent,
  LanSearchPhase,
  LanSearchState,
  BarcodeProvider,
  SettingsTransferResult,
  FeishuSettings,
  FeishuSyncPayload,
  FeishuSyncResult,
  FeishuTestResult
}

// Extended progress type for received messages (includes event)
export interface BatchQueryProgressEvent extends BatchQueryProgress {
  event: string
}

export interface IElectronAPI {
  /** The host platform (e.g. 'darwin', 'win32', 'linux'). */
  platform: string
  /** Update the native window-controls overlay colors (Windows only). */
  setTitleBarOverlay: (overlay: { color?: string; symbolColor?: string; height?: number }) => Promise<boolean>
  send: (channel: string, data: unknown) => void
  /** Subscribe to a main-process channel; returns the unsubscribe function. */
  receive: (channel: string, func: (...args: unknown[]) => void) => () => void
  log: (level: string, tag: string, message: string, meta?: Record<string, unknown>) => void
  getSettings: () => Promise<Settings>
  getSetting: <K extends keyof Settings>(key: K) => Promise<Settings[K] | undefined>
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => Promise<void>
  updateSettings: (values: Partial<Settings>) => Promise<void>
  deleteSetting: <K extends keyof Settings>(key: K) => Promise<void>
  clearSearchCache: () => Promise<void>
  exportSettingsBackup: (password: string) => Promise<SettingsTransferResult>
  importSettingsBackup: (password: string) => Promise<SettingsTransferResult>
  getThrottleStatus: () => Promise<ThrottleStatus>
  getUsdToDisplayRate: (target: DisplayCurrency) => Promise<number>
  executeBatchQuery: (catalogNumbers: string[], platforms?: Platform[]) => Promise<BatchQueryResult[]>
  enrichDetails: (
    catalogNumber: string,
    existingResults: QueryResult[],
    knownDetails?: CDDetails | null
  ) => Promise<DetailEnrichmentResult>
  cancelEnrichDetails: () => Promise<void>
  cancelBatchQuery: () => Promise<void>
  openExternal: (url: string) => Promise<void>
  fetchImage: (url: string, size?: number) => Promise<{ base64: string; mimeType: string } | null>
  getLanStatus: () => Promise<LanServerStatus>
  getLanCandidates: () => Promise<LanCandidate[]>
  applyLanServer: () => Promise<LanServerStatus>
  regenerateLanToken: () => Promise<LanServerStatus>
  setLanSearchAvailability: (available: boolean) => Promise<void>
  setLanSearchCatalogCount: (count: number) => Promise<void>
  setLanSearchState: (state: LanSearchState) => Promise<void>
  getUpdateState: () => Promise<UpdateState>
  checkForUpdates: () => Promise<UpdateState>
  downloadUpdate: () => Promise<UpdateState>
  installUpdate: () => Promise<boolean>
  /**
   * Archive the given catalog numbers into the configured Feishu Bitable table.
   * Never rejects: disabled/incomplete config resolves as `status: 'skipped'`.
   */
  syncFeishu: (payload: FeishuSyncPayload) => Promise<FeishuSyncResult>
  /** Read-only credential/table probe against the current form values. */
  testFeishu: (settings: FeishuSettings) => Promise<FeishuTestResult>
}

declare global {
  interface Window {
    electronAPI: IElectronAPI
  }
}

export {}
