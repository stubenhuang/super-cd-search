import type { QueryResult, QueryStatus, Platform } from '../../shared/types'

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
