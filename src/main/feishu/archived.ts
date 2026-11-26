import { PLATFORMS } from '../../shared/platforms'
import { errorMessage } from '../../shared/utils'
import { logger } from '../logger'
import {
  findArchivedResults,
  isFeishuConfigured,
  normalizeFeishuSettings,
  readFeishuSettings
} from './client'
import type { CDDetails, Platform, QueryResult, QueryStatus, RawItem, RawItemValue } from '../../shared/types'

/**
 * Feishu type-1 text cells cap at 100,000 characters. Leave headroom for the
 * JSON escaping Feishu may apply, and for future fields on QueryResult.
 */
const MAX_ARCHIVED_JSON_CHARS = 95_000
/** A stored cell larger than this is treated as corrupt rather than parsed. */
const MAX_PARSE_CHARS = 200_000

const QUERY_STATUSES: ReadonlySet<string> = new Set(['found', 'not_found', 'error', 'challenge'])

/**
 * Serialize one catalog number's full results into the resultsJson column.
 *
 * rawItems are also archived in the per-platform tables, so when a batch is
 * large enough to threaten Feishu's cell limit we drop them from this JSON
 * first. If it is still too large we return null: the caller then omits the
 * key, and on an update Feishu keeps the previously archived value instead of
 * erasing it with a truncated one.
 */
export function serializeResults(results: readonly QueryResult[]): string | null {
  const full = JSON.stringify(results)
  if (full.length <= MAX_ARCHIVED_JSON_CHARS) return full

  const slim = results.map(result => {
    const copy: Record<string, unknown> = { ...result }
    delete copy.rawItems
    return copy
  })
  const slimJson = JSON.stringify(slim)
  if (slimJson.length <= MAX_ARCHIVED_JSON_CHARS) {
    logger.warn('feishu.archived', 'resultsJson too large, dropping rawItems', { chars: full.length })
    return slimJson
  }
  logger.warn('feishu.archived', 'resultsJson too large even without rawItems, skipping write', { chars: full.length })
  return null
}

function isRawItemValue(value: unknown): value is RawItemValue {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value)
}

function parseRawItems(value: unknown): RawItem[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items: RawItem[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const flat: RawItem = {}
    for (const [key, cell] of Object.entries(entry as Record<string, unknown>)) {
      if (isRawItemValue(cell)) flat[key] = cell
    }
    items.push(flat)
  }
  return items.length > 0 ? items : undefined
}

function parseDetails(value: unknown): CDDetails | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  const read = (key: keyof CDDetails): string | null =>
    typeof source[key] === 'string' ? source[key] as string : null
  return {
    label: read('label'),
    format: read('format'),
    country: read('country'),
    released: read('released'),
    genre: read('genre')
  }
}

function strOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function numOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Defensively parse the resultsJson column. The cell is user-editable in
 * Feishu, so nothing from it reaches the orchestrator or renderer until its
 * shape has been validated here. Corrupt cells simply yield no archive.
 */
export function parseArchivedResults(raw: string): QueryResult[] {
  if (!raw || raw.length > MAX_PARSE_CHARS) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const out: QueryResult[] = []
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const item = entry as Record<string, unknown>
    const platform = item.platform
    const status = item.status
    if (typeof platform !== 'string' || !PLATFORMS.includes(platform as Platform)) continue
    if (typeof status !== 'string' || !QUERY_STATUSES.has(status)) continue

    const result: QueryResult = {
      platform: platform as Platform,
      name: strOrNull(item.name),
      artist: strOrNull(item.artist),
      priceMin: numOrNull(item.priceMin),
      priceMax: numOrNull(item.priceMax),
      coverUrl: strOrNull(item.coverUrl),
      link: strOrNull(item.link),
      status: status as QueryStatus
    }
    if (typeof item.error === 'string') result.error = item.error
    const details = parseDetails(item.details)
    if (details) result.details = details
    const rawItems = parseRawItems(item.rawItems)
    if (rawItems) result.rawItems = rawItems
    out.push(result)
  }
  return out
}

function preferFound(current: QueryResult, archived: QueryResult | undefined): QueryResult {
  if (current.status === 'found') return current
  if (archived?.status === 'found') return archived
  return current
}

/**
 * Merge a fresh batch's results over the previously archived ones, keyed by
 * platform. Archived platforms absent from this batch are preserved, so a
 * narrower search (e.g. switching from deep to standard mode) never erases
 * channels that were already found. A `found` archive is never downgraded by a
 * later not_found/error result. Output follows canonical platform order.
 */
export function mergeResults(
  current: readonly QueryResult[],
  archived: readonly QueryResult[]
): QueryResult[] {
  const byPlatform = new Map<Platform, QueryResult>()
  for (const result of archived) byPlatform.set(result.platform, result)
  for (const result of current) {
    byPlatform.set(result.platform, preferFound(result, byPlatform.get(result.platform)))
  }
  return PLATFORMS
    .filter(platform => byPlatform.has(platform))
    .map(platform => byPlatform.get(platform)!)
}

/**
 * Only `found` results are reused permanently. not_found/error stay
 * re-queryable through the ordinary 1-day local cache.
 */
export function foundByPlatform(results: readonly QueryResult[]): Map<Platform, QueryResult> {
  const map = new Map<Platform, QueryResult>()
  for (const result of results) {
    if (result.status === 'found' && !map.has(result.platform)) map.set(result.platform, result)
  }
  return map
}

/**
 * One batch-level Feishu lookup before a search runs. Returns, per catalog
 * number, the archived `found` results keyed by platform. Any failure
 * (disabled, unconfigured, offline, timeout, malformed cell) degrades to an
 * empty map so the search falls back to the existing live-query path.
 */
export async function loadArchivedFoundResults(
  catalogNumbers: readonly string[],
  signal: AbortSignal
): Promise<Map<string, Map<Platform, QueryResult>>> {
  const empty = new Map<string, Map<Platform, QueryResult>>()
  const raw = readFeishuSettings()
  if (!raw.enabled || !isFeishuConfigured(raw) || catalogNumbers.length === 0 || signal.aborted) {
    return empty
  }

  const settings = normalizeFeishuSettings(raw)
  try {
    const texts = await findArchivedResults(settings, [...catalogNumbers], signal)
    const out = new Map<string, Map<Platform, QueryResult>>()
    for (const [catalogNumber, text] of texts) {
      const found = foundByPlatform(parseArchivedResults(text))
      if (found.size > 0) out.set(catalogNumber, found)
    }
    if (out.size > 0) {
      logger.debug('feishu.archived', 'loaded archived results', {
        catalogs: [...out.keys()],
        platformCount: [...out.values()].reduce((total, map) => total + map.size, 0)
      })
    }
    return signal.aborted ? empty : out
  } catch (err) {
    logger.warn('feishu.archived', 'archived lookup failed, falling back to live queries', { error: errorMessage(err) })
    return empty
  }
}
