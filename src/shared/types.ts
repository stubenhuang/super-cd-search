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
export type BarcodeProvider = 'discogs' | 'tower' | 'hmv' | 'yahoo' | 'surugaya'

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
  | 'cloudflare_challenge'
  | 'fetch_failed'
  | 'llm_failed'

export type DetailEnrichProgressStatus =
  | 'searching'
  | 'fetching'
  | 'analyzing'
  | 'skipped'
  | 'complete'
  | 'error'

/** Live progress emitted while the detail modal enriches missing fields. */
export interface DetailEnrichProgress {
  catalogNumber: string
  platform: Platform
  status: DetailEnrichProgressStatus
  reason?: DetailEnrichSkipReason
}

export type DetailEnrichmentStatus = 'complete' | 'partial' | 'not_configured' | 'error'

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

export interface ExportFileResult {
  status: 'saved' | 'cancelled' | 'error'
  filePath?: string
  error?: string
}

export interface DirectorySelectResult {
  status: 'selected' | 'cancelled'
  path?: string
}

export interface ExcelExportRow {
  catalogNumber: string
  imageUrl: string
  details: string
  lowestPrice: string
  highestPrice: string
}

export interface ExcelExportPayload {
  headers: string[]
  rows: ExcelExportRow[]
}

export interface ExportProgress {
  phase: 'images'
  current: number
  total: number
}

export interface ThrottleStatus {
  domains: Record<string, {
    pendingRequests: number
    active: boolean
    backoffAttempt: number | null
    nextBackoffDelay: number | null
  }>
}
