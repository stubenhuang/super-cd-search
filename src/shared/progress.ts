/**
 * Pure helpers for the search progress state. The renderer keeps progress as a
 * flat `Map<key, status>` where each key is `catalogNumber:platform`; this
 * module owns that key format plus the aggregation / filtering / counting logic
 * so it stays testable without a DOM or Electron.
 */

export const PROGRESS_KEY_SEPARATOR = ':'

/** Statuses that mean a platform has finished its work for a catalog number. */
export const TERMINAL_STATUSES: readonly string[] = ['complete', 'not_found', 'error', 'challenge']

export function makeProgressKey(catalogNumber: string, platform: string): string {
  return `${catalogNumber}${PROGRESS_KEY_SEPARATOR}${platform}`
}

export function parseProgressKey(key: string): { catalogNumber: string; platform: string } | null {
  const separator = key.indexOf(PROGRESS_KEY_SEPARATOR)
  if (separator <= 0) return null
  const platform = key.slice(separator + 1)
  if (!platform) return null
  return { catalogNumber: key.slice(0, separator), platform }
}

export function isTerminalStatus(status: string | undefined): boolean {
  return status !== undefined && TERMINAL_STATUSES.includes(status)
}

/**
 * Aggregate a flat progress map into `catalogNumber -> (platform -> status)`,
 * keeping only the platforms in the given allowlist. Platforms never seen yet
 * simply have no entry, which lets callers distinguish "pending" from done.
 */
export function buildProgressByCatalog(
  statuses: ReadonlyMap<string, string>,
  platforms: readonly string[]
): Map<string, Map<string, string>> {
  const map = new Map<string, Map<string, string>>()
  for (const [key, status] of statuses) {
    const parsed = parseProgressKey(key)
    if (!parsed) continue
    if (!platforms.includes(parsed.platform)) continue
    if (!map.has(parsed.catalogNumber)) {
      map.set(parsed.catalogNumber, new Map())
    }
    map.get(parsed.catalogNumber)!.set(parsed.platform, status)
  }
  return map
}

/**
 * Remove every `catalogs × platforms` cross entry from the progress map. Used
 * at the start of a deep-dig pass so leftover terminal statuses from the
 * standard search don't flash the bar to 100% before the dig reports its own
 * progress. Returns the original map reference when nothing was removed so
 * React can skip a re-render.
 */
export function clearProgressEntries(
  statuses: Map<string, string>,
  catalogs: readonly string[],
  platforms: readonly string[]
): Map<string, string> {
  const catalogSet = new Set(catalogs)
  const platformSet = new Set(platforms)
  let next: Map<string, string> | null = null
  for (const key of statuses.keys()) {
    const parsed = parseProgressKey(key)
    if (!parsed) continue
    if (!catalogSet.has(parsed.catalogNumber) || !platformSet.has(parsed.platform)) continue
    if (next === null) next = new Map(statuses)
    next.delete(key)
  }
  return next ?? statuses
}

/**
 * Count catalog numbers whose every platform has reached a terminal status.
 * Only catalogs with a complete platform row (size === platforms.length)
 * qualify, mirroring the deep-dig progress semantics.
 */
export function countCompletedCatalogs(
  byCatalog: ReadonlyMap<string, ReadonlyMap<string, string>>,
  catalogs: readonly string[],
  platforms: readonly string[]
): number {
  let count = 0
  for (const catalogNumber of catalogs) {
    const statuses = byCatalog.get(catalogNumber)
    if (!statuses) continue
    if (statuses.size !== platforms.length) continue
    if (platforms.every(platform => isTerminalStatus(statuses.get(platform)))) {
      count++
    }
  }
  return count
}
