import { getSetting } from '../settings'
import { BARCODE_PROVIDERS, DEFAULT_BARCODE_PROVIDERS } from '../../shared/platforms'
import type { BarcodeCatalogCandidate, BarcodeProvider } from '../../shared/types'
import { logger } from '../logger'
import {
  resolveDiscogsBarcode,
  resolveHmvBarcode,
  resolveSurugayaBarcode,
  resolveTowerBarcode,
  resolveYahooBarcode
} from './providers'

export type BarcodeProviderOutcome =
  | { status: 'found'; candidate: BarcodeCatalogCandidate }
  | { status: 'not_found' }
  | { status: 'no_token' }
  | { status: 'skipped'; reason?: string }
  | { status: 'error'; message?: string }

export type BarcodeProviderResolver = (barcode: string) => Promise<BarcodeProviderOutcome>

export type BarcodeResolution =
  | { status: 'found'; candidate: BarcodeCatalogCandidate; attemptedSources: BarcodeProvider[] }
  | { status: 'candidates'; candidates: BarcodeCatalogCandidate[]; attemptedSources: BarcodeProvider[] }
  | { status: 'not_found'; attemptedSources: BarcodeProvider[] }
  | { status: 'no_token'; attemptedSources: BarcodeProvider[] }
  | { status: 'error'; message: string }

export const barcodeResolvers: Record<BarcodeProvider, BarcodeProviderResolver> = {
  discogs: resolveDiscogsBarcode,
  tower: resolveTowerBarcode,
  hmv: resolveHmvBarcode,
  yahoo: resolveYahooBarcode,
  surugaya: resolveSurugayaBarcode
}

export function getConfiguredBarcodeProviders(): BarcodeProvider[] {
  const configured = getSetting('barcodeProviders')
  if (configured === undefined || configured === null || !Array.isArray(configured)) {
    return [...DEFAULT_BARCODE_PROVIDERS]
  }

  const seen = new Set<BarcodeProvider>()
  const ordered: BarcodeProvider[] = []
  for (const value of configured) {
    const provider = BARCODE_PROVIDERS.find(p => p === value)
    if (provider && !seen.has(provider)) {
      seen.add(provider)
      ordered.push(provider)
    }
  }
  return ordered
}

function dedupeCandidates(candidates: BarcodeCatalogCandidate[]): BarcodeCatalogCandidate[] {
  const seen = new Set<string>()
  return candidates.filter(candidate => {
    const key = candidate.catalogNumber.toUpperCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Walk the configured providers in order. A high-confidence hit is returned
 * immediately (stopping the chain); low-confidence hits are collected and, if
 * nothing better appears, returned for the phone user to choose from.
 */
export async function resolveBarcodeCatalog(
  barcode: string,
  providers: BarcodeProvider[] = getConfiguredBarcodeProviders(),
  resolvers: Record<BarcodeProvider, BarcodeProviderResolver> = barcodeResolvers
): Promise<BarcodeResolution> {
  if (providers.length === 0) {
    return { status: 'error', message: '没有启用任何条码解析供应商，请到设置中开启' }
  }

  const attemptedSources: BarcodeProvider[] = []
  const lowConfidence: BarcodeCatalogCandidate[] = []
  let sawNoToken = false

  for (const provider of providers) {
    attemptedSources.push(provider)
    try {
      const outcome = await resolvers[provider](barcode)
      logger.debug('barcode', 'provider outcome', { barcode, provider, status: outcome.status })

      if (outcome.status === 'found') {
        if (outcome.candidate.confidence === 'high') {
          return { status: 'found', candidate: outcome.candidate, attemptedSources }
        }
        lowConfidence.push(outcome.candidate)
        continue
      }

      if (outcome.status === 'no_token') {
        sawNoToken = true
        continue
      }

      // not_found / skipped / error: try the next provider.
    } catch (err) {
      logger.warn('barcode', 'provider resolver threw', {
        barcode,
        provider,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  if (lowConfidence.length > 0) {
    return {
      status: 'candidates',
      candidates: dedupeCandidates(lowConfidence),
      attemptedSources
    }
  }

  if (sawNoToken) {
    return { status: 'no_token', attemptedSources }
  }

  return { status: 'not_found', attemptedSources }
}

// ---------------------------------------------------------------------------
// Small in-memory TTL cache for full resolution results. Errors/no_token are
// not cached so users can fix their configuration without waiting a day.
// ---------------------------------------------------------------------------

interface ResolutionCacheEntry {
  resolution: BarcodeResolution
  fetchedAt: number
}

const RESOLUTION_CACHE_TTL = 24 * 60 * 60 * 1000
const RESOLUTION_CACHE_MAX = 500
const resolutionCache = new Map<string, ResolutionCacheEntry>()

export function clearBarcodeResolutionCache(): void {
  resolutionCache.clear()
}

function resolutionCacheKey(barcode: string, providers: BarcodeProvider[]): string {
  return providers.length > 0 ? `${providers.join('>')}:${barcode}` : barcode
}

export function getCachedBarcodeResolution(barcode: string, providers: BarcodeProvider[] = []): BarcodeResolution | null {
  const key = resolutionCacheKey(barcode, providers)
  const entry = resolutionCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.fetchedAt > RESOLUTION_CACHE_TTL) {
    resolutionCache.delete(key)
    return null
  }
  return entry.resolution
}

export function cacheBarcodeResolution(barcode: string, resolution: BarcodeResolution, providers: BarcodeProvider[] = []): void {
  if (resolution.status === 'error' || resolution.status === 'no_token') return
  const key = resolutionCacheKey(barcode, providers)
  resolutionCache.delete(key)
  resolutionCache.set(key, { resolution, fetchedAt: Date.now() })
  if (resolutionCache.size > RESOLUTION_CACHE_MAX) {
    const oldest = resolutionCache.keys().next().value
    if (oldest !== undefined) resolutionCache.delete(oldest)
  }
}

/** Resolve using the shared cache; mainly used by the LAN barcode handler. */
export async function resolveBarcodeCatalogCached(
  barcode: string,
  providers: BarcodeProvider[] = getConfiguredBarcodeProviders()
): Promise<BarcodeResolution> {
  const cached = getCachedBarcodeResolution(barcode, providers)
  if (cached) {
    logger.debug('barcode', 'resolution cache hit', { barcode, status: cached.status })
    return cached
  }

  const resolution = await resolveBarcodeCatalog(barcode, providers)
  cacheBarcodeResolution(barcode, resolution, providers)
  return resolution
}
