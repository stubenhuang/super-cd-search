import type { QueryResult } from '../../shared/types'
import { queryError } from './types'
import { runPlatformQuery } from './runner'
import { listingsToQueryResult } from './apify-results'
import { searchTaobaoByKeyword, ApifyClientError } from '../apify/client'
import { getSetting } from '../settings'
import { DEFAULT_APIFY_SETTINGS } from '../../shared/apify'
import { isTimeoutError } from '../browser/abort'
import { logger } from '../logger'

/**
 * Taobao keyword-search source, powered by an Apify actor. The catalog number
 * is used as the search keyword (no cover image is needed).
 */
export function queryTaobao(
  catalogNumber: string,
  signal?: AbortSignal
): Promise<QueryResult> {
  return runPlatformQuery(catalogNumber, signal, {
    platform: 'taobao',
    tag: 'queries.taobao',
    // Isolate from results cached by the previous reverse-image implementations.
    cacheContext: 'apify-taobao-v4',
    mapError: (err) => {
      if (isTimeoutError(err) || err instanceof ApifyClientError) {
        return queryError('taobao', err instanceof Error ? err.message : '淘宝搜索失败，请稍后重试')
      }
      return queryError('taobao', err instanceof Error ? err.message : 'Unknown error')
    },
    run: async (runSignal) => {
      const listings = await searchTaobaoByKeyword(catalogNumber, runSignal)
      logger.debug('queries.taobao', 'actor listings', { catalogNumber, count: listings.length })
      const settings = { ...DEFAULT_APIFY_SETTINGS, ...getSetting('apify') }
      return listingsToQueryResult('taobao', listings, settings.num)
    }
  })
}
