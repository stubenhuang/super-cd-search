/**
 * Shared types for publishing a search result to a marketplace.
 *
 * Two platforms are supported:
 *  - `discogs`: official REST API (`POST /marketplace/listings`), fully automated.
 *  - `xianyu`:  no public listing API exists, so the app drives the seller
 *    workbench (seller.goofish.com) in the shared real-Chrome session and stops
 *    before the final submit, leaving the last click to the user.
 *
 * The renderer renders the preview form from `PublishField[]`, so adding a
 * platform field never requires touching the dialog markup.
 */

export type PublishPlatform = 'xianyu' | 'discogs'

export const PUBLISH_PLATFORMS: PublishPlatform[] = ['xianyu', 'discogs']

/**
 * Currencies the app can prefill a price in. Limited to the ones the exchange
 * rate module converts (see src/main/currency), so the suggested price is
 * always computable; the user can still type any value by hand.
 */
export type PublishCurrency = 'USD' | 'CNY' | 'JPY' | 'EUR' | 'GBP'

export const PUBLISH_CURRENCIES: PublishCurrency[] = ['CNY', 'USD', 'JPY', 'EUR', 'GBP']

/** Discogs media grades, verbatim API values. */
export type PublishMediaCondition =
  | 'Mint (M)'
  | 'Near Mint (NM or M-)'
  | 'Very Good Plus (VG+)'
  | 'Very Good (VG)'
  | 'Good Plus (G+)'
  | 'Good (G)'
  | 'Fair (F)'
  | 'Poor (P)'

export const PUBLISH_MEDIA_CONDITIONS: PublishMediaCondition[] = [
  'Mint (M)',
  'Near Mint (NM or M-)',
  'Very Good Plus (VG+)',
  'Very Good (VG)',
  'Good Plus (G+)',
  'Good (G)',
  'Fair (F)',
  'Poor (P)'
]

/** Discogs sleeve grades: media grades plus the sleeve-only values. */
export type PublishSleeveCondition = PublishMediaCondition | 'Generic' | 'Not Graded' | 'No Cover'

export const PUBLISH_SLEEVE_CONDITIONS: PublishSleeveCondition[] = [
  ...PUBLISH_MEDIA_CONDITIONS,
  'Generic',
  'Not Graded',
  'No Cover'
]

export type PublishListingStatus = 'For Sale' | 'Draft'

/** 成色标签 offered for 闲鱼; matched against the page's own option text. */
export const XIANYU_CONDITIONS = ['全新', '几乎全新', '轻微使用痕迹', '明显使用痕迹', '严重使用痕迹'] as const

/**
 * One configured publishing destination. Everything platform specific is
 * optional so a target stays valid while the user fills it in.
 */
export interface PublishTarget {
  id: string
  platform: PublishPlatform
  /** User-visible label shown in the result-card dropdown, e.g.「我的闲鱼小店」. */
  name: string
  /**
   * Account this target actually operates, detected by the app (never typed by
   * the user): 闲鱼 nickname after the target's own QR login, Discogs username
   * resolved from its token via `/oauth/identity`. Empty until detected.
   */
  account: string
  enabled: boolean
  createdAt: number
  // --- Discogs defaults ---
  currency?: PublishCurrency
  condition?: PublishMediaCondition
  sleeveCondition?: PublishSleeveCondition | ''
  status?: PublishListingStatus
  allowOffers?: boolean
  location?: string
  weight?: number | null
  formatQuantity?: number | null
  /** Optional per-target token; falls back to the global `discogsToken`. */
  token?: string
  // --- 闲鱼 defaults ---
  xianyuCondition?: string
  uploadCover?: boolean
  /**
   * When the 闲鱼 login was last confirmed, for the settings row. Every 闲鱼
   * target owns a separate Chrome profile, so two targets really are two
   * independent accounts — unrelated to the search channel's login.
   */
  xianyuLoginAt?: number
}

/** Login state of one publish target's own browser profile. */
export type PublishTargetLoginState = 'logged_in' | 'logged_out' | 'not_started'

export interface PublishTargetStatus {
  state: PublishTargetLoginState
  /** Account name when known (闲鱼 nickname / member id, Discogs username). */
  account?: string
  /** Ready-to-display Chinese message. */
  message: string
}

export interface PublishTargetLoginResult {
  ok: boolean
  account?: string
  message: string
}

/** Form field kinds the preview dialog knows how to render. */
export type PublishFieldKind = 'text' | 'textarea' | 'number' | 'select' | 'checkbox' | 'readonly' | 'image'

export interface PublishFieldOption {
  value: string
  label: string
}

/**
 * One editable field of the preview form. `labelKey` is an i18n key resolved by
 * the renderer; option labels are platform terms and used verbatim.
 */
export interface PublishField {
  key: string
  labelKey: string
  kind: PublishFieldKind
  value: string | number | boolean | null
  options?: PublishFieldOption[]
  required?: boolean
  maxLength?: number
  /** Optional i18n key for a hint rendered under the field. */
  hintKey?: string
}

export interface PublishReleaseCandidate {
  id: number
  title: string
  catno: string
  year?: number
  format?: string
}

/** A prefilled, still editable publish draft for one catalog number + target. */
export interface PublishDraft {
  targetId: string
  platform: PublishPlatform
  targetName: string
  catalogNumber: string
  fields: PublishField[]
  /** Platform payload that is not a visible field (Discogs release candidates). */
  meta: {
    candidates?: PublishReleaseCandidate[]
  }
  /** Non-fatal problems worth surfacing before the user confirms. */
  warnings: string[]
  /** Blocking problems (e.g. missing credentials); confirm stays disabled. */
  blockers: string[]
}

export type PublishStage =
  | 'preparing'
  | 'resolving'
  | 'filling'
  | 'awaiting-user'
  | 'verifying'
  | 'done'
  | 'error'
  | 'cancelled'

export interface PublishProgress {
  catalogNumber: string
  targetId: string
  stage: PublishStage
  step: number
  totalSteps: number
  /** Already-localized text: the main process owns no i18n table, so it writes
   * plain Chinese messages (the app UI is Chinese-only). */
  message: string
  /** 闲鱼 half-automatic mode: the user must finish in the browser window. */
  needsUserAction?: boolean
  artifacts?: string[]
  error?: string
}

export interface PublishOutcome {
  status: 'published' | 'error' | 'cancelled'
  platform: PublishPlatform
  targetName: string
  catalogNumber: string
  /** Discogs: the listing resource URL. 闲鱼: the opened draft page URL. */
  listingUrl?: string
  listingId?: string
  error?: string
  /** Files written for later selector hardening (DOM dump + screenshot). */
  artifacts?: string[]
}

/** Result of the settings-page「测试连接」button. */
export interface PublishTargetTestResult {
  ok: boolean
  message: string
  /** Account the credentials belong to, when the platform can report it. */
  account?: string
}

export interface PublishPrepareRequest {
  catalogNumber: string
  targetId: string
  results: import('./types').QueryResult[]
  enrichedDetails?: import('./types').CDDetails | null
  /** Details text composed by the renderer (it owns the i18n labels). */
  descriptionText: string
}

export interface PublishRunRequest {
  targetId: string
  catalogNumber: string
  fields: PublishField[]
}
