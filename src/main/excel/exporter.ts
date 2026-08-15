import ExcelJS from 'exceljs'
import type { ExcelExportPayload } from '../../shared/types'
import { downloadImage } from '../image'
import { logger } from '../logger'

export interface WorkbookImage {
  buffer: Buffer
  extension: 'jpeg' | 'png'
}

export type ImageFetcher = (url: string) => Promise<WorkbookImage | null>
export type ImageProgressCallback = (completed: number, total: number) => void

const IMAGE_COLUMN_INDEX = 1
const IMAGE_WIDTH = 110
const IMAGE_HEIGHT = 82
const DATA_ROW_HEIGHT = 90
const IMAGE_CONCURRENCY = 3

async function defaultImageFetcher(url: string): Promise<WorkbookImage | null> {
  const image = await downloadImage(url, 110)
  if (!image) return null
  return {
    buffer: Buffer.from(image.base64, 'base64') as Buffer,
    extension: image.mimeType === 'image/png' ? 'png' : 'jpeg'
  }
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await mapper(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

function styleHeaderRow(row: ExcelJS.Row): void {
  row.height = 24
  row.eachCell(cell => {
    cell.font = { bold: true, size: 12 }
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE8DDBE' }
    }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
  })
}

/**
 * Build the Excel workbook in memory. `imageFetcher` is injectable so tests can
 * run without Electron's native image pipeline.
 */
export async function buildExcelWorkbook(
  payload: ExcelExportPayload,
  imageFetcher: ImageFetcher = defaultImageFetcher,
  onImageProgress?: ImageProgressCallback
): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Super CD Search'
  workbook.created = new Date()

  const worksheet = workbook.addWorksheet('Search Results', {
    views: [{ state: 'frozen', ySplit: 1 }]
  })

  worksheet.columns = [
    { header: payload.headers[0] || '编号', key: 'catalogNumber', width: 16 },
    { header: payload.headers[1] || '图片', key: 'image', width: 18 },
    { header: payload.headers[2] || '详情', key: 'details', width: 90 },
    { header: payload.headers[3] || '最低价', key: 'lowestPrice', width: 12 },
    { header: payload.headers[4] || '最高价', key: 'highestPrice', width: 12 }
  ]
  styleHeaderRow(worksheet.getRow(1))

  for (const row of payload.rows) {
    const dataRow = worksheet.addRow([row.catalogNumber, '', row.details, row.lowestPrice, row.highestPrice])
    dataRow.height = DATA_ROW_HEIGHT
    dataRow.alignment = { vertical: 'top', wrapText: true }

    const detailCell = dataRow.getCell(3)
    detailCell.alignment = { vertical: 'top', wrapText: true }

    const imageCell = dataRow.getCell(2)
    imageCell.alignment = { vertical: 'middle', horizontal: 'center' }
  }

  // Download and embed cover images with limited concurrency.
  let completedImages = 0
  const imageCount = payload.rows.length
  const reportImageProgress = (): void => {
    completedImages++
    onImageProgress?.(completedImages, imageCount)
  }

  await mapWithConcurrency(payload.rows, IMAGE_CONCURRENCY, async (row, index) => {
    if (!row.imageUrl) {
      worksheet.getRow(index + 2).getCell(2).value = '无图'
      reportImageProgress()
      return
    }

    let image: WorkbookImage | null = null
    try {
      image = await imageFetcher(row.imageUrl)
    } catch (err) {
      logger.warn('excel.export', 'cover image download failed', { url: row.imageUrl, error: err instanceof Error ? err.message : String(err) })
    }

    const cell = worksheet.getRow(index + 2).getCell(2)
    if (!image) {
      cell.value = '图片获取失败'
      reportImageProgress()
      return
    }

    try {
      const imageId = workbook.addImage({
        buffer: image.buffer as unknown as ArrayBuffer,
        extension: image.extension
      })
      worksheet.addImage(imageId, {
        tl: { col: IMAGE_COLUMN_INDEX + 0.03, row: index + 1 + 0.04 },
        ext: { width: IMAGE_WIDTH, height: IMAGE_HEIGHT }
      })
    } catch (err) {
      logger.warn('excel.export', 'failed to embed cover image', { url: row.imageUrl, error: err instanceof Error ? err.message : String(err) })
      cell.value = '图片获取失败'
    }
    reportImageProgress()
  })

  return workbook
}

export async function writeExcelFile(
  payload: ExcelExportPayload,
  filePath: string,
  imageFetcher: ImageFetcher = defaultImageFetcher,
  onImageProgress?: ImageProgressCallback
): Promise<void> {
  const startedAt = Date.now()
  const workbook = await buildExcelWorkbook(payload, imageFetcher, onImageProgress)
  await workbook.xlsx.writeFile(filePath)
  logger.debug('excel.export', 'workbook written', { filePath, durationMs: Date.now() - startedAt })
}
