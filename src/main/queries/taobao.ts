import type { QueryResult } from '../../shared/types'
import { queryError } from './types'
import { runPlatformQuery } from './runner'
import { listingsToQueryResult } from './apify-results'
import { searchTaobaoByImage, ApifyClientError } from '../apify/client'
import { getSetting } from '../settings'
import { DEFAULT_APIFY_SETTINGS } from '../../shared/apify'
import { isTimeoutError } from '../browser/abort'
import { logger } from '../logger'

/**
 * Taobao reverse-image-search source, powered by an Apify actor.
 * The cover image is downloaded and sent as base64 from the text sources in the same batch.
 */
export function queryTaobao(
  catalogNumber: string,
  imageBase64: string,
  signal?: AbortSignal
): Promise<QueryResult> {
  return runPlatformQuery(catalogNumber, signal, {
    platform: 'taobao',
    tag: 'queries.taobao',
    // Isolate from results cached by the previous URL-based implementation.
    cacheContext: 'apify-base64',
    mapError: (err) => {
      if (isTimeoutError(err) || err instanceof ApifyClientError) {
        return queryError('taobao', err instanceof Error ? err.message : '淘宝图搜失败，请稍后重试')
      }
      return queryError('taobao', err instanceof Error ? err.message : 'Unknown error')
    },
    run: async (runSignal) => {
      const listings = await searchTaobaoByImage(imageBase64, runSignal)
      logger.debug('queries.taobao', 'actor listings', { catalogNumber, count: listings.length })
      const settings = { ...DEFAULT_APIFY_SETTINGS, ...getSetting('apify') }
      return listingsToQueryResult('taobao', listings, settings.num)
    }
  })
}
