export type QueryStatus = 'found' | 'not_found' | 'error' | 'challenge'

export type DisplayCurrency = 'USD' | 'CNY'

export type Platform =
  | 'discogs'
  | 'ebay'
  | 'kojima'
  | 'hmv'
  | 'yahoo'
  | 'cdjapan'
  | 'tower'
  | 'xianyu'
  | 'taobao'

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

/**
 * Marketplace channels that require a manual QR-code login in the shared
 * real-Chrome window before their queries can run.
 */
export type LoginPlatform = 'xianyu' | 'taobao'

/** Result of a manual login run (IPC-facing). */
export interface LoginResult {
  status: 'done' | 'error' | 'cancelled'
  error?: string
}

/**
 * Live status of the real-Chrome login session for one platform. The cookies
 * live in the Chrome profile (not in app settings), so this is derived from the
 * running browser rather than persisted state.
 */
export interface LoginSessionStatus {
  state: 'not_started' | 'starting' | 'unverified' | 'verified' | 'expired'
  /** Absolute ms timestamp when the current login expires (when verified). */
  expiresAt?: number
}

export interface LLMSettings {
  enabled: boolean
  apiBaseUrl: string
  apiKey: string
  model: string
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

/** A usable LAN address detected on this computer. */
export interface LanCandidate {
  address: string
  interfaceName: string
}

export type LanServerState = 'disabled' | 'stopped' | 'running' | 'error' | 'no_network'

/** Live status of the built-in LAN server (IPC-facing). */
export interface LanServerStatus {
  state: LanServerState
  /** Whether the user has the LAN connection feature switched on. */
  enabled: boolean
  /** Address the server is bound to. Empty means "auto". */
  host: string
  port: number
  /**
   * Full URL including the one-time LAN access token. Only send this to the
   * renderer when it needs to build the QR code; never write it to logs.
   */
  url?: string
  error?: string
}

/** Sources that can translate a CD barcode into a catalog number. */
export type BarcodeProvider = 'discogs' | 'tower' | 'hmv' | 'yahoo'

export type BarcodeCandidateConfidence = 'high' | 'low'

/** A catalog number candidate resolved from a barcode by one source. */
export interface BarcodeCatalogCandidate {
  catalogNumber: string
  title: string
  source: BarcodeProvider
  productUrl?: string
  confidence: BarcodeCandidateConfidence
}

export type LanBarcodeLookupStatus = 'added' | 'candidates' | 'not_found' | 'unavailable' | 'no_token' | 'error'

/** Result of a phone-side barcode lookup submitted to the LAN server. */
export interface LanBarcodeLookupResponse {
  status: LanBarcodeLookupStatus
  /** The normalized barcode that was looked up. */
  barcode: string
  /** Catalog number added automatically (when status is `added`). */
  catalogNumber?: string
  /** Release title shown to the user (when added). */
  title?: string
  /** Source that produced an automatic high-confidence match. */
  source?: BarcodeProvider
  /** Low-confidence candidates the phone user must choose from. */
  candidates?: BarcodeCatalogCandidate[]
  /** Human-readable message for non-success states. */
  message?: string
}

/** Sent from the main process to the desktop renderer after a phone lookup. */
export interface LanCatalogAddedEvent {
  catalogNumber: string
  title?: string
}

/**
 * Stages of the desktop search state machine as mirrored to the phone.
 * `deep-dig-prompt` / `smart-prompt` are desktop-side confirmation dialogs;
 * the phone shows a "waiting for the desktop" message.
 */
export type LanSearchPhase =
  | 'idle'
  | 'searching'
  | 'deep-dig-prompt'
  | 'deep-search'
  | 'smart-prompt'
  | 'smart-running'
  | 'smart-cancelled'
  | 'smart-done'
  | 'done'

/** Search mode of the desktop pipeline, mirrored to the phone. */
export type LanSearchMode = 'standard' | 'deep'

/** Per-platform status of one catalog number during a desktop search run. */
export interface LanSearchCatalogProgress {
  catalogNumber: string
  platforms: Array<{ platform: string; status: string }>
}

/**
 * Snapshot of the desktop search state machine, pushed from the renderer to
 * the main process and polled by the phone. The `input` field is the sync
 * channel for the phone/desktop search box.
 */
export interface LanSearchState {
  phase: LanSearchPhase
  /** Desktop search box text (phone edits replace it; desktop edits mirror back). */
  input: string
  /** Matches the desktop search box disabled condition (isLoading / isCancelling / isDeepSearching). */
  busy: boolean
  /** Search mode currently selected on the desktop. */
  searchMode: LanSearchMode
  /** Catalog numbers shown in the current progress panel. */
  catalogs: string[]
  /** Platforms shown in the current progress panel. */
  platforms: string[]
  total: number
  completed: number
  percent: number
  progress: LanSearchCatalogProgress[]
  error: string | null
  /** Smart-generation stage counter (phase `smart-running`). */
  stageIndex?: number
  stageTotal?: number
  /** Catalog number being processed by the smart-generation stage. */
  stageCatalog?: string
  /** Catalog count shown in the deep-dig / smart-generation confirmation dialogs. */
  flowCount?: number
  /** Platforms offered in the deep-dig confirmation dialog (phase `deep-dig-prompt`). */
  flowPlatforms?: string[]
  /** Failed generation count shown in the smart-generation done dialog. */
  flowFailed?: number
}

/** Result of a phone-side search control action (input sync / run trigger). */
export interface LanSearchStatusResponse {
  status: 'ok' | 'error' | 'unavailable'
  message?: string
}

export interface Settings {
  discogsToken?: string
  ebayClientId?: string
  ebayClientSecret?: string
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
  /** Enable the LAN-only HTTP server so a phone can connect via QR code. */
  lanEnabled?: boolean
  /**
   * IPv4 address the LAN server should bind to. Empty means auto-detect;
   * only private (LAN) IPv4 addresses are accepted.
   */
  lanHost?: string
  /** Port for the LAN server. */
  lanPort?: number
  /**
   * Enabled barcode->catalog-number providers, in lookup priority order.
   * Disabled providers are simply absent from this list.
   */
  barcodeProviders?: BarcodeProvider[]
  /** Directory last used for Excel export; preselected next time. */
  lastExportDirectory?: string
  /**
   * Check GitHub for a new version on startup and download it in the
   * background. Defaults to true when unset.
   */
  autoUpdateEnabled?: boolean
  /** Configured marketplace publishing destinations (闲鱼 / Discogs). */
  publishTargets?: import('./publish').PublishTarget[]
}

/**
 * On-disk shape of a password-protected settings backup.
 *
 * The plaintext payload is the JSON of the exported settings (never the LAN
 * pairing token). Everything needed to re-derive the key except the password
 * itself is stored in the clear; the GCM auth tag is what lets us tell a wrong
 * password apart from a damaged file.
 */
export interface SettingsBackupEnvelope {
  app: 'super-cd-search'
  /** Bump only for breaking changes; unknown higher versions are rejected. */
  formatVersion: 1
  exportedAt: string
  kdf: { algorithm: 'pbkdf2-sha512'; iterations: number; salt: string }
  cipher: { algorithm: 'aes-256-gcm'; iv: string; authTag: string }
  /** Base64 ciphertext of the settings JSON. */
  ciphertext: string
}

export type SettingsTransferErrorCode =
  | 'weak_password'
  | 'bad_password'
  | 'corrupt_file'
  | 'unsupported_version'
  | 'cancelled'
  | 'io_error'

export interface SettingsTransferResult {
  status: 'ok' | 'cancelled' | 'error'
  filePath?: string
  /** Keys that were actually written by an import; empty means nothing changed. */
  importedKeys?: string[]
  errorCode?: SettingsTransferErrorCode
  message?: string
}

export interface BatchQueryProgress {
  catalogNumber: string
  platform: string
  status: 'loading' | 'complete' | 'error' | 'not_found' | 'found' | 'challenge'
  results?: QueryResult[]
}

/** Reasons a source can be skipped by the on-demand LLM detail enrichment. */
export type DetailEnrichSkipReason =
  | 'platform_disabled'
  | 'not_found'
  | 'no_product_link'
  | 'fetch_failed'
  | 'llm_failed'

export type DetailEnrichProgressStatus =
  | 'searching'
  | 'fetching'
  | 'analyzing'
  | 'skipped'
  | 'complete'
  | 'error'
  /** Emitted once when the running enrichment was aborted by the user. */
  | 'cancelled'

/** Live progress emitted while the detail modal enriches missing fields. */
export interface DetailEnrichProgress {
  catalogNumber: string
  platform: Platform
  status: DetailEnrichProgressStatus
  reason?: DetailEnrichSkipReason
}

/** 'cancelled' means the run was aborted; partial details may still be present. */
export type DetailEnrichmentStatus = 'complete' | 'partial' | 'not_configured' | 'error' | 'cancelled'

export interface DetailEnrichmentResult {
  status: DetailEnrichmentStatus
  /** False when LLM settings are disabled/incomplete; renderer shows a hint. */
  llmConfigured: boolean
  /** True when previously generated LLM detail fields were reused from cache. */
  usedCache: boolean
  /** Final aggregated details (existing fields are never overwritten). */
  details: CDDetails
  /** Detail keys that are still missing after enrichment. */
  missingFields: (keyof CDDetails)[]
  /** Platforms whose product page was actually sent to the LLM. */
  analyzedPlatforms: Platform[]
  /** Platforms that were searched or had their product page fetched. */
  attemptedPlatforms: Platform[]
  skippedPlatforms: Array<{ platform: Platform; reason: DetailEnrichSkipReason }>
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
