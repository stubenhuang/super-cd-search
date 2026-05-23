import type { QueryResult, QueryStatus, Platform } from '../../shared/types'
import { convertToUSDWithFallback } from '../currency'

export type { QueryResult, QueryStatus, Platform }

export interface PlatformQuery {
  execute(catalogNumber: string): Promise<QueryResult>
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
  // Support two formats:
  // 1. ¥ prefix (HMV): "¥2,750"
  // 2. 円 suffix (Yahoo): "2,574円"
  const match = text.match(/¥([\d,]+)|([\d,]+)円/)
  if (!match) return null
  // Extract the number from whichever group matched
  const priceStr = match[1] || match[2]
  if (!priceStr) return null
  const priceJPY = parseInt(priceStr.replace(/,/g, ''), 10)
  if (isNaN(priceJPY)) return null
  return convertToUSDWithFallback(priceJPY, 'JPY')
}
