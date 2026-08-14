import type { QueryResult, QueryStatus, Platform, CDDetails } from '../../shared/types'
import { convertToUSDWithFallback } from '../currency'

export type { QueryResult, QueryStatus, Platform, CDDetails }

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

/**
 * A distinct "needs verification" result for Cloudflare-protected platforms:
 * the scrape hit a challenge page or no verified session is available. Unlike a
 * plain error it is not a transient network failure, so the UI can point the
 * user at the verification flow.
 */
export function cloudflareChallenge(platform: Platform): QueryResult {
  return {
    platform,
    name: null,
    artist: null,
    priceMin: null,
    priceMax: null,
    coverUrl: null,
    link: null,
    status: 'challenge',
    error: 'Cloudflare 验证未完成或已失效，请在设置中完成验证'
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
