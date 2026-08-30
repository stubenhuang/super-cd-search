import type { Platform, CDDetails } from '../../shared/types'
import { DETAIL_KEYS, isValidDetailValue } from '../../shared/details'
import type { CompressedContent } from '../parser/readability'

const PLATFORM_NAMES: Record<Platform, string> = {
  discogs: 'Discogs',
  ebay: 'eBay',
  kojima: 'Kojima Rokuon',
  hmv: 'HMV Japan',
  yahoo: 'Yahoo Shopping Japan',
  cdjapan: 'CDJapan',
  tower: 'Tower Records Japan',
  surugaya: 'Suruga-ya',
  zenmarket: 'ZenMarket',
  xianyu: 'Xianyu',
  taobao: 'Taobao'
}

const DETAIL_FIELD_NAMES: Record<keyof CDDetails, string> = {
  label: 'label (record label)',
  format: 'format (CD, SACD, LP, Blu-spec CD, etc.)',
  country: 'country of release',
  released: 'release date',
  genre: 'genre / style'
}

/**
 * Build the prompt used by the on-demand "smart generate" flow. Unlike the old
 * whole-page parser, the LLM is only asked for the fields that are currently
 * missing and is explicitly told not to touch existing values.
 *
 * The webpage content passed in already includes the page's JSON-LD
 * structured data (see compressHtml), which Japanese retailers embed as the
 * authoritative source for genre/label/format/release date. The prompt tells
 * the model to prefer that section, then normalizes values to the same
 * conventions Discogs produces (English genre/country names, "CD, Album"
 * style formats, ISO dates) so the detail modal shows consistent output
 * regardless of source platform.
 */
export function buildDetailFillPrompt(
  platform: Platform,
  catalogNumber: string,
  content: CompressedContent,
  missingFields: (keyof CDDetails)[],
  knownDetails: CDDetails
): string {
  const requestedFields = missingFields.length > 0 ? missingFields : [...DETAIL_KEYS]
  const knownLines = DETAIL_KEYS
    .filter(key => isValidDetailValue(knownDetails[key]))
    .map(key => `- ${DETAIL_FIELD_NAMES[key]}: ${knownDetails[key]}`)
    .join('\n')

  const missingLines = requestedFields
    .map(key => `    "${key}": "extracted value or null"`)
    .join(',\n')

  return `You are a CD/vinyl metadata extractor specialized in Japanese music retail pages.

Platform: ${PLATFORM_NAMES[platform]}
Catalog Number: ${catalogNumber}
Page URL: ${content.pageUrl}

Webpage Content:
${content.text}

Known details (already collected from other sources — do NOT change or return these):
${knownLines || '(none)'}

Missing fields to find on this page:
${requestedFields.map(key => `- ${DETAIL_FIELD_NAMES[key]}`).join('\n')}

Extract ONLY the missing fields from the webpage content above and return a JSON object in exactly this shape:

{
  "details": {
${missingLines}
  }
}

Rules:
1. If the page contains a "[STRUCTURED DATA]" section, trust it first — it is machine-readable metadata embedded by the shop and is more reliable than prose. Use its values for the matching fields (genre, label, format, released).
2. Normalize values to standard Discogs-style conventions so results look consistent across platforms:
   - country: use the English country name ("Japan", "US", "UK", ...). The Japanese "国内" means "Japan" (domestic release); "輸入盤"/"輸入" means an import (leave as the stated country, e.g. "UK", "US", or null when unspecified).
   - format: use the Discogs style, e.g. "CD, Album", "CD, Album, Stereo", "SACD", "LP, Reissue". The Japanese "CDアルバム" → "CD, Album", "SHM-CD" stays "SHM-CD", "Blu-spec CD" stays as-is.
   - released: prefer an ISO date "YYYY-MM-DD" (e.g. "2015年06月17日" → "2015-06-17"); fall back to the year alone when only a year is given.
   - genre: translate Japanese genre names to English ("クラシック" → "Classical", "ジャズ" → "Jazz", "ロック" → "Rock", "ポップス" → "Pop", "アニメ" → "Anime", "サウンドトラック" → "Soundtrack"), and combine multiple genres with ", ".
   - label: keep the label name exactly as written (proper noun, no translation).
3. Set a field to null when it cannot be found clearly on the page — never invent or guess values.
4. Do not return fields that were listed as already known.
5. If the page shows multiple releases/formats, prefer the one matching the catalog number above.
6. Return ONLY the JSON object, no markdown fences, no explanations.`
}
