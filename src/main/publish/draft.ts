import { convertFromUSD } from '../currency'
import { withTimeout } from '../browser/abort'
import type { CDDetails, QueryResult } from '../../shared/types'
import {
  PUBLISH_MEDIA_CONDITIONS,
  PUBLISH_SLEEVE_CONDITIONS,
  XIANYU_CONDITIONS,
  type PublishDraft,
  type PublishField,
  type PublishCurrency,
  type PublishMediaCondition,
  type PublishPrepareRequest,
  type PublishReleaseCandidate,
  type PublishTarget
} from '../../shared/publish'
import { aggregateDetails, isValidDetailValue, DETAIL_KEYS } from '../../shared/details'
import { getPublishTarget, resolveDiscogsToken } from './targets'
import { searchReleaseCandidates } from './discogs'
import { logger } from '../logger'

/** Lowest USD price across the found platforms of one catalog number. */
export function lowestUsdPrice(results: readonly QueryResult[]): number | null {
  const prices = results
    .filter(result => result.status === 'found')
    .flatMap(result => [result.priceMin, result.priceMax])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  return prices.length > 0 ? Math.min(...prices) : null
}

/**
 * How long a price prefill may wait for the exchange-rate lookup. The lookup
 * already falls back to static rates when it *fails*, but a hanging request
 * would otherwise leave the preview dialog spinning forever, so the prefill is
 * abandoned (and the price left blank) instead.
 */
const PRICE_LOOKUP_TIMEOUT_MS = 3000

async function prefillPrice(usd: number | null, currency: PublishCurrency): Promise<number | null> {
  if (usd === null) return null
  try {
    return await withTimeout(
      () => convertFromUSD(usd, currency),
      PRICE_LOOKUP_TIMEOUT_MS,
      '汇率查询超时'
    )
  } catch {
    return null
  }
}

/** Best available name/artist for prefilled titles. */
export function pickPrimaryResult(results: readonly QueryResult[]): QueryResult | undefined {
  return results.find(result => result.status === 'found' && result.name) ||
    results.find(result => result.status === 'found') ||
    results[0]
}

/** Merge aggregated details with LLM-generated ones without overwriting. */
export function mergeDetails(results: readonly QueryResult[], enriched?: CDDetails | null): CDDetails {
  const merged = { ...aggregateDetails(results).details }
  if (enriched) {
    for (const key of DETAIL_KEYS) {
      if (!isValidDetailValue(merged[key]) && isValidDetailValue(enriched[key])) {
        merged[key] = enriched[key]!.trim()
      }
    }
  }
  return merged
}

/** `艺术家 — 专辑` (or whichever part exists), which is what both platforms expect. */
export function buildTitle(catalogNumber: string, results: readonly QueryResult[]): string {
  const primary = pickPrimaryResult(results)
  const name = primary?.name?.trim() || ''
  const artist = primary?.artist?.trim() || ''
  if (artist && name && artist !== name) return `${artist} — ${name}`
  return name || artist || catalogNumber
}

function catalogNumberField(catalogNumber: string): PublishField {
  return {
    key: 'catalogNumber',
    labelKey: 'publish.field.catalogNumber',
    kind: 'readonly',
    value: catalogNumber
  }
}

/** Build the Discogs preview fields; candidates drive the release selector. */
export function buildDiscogsFields(
  target: PublishTarget,
  catalogNumber: string,
  descriptionText: string,
  candidates: PublishReleaseCandidate[],
  best: PublishReleaseCandidate | null,
  price: number | null
): PublishField[] {
  const condition: PublishMediaCondition = target.condition ?? 'Very Good Plus (VG+)'
  const fields: PublishField[] = [
    catalogNumberField(catalogNumber),
    {
      key: 'release',
      labelKey: 'publish.field.release',
      kind: 'select',
      value: best ? String(best.id) : '',
      required: true,
      options: candidates.map(candidate => ({
        value: String(candidate.id),
        label: [candidate.title, candidate.catno && `[${candidate.catno}]`, candidate.year && `(${candidate.year})`]
          .filter(Boolean)
          .join(' ')
      }))
    },
    {
      key: 'condition',
      labelKey: 'publish.field.condition',
      kind: 'select',
      value: condition,
      required: true,
      options: PUBLISH_MEDIA_CONDITIONS.map(value => ({ value, label: value }))
    },
    {
      key: 'sleeveCondition',
      labelKey: 'publish.field.sleeveCondition',
      kind: 'select',
      value: target.sleeveCondition ?? '',
      options: [
        { value: '', label: '—' },
        ...PUBLISH_SLEEVE_CONDITIONS.map(value => ({ value, label: value }))
      ]
    },
    {
      key: 'price',
      labelKey: 'publish.field.price',
      kind: 'number',
      value: price ?? '',
      required: true
    },
    {
      key: 'currency',
      labelKey: 'publish.field.currency',
      kind: 'readonly',
      value: target.currency ?? 'USD'
    },
    {
      key: 'status',
      labelKey: 'publish.field.status',
      kind: 'select',
      value: target.status ?? 'For Sale',
      required: true,
      options: [
        { value: 'For Sale', label: 'For Sale' },
        { value: 'Draft', label: 'Draft' }
      ]
    },
    {
      key: 'allowOffers',
      labelKey: 'publish.field.allowOffers',
      kind: 'checkbox',
      value: target.allowOffers ?? false
    },
    {
      key: 'comments',
      labelKey: 'publish.field.comments',
      kind: 'textarea',
      value: descriptionText
    },
    {
      key: 'externalId',
      labelKey: 'publish.field.externalId',
      kind: 'text',
      value: catalogNumber,
      hintKey: 'publish.hint.externalId'
    },
    {
      key: 'location',
      labelKey: 'publish.field.location',
      kind: 'text',
      value: target.location ?? ''
    },
    {
      key: 'weight',
      labelKey: 'publish.field.weight',
      kind: 'number',
      value: target.weight ?? '',
      hintKey: 'publish.hint.weight'
    },
    {
      key: 'formatQuantity',
      labelKey: 'publish.field.formatQuantity',
      kind: 'number',
      value: target.formatQuantity ?? '',
      hintKey: 'publish.hint.formatQuantity'
    }
  ]

  return fields
}

/** Build the 闲鱼 preview fields (browser form; last click stays manual). */
export function buildXianyuFields(
  target: PublishTarget,
  catalogNumber: string,
  results: readonly QueryResult[],
  descriptionText: string,
  priceCny: number | null
): PublishField[] {
  const primary = pickPrimaryResult(results)
  return [
    catalogNumberField(catalogNumber),
    {
      key: 'title',
      labelKey: 'publish.field.title',
      kind: 'text',
      value: buildTitle(catalogNumber, results),
      required: true,
      maxLength: 60
    },
    {
      key: 'price',
      labelKey: 'publish.field.price',
      kind: 'number',
      value: priceCny ?? '',
      required: true
    },
    {
      key: 'condition',
      labelKey: 'publish.field.xianyuCondition',
      kind: 'select',
      value: target.xianyuCondition ?? XIANYU_CONDITIONS[0],
      options: XIANYU_CONDITIONS.map(value => ({ value, label: value }))
    },
    {
      key: 'description',
      labelKey: 'publish.field.description',
      kind: 'textarea',
      value: descriptionText
    },
    {
      key: 'image',
      labelKey: 'publish.field.image',
      kind: 'image',
      value: primary?.coverUrl ?? '',
      hintKey: 'publish.hint.image'
    }
  ]
}

/**
 * Assemble the editable draft for one catalog number + target.
 * Throws only for programming errors (unknown target); everything the user can
 * fix shows up as `blockers` / `warnings` in the draft.
 */
export async function buildPublishDraft(request: PublishPrepareRequest): Promise<PublishDraft> {
  const target = getPublishTarget(request.targetId)
  if (!target) throw new Error('发布目标不存在，请到设置中重新配置')

  const results = request.results ?? []
  const descriptionText = request.descriptionText ?? ''
  const warnings: string[] = []
  const blockers: string[] = []

  if (target.platform === 'discogs') {
    const token = resolveDiscogsToken(target)
    const currency = target.currency ?? 'USD'
    const lowestUsd = lowestUsdPrice(results)
    const price = await prefillPrice(lowestUsd, currency)

    if (!token) blockers.push('未配置 Discogs Token：请在「API 令牌」分区填写，或在本目标里单独填写')
    if (lowestUsd === null) warnings.push('搜索结果是空的，价格需要手动填写')
    else if (price === null) warnings.push('汇率查询超时，价格需要手动填写')

    let candidates: PublishReleaseCandidate[] = []
    let best: PublishReleaseCandidate | null = null
    // The database search is public, so candidates are resolved even before a
    // token is configured — the user can pick the release and only then add the
    // credential needed to actually publish.
    try {
      const search = await searchReleaseCandidates(request.catalogNumber, token)
      candidates = search.candidates
      best = search.best
    } catch (err) {
      warnings.push(`Discogs 搜索失败，请手动处理：${err instanceof Error ? err.message : String(err)}`)
    }
    if (candidates.length === 0) {
      blockers.push('没有找到对应的 Discogs Release，无法发布（可先在 Discogs 上确认该版本已收录）')
    }

    logger.debug('publish.draft', 'discogs draft built', {
      catalogNumber: request.catalogNumber,
      candidates: candidates.length,
      currency
    })

    return {
      targetId: target.id,
      platform: target.platform,
      targetName: target.name,
      catalogNumber: request.catalogNumber,
      fields: buildDiscogsFields(target, request.catalogNumber, descriptionText, candidates, best, price),
      meta: { candidates },
      warnings,
      blockers
    }
  }

  const lowestUsd = lowestUsdPrice(results)
  const priceCny = await prefillPrice(lowestUsd, 'CNY')
  if (lowestUsd === null) warnings.push('搜索结果是空的，价格需要手动填写')
  else if (priceCny === null) warnings.push('汇率查询超时，价格需要手动填写')
  if (!pickPrimaryResult(results)?.coverUrl) warnings.push('没有可用封面图，闲鱼发布页需要你手动选图')

  logger.debug('publish.draft', 'xianyu draft built', {
    catalogNumber: request.catalogNumber,
    hasCover: Boolean(pickPrimaryResult(results)?.coverUrl)
  })

  return {
    targetId: target.id,
    platform: target.platform,
    targetName: target.name,
    catalogNumber: request.catalogNumber,
    fields: buildXianyuFields(target, request.catalogNumber, results, descriptionText, priceCny),
    meta: {},
    warnings,
    blockers
  }
}
