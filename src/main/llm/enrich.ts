import { BrowserWindow } from 'electron'
import type {
  CDDetails,
  DetailEnrichProgress,
  DetailEnrichSkipReason,
  DetailEnrichmentResult,
  Platform,
  QueryResult
} from '../../shared/types'
import { aggregateDetails, emptyCDDetails, hasAllDetailFields, isValidDetailValue, missingDetailKeys } from '../../shared/details'
import { normalizeCatalogNumber } from '../../shared/utils'
import { getSetting } from '../settings'
import { browserPool } from '../browser'
import { acquireCloudflarePage, isCloudflareChallenge } from '../cloudflare'
import { compressHtml } from '../parser/readability'
import { LLMClient } from './client'
import { buildDetailFillPrompt } from './prompt'
import { logger } from '../logger'
import { queryKojima } from '../queries/kojima'
import { queryHmv } from '../queries/hmv'
import { queryYahoo } from '../queries/yahoo'
import { queryCdjapan } from '../queries/cdjapan'
import { queryTower } from '../queries/tower'
import { querySurugaya } from '../queries/surugaya'
import { queryZenmarket } from '../queries/zenmarket'
import { getCachedEnrichment, cacheEnrichment } from '../queries/cache'

export type SmartFillPlatform = Exclude<Platform, 'discogs' | 'ebay'>

/**
 * On-demand LLM enrichment source order.
 *
 * Ordered by how reliable each Japanese source is for structured release
 * metadata (label/format/country/release date/genre):
 *
 *  1. Tower Records Japan — official retailer, full item spec on product page.
 *  2. HMV Japan — official retailer, structured spec tables.
 *  3. CDJapan — product pages are directly addressable by catalog number.
 *  4. Kojima Rokuon — specialist CD shop with key:value descriptions.
 *  5. Yahoo Shopping — marketplace; useful but less structured.
 *  6. Suruga-ya — second-hand listings; metadata is sparse.
 *  7. ZenMarket — aggregator/proxy of marketplace listings (last resort).
 *
 * Discogs and eBay are intentionally excluded from the smart-fill flow.
 */
export const SMART_FILL_PLATFORM_PRIORITY: SmartFillPlatform[] = [
  'tower',
  'hmv',
  'cdjapan',
  'kojima',
  'yahoo',
  'surugaya',
  'zenmarket'
]

const QUERY_FUNCTIONS: Record<SmartFillPlatform, (catalogNumber: string) => Promise<QueryResult>> = {
  tower: queryTower,
  hmv: queryHmv,
  cdjapan: queryCdjapan,
  kojima: queryKojima,
  yahoo: queryYahoo,
  surugaya: querySurugaya,
  zenmarket: queryZenmarket
}

const PLATFORM_HEADERS: Partial<Record<Platform, Record<string, string>>> = {
  hmv: { 'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8' },
  yahoo: { 'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8' },
  tower: { 'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8' },
  kojima: { 'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8' },
  cdjapan: { 'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8' }
}

const PLATFORM_COOKIES: Partial<Record<Platform, { name: string; domain: string }>> = {
  hmv: { name: 'hmv', domain: '.hmv.co.jp' },
  yahoo: { name: 'yahoo', domain: '.shopping.yahoo.co.jp' },
  tower: { name: 'tower', domain: '.tower.jp' },
  kojima: { name: 'kojimarokuon', domain: '.kojimarokuon.com' },
  cdjapan: { name: 'cdjapan', domain: '.cdjapan.co.jp' }
}

function emitProgress(progress: DetailEnrichProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('detail:enrich-progress', progress)
  }
}

function isLLMConfigured(): boolean {
  const llm = getSetting('llm')
  return !!(
    llm?.enabled &&
    llm.apiKey &&
    llm.apiBaseUrl &&
    llm.model
  )
}

function isPlatformEnabledForLLM(platform: Platform): boolean {
  const llm = getSetting('llm')
  if (!llm?.platformEnabled) return true
  return llm.platformEnabled[platform] !== false
}

async function fetchProductHtml(platform: SmartFillPlatform, url: string): Promise<string | null> {
  // Cloudflare-protected shops run through the user-verified real Chrome.
  if (platform === 'surugaya' || platform === 'zenmarket') {
    const acquired = await acquireCloudflarePage()
    if (!acquired) return null
    const { page, release } = acquired
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
      if (await isCloudflareChallenge(page)) return null
      return await page.content()
    } catch (err) {
      logger.warn('llm.enrich', 'failed to fetch Cloudflare page', { platform, url, error: err instanceof Error ? err.message : String(err) })
      return null
    } finally {
      release()
    }
  }

  const { browser, page } = await browserPool.acquire()
  try {
    const headers = PLATFORM_HEADERS[platform]
    if (headers) {
      await page.setExtraHTTPHeaders(headers)
    }

    const cookie = PLATFORM_COOKIES[platform]
    const cookieValue = getSetting('cookies')?.[platform]
    if (cookie && cookieValue) {
      await page.setCookie({ name: cookie.name, value: cookieValue, domain: cookie.domain, path: '/' })
    }

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    return await page.content()
  } catch (err) {
    logger.warn('llm.enrich', 'failed to fetch product page', { platform, url, error: err instanceof Error ? err.message : String(err) })
    return null
  } finally {
    await browserPool.release(browser, page)
  }
}

/** Merge parsed detail fields into `target`, filling only currently-missing keys. */
function mergeMissingDetails(target: CDDetails, incoming: CDDetails | null | undefined): void {
  if (!incoming) return
  for (const key of Object.keys(target) as (keyof CDDetails)[]) {
    if (!isValidDetailValue(target[key]) && isValidDetailValue(incoming[key])) {
      target[key] = incoming[key].trim()
    }
  }
}

/** Extract a JSON object even when the model wraps it in prose or fences. */
function parseLLMDetailResponse(content: string): CDDetails | null {
  try {
    let jsonText = content.trim()
    const fenced = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fenced) jsonText = fenced[1].trim()

    const start = jsonText.indexOf('{')
    const end = jsonText.lastIndexOf('}')
    if (start >= 0 && end > start) {
      jsonText = jsonText.slice(start, end + 1)
    }

    const parsed = JSON.parse(jsonText) as { details?: Record<string, unknown> } & Record<string, unknown>
    if (typeof parsed !== 'object' || parsed === null) return null

    // Accept either {"details": {...}} or a bare detail object.
    const source = (parsed.details && typeof parsed.details === 'object' ? parsed.details : parsed) as Record<string, unknown>
    const details = emptyCDDetails()

    for (const key of Object.keys(details) as (keyof CDDetails)[]) {
      const value = source[key]
      if (typeof value === 'string' && value.trim()) {
        details[key] = value.trim().slice(0, 300)
      }
    }
    return details
  } catch {
    return null
  }
}

/**
 * On-demand detail enrichment used by the "智能生成" button.
 *
 * Sources are visited one at a time in reliability order. For each source we
 * resolve its product URL (using the renderer's existing result when present,
 * otherwise a fresh search), fetch the product detail page, and ask the LLM
 * only for the fields that are still missing. Processing stops as soon as all
 * detail fields are filled.
 */
export async function enrichDetails(
  catalogNumber: string,
  existingResults: QueryResult[] = [],
  knownDetails?: CDDetails | null
): Promise<DetailEnrichmentResult> {
  const normalizedCatalog = normalizeCatalogNumber(catalogNumber)
  const safeResults = Array.isArray(existingResults) ? existingResults : []
  logger.debug('llm.enrich', 'enrichment start', { catalogNumber: normalizedCatalog, existingSourceCount: safeResults.length })

  const baseAggregation = aggregateDetails([
    { details: knownDetails ?? null },
    ...safeResults
  ])
  const working = { ...baseAggregation.details }
  logger.debug('llm.enrich', 'initial aggregate details', { catalogNumber: normalizedCatalog, missingFields: missingDetailKeys(working) })

  // Reuse previously generated LLM details first. Cached fields never override
  // existing scraper values — they only fill what is still missing.
  const cached = getCachedEnrichment(normalizedCatalog)
  if (cached) {
    mergeMissingDetails(working, cached)
    logger.debug('llm.enrich', 'cached enrichment merged', { catalogNumber: normalizedCatalog, missingFields: missingDetailKeys(working) })
  }

  const notConfiguredResult = (): DetailEnrichmentResult => ({
    status: hasAllDetailFields(working) ? 'complete' : 'not_configured',
    llmConfigured: false,
    usedCache: !!cached,
    details: { ...working },
    missingFields: missingDetailKeys(working),
    analyzedPlatforms: [],
    attemptedPlatforms: [],
    skippedPlatforms: []
  })

  if (!isLLMConfigured()) {
    logger.debug('llm.enrich', 'LLM not configured, returning cached/existing details', { catalogNumber: normalizedCatalog, missingFields: missingDetailKeys(working), cacheHit: !!cached })
    return notConfiguredResult()
  }

  if (hasAllDetailFields(working)) {
    logger.debug('llm.enrich', 'all fields already complete from cache, skipping LLM', { catalogNumber: normalizedCatalog })
    return {
      status: 'complete',
      llmConfigured: true,
      usedCache: true,
      details: { ...working },
      missingFields: [],
      analyzedPlatforms: [],
      attemptedPlatforms: [],
      skippedPlatforms: []
    }
  }

  const llmSettings = getSetting('llm')!
  logger.debug('llm.enrich', 'LLM configured', { catalogNumber: normalizedCatalog, model: llmSettings.model })
  const client = new LLMClient(llmSettings)
  const existingByPlatform = new Map(safeResults.map(result => [result.platform, result]))
  const attemptedPlatforms: SmartFillPlatform[] = []
  const analyzedPlatforms: SmartFillPlatform[] = []
  const skippedPlatforms: Array<{ platform: Platform; reason: DetailEnrichSkipReason }> = []

  const skip = (platform: Platform, reason: DetailEnrichSkipReason): void => {
    skippedPlatforms.push({ platform, reason })
    emitProgress({ catalogNumber: normalizedCatalog, platform, status: 'skipped', reason })
  }

  for (const platform of SMART_FILL_PLATFORM_PRIORITY) {
    if (hasAllDetailFields(working)) break

    logger.debug('llm.enrich', 'source iteration start', { catalogNumber: normalizedCatalog, platform, missingFields: missingDetailKeys(working) })

    if (!isPlatformEnabledForLLM(platform)) {
      logger.debug('llm.enrich', 'source disabled in LLM settings', { catalogNumber: normalizedCatalog, platform })
      skip(platform, 'platform_disabled')
      continue
    }

    // 1. Resolve the product URL. Existing not_found/challenge results are
    //    trusted and skipped — sources that can't find the item never reach LLM.
    let result = existingByPlatform.get(platform)
    if (result && result.status === 'found' && result.link) {
      // Reuse the search result the renderer already has.
    } else if (result && result.status !== 'found') {
      skip(platform, result.status === 'challenge' ? 'cloudflare_challenge' : 'not_found')
      continue
    } else {
      emitProgress({ catalogNumber: normalizedCatalog, platform, status: 'searching' })
      try {
        result = await QUERY_FUNCTIONS[platform](normalizedCatalog)
      } catch (err) {
        logger.warn('llm.enrich', 'source search failed', { catalogNumber: normalizedCatalog, platform, error: err instanceof Error ? err.message : String(err) })
        skip(platform, 'not_found')
        continue
      }
    }

    attemptedPlatforms.push(platform)
    logger.debug('llm.enrich', 'source search resolved', {
      catalogNumber: normalizedCatalog,
      platform,
      status: result?.status ?? 'missing',
      hasLink: !!result?.link
    })

    if (!result || result.status !== 'found') {
      skip(platform, result?.status === 'challenge' ? 'cloudflare_challenge' : 'not_found')
      continue
    }
    if (!result.link) {
      skip(platform, 'no_product_link')
      continue
    }

    // 2. Reuse whatever deterministic scraper fields this source already has.
    mergeMissingDetails(working, result.details)
    logger.debug('llm.enrich', 'scraper fields merged', { catalogNumber: normalizedCatalog, platform, missingFields: missingDetailKeys(working) })
    if (hasAllDetailFields(working)) {
      logger.debug('llm.enrich', 'all fields complete from scraper data, stopping early', { catalogNumber: normalizedCatalog, platform })
      emitProgress({ catalogNumber: normalizedCatalog, platform, status: 'complete' })
      break
    }

    // 3. Fetch the product detail page and ask the LLM for the missing fields.
    emitProgress({ catalogNumber: normalizedCatalog, platform, status: 'fetching' })
    let html: string | null
    try {
      html = await fetchProductHtml(platform, result.link)
    } catch (err) {
      logger.warn('llm.enrich', 'page fetch threw', { catalogNumber: normalizedCatalog, platform, error: err instanceof Error ? err.message : String(err) })
      html = null
    }
    if (!html) {
      skip(platform, platform === 'surugaya' || platform === 'zenmarket' ? 'cloudflare_challenge' : 'fetch_failed')
      continue
    }

    emitProgress({ catalogNumber: normalizedCatalog, platform, status: 'analyzing' })
    const missing = missingDetailKeys(working)
    const content = compressHtml(html, result.link)
    const prompt = buildDetailFillPrompt(platform, normalizedCatalog, content, missing, working)

    try {
      const response = await client.chat([{ role: 'user', content: prompt }])
      const parsed = parseLLMDetailResponse(response.content)
      logger.debug('llm.enrich', 'LLM detail response parsed', {
        catalogNumber: normalizedCatalog,
        platform,
        parsedFieldCount: Object.values(parsed ?? {}).filter(Boolean).length
      })
      mergeMissingDetails(working, parsed)
      analyzedPlatforms.push(platform)
      logger.debug('llm.enrich', 'LLM fields merged', { catalogNumber: normalizedCatalog, platform, missingFields: missingDetailKeys(working) })

      if (hasAllDetailFields(working)) {
        logger.debug('llm.enrich', 'all fields complete, stopping', { catalogNumber: normalizedCatalog, platform })
        emitProgress({ catalogNumber: normalizedCatalog, platform, status: 'complete' })
        break
      }
    } catch (err) {
      logger.warn('llm.enrich', 'LLM analysis failed', { catalogNumber: normalizedCatalog, platform, error: err instanceof Error ? err.message : String(err) })
      skip(platform, 'llm_failed')
    }
  }

  const missingFields = missingDetailKeys(working)

  // Persist whatever the LLM produced — even a partial result is valuable on
  // the next run because it will skip those fields.
  if (analyzedPlatforms.length > 0) {
    cacheEnrichment(normalizedCatalog, working)
  }

  logger.debug('llm.enrich', 'enrichment complete', {
    catalogNumber: normalizedCatalog,
    status: missingFields.length === 0 ? 'complete' : 'partial',
    missingFields,
    analyzedPlatforms,
    attemptedPlatforms,
    skippedPlatforms,
    cacheHit: !!cached
  })

  return {
    status: missingFields.length === 0 ? 'complete' : 'partial',
    llmConfigured: true,
    usedCache: !!cached,
    details: working,
    missingFields,
    analyzedPlatforms,
    attemptedPlatforms,
    skippedPlatforms
  }
}
