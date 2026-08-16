import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { parseLibraryExcel } from '../src/main/excel/importer'

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=',
  'base64'
)

const headers = ['编号', '图片', '详情', '最低价($)', '最高价($)', '最低价(￥)', '最高价(￥)']

describe('CD library Excel importer', () => {
  let dir: string

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'scd-import-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('parses numeric prices, embedded images and keeps the last valid duplicate', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('CD Library')
    sheet.addRow(headers)
    sheet.addRow(['ABC100', '', 'first', 1, 2, 7.2, 14.4])
    sheet.addRow(['ABC-100', '', 'last', 3, 4, 21.6, 28.8])
    sheet.addRow(['BAD-1', '', 'bad numeric', '$1.00', 2, 7.2, 14.4])
    const imageId = workbook.addImage({ buffer: PNG_1PX, extension: 'png' })
    sheet.addImage(imageId, { tl: { col: 1.03, row: 2.04 }, ext: { width: 20, height: 20 } })
    const file = join(dir, 'library.xlsx')
    await workbook.xlsx.writeFile(file)

    const parsed = await parseLibraryExcel(file)
    expect(parsed.records).toHaveLength(1)
    expect(parsed.records[0]).toMatchObject({ catalogNumber: 'ABC-100', details: 'last', lowestPriceUsd: 3 })
    expect(parsed.records[0].embeddedImage?.mimeType).toBe('image/png')
    expect(parsed.errors).toEqual([{ row: 4, message: '最低价($)必须是数值单元格' }])
  })

  it('accepts the English seven-column headers and image URLs', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Library')
    sheet.addRow(['Catalog Number', 'Image', 'Details', 'Lowest Price ($)', 'Highest Price ($)', 'Lowest Price (¥)', 'Highest Price (¥)'])
    sheet.addRow(['X-1', 'https://example.com/a.jpg', 'details', 1, 2, 7, 14])
    const file = join(dir, 'english.xlsx')
    await workbook.xlsx.writeFile(file)
    const parsed = await parseLibraryExcel(file)
    expect(parsed.records[0].imageUrl).toBe('https://example.com/a.jpg')
  })

  it('rejects the legacy five-column format', async () => {
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet('Old').addRow(['编号', '图片', '详情', '最低价', '最高价'])
    const file = join(dir, 'old.xlsx')
    await workbook.xlsx.writeFile(file)
    await expect(parseLibraryExcel(file)).rejects.toThrow('旧 5 列 Excel 不支持导入')
  })
})
