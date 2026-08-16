import ExcelJS from 'exceljs'
import type { CDLibraryImportError } from '../../shared/types'
import { validateLibraryRecordInput, type EmbeddedLibraryImage, type ImportedLibraryRecord } from '../library'

const HEADER_ALIASES = {
  catalogNumber: ['编号', 'Catalog Number'],
  image: ['图片', 'Image'],
  details: ['详情', 'Details'],
  lowestPriceUsd: ['最低价($)', 'Lowest Price ($)'],
  highestPriceUsd: ['最高价($)', 'Highest Price ($)'],
  lowestPriceCny: ['最低价(￥)', 'Lowest Price (¥)'],
  highestPriceCny: ['最高价(￥)', 'Highest Price (¥)']
} as const

type HeaderKey = keyof typeof HEADER_ALIASES
type ColumnMap = Record<HeaderKey, number>

export interface ExcelImportParseResult {
  records: ImportedLibraryRecord[]
  errors: CDLibraryImportError[]
  inputRows: number
}

function findColumns(worksheet: ExcelJS.Worksheet): ColumnMap | null {
  const headers = new Map<string, number>()
  worksheet.getRow(1).eachCell((cell, column) => {
    headers.set(cell.text.trim(), column)
  })

  const columns = {} as ColumnMap
  for (const [key, aliases] of Object.entries(HEADER_ALIASES) as Array<[HeaderKey, readonly string[]]>) {
    const alias = aliases.find(item => headers.has(item))
    if (!alias) return null
    columns[key] = headers.get(alias)!
  }
  return columns
}

function getNumericCell(row: ExcelJS.Row, column: number, label: string): number | null {
  const value = row.getCell(column).value
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'number') throw new Error(`${label}必须是数值单元格`)
  return value
}

function imageBuffer(image: ExcelJS.Image): EmbeddedLibraryImage | null {
  if (image.extension !== 'png' && image.extension !== 'jpeg') return null
  const source = image.buffer ?? (image.base64 ? Buffer.from(image.base64, 'base64') : null)
  if (!source) return null
  return {
    buffer: Buffer.from(source as unknown as Uint8Array),
    mimeType: image.extension === 'png' ? 'image/png' : 'image/jpeg'
  }
}

function imagesByRow(workbook: ExcelJS.Workbook, worksheet: ExcelJS.Worksheet, imageColumn: number): Map<number, EmbeddedLibraryImage> {
  const result = new Map<number, EmbeddedLibraryImage>()
  for (const entry of worksheet.getImages()) {
    const rowNumber = Math.floor(entry.range.tl.row) + 1
    const columnNumber = Math.floor(entry.range.tl.col) + 1
    if (columnNumber !== imageColumn) continue
    const image = workbook.getImage(Number(entry.imageId))
    const parsed = imageBuffer(image)
    if (parsed) result.set(rowNumber, parsed)
  }
  return result
}

function imageUrlFromCell(cell: ExcelJS.Cell): string {
  if (cell.hyperlink) return cell.hyperlink.trim()
  return cell.text.trim()
}

export async function parseLibraryExcel(filePath: string): Promise<ExcelImportParseResult> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)

  let worksheet: ExcelJS.Worksheet | undefined
  let columns: ColumnMap | null = null
  for (const candidate of workbook.worksheets) {
    const found = findColumns(candidate)
    if (found) {
      worksheet = candidate
      columns = found
      break
    }
  }
  if (!worksheet || !columns) {
    throw new Error('未找到完整的新版 7 列表头；旧 5 列 Excel 不支持导入')
  }

  const embeddedImages = imagesByRow(workbook, worksheet, columns.image)
  const errors: CDLibraryImportError[] = []
  const byCatalog = new Map<string, ImportedLibraryRecord>()
  let inputRows = 0

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber)
    if (!row.hasValues) continue
    inputRows++
    try {
      const raw: ImportedLibraryRecord = {
        catalogNumber: row.getCell(columns.catalogNumber).text,
        imageUrl: imageUrlFromCell(row.getCell(columns.image)),
        details: row.getCell(columns.details).text,
        lowestPriceUsd: getNumericCell(row, columns.lowestPriceUsd, '最低价($)'),
        highestPriceUsd: getNumericCell(row, columns.highestPriceUsd, '最高价($)'),
        lowestPriceCny: getNumericCell(row, columns.lowestPriceCny, '最低价(￥)'),
        highestPriceCny: getNumericCell(row, columns.highestPriceCny, '最高价(￥)'),
        embeddedImage: embeddedImages.get(rowNumber) ?? null
      }
      const validated = validateLibraryRecordInput(raw)
      byCatalog.set(validated.catalogNumber, { ...validated, embeddedImage: raw.embeddedImage })
    } catch (err) {
      errors.push({ row: rowNumber, message: err instanceof Error ? err.message : String(err) })
    }
  }

  return { records: [...byCatalog.values()], errors, inputRows }
}

export { HEADER_ALIASES }
