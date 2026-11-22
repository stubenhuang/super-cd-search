import type { QueryResult, Platform } from '../../shared/types'
import { getCachedQueryResult, cacheQueryResult } from './cache'
import { queryError } from './types'
import { throwIfAborted } from '../browser/abort'
import { errorMessage } from '../../shared/utils'
import { logger } from '../logger'

/**
 * The scaffold every platform query shares, in one place.
 *
 * Each `queryX(catalogNumber, signal)` used to open with the same ten lines —
 * abort check, "query start" log, cache lookup with the mode-dependent context,
 * `try { run } catch { queryError }`, a second abort check, then the cache
 * write. Copying it nine times meant every change (a new log line, the fast
 * mode cache context, the Taobao timeout mapping) had to be made nine times,
 * and the copies had already drifted in how they worded the error fallback.
 *
 * Per-platform differences are configuration, not structure:
 * - `tag` keeps the log tags (`queries.tower`, …) unchanged;
 * - `cacheContext` carries the fast/full mode split (undefined → `default`,
 *   which is what `cache.ts` already defaults to);
 * - `run` holds the platform-specific scrape, including the API→web fallbacks
 *   of Discogs/eBay;
 * - `mapError` lets a platform turn its own deadline into a retryable result
 *   without re-implementing the wrapper.
 */

export interface PlatformQueryConfig {
  platform: Platform
  /** Log tag, e.g. `'queries.tower'`. */
  tag: string
  /** Cache namespace; omit for the default context. */
  cacheContext?: string
  run: (signal?: AbortSignal) => Promise<QueryResult>
  /** Default error mapping: `queryError(platform, message|'Unknown error')`. */
  mapError?: (err: unknown) => QueryResult
}

function defaultErrorMapper(platform: Platform) {
  return (err: unknown): QueryResult => queryError(platform, err instanceof Error ? err.message : 'Unknown error')
}

export async function runPlatformQuery(
  catalogNumber: string,
  signal: AbortSignal | undefined,
  config: PlatformQueryConfig
): Promise<QueryResult> {
  const { platform, tag, cacheContext, run, mapError } = config

  throwIfAborted(signal)
  logger.debug(tag, 'query start', { catalogNumber })

  const cached = getCachedQueryResult(platform, catalogNumber, cacheContext)
  if (cached) return cached

  let result: QueryResult
  try {
    result = await run(signal)
  } catch (err) {
    // A cancelled batch must stay a cancellation; only the platform's own
    // failure becomes a (never cached) error result.
    throwIfAborted(signal)
    logger.warn(tag, 'query failed', { catalogNumber, error: errorMessage(err) })
    result = (mapError ?? defaultErrorMapper(platform))(err)
  }

  throwIfAborted(signal)
  cacheQueryResult(catalogNumber, result, cacheContext)
  return result
}
