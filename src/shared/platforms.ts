import type { BarcodeProvider, Platform } from './types'

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
  'xianyu',
  'taobao'
]

/**
 * Reverse-image-search sources. They need a cover image from the text sources,
 * so the orchestrator runs them in a second phase after the text platforms.
 * Taobao is now a keyword/catalog-number source, not an image source.
 */
export const IMAGE_PLATFORMS: Platform[] = ['xianyu']

export const PLATFORM_LABELS: Record<Platform, string> = {
  discogs: 'Discogs',
  ebay: 'eBay',
  kojima: 'Kojima Rokuon',
  hmv: 'HMV Japan',
  yahoo: 'Yahoo Shopping',
  cdjapan: 'CDJapan',
  tower: 'Tower Records Japan',
  xianyu: '闲鱼',
  taobao: '淘宝'
}

/**
 * Human-readable label of one platform, falling back to its id.
 *
 * Replaces the `PLATFORM_LABELS[p] || p` idiom that was spelled out at every
 * call site (result cards, detail modal, flow dialog phase text).
 */
export function platformLabel(platform: Platform): string {
  return PLATFORM_LABELS[platform] ?? platform
}

/** Default platform set for the standard search mode. */
export const DEFAULT_STANDARD_PLATFORMS: Platform[] = ['discogs', 'ebay']

/** Default platform set for deep search mode (all free text platforms). */
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
  'yahoo'
]

export const DEFAULT_BARCODE_PROVIDERS: BarcodeProvider[] = [...BARCODE_PROVIDERS]

export const BARCODE_PROVIDER_LABELS: Record<BarcodeProvider, string> = {
  discogs: 'Discogs',
  tower: 'Tower Records Japan',
  hmv: 'HMV Japan',
  yahoo: 'Yahoo Shopping'
}

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
