import { getLibraryRecords } from '../library'
import { normalizeCatalogNumber } from '../../shared/utils'
import { logger } from '../logger'
import type { PublishItem, PublishSnapshot } from '../../shared/types'

interface ActivePublishRound {
  catalogNumbers: string[]
  startedAt: number
}

/**
 * The publish round is deliberately in-memory only: it exists while the
 * desktop publish page is open and disappears when it closes (or the app
 * quits). Per-record publish state, by contrast, is persistent in the library
 * database and simply read live through the round.
 */
let activeRound: ActivePublishRound | null = null

/**
 * Start a new round with the given catalog numbers. Duplicates (case
 * insensitive) and numbers missing from the library are skipped. Returns the
 * number of items actually in the round. Does not reset any publish state.
 */
export function startPublishRound(catalogNumbers: string[]): number {
  if (!Array.isArray(catalogNumbers)) throw new Error('编号列表格式无效')
  const seen = new Set<string>()
  const wanted: string[] = []
  for (const raw of catalogNumbers) {
    const catalogNumber = normalizeCatalogNumber(String(raw ?? ''))
    if (!catalogNumber) continue
    const key = catalogNumber.toUpperCase()
    if (seen.has(key)) continue
    seen.add(key)
    wanted.push(catalogNumber)
  }

  const records = getLibraryRecords(wanted)
  const existing = new Set(records.map(record => record.catalogNumber.toUpperCase()))
  const catalogList = wanted.filter(catalog => existing.has(catalog.toUpperCase()))
  activeRound = { catalogNumbers: catalogList, startedAt: Date.now() }
  logger.info('publish.round', 'publish round started', { count: catalogList.length })
  return catalogList.length
}

/** End the round ("关闭发布页 / 应用退出"); phones go back to the empty state. */
export function finishPublishRound(): void {
  if (!activeRound) return
  const count = activeRound.catalogNumbers.length
  activeRound = null
  logger.info('publish.round', 'publish round finished', { count })
}

/** Round snapshot for the phone tab and the desktop publish page. */
export function getPublishSnapshot(): PublishSnapshot {
  if (!activeRound) return { publishedAt: null, items: [] }
  const byCatalog = new Map(
    getLibraryRecords(activeRound.catalogNumbers).map(record => [record.catalogNumber.toUpperCase(), record])
  )
  const items: PublishItem[] = []
  for (const catalog of activeRound.catalogNumbers) {
    const record = byCatalog.get(catalog.toUpperCase())
    if (!record) continue // deleted from the library mid-round
    items.push({
      catalogNumber: record.catalogNumber,
      imageUrl: record.imageUrl,
      hasEmbeddedImage: record.hasEmbeddedImage,
      details: record.details,
      lowestPriceUsd: record.lowestPriceUsd,
      highestPriceUsd: record.highestPriceUsd,
      lowestPriceCny: record.lowestPriceCny,
      highestPriceCny: record.highestPriceCny,
      published: record.published === true,
      platforms: record.platforms ?? []
    })
  }
  return { publishedAt: activeRound.startedAt, items }
}
