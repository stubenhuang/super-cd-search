import { getSetting } from '../settings'
import type { Platform, QueryResult } from '../../shared/types'
import type { LLMPlatformResult } from './types'
import { LLMClient } from './client'
import { buildParsePrompt } from './prompt'
import { compressHtml } from '../parser/readability'
import { convertToUSDWithFallback, type Currency } from '../currency'

export async function tryLLMParse(
  platform: Platform,
  catalogNumber: string,
  html: string
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
    const compressedContent = compressHtml(html)
    const prompt = buildParsePrompt(platform, catalogNumber, compressedContent)
    const client = new LLMClient(llmSettings)
    const response = await client.chat([{ role: 'user', content: prompt }])
    const parsed = parseLLMResponse(response.content)
    if (!parsed) {
      return null
    }
    return convertToQueryResult(parsed, platform)
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
  platform: Platform
): Promise<QueryResult> {
  let priceMin: number | null = null
  let priceMax: number | null = null

  if (parsed.priceMin !== null && parsed.priceCurrency) {
    priceMin = await convertToUSDWithFallback(parsed.priceMin, parsed.priceCurrency as Currency)
  }
  if (parsed.priceMax !== null && parsed.priceCurrency) {
    priceMax = await convertToUSDWithFallback(parsed.priceMax, parsed.priceCurrency as Currency)
  }

  return {
    platform,
    name: parsed.name,
    artist: parsed.artist,
    priceMin,
    priceMax,
    coverUrl: parsed.coverUrl,
    link: parsed.link,
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