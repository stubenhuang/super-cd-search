import type { Platform, QueryResult } from '../../shared/types'
import { convertToUSDWithFallback } from '../currency'
import { notFound } from './types'
import type { ApifyListing } from '../apify/client'

/**
 * Turn the actor's ranked listings into one QueryResult. The best (first) match
 * supplies the name/link/cover; the top N CNY prices are converted to USD and
 * collapsed into the priceMin/priceMax range the rest of the app expects.
 */
export async function listingsToQueryResult(
  platform: Platform,
  listings: ApifyListing[],
  topN: number
): Promise<QueryResult> {
  const usable = listings.slice(0, Math.max(1, topN))
  const best = usable[0]
  if (!best) return notFound(platform)

  const converted = await Promise.all(
    usable.map(listing =>
      listing.priceCNY === null ? null : convertToUSDWithFallback(listing.priceCNY, 'CNY')
    )
  )
  const prices = converted.filter((price): price is number => price !== null)
  if (prices.length === 0) return notFound(platform)

  return {
    platform,
    name: best.title,
    artist: null,
    priceMin: Math.min(...prices),
    priceMax: Math.max(...prices),
    coverUrl: best.coverUrl,
    link: best.url,
    status: 'found'
  }
}
