import type { BarcodeProvider, Platform, PublishPlatform } from './types'

/**
 * Canonical platform order used across the app: result ordering, export
 * columns and the renderer's platform selector all follow this list.
 */
export const PLATFORMS: Platform[] = [
  'discogs',
  'ebay',
  'kojima',
  'hmv',
  'yahoo',
  'cdjapan',
  'tower',
  'surugaya',
  'zenmarket',
  'xianyu',
  'taobao'
]

export const PLATFORM_LABELS: Record<Platform, string> = {
  discogs: 'Discogs',
  ebay: 'eBay',
  kojima: 'Kojima Rokuon',
  hmv: 'HMV Japan',
  yahoo: 'Yahoo Shopping',
  cdjapan: 'CDJapan',
  tower: 'Tower Records Japan',
  surugaya: 'Suruga-ya',
  zenmarket: 'ZenMarket',
  xianyu: 'Xianyu',
  taobao: 'Taobao'
}

/**
 * Text-search platforms. The marketplace channels (xianyu/taobao) are not part
 * of this list: they are special channels that need a QR-code login and only
 * run while they are both checked and verified (see SELECTABLE_PLATFORMS).
 */
export const SEARCH_PLATFORMS: Platform[] = PLATFORMS.filter(p => p !== 'xianyu' && p !== 'taobao')

/** Marketplace channels driven by the special-channel login flow. */
export const CHANNEL_PLATFORMS: Platform[] = ['xianyu', 'taobao']

/**
 * Everything the user can tick for the standard/deep search modes in the
 * settings panel: text platforms plus the marketplace channels. A checked
 * channel still only joins a search while its QR login is verified.
 */
export const SELECTABLE_PLATFORMS: Platform[] = [...SEARCH_PLATFORMS, ...CHANNEL_PLATFORMS]

/** Default platform set for the standard search mode. */
export const DEFAULT_STANDARD_PLATFORMS: Platform[] = ['discogs', 'ebay']

/**
 * Default platform set for the deep search mode. The two Cloudflare-protected
 * platforms are intentionally excluded: they need a manual verification step
 * first, so new users opt in to them from the settings panel instead of having
 * an unverified deep search fail by default.
 */
export const DEFAULT_DEEP_PLATFORMS: Platform[] = [
  'discogs',
  'ebay',
  'kojima',
  'hmv',
  'yahoo',
  'cdjapan',
  'tower'
]

/** All barcode -> catalog-number providers in their default priority order. */
export const BARCODE_PROVIDERS: BarcodeProvider[] = [
  'discogs',
  'tower',
  'hmv',
  'yahoo',
  'surugaya'
]

export const DEFAULT_BARCODE_PROVIDERS: BarcodeProvider[] = [...BARCODE_PROVIDERS]

export const BARCODE_PROVIDER_LABELS: Record<BarcodeProvider, string> = {
  discogs: 'Discogs',
  tower: 'Tower Records Japan',
  hmv: 'HMV Japan',
  yahoo: 'Yahoo Shopping',
  surugaya: 'Suruga-ya'
}

/** Marketplaces a published CD can be marked as listed on (user-maintained). */
export const PUBLISH_PLATFORMS: PublishPlatform[] = ['taobao', 'xianyu', 'discogs']

/**
 * Platforms offered for the deep-dig pass after a standard search. Deep dig
 * widens coverage to the deep-mode platform set instead of re-querying the
 * (already exhausted) standard set. Falls back to the deep defaults when the
 * setting is missing, and is deduplicated and ordered by the canonical
 * PLATFORMS list so the progress column matches result/export ordering.
 */
export function resolveDeepDigPlatforms(
  settings?: { deepPlatforms?: Platform[] } | null
): Platform[] {
  const configured = settings?.deepPlatforms ?? DEFAULT_DEEP_PLATFORMS
  const selected = new Set<Platform>(configured)
  return PLATFORMS.filter(p => selected.has(p))
}

/**
 * Collapse a platform list into a readable, shortened label for dialogs. When
 * the list is longer than `max`, only the first `max` names are shown and the
 * remainder is returned as a count so long lists don't stretch the modal.
 */
export function summarizePlatformNames(
  platforms: readonly Platform[],
  labels: Readonly<Partial<Record<Platform, string>>>,
  max = 4
): { shown: string; rest: number } {
  const shownPlatforms = platforms.slice(0, max)
  const shown = shownPlatforms.map(p => labels[p] ?? p).join(' / ')
  return { shown, rest: platforms.length - shownPlatforms.length }
}
