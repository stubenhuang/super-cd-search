import type { QueryResult } from '../../shared/types'
import { queryError, withRawItems } from './types'
import { runPlatformQuery } from './runner'
import { apifyListingsToRawItems, listingsToQueryResult } from './apify-results'
import { searchTaobaoByKeyword, ApifyClientError } from '../apify/client'
import { getSetting } from '../settings'
import { resolveApifySettings } from '../../shared/apify'
import { isTimeoutError } from '../browser/abort'
import { logger } from '../logger'

/**
 * Taobao keyword-search source, powered by an Apify actor. `keyword` is the
 * album/artist resolved from the phase-one text results; `catalogNumber` stays
 * the cache key so results are still cached per catalog number.
 */
export function queryTaobao(
  catalogNumber: string,
  keyword: string,
  signal?: AbortSignal
): Promise<QueryResult> {
  return runPlatformQuery(catalogNumber, signal, {
    platform: 'taobao',
    tag: 'queries.taobao',
    // Keyword semantics changed (album/artist instead of catalog number).
    cacheContext: 'apify-taobao-v5',
    mapError: (err) => {
      if (isTimeoutError(err) || err instanceof ApifyClientError) {
        return queryError('taobao', err instanceof Error ? err.message : '淘宝搜索失败，请稍后重试')
      }
      return queryError('taobao', err instanceof Error ? err.message : 'Unknown error')
    },
    run: async (runSignal) => {
      const listings = await searchTaobaoByKeyword(keyword, runSignal)
      logger.debug('queries.taobao', 'actor listings', { catalogNumber, keyword, count: listings.length })
      const settings = resolveApifySettings(getSetting('apify'))
      const result = await listingsToQueryResult('taobao', listings, settings.num)
      return withRawItems(result, apifyListingsToRawItems(listings))
    }
  })
}
