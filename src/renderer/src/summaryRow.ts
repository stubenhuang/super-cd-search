import type { CDDetails, DisplayCurrency, Platform, QueryResult, QueryStatus } from '../../shared/types'
import { FEISHU_FIELDS, type FeishuFieldName } from '../../shared/feishu'
import { aggregateDetails, fillMissingDetails } from '../../shared/details'
import { PLATFORMS, platformLabel } from '../../shared/platforms'
import type { TranslationKey } from './i18n'
import { isSafeLink } from './platformDetail'

/**
 * Field set and order are literally the Feishu 汇总表 definition, so the
 * in-app summary card always shows every column that gets archived.
 */
export const SUMMARY_COLUMNS: readonly FeishuFieldName[] = FEISHU_FIELDS

/** Exhaustive so adding a Feishu column without a label fails typecheck. */
export const SUMMARY_COLUMN_LABEL_KEYS: Record<FeishuFieldName, TranslationKey> = {
  '编号': 'detail.catalogNumber',
  name: 'detail.album',
  artist: 'detail.artist',
  coverUrl: 'summary.cover',
  status: 'summary.status',
  error: 'summary.error',
  label: 'detail.label',
  format: 'detail.format',
  country: 'detail.country',
  released: 'detail.released',
  genre: 'detail.genre',
  priceAll: 'summary.priceAll',
  resultsJson: 'summary.results'
}

/** Exhaustive over all four QueryStatus values, including `challenge`. */
export const STATUS_LABEL_KEYS: Record<QueryStatus, TranslationKey> = {
  found: 'result.statusFound',
  not_found: 'result.statusNotFound',
  error: 'result.statusError',
  challenge: 'result.statusChallenge'
}

/**
 * Presentation grouping for the summary card. Flattened `columns` is exactly
 * FEISHU_FIELDS in order, so every archived column stays visible (tests assert
 * exhaustiveness — adding a Feishu column forces a group update).
 */
export type SummaryGroupId = 'identity' | 'details' | 'pricing' | 'results'

export interface SummaryFieldGroup {
  id: SummaryGroupId
  columns: readonly FeishuFieldName[]
}

export const SUMMARY_FIELD_GROUPS: readonly SummaryFieldGroup[] = [
  { id: 'identity', columns: ['编号', 'name', 'artist', 'coverUrl', 'status', 'error'] },
  { id: 'details', columns: ['label', 'format', 'country', 'released', 'genre'] },
  { id: 'pricing', columns: ['priceAll'] },
  { id: 'results', columns: ['resultsJson'] }
]

/** Exhaustive group-title labels for the card's field sections. */
export const SUMMARY_GROUP_LABEL_KEYS: Record<SummaryGroupId, TranslationKey> = {
  identity: 'summary.group.identity',
  details: 'summary.group.details',
  pricing: 'summary.group.pricing',
  results: 'summary.group.results'
}

/** Fields whose content needs a full grid row (price pills / result count). */
export const WIDE_COLUMNS: ReadonlySet<FeishuFieldName> = new Set(['priceAll', 'resultsJson'])

/** Moved verbatim from the old per-platform card (App.tsx formatPrice). */
export function formatPrice(
  min: number | null,
  max: number | null,
  currency: DisplayCurrency,
  usdToCnyRate: number | null
): string {
  if (min === null && max === null) return '-'

  const formatSingle = (usd: number): string => {
    if (currency === 'CNY' && usdToCnyRate !== null) {
      return `¥${(usd * usdToCnyRate).toFixed(2)}`
    }
    return `$${usd.toFixed(2)}`
  }

  if (min === null || max === null) {
    const price = min ?? max
    return price !== null ? formatSingle(price) : '-'
  }
  if (min === max) return formatSingle(min)
  return `${formatSingle(min)} - ${formatSingle(max)}`
}

/** Mirror of buildFeishuFields' pickPrimaryResult (main/feishu/record.ts). */
export function pickPrimaryResult(results: readonly QueryResult[]): QueryResult | undefined {
  return results.find(result => result.status === 'found' && result.name) ||
    results.find(result => result.status === 'found') ||
    results[0]
}

function finiteOrNull(value: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Lowest/highest bounds across found results, for the inline price badges. */
export function computePriceBounds(results: readonly QueryResult[]): {
  lowestPrice: number | null
  highestPrice: number | null
} {
  const candidates: { min: number; max: number }[] = []
  for (const result of results) {
    if (result.status !== 'found') continue
    const min = finiteOrNull(result.priceMin)
    const max = finiteOrNull(result.priceMax)
    if (min === null && max === null) continue
    candidates.push({ min: (min ?? max) as number, max: (max ?? min) as number })
  }
  return {
    lowestPrice: candidates.length > 0 ? Math.min(...candidates.map(c => c.min)) : null,
    highestPrice: candidates.length > 0 ? Math.max(...candidates.map(c => c.max)) : null
  }
}

export interface PriceEntry {
  platform: Platform
  label: string
  priceMin: number | null
  priceMax: number | null
  /** Absolute http(s) link only; relative URLs never reach openExternal. */
  link: string | null
  isLowest: boolean
  isHighest: boolean
}

/**
 * One entry per platform present in the batch (same key set as Feishu's
 * priceAll), but in canonical PLATFORMS order rather than completion order.
 */
export function buildPriceAllEntries(results: readonly QueryResult[]): PriceEntry[] {
  const bounds = computePriceBounds(results)
  const byPlatform = new Map<Platform, QueryResult>()
  for (const result of results) byPlatform.set(result.platform, result)

  const entries: PriceEntry[] = []
  for (const platform of PLATFORMS) {
    const result = byPlatform.get(platform)
    if (!result) continue
    const priceMin = finiteOrNull(result.priceMin)
    const priceMax = finiteOrNull(result.priceMax)
    const effectiveMin = priceMin ?? priceMax
    const effectiveMax = priceMax ?? priceMin
    entries.push({
      platform,
      label: platformLabel(platform),
      priceMin,
      priceMax,
      link: isSafeLink(result.link) ? result.link : null,
      isLowest: result.status === 'found' && effectiveMin !== null && effectiveMin === bounds.lowestPrice,
      isHighest: bounds.lowestPrice !== bounds.highestPrice &&
        result.status === 'found' && effectiveMax !== null && effectiveMax === bounds.highestPrice
    })
  }
  return entries
}

/** Empty/relative cover URLs must not trigger a fetchImage IPC round-trip. */
export function safeCoverUrl(url: string | null | undefined): string | null {
  return isSafeLink(url) ? url : null
}

export function buildResultsSummary(results: readonly QueryResult[]): { total: number; found: number } {
  return {
    total: results.length,
    found: results.filter(result => result.status === 'found').length
  }
}

export interface SummaryCells {
  name: string | null
  artist: string | null
  coverUrl: string | null
  status: QueryStatus | null
  error: string | null
  details: CDDetails
  priceEntries: PriceEntry[]
  resultsTotal: number
  resultsFound: number
}

/**
 * All values for one summary card. Mirrors buildFeishuFields: the five
 * human-readable columns come from pickPrimaryResult, the detail columns from
 * aggregateDetails + LLM fill-only enrichment (no sorting, no overwrite).
 */
export function buildSummaryCells(
  results: readonly QueryResult[],
  enrichedDetails?: CDDetails | null
): SummaryCells {
  const primary = pickPrimaryResult(results)
  const details: CDDetails = { ...aggregateDetails(results).details }
  fillMissingDetails(details, enrichedDetails)
  const summary = buildResultsSummary(results)

  return {
    name: primary?.name ?? null,
    artist: primary?.artist ?? null,
    coverUrl: safeCoverUrl(primary?.coverUrl),
    status: primary?.status ?? null,
    error: primary?.error ?? null,
    details,
    priceEntries: buildPriceAllEntries(results),
    resultsTotal: summary.total,
    resultsFound: summary.found
  }
}
