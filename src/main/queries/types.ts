import type { QueryResult, QueryStatus, Platform, CDDetails, RawItem } from '../../shared/types'
import { convertToUSDWithFallback } from '../currency'

export type { QueryResult, QueryStatus, Platform, CDDetails }

/** Attach the raw scraper items that back this result for the per-platform Feishu tables. */
export function withRawItems(result: QueryResult, items: RawItem[]): QueryResult {
  return items.length > 0 ? { ...result, rawItems: items } : result
}

export function notFound(platform: Platform): QueryResult {
  return {
    platform,
    name: null,
    artist: null,
    priceMin: null,
    priceMax: null,
    coverUrl: null,
    link: null,
    status: 'not_found'
  }
}

export function queryError(platform: Platform, message: string): QueryResult {
  return {
    platform,
    name: null,
    artist: null,
    priceMin: null,
    priceMax: null,
    coverUrl: null,
    link: null,
    status: 'error',
    error: message
  }
}

/** Parse Japanese price text (e.g., "¥3,300" or "1,980円") and convert to USD */
export async function parseJPYPrice(text: string): Promise<number | null> {
  const match = text.match(/¥?([\d,]+)円?/)
  if (!match) return null
  const priceJPY = parseInt(match[1].replace(/,/g, ''), 10)
  if (isNaN(priceJPY)) return null
  return convertToUSDWithFallback(priceJPY, 'JPY')
}

