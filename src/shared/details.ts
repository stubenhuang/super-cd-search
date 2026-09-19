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

/** Localized labels used when composing the human-readable details text. */
export interface DetailsTextLabels {
  catalogNumber: string
  album: string
  artist: string
  fields: Record<DetailKey, string>
}

export interface BuildDetailsTextOptions {
  catalogNumber: string
  /** Album title; skipped when missing or identical to the catalog number. */
  album?: string | null
  artist?: string | null
  details: CDDetails
  labels: DetailsTextLabels
}

/**
 * Compose the multi-line details text shared by the detail modal's「复制信息」
 * and the publish preview's description field. Renderer-owned because it needs
 * localized labels; the main process receives the finished text.
 */
export function buildDetailsText(options: BuildDetailsTextOptions): string {
  const { catalogNumber, album, artist, details, labels } = options
  const lines: string[] = [`${labels.catalogNumber}: ${catalogNumber}`]
  if (album && album !== catalogNumber) lines.push(`${labels.album}: ${album}`)
  if (artist) lines.push(`${labels.artist}: ${artist}`)
  for (const key of DETAIL_KEYS) {
    const value = details[key]
    if (isValidDetailValue(value)) lines.push(`${labels.fields[key]}: ${value}`)
  }
  return lines.join('\n')
}
