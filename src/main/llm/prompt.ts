import type { Platform } from '../../shared/types'
import type { CompressedContent } from '../parser/readability'

export function buildParsePrompt(
  platform: Platform,
  catalogNumber: string,
  content: CompressedContent
): string {
  const platformNames: Record<Platform, string> = {
    discogs: 'Discogs',
    ebay: 'eBay',
    kojima: 'Kojima Rokuon',
    hmv: 'HMV Japan',
    yahoo: 'Yahoo Shopping Japan',
    cdjapan: 'CDJapan',
    tower: 'Tower Records Japan'
  }

  return `You are a CD/vinyl product information extractor. Extract product details from the following webpage content.

Platform: ${platformNames[platform]}
Catalog Number: ${catalogNumber}
Page URL: ${content.pageUrl}

Webpage Content:
${content.text}

Extract the following fields and return them as a JSON object. If a field cannot be found, set it to null.

Required JSON format:
{
  "name": "Product title/name",
  "artist": "Artist/performer name",
  "priceMin": Minimum price as number (in original currency),
  "priceMax": Maximum price as number (in original currency, same as priceMin if single price),
  "priceCurrency": "Currency code (JPY, USD, EUR, GBP, etc.)",
  "coverUrl": "Cover image URL - use one from [IMAGE URLs] section above, or construct from the page URL if obvious",
  "link": "Product page URL - use the Page URL above if it points to a product, otherwise pick the best matching URL from [LINK URLs] section",
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
4. For coverUrl: pick the most likely product cover image from the [IMAGE URLs] section. Prefer larger images over thumbnails.
5. For link: use the Page URL if it's a product page, otherwise find the best product link from the [LINK URLs] section
6. Return ONLY the JSON object, no other text or explanation
7. Ensure the JSON is valid and parseable`
}