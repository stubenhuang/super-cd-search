import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  resolveBarcodeCatalog,
  resolveBarcodeCatalogCached,
  getConfiguredBarcodeProviders,
  getCachedBarcodeResolution,
  cacheBarcodeResolution,
  clearBarcodeResolutionCache,
  type BarcodeProviderResolver,
  type BarcodeProviderOutcome
} from '../src/main/barcode/resolver'
import { deleteSetting, setSetting } from '../src/main/settings'
import type { BarcodeProvider } from '../src/shared/types'

function resolver(
  implementation: (provider: BarcodeProvider, barcode: string) => BarcodeProviderOutcome | Promise<BarcodeProviderOutcome>
): BarcodeProviderResolver {
  return async barcode => implementation(barcode as BarcodeProvider, barcode)
}

function resolversFor(cases: Partial<Record<BarcodeProvider, BarcodeProviderOutcome>>): Record<BarcodeProvider, BarcodeProviderResolver> {
  return {
    discogs: resolver(() => cases.discogs || { status: 'not_found' }),
    tower: resolver(() => cases.tower || { status: 'not_found' }),
    hmv: resolver(() => cases.hmv || { status: 'not_found' }),
    yahoo: resolver(() => cases.yahoo || { status: 'not_found' }),
    surugaya: resolver(() => cases.surugaya || { status: 'not_found' })
  }
}

beforeEach(() => {
  clearBarcodeResolutionCache()
  deleteSetting('barcodeProviders')
})

describe('resolveBarcodeCatalog', () => {
  it('stops at the first high-confidence provider', async () => {
    const order: string[] = []
    const resolvers = resolversFor({ discogs: { status: 'found', candidate: { catalogNumber: 'X-1', title: 'Album', source: 'discogs', confidence: 'high' } } })
    const original = resolvers.discogs
    resolvers.discogs = async barcode => {
      order.push('discogs')
      return original(barcode)
    }
    resolvers.tower = async () => {
      order.push('tower')
      return { status: 'not_found' }
    }

    const result = await resolveBarcodeCatalog('1234567890123', ['discogs', 'tower'], resolvers)
    expect(result.status).toBe('found')
    expect(order).toEqual(['discogs'])
  })

  it('collects low-confidence candidates and returns them when no high hit appears', async () => {
    const resolvers = resolversFor({
      tower: { status: 'found', candidate: { catalogNumber: 'WPCS-11100', title: 'Luminosa', source: 'tower', confidence: 'low' } },
      hmv: { status: 'found', candidate: { catalogNumber: 'WPCS-11100', title: 'Luminosa', source: 'hmv', confidence: 'low' } }
    })

    const result = await resolveBarcodeCatalog('4943674029365', ['discogs', 'tower', 'hmv'], resolvers)
    expect(result).toMatchObject({
      status: 'candidates',
      attemptedSources: ['discogs', 'tower', 'hmv']
    })
    if (result.status === 'candidates') {
      expect(result.candidates).toHaveLength(1)
      expect(result.candidates[0].source).toBe('tower')
    }
  })

  it('a later high-confidence hit supersedes earlier low-confidence candidates', async () => {
    const resolvers = resolversFor({
      tower: { status: 'found', candidate: { catalogNumber: 'WRONG-1', title: 'Wrong', source: 'tower', confidence: 'low' } },
      yahoo: { status: 'found', candidate: { catalogNumber: 'WPCS-11100', title: 'Right', source: 'yahoo', confidence: 'high' } }
    })

    const result = await resolveBarcodeCatalog('4943674029365', ['discogs', 'tower', 'hmv', 'yahoo'], resolvers)
    expect(result).toMatchObject({
      status: 'found',
      candidate: { catalogNumber: 'WPCS-11100', source: 'yahoo', confidence: 'high' }
    })
  })

  it('returns no_token only when nothing else produced a candidate', async () => {
    const resolvers = resolversFor({ discogs: { status: 'no_token' } })
    const result = await resolveBarcodeCatalog('1234567890123', ['discogs', 'tower'], resolvers)
    expect(result).toMatchObject({ status: 'no_token', attemptedSources: ['discogs', 'tower'] })
  })

  it('respects the user-configured provider order', () => {
    setSetting('barcodeProviders', ['yahoo', 'discogs'])
    expect(getConfiguredBarcodeProviders()).toEqual(['yahoo', 'discogs'])
  })

  it('falls back to the default order only when the setting is missing', () => {
    setSetting('barcodeProviders', [])
    expect(getConfiguredBarcodeProviders()).toEqual([])
    deleteSetting('barcodeProviders')
    expect(getConfiguredBarcodeProviders()).toEqual(['discogs', 'tower', 'hmv', 'yahoo', 'surugaya'])
  })

  it('returns an error when every provider is disabled', async () => {
    const result = await resolveBarcodeCatalog('1234567890123', [], resolversFor({}))
    expect(result).toMatchObject({ status: 'error', message: expect.stringContaining('没有启用') })
  })

  it('caches found, candidates and not_found resolutions but not errors or no_token', async () => {
    const found = {
      status: 'found' as const,
      candidate: { catalogNumber: 'X-1', title: 'Album', source: 'tower' as const, confidence: 'high' as const },
      attemptedSources: ['tower' as const]
    }
    cacheBarcodeResolution('1111111111111', found)
    expect(getCachedBarcodeResolution('1111111111111')).toEqual(found)

    cacheBarcodeResolution('2222222222222', { status: 'error', message: 'boom' })
    expect(getCachedBarcodeResolution('2222222222222')).toBeNull()

    cacheBarcodeResolution('3333333333333', { status: 'no_token', attemptedSources: ['discogs'] })
    expect(getCachedBarcodeResolution('3333333333333')).toBeNull()

    clearBarcodeResolutionCache()
    expect(getCachedBarcodeResolution('1111111111111')).toBeNull()
  })

  it('resolveBarcodeCatalogCached reuses a cached resolution without calling providers', async () => {
    const spy = vi.fn(async () => ({ status: 'not_found' as const }))
    const resolvers = {
      discogs: spy,
      tower: spy,
      hmv: spy,
      yahoo: spy,
      surugaya: spy
    }
    const resolution = {
      status: 'candidates' as const,
      candidates: [{ catalogNumber: 'X-1', title: 'Album', source: 'tower' as const, confidence: 'low' as const }],
      attemptedSources: ['tower' as const]
    }
    cacheBarcodeResolution('4444444444444', resolution, ['discogs', 'tower'])

    expect(await resolveBarcodeCatalogCached('4444444444444', ['discogs', 'tower'])).toEqual(resolution)
    expect(spy).not.toHaveBeenCalled()
  })
})
