import type { Platform } from '../../shared/types'

export function buildParsePrompt(
  platform: Platform,
  catalogNumber: string,
  content: string
): string {
  const platformNames: Record<Platform, string> = {
    discogs: 'Discogs',
    ebay: 'eBay',
    kojima: 'Kojima Rokuon',
    hmv: 'HMV Japan',
    yahoo: 'Yahoo Shopping Japan'
  }

  return `You are a CD/vinyl product information extractor. Extract product details from the following webpage content.

Platform: ${platformNames[platform]}
Catalog Number: ${catalogNumber}

Webpage Content:
${content}

Extract the following fields and return them as a JSON object. If a field cannot be found, set it to null.

Required JSON format:
{
  "name": "Product title/name",
  "artist": "Artist/performer name",
  "priceMin": Minimum price as number (in original currency),
  "priceMax": Maximum price as number (in original currency, same as priceMin if single price),
  "priceCurrency": "Currency code (JPY, USD, EUR, GBP, etc.)",
  "coverUrl": "Cover image URL",
  "link": "Product page URL",
  "details": {
    "label": "Record label name",
    "format": "Format (CD, SACD, LP, Vinyl, etc.)",
    "country": "Country of release",
    "released": "Release date",
    "genre": "Music genre/style"
  }
}

Important:
1. Extract prices exactly as shown on the page with the original currency
2. If there's a price range, set priceMin and priceMax accordingly; if single price, set both to the same value
3. For Japanese platforms (HMV, Kojima, Yahoo), prices are usually in JPY
4. Return ONLY the JSON object, no other text or explanation
5. Ensure the JSON is valid and parseable`
}