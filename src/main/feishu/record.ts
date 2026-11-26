import type { CDDetails, QueryResult, RawItemValue } from '../../shared/types'
import { DETAIL_KEYS, aggregateDetails, fillMissingDetails } from '../../shared/details'
import { FEISHU_PRIMARY_FIELD, FEISHU_RESULTS_FIELD, type FeishuSyncRow } from '../../shared/feishu'
import { mergeResults, serializeResults } from './archived'

/** Best available result for the aggregate row, preferring one with an album name. */
function pickPrimaryResult(results: readonly QueryResult[]): QueryResult | undefined {
  return results.find(result => result.status === 'found' && result.name) ||
    results.find(result => result.status === 'found') ||
    results[0]
}

/**
 * All platform prices for one catalog number, as a JSON string keyed by
 * platform. Prices are already USD-normalized numbers; unavailable ones are
 * null so the key set stays stable for every platform in the batch.
 */
export function buildPriceAll(results: readonly QueryResult[]): string {
  const prices: Record<string, { priceMin: number | null; priceMax: number | null }> = {}
  for (const result of results) {
    prices[result.platform] = {
      priceMin: finiteOrNull(result.priceMin),
      priceMax: finiteOrNull(result.priceMax)
    }
  }
  return JSON.stringify(prices)
}

function finiteOrNull(value: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Empty values are omitted entirely rather than written as ''. Feishu treats
 * an explicitly empty field as "clear the old value", which would wipe details
 * that a later LLM enrichment run did not touch. Scalars are stringified so
 * per-platform raw records (numbers/booleans) can reuse the same helper.
 */
export function putField(fields: Record<string, string>, name: string, value: RawItemValue | undefined): void {
  if (typeof value === 'string') {
    if (value.trim().length > 0) fields[name] = value
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    fields[name] = String(value)
  } else if (typeof value === 'boolean') {
    fields[name] = String(value)
  }
}

/**
 * Turn one catalog number's search data into the Bitable columns. `archived`
 * is the previously stored resultsJson values for this catalog; they are merged
 * by platform so a narrower search never erases channels already found.
 */
export function buildFeishuFields(
  row: FeishuSyncRow,
  archived: readonly QueryResult[] = []
): Record<string, string> {
  const fields: Record<string, string> = {}
  // One source of truth for the whole row. resultsJson is the lossless, merged
  // archive, so every human-readable column is derived from the same merged set.
  // Otherwise a later, narrower search would leave resultsJson as a superset
  // while name/status/priceAll/details describe only the latest batch.
  const effective = mergeResults(row.results, archived)
  const primary = pickPrimaryResult(effective)

  putField(fields, FEISHU_PRIMARY_FIELD, row.catalogNumber)
  if (primary) {
    putField(fields, 'name', primary.name)
    putField(fields, 'artist', primary.artist)
    putField(fields, 'coverUrl', primary.coverUrl)
    putField(fields, 'status', primary.status)
    putField(fields, 'error', primary.error)
  }

  // Same merge as the detail modal: scraped details first, LLM details only
  // fill the fields that are still empty.
  const merged: CDDetails = { ...aggregateDetails(effective).details }
  fillMissingDetails(merged, row.enrichedDetails)
  for (const key of DETAIL_KEYS) {
    putField(fields, key, merged[key])
  }

  fields.priceAll = buildPriceAll(effective)
  // Omitting the key (serializeResults returned null) leaves the existing cell
  // untouched on update rather than overwriting it with a truncated value.
  putField(fields, FEISHU_RESULTS_FIELD, serializeResults(effective) ?? undefined)
  return fields
}
