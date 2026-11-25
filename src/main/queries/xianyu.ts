import type { QueryResult } from '../../shared/types'
import { queryError, withRawItems } from './types'
import { runPlatformQuery } from './runner'
import { apifyListingsToRawItems, listingsToQueryResult } from './apify-results'
import { searchXianyuByImage, ApifyClientError } from '../apify/client'
import { getSetting } from '../settings'
import { DEFAULT_APIFY_SETTINGS } from '../../shared/apify'
import { isTimeoutError } from '../browser/abort'
import { logger } from '../logger'

/**
 * Xianyu (Goofish) reverse-image-search source, powered by an Apify actor.
 * The cover image is downloaded and sent as base64 from the text sources in the same batch.
 */
export function queryXianyu(
  catalogNumber: string,
  imageBase64: string,
  signal?: AbortSignal
): Promise<QueryResult> {
  return runPlatformQuery(catalogNumber, signal, {
    platform: 'xianyu',
    tag: 'queries.xianyu',
    // Bust cached results from before the cover field was normalized.
    cacheContext: 'apify-xianyu-v2',
    mapError: (err) => {
      if (isTimeoutError(err) || err instanceof ApifyClientError) {
        return queryError('xianyu', err instanceof Error ? err.message : '闲鱼图搜失败，请稍后重试')
      }
      return queryError('xianyu', err instanceof Error ? err.message : 'Unknown error')
    },
    run: async (runSignal) => {
      const listings = await searchXianyuByImage(imageBase64, runSignal)
      logger.debug('queries.xianyu', 'actor listings', { catalogNumber, count: listings.length })
      const settings = { ...DEFAULT_APIFY_SETTINGS, ...getSetting('apify') }
      const result = await listingsToQueryResult('xianyu', listings, settings.maxItems)
      return withRawItems(result, apifyListingsToRawItems(listings))
    }
  })
}
