import type { Platform } from './types'

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
  'zenmarket'
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
  zenmarket: 'ZenMarket'
}

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
