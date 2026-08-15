import type { CDDetails, Platform } from './types'

export const DETAIL_KEYS = ['label', 'format', 'country', 'released', 'genre'] as const
export type DetailKey = (typeof DETAIL_KEYS)[number]

/** A minimal view of a search result used for detail aggregation. */
export interface DetailSource {
  platform?: Platform
  details?: CDDetails | null
}

export interface DetailAggregation {
  details: CDDetails
  /** The source with the most valid detail fields (undefined when all sources are empty). */
  best: DetailSource | null
}

export function emptyCDDetails(): CDDetails {
  return { label: null, format: null, country: null, released: null, genre: null }
}

/** Treat trimmed, non-empty values as valid detail data. */
export function isValidDetailValue(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function countValidDetailFields(details?: CDDetails | null): number {
  if (!details) return 0
  return DETAIL_KEYS.reduce((count, key) => count + (isValidDetailValue(details[key]) ? 1 : 0), 0)
}

export function missingDetailKeys(details?: CDDetails | null): DetailKey[] {
  return DETAIL_KEYS.filter(key => !isValidDetailValue(details?.[key]))
}

export function hasAllDetailFields(details?: CDDetails | null): boolean {
  return missingDetailKeys(details).length === 0
}

/**
 * Aggregate detail fields from several sources.
 *
 * Sources are ordered by the number of valid fields they carry (descending);
 * the richest source therefore "swallows" poorer sources on every field it
 * defines. Poorer sources are still consulted for the fields the richer ones
 * left empty, which fills the aggregate as completely as possible. Ties keep
 * the input order, so callers can pass a preferred-platform order.
 */
export function aggregateDetails(sources: readonly DetailSource[]): DetailAggregation {
  const scored = sources
    .map((source, index) => ({ source, score: countValidDetailFields(source.details), index }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)

  const details = emptyCDDetails()

  for (const entry of scored) {
    // A non-zero score guarantees a non-null details object.
    const sourceDetails = entry.source.details!
    for (const key of DETAIL_KEYS) {
      const value = sourceDetails[key]
      if (details[key] === null && isValidDetailValue(value)) {
        details[key] = value.trim()
      }
    }
  }

  return {
    details,
    best: scored[0]?.source ?? null
  }
}
