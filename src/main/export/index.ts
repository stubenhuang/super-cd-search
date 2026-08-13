import ExcelJS from 'exceljs'
import { dialog } from 'electron'
import type { BatchQueryResult, QueryResult, CDDetails, Platform } from '../../shared/types'
import { downloadImage } from '../image'

const IMAGE_SIZE = 60 // pixels
const ROW_HEIGHT = 120
const EXPORT_IMAGE_SIZE = 120 // pixels (source resolution for the 60px cell)

/**
 * Format price range for display
 */
function formatPriceRange(priceMin: number | null, priceMax: number | null): string {
  if (priceMin === null && priceMax === null) return '---'

  if (priceMin !== null && priceMax !== null && priceMin !== priceMax) {
    return `$${priceMin.toFixed(2)} ~ $${priceMax.toFixed(2)}`
  }

  const price = priceMin ?? priceMax
  return price !== null ? `$${price.toFixed(2)}` : '---'
}

/**
 * Get image extension from mime type
 */
function getExtensionFromMimeType(mimeType: string): 'png' | 'jpeg' | 'gif' {
  if (mimeType.includes('png')) return 'png'
  if (mimeType.includes('gif')) return 'gif'
  return 'jpeg'
}

/**
 * Format CD info into multi-line string
 */
function formatCDInfo(
  name: string | null,
  artist: string | null,
  details: CDDetails | undefined
): string {
  const lines: string[] = []

  if (name) lines.push(`标题: ${name}`)
  if (artist) lines.push(`艺术家: ${artist}`)
  if (details?.label) lines.push(`Label: ${details.label}`)
  if (details?.format) lines.push(`Format: ${details.format}`)
  if (details?.country) lines.push(`Country: ${details.country}`)
  if (details?.released) lines.push(`Released: ${details.released}`)
  if (details?.genre) lines.push(`Genre: ${details.genre}`)

  return lines.length > 0 ? lines.join('\n') : '---'
}

/**
 * Find result for a specific platform
 */
function findPlatformResult(results: QueryResult[], platform: Platform): QueryResult | undefined {
  return results.find(r => r.platform === platform)
}

/**
 * Merge details from all platforms, prioritizing non-null values
 */
function mergeDetails(results: QueryResult[]): CDDetails {
  const merged: CDDetails = {
    label: null,
    format: null,
    country: null,
    released: null,
    genre: null
  }

  for (const result of results) {
    if (result.status !== 'found' || !result.details) continue

    if (!merged.label && result.details.label) merged.label = result.details.label
    if (!merged.format && result.details.format) merged.format = result.details.format
    if (!merged.country && result.details.country) merged.country = result.details.country
    if (!merged.released && result.details.released) merged.released = result.details.released
    if (!merged.genre && result.details.genre) merged.genre = result.details.genre
  }

  return merged
}

/**
 * Get CD basic info (name, artist, coverUrl) from first found result
 */
function getCDInfo(results: QueryResult[]): { name: string | null; artist: string | null; coverUrl: string | null } {
  const found = results.find(r => r.status === 'found' && r.name)
  return {
    name: found?.name || null,
    artist: found?.artist || null,
    coverUrl: found?.coverUrl || null
  }
}

export async function exportToExcel(results: BatchQueryResult[]): Promise<string | null> {
  const { filePath } = await dialog.showSaveDialog({
    title: '导出结果到 Excel',
    defaultPath: `cd-search-results-${new Date().toISOString().slice(0, 16).replace(':', '-')}.xlsx`,
    filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
  })

  if (!filePath) return null

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Super CD Search'
  workbook.created = new Date()

  const worksheet = workbook.addWorksheet('Results')

  // Define columns
  worksheet.columns = [
    { header: '编号', key: 'catalogNumber', width: 20 },
    { header: '封面', key: 'cover', width: 12 },
    { header: 'CD信息', key: 'cdInfo', width: 60 },
    { header: 'Discogs价格', key: 'discogsPrice', width: 18 },
    { header: 'Discogs链接', key: 'discogsLink', width: 25 },
    { header: 'eBay价格', key: 'ebayPrice', width: 18 },
    { header: 'eBay链接', key: 'ebayLink', width: 25 },
    { header: 'Kojima价格', key: 'kojimaPrice', width: 18 },
    { header: 'Kojima链接', key: 'kojimaLink', width: 25 },
    { header: 'HMV价格', key: 'hmvPrice', width: 18 },
    { header: 'HMV链接', key: 'hmvLink', width: 25 },
    { header: 'Yahoo价格', key: 'yahooPrice', width: 18 },
    { header: 'Yahoo链接', key: 'yahooLink', width: 25 },
    { header: 'CDJapan价格', key: 'cdjapanPrice', width: 18 },
    { header: 'CDJapan链接', key: 'cdjapanLink', width: 25 },
    { header: 'Tower价格', key: 'towerPrice', width: 18 },
    { header: 'Tower链接', key: 'towerLink', width: 25 }
  ]

  // Style header row
  const headerRow = worksheet.getRow(1)
  headerRow.font = { bold: true }
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' }
  }
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' }

  // Set row height for header
  headerRow.height = 20

  // Download all images in parallel
  const imagePromises: Map<number, Promise<{ base64: string; mimeType: string } | null>> = new Map()

  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    const cdInfo = getCDInfo(result.results)

    if (cdInfo.coverUrl) {
      imagePromises.set(i, downloadImage(cdInfo.coverUrl, EXPORT_IMAGE_SIZE))
    }
  }

  // Wait for all image downloads
  const imageData = new Map<number, { base64: string; mimeType: string } | null>()
  await Promise.all(
    Array.from(imagePromises.entries()).map(async ([index, promise]) => {
      imageData.set(index, await promise)
    })
  )

  // Add data rows
  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    const rowIndex = i + 2 // +1 for 0-indexed, +1 for header row

    const cdInfo = getCDInfo(result.results)
    const mergedDetails = mergeDetails(result.results)

    // Get platform-specific results
    const platformResults: Record<Platform, QueryResult | undefined> = {
      discogs: findPlatformResult(result.results, 'discogs'),
      ebay: findPlatformResult(result.results, 'ebay'),
      kojima: findPlatformResult(result.results, 'kojima'),
      hmv: findPlatformResult(result.results, 'hmv'),
      yahoo: findPlatformResult(result.results, 'yahoo'),
      cdjapan: findPlatformResult(result.results, 'cdjapan'),
      tower: findPlatformResult(result.results, 'tower')
    }

    // Add row data
    const row = worksheet.addRow({
      catalogNumber: result.catalogNumber,
      cover: '', // Placeholder, image will be added separately
      cdInfo: formatCDInfo(cdInfo.name, cdInfo.artist, mergedDetails),
      discogsPrice: platformResults.discogs?.status === 'found'
        ? formatPriceRange(platformResults.discogs.priceMin, platformResults.discogs.priceMax)
        : '---',
      discogsLink: '', // Set as hyperlink below
      ebayPrice: platformResults.ebay?.status === 'found'
        ? formatPriceRange(platformResults.ebay.priceMin, platformResults.ebay.priceMax)
        : '---',
      ebayLink: '',
      kojimaPrice: platformResults.kojima?.status === 'found'
        ? formatPriceRange(platformResults.kojima.priceMin, platformResults.kojima.priceMax)
        : '---',
      kojimaLink: '',
      hmvPrice: platformResults.hmv?.status === 'found'
        ? formatPriceRange(platformResults.hmv.priceMin, platformResults.hmv.priceMax)
        : '---',
      hmvLink: '',
      yahooPrice: platformResults.yahoo?.status === 'found'
        ? formatPriceRange(platformResults.yahoo.priceMin, platformResults.yahoo.priceMax)
        : '---',
      yahooLink: '',
      cdjapanPrice: platformResults.cdjapan?.status === 'found'
        ? formatPriceRange(platformResults.cdjapan.priceMin, platformResults.cdjapan.priceMax)
        : '---',
      cdjapanLink: '',
      towerPrice: platformResults.tower?.status === 'found'
        ? formatPriceRange(platformResults.tower.priceMin, platformResults.tower.priceMax)
        : '---',
      towerLink: ''
    })

    // Set hyperlink cells
    const linkPlatforms: { key: string; result: QueryResult | undefined }[] = [
      { key: 'discogsLink', result: platformResults.discogs },
      { key: 'ebayLink', result: platformResults.ebay },
      { key: 'kojimaLink', result: platformResults.kojima },
      { key: 'hmvLink', result: platformResults.hmv },
      { key: 'yahooLink', result: platformResults.yahoo },
      { key: 'cdjapanLink', result: platformResults.cdjapan },
      { key: 'towerLink', result: platformResults.tower }
    ]

    for (const { key, result: platformResult } of linkPlatforms) {
      const cell = row.getCell(key)
      if (platformResult?.status === 'found' && platformResult.link) {
        cell.value = {
          text: '点击跳转到详情页',
          hyperlink: platformResult.link
        }
        cell.font = { color: { argb: 'FF0563C1' }, underline: true }
      } else {
        cell.value = '---'
      }
      cell.alignment = { vertical: 'middle', horizontal: 'center' }
    }

    // Set row height for image
    row.height = ROW_HEIGHT

    // Center align all cells
    row.alignment = { vertical: 'middle', wrapText: true }

    // Add image if available
    const imgData = imageData.get(i)
    if (imgData) {
      try {
        const extension = getExtensionFromMimeType(imgData.mimeType)
        const imageId = workbook.addImage({
          base64: imgData.base64,
          extension
        })

        worksheet.addImage(imageId, {
          tl: { col: 1, row: rowIndex - 1 },
          ext: { width: IMAGE_SIZE, height: IMAGE_SIZE },
          editAs: 'oneCell'
        })
      } catch (err) {
        console.warn('Failed to add image to Excel:', err)
        row.getCell(2).value = '(无图片)'
        row.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' }
      }
    } else {
      row.getCell(2).value = '(无图片)'
      row.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' }
    }
  }

  // Auto-filter for all columns
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: results.length + 1, column: 17 }
  }

  // Freeze header row
  worksheet.views = [
    { state: 'frozen', ySplit: 1 }
  ]

  await workbook.xlsx.writeFile(filePath)
  return filePath
}
