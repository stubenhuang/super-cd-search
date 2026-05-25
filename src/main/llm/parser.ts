import { getSetting } from '../settings'
import type { Platform, QueryResult } from '../../shared/types'
import type { LLMPlatformResult } from './types'
import { LLMClient } from './client'
import { buildParsePrompt } from './prompt'
import { compressHtml, type CompressedContent } from '../parser/readability'
import { convertToUSDWithFallback, type Currency } from '../currency'

export async function tryLLMParse(
  platform: Platform,
  catalogNumber: string,
  html: string,
  pageUrl: string
): Promise<QueryResult | null> {
  const llmSettings = getSetting('llm')

  if (!llmSettings?.enabled) {
    return null
  }

  if (!llmSettings.platformEnabled?.[platform]) {
    return null
  }

  if (!llmSettings.apiKey || !llmSettings.apiBaseUrl || !llmSettings.model) {
    return null
  }

  try {
    const compressedContent = compressHtml(html, pageUrl)
    const prompt = buildParsePrompt(platform, catalogNumber, compressedContent)
    const client = new LLMClient(llmSettings)
    const response = await client.chat([{ role: 'user', content: prompt }])
    const parsed = parseLLMResponse(response.content)
    if (!parsed) {
      return null
    }
    return convertToQueryResult(parsed, platform, pageUrl, compressedContent)
  } catch (err) {
    console.warn(`LLM parsing failed for ${platform}:`, err)
    return null
  }
}

function parseLLMResponse(content: string): LLMPlatformResult | null {
  try {
    let jsonStr = content.trim()
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim()
    }
    const parsed = JSON.parse(jsonStr) as LLMPlatformResult
    if (typeof parsed !== 'object' || parsed === null) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

async function convertToQueryResult(
  parsed: LLMPlatformResult,
  platform: Platform,
  pageUrl: string,
  compressed: CompressedContent
): Promise<QueryResult> {
  let priceMin: number | null = null
  let priceMax: number | null = null

  if (parsed.priceMin !== null && parsed.priceCurrency) {
    priceMin = await convertToUSDWithFallback(parsed.priceMin, parsed.priceCurrency as Currency)
  }
  if (parsed.priceMax !== null && parsed.priceCurrency) {
    priceMax = await convertToUSDWithFallback(parsed.priceMax, parsed.priceCurrency as Currency)
  }

  // Resolve coverUrl: use parsed value, or find first relevant image from extracted URLs
  let coverUrl = parsed.coverUrl
  if (!coverUrl && compressed.imageUrls.length > 0) {
    // Find the most relevant cover image (prefer larger images, avoid thumbnails/icons)
    coverUrl = findBestImageUrl(compressed.imageUrls, platform)
  }
  if (coverUrl && !coverUrl.startsWith('http')) {
    coverUrl = resolveUrl(coverUrl, pageUrl)
  }

  // Resolve link: use parsed value, or fallback to first product link
  let link = parsed.link
  if (!link && compressed.linkUrls.length > 0) {
    link = findBestLinkUrl(compressed.linkUrls, platform, pageUrl)
  }
  if (link && !link.startsWith('http')) {
    link = resolveUrl(link, pageUrl)
  }

  return {
    platform,
    name: parsed.name,
    artist: parsed.artist,
    priceMin,
    priceMax,
    coverUrl,
    link,
    status: parsed.name ? 'found' : 'not_found',
    details: parsed.details ? {
      label: parsed.details.label,
      format: parsed.details.format,
      country: parsed.details.country,
      released: parsed.details.released,
      genre: parsed.details.genre
    } : undefined
  }
}

function findBestImageUrl(urls: string[], platform: Platform): string | null {
  // Filter out obvious non-cover images (icons, logos, thumbnails)
  const excludePatterns = [
    /icon/i, /logo/i, /avatar/i, /button/i, /banner/i,
    /\/thumb/i, /\/small/i, /_sm/i, /\/icon\./i,
    /sprite/i, /placeholder/i, /loading/i, /blank/i
  ]

  // Prefer images that likely contain product covers
  const includePatterns = [
    /cover/i, /album/i, /product/i, /item/i, /release/i,
    /image/i, /photo/i, /artwork/i, / jacket/i
  ]

  // Platform-specific patterns
  const platformPatterns: Record<Platform, RegExp[]> = {
    discogs: [/\/r\/\d+-/, /discogs/],
    ebay: [/\/images\/i/, /ebayimg/],
    kojima: [/\/item/, /kojima/],
    hmv: [/\/item/, /hmv/],
    yahoo: [/\/product/, /yahoo/]
  }

  // First try platform-specific matches
  for (const url of urls) {
    if (platformPatterns[platform].some(p => p.test(url))) {
      if (!excludePatterns.some(p => p.test(url))) {
        return url
      }
    }
  }

  // Then try general cover-like patterns
  for (const url of urls) {
    if (includePatterns.some(p => p.test(url))) {
      if (!excludePatterns.some(p => p.test(url))) {
        return url
      }
    }
  }

  // Fall back to first non-excluded URL
  for (const url of urls) {
    if (!excludePatterns.some(p => p.test(url))) {
      return url
    }
  }

  return urls[0] || null
}

function findBestLinkUrl(urls: string[], platform: Platform, pageUrl: string): string | null {
  // Filter out navigation/utility links
  const excludePatterns = [
    /^\/$/, /login/i, /signin/i, /signup/i, /account/i,
    /cart/i, /checkout/i, /help/i, /support/i, /faq/i,
    /search/i, /category/i, /browse/i, /filter/i,
    /\.css/i, /\.js/i, /\.png/i, /\.jpg/i, /\.gif/i,
    /mailto:/, /tel:/, /javascript:/, /^#/
  ]

  // Platform-specific product link patterns
  const productPatterns: Record<Platform, RegExp[]> = {
    discogs: [/\/release\//, /\/master\//],
    ebay: [/\/itm\//, /item\/\d+/, /listing\/\d+/],
    kojima: [/\/item\//, /\/product\//],
    hmv: [/\/item\//, /\/product\//],
    yahoo: [/\/product\//, /\/item\//, /store\//]
  }

  // First try platform-specific product link patterns
  for (const url of urls) {
    if (productPatterns[platform].some(p => p.test(url))) {
      if (!excludePatterns.some(p => p.test(url))) {
        return url
      }
    }
  }

  // Fall back to first non-excluded, non-image URL
  for (const url of urls) {
    if (!excludePatterns.some(p => p.test(url))) {
      return url
    }
  }

  // Last resort: use the pageUrl itself if it looks like a product page
  if (productPatterns[platform].some(p => p.test(pageUrl))) {
    return pageUrl
  }

  return null
}

function resolveUrl(relativeUrl: string, baseUrl: string): string {
  try {
    return new URL(relativeUrl, baseUrl).href
  } catch {
    // If resolution fails, return the original
    return relativeUrl
  }
}