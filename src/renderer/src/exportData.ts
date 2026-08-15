import type { QueryResult, CDDetails, ExcelExportRow } from './electron-api'
import { aggregateDetails, DETAIL_KEYS, isValidDetailValue } from '../../shared/details'

export interface ExportDataOptions {
  catalogNumbers: string[]
  resultsByCatalog: Map<string, QueryResult[]>
  enrichedDetailsByCatalog: Map<string, CDDetails>
  /** Formats a USD amount according to the currently selected currency. */
  formatPrice: (usd: number) => string
  /** Translation function, e.g. the app's useI18n().t. */
  t: (key: string) => string
}

const PLATFORM_PRIORITY: Record<string, number> = {
  discogs: 0,
  hmv: 1,
  kojima: 2,
  yahoo: 3,
  ebay: 4,
  cdjapan: 5,
  tower: 6,
  surugaya: 7,
  zenmarket: 8
}

interface Presentation {
  displayName: string
  displayArtist: string | null | undefined
  displayCover: string | null | undefined
  details: CDDetails
}

function buildPresentation(results: QueryResult[], enrichedDetails?: CDDetails): Presentation {
  const sortedResults = [...results].sort((a, b) =>
    (PLATFORM_PRIORITY[a.platform] ?? 99) - (PLATFORM_PRIORITY[b.platform] ?? 99)
  )

  const aggregation = aggregateDetails(sortedResults)
  const bestDetailResult = aggregation.best?.platform
    ? sortedResults.find(r => r.platform === aggregation.best?.platform)
    : undefined
  const namedBest = bestDetailResult?.status === 'found' && bestDetailResult.name
    ? bestDetailResult
    : undefined
  const primaryResult = namedBest ||
    sortedResults.find(r => r.status === 'found' && r.name) ||
    sortedResults.find(r => r.status === 'found') ||
    sortedResults[0]

  const details: CDDetails = { ...aggregation.details }
  if (enrichedDetails) {
    for (const key of DETAIL_KEYS) {
      if (!isValidDetailValue(details[key]) && isValidDetailValue(enrichedDetails[key])) {
        details[key] = enrichedDetails[key]!.trim()
      }
    }
  }

  return {
    displayName: primaryResult?.name || '',
    displayArtist: primaryResult?.artist,
    displayCover: primaryResult?.coverUrl,
    details
  }
}

export function getCatalogPriceBounds(results: QueryResult[]): { lowestPrice: number | null; highestPrice: number | null } {
  const candidates = results
    .filter(r => r.status === 'found' && (r.priceMin !== null || r.priceMax !== null))
    .map(r => ({
      min: r.priceMin ?? r.priceMax as number,
      max: r.priceMax ?? r.priceMin as number
    }))

  return {
    lowestPrice: candidates.length > 0 ? Math.min(...candidates.map(c => c.min)) : null,
    highestPrice: candidates.length > 0 ? Math.max(...candidates.map(c => c.max)) : null
  }
}

/** Build the detail text exactly like DetailModal's "复制信息" content. */
function buildDetailsText(catalogNumber: string, presentation: Presentation, t: (key: string) => string): string {
  const lines: string[] = [`${t('detail.catalogNumber')}: ${catalogNumber}`]
  if (presentation.displayName && presentation.displayName !== catalogNumber) {
    lines.push(`${t('detail.album')}: ${presentation.displayName}`)
  }
  if (presentation.displayArtist) {
    lines.push(`${t('detail.artist')}: ${presentation.displayArtist}`)
  }
  const labelKeys: Record<(typeof DETAIL_KEYS)[number], string> = {
    label: t('detail.label'),
    format: t('detail.format'),
    country: t('detail.country'),
    released: t('detail.released'),
    genre: t('detail.genre')
  }
  for (const key of DETAIL_KEYS) {
    if (presentation.details[key]) {
      lines.push(`${labelKeys[key]}: ${presentation.details[key]}`)
    }
  }
  return lines.join('\n')
}

export function buildExportRows(options: ExportDataOptions): ExcelExportRow[] {
  const { catalogNumbers, resultsByCatalog, enrichedDetailsByCatalog, formatPrice, t } = options

  return catalogNumbers.map(catalogNumber => {
    const results = resultsByCatalog.get(catalogNumber) || []
    const enrichedDetails = enrichedDetailsByCatalog.get(catalogNumber)
    const presentation = buildPresentation(results, enrichedDetails)
    const bounds = getCatalogPriceBounds(results)

    return {
      catalogNumber,
      imageUrl: presentation.displayCover || '',
      details: buildDetailsText(catalogNumber, presentation, t),
      lowestPrice: bounds.lowestPrice !== null ? formatPrice(bounds.lowestPrice) : '',
      highestPrice: bounds.highestPrice !== null ? formatPrice(bounds.highestPrice) : ''
    }
  })
}
