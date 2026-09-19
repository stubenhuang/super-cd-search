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
  LoginPlatform,
  LoginResult,
  LoginSessionStatus,
  DetailEnrichProgress,
  DetailEnrichProgressStatus,
  DetailEnrichmentResult,
  LanCandidate,
  LanServerStatus,
  LanCatalogAddedEvent,
  LanSearchMode,
  LanSearchPhase,
  LanSearchState,
  LanSearchStatusResponse,
  BarcodeProvider,
  BarcodeCatalogCandidate,
  SettingsTransferResult
} from '../../shared/types'
import type {
  PublishTarget,
  PublishDraft,
  PublishOutcome,
  PublishPrepareRequest,
  PublishRunRequest,
  PublishTargetLoginResult,
  PublishTargetStatus,
  PublishTargetTestResult
} from '../../shared/publish'
import type { UpdateState } from '../../shared/updater'

export type {
  UpdateState,
  PublishTarget,
  PublishDraft,
  PublishOutcome,
  PublishPrepareRequest,
  PublishRunRequest,
  PublishTargetLoginResult,
  PublishTargetStatus,
  PublishTargetTestResult,
  QueryResult,
  QueryStatus,
  Platform,
  CDDetails,
  Settings,
  ThrottleStatus,
  BatchQueryResult,
  DisplayCurrency,
  LoginPlatform,
  LoginResult,
  LoginSessionStatus,
  DetailEnrichProgress,
  DetailEnrichProgressStatus,
  DetailEnrichmentResult,
  LanCandidate,
  LanServerStatus,
  LanCatalogAddedEvent,
  LanSearchMode,
  LanSearchPhase,
  LanSearchState,
  LanSearchStatusResponse,
  BarcodeProvider,
  BarcodeCatalogCandidate,
  SettingsTransferResult
}

// Extended progress type for received messages (includes event)
export interface BatchQueryProgressEvent extends BatchQueryProgress {
  event: string
}

export type { BatchQueryProgress }

export interface IElectronAPI {
  /** The host platform (e.g. 'darwin', 'win32', 'linux'). */
  platform: string
  /** Update the native window-controls overlay colors (Windows only). */
  setTitleBarOverlay: (overlay: { color?: string; symbolColor?: string; height?: number }) => Promise<boolean>
  send: (channel: string, data: unknown) => void
  /**
   * Subscribe to a main-process channel; returns the unsubscribe function.
   *
   * Publish progress is pushed on the `'publish:progress'` channel as a
   * `PublishProgress` payload (the channel whitelist lives in the preload).
   */
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
  startLogin: (platform: LoginPlatform) => Promise<LoginResult>
  cancelLogin: () => Promise<void>
  getLoginStatus: (platform: LoginPlatform) => Promise<LoginSessionStatus>
  closeLoginSession: () => Promise<void>
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
   * Enabled marketplace publishing destinations, in user order. The settings
   * page reads `getSettings().publishTargets` instead, because it must also
   * show (and be able to re-enable) disabled targets.
   */
  listPublishTargets: () => Promise<PublishTarget[]>
  /** Probe credentials/session of one target without publishing anything. */
  testPublishTarget: (targetId: string) => Promise<PublishTargetTestResult>
  /**
   * Read-only login probe for one target's own browser profile. Never starts
   * Chrome: `not_started` means that profile has not been opened yet,
   * `logged_out` means it started but the login expired.
   */
  publishTargetStatus: (targetId: string) => Promise<PublishTargetStatus>
  /**
   * Start (or reuse) this target's own Chrome window and wait for the user to
   * scan the QR code. Can take tens of seconds; resolves `ok: false` with a
   * displayable message when the user cancels or the wait times out.
   */
  loginPublishTarget: (targetId: string) => Promise<PublishTargetLoginResult>
  /**
   * Close this target's own browser session and delete its login data.
   * Unrelated to deleting the target itself.
   */
  forgetPublishTarget: (targetId: string) => Promise<PublishTargetLoginResult>
  /** Build the prefilled, editable preview form for one catalog + target. */
  preparePublish: (request: PublishPrepareRequest) => Promise<PublishDraft>
  /**
   * Execute a publish run; progress is pushed on `'publish:progress'`.
   * Never rejects: failures resolve as `PublishOutcome` with `status: 'error'`.
   */
  runPublish: (request: PublishRunRequest) => Promise<PublishOutcome>
  /** Abort the running publish run (harmless when nothing is running). */
  cancelPublish: () => Promise<void>
}

declare global {
  interface Window {
    electronAPI: IElectronAPI
  }
}

export {}
