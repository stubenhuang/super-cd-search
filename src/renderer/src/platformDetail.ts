import type { Platform, QueryResult, RawItemValue } from '../../shared/types'
import { PLATFORMS } from '../../shared/platforms'
import { PLATFORM_TABLE_FIELDS } from '../../shared/feishu'

/**
 * Renderer-side cap on raw detail rows. Taobao/Xianyu can return up to
 * 1000/1500 raw items per catalog; each cover cell owns a `useCoverImage`
 * hook, so an unbounded table would mount thousands of them at once.
 */
export const MAX_DETAIL_ROWS = 50

/** External-link protocols accepted by the main process (src/main/security/urls.ts). */
const SAFE_PROTOCOLS = new Set(['http:', 'https:'])

/**
 * Platforms that actually carry raw detail items, in canonical PLATFORMS
 * order. Results without `rawItems` (not_found/error/old cache entries) are
 * skipped and duplicates collapse naturally.
 */
export function getPlatformTabs(results: readonly QueryResult[]): Platform[] {
  const withItems = new Set<Platform>()
  for (const result of results) {
    if (result.rawItems && result.rawItems.length > 0) {
      withItems.add(result.platform)
    }
  }
  return PLATFORMS.filter(platform => withItems.has(platform))
}

/** Curated columns of a platform's Feishu detail table (raw scraper keys). */
export function visibleColumns(platform: Platform): readonly string[] {
  return PLATFORM_TABLE_FIELDS[platform]
}

/**
 * Whether a raw value is an absolute http(s) URL that can be handed to
 * `openExternal` (mirrors `isSafeExternalUrl` in src/main/security/urls.ts).
 * Relative paths such as Discogs `uri` values are deliberately rejected.
 */
export function isSafeLink(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 4096) return false
  try {
    return SAFE_PROTOCOLS.has(new URL(value).protocol)
  } catch {
    return false
  }
}

/** Human-readable cell text for a scalar raw value. */
export function formatRawValue(value: RawItemValue | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? '是' : '否'
  return String(value)
}

/** Truncate a raw-item list to a bounded prefix and report the hidden count. */
export function capRows<T>(items: readonly T[], cap: number = MAX_DETAIL_ROWS): { shown: readonly T[]; hidden: number } {
  const shown = items.slice(0, cap)
  return { shown, hidden: Math.max(0, items.length - shown.length) }
}
