import type { QueryResult } from '../../shared/types'
import { queryError } from './types'
import { runPlatformQuery } from './runner'
import { listingsToQueryResult } from './apify-results'
import { searchXianyuByImage, ApifyClientError } from '../apify/client'
import { getSetting } from '../settings'
import { DEFAULT_APIFY_SETTINGS } from '../../shared/apify'
import { isTimeoutError } from '../browser/abort'
import { logger } from '../logger'

/**
 * Xianyu (Goofish) reverse-image-search source, powered by an Apify actor.
 * The cover image URL comes from the text sources in the same batch.
 */
export function queryXianyu(
  catalogNumber: string,
  imageUrl: string,
  signal?: AbortSignal
): Promise<QueryResult> {
  return runPlatformQuery(catalogNumber, signal, {
    platform: 'xianyu',
    tag: 'queries.xianyu',
    // Isolate from any results cached by the removed QR-login implementation.
    cacheContext: 'apify',
    mapError: (err) => {
      if (isTimeoutError(err) || err instanceof ApifyClientError) {
        return queryError('xianyu', err instanceof Error ? err.message : '闲鱼图搜失败，请稍后重试')
      }
      return queryError('xianyu', err instanceof Error ? err.message : 'Unknown error')
    },
    run: async (runSignal) => {
      const listings = await searchXianyuByImage(imageUrl, runSignal)
      logger.debug('queries.xianyu', 'actor listings', { catalogNumber, count: listings.length })
      const settings = { ...DEFAULT_APIFY_SETTINGS, ...getSetting('apify') }
      return listingsToQueryResult('xianyu', listings, settings.num)
    }
  })
}
