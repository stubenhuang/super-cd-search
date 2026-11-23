import type { CDDetails, QueryResult } from '../../shared/types'
import { DETAIL_KEYS, aggregateDetails, fillMissingDetails } from '../../shared/details'
import { FEISHU_PRIMARY_FIELD, type FeishuFieldName, type FeishuSyncRow } from '../../shared/feishu'
import { pickPrimaryResult } from '../publish/draft'

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
 * that a later LLM enrichment run did not touch.
 */
function putField(fields: Record<string, string>, name: FeishuFieldName, value: string | null | undefined): void {
  if (typeof value === 'string' && value.trim().length > 0) {
    fields[name] = value
  }
}

/** Turn one catalog number's search data into the twelve Bitable columns. */
export function buildFeishuFields(row: FeishuSyncRow): Record<string, string> {
  const fields: Record<string, string> = {}
  const primary = pickPrimaryResult(row.results)

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
  const merged: CDDetails = { ...aggregateDetails(row.results).details }
  fillMissingDetails(merged, row.enrichedDetails)
  for (const key of DETAIL_KEYS) {
    putField(fields, key, merged[key])
  }

  fields.priceAll = buildPriceAll(row.results)
  return fields
}
