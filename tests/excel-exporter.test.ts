import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { buildExcelWorkbook, writeExcelFile, type ImageFetcher } from '../src/main/excel/exporter'
import type { ExcelExportPayload } from '../src/shared/types'

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=',
  'base64'
)

const headers = ['编号', '图片', '详情', '最低价($)', '最高价($)', '最低价(￥)', '最高价(￥)']

function payload(rows: ExcelExportPayload['rows']): ExcelExportPayload {
  return { headers, rows }
}

describe('buildExcelWorkbook', () => {
  it('builds headers and data rows, filling image placeholders for missing URLs', async () => {
    const workbook = await buildExcelWorkbook(payload([
      { catalogNumber: 'X-1', imageUrl: '', details: '编号: X-1\n专辑: Album', lowestPriceUsd: 5, highestPriceUsd: 9, lowestPriceCny: 36, highestPriceCny: 64.8 }
    ]))

    const sheet = workbook.getWorksheet('Search Results')
    expect(sheet).toBeDefined()
    expect(sheet!.rowCount).toBe(2)
    expect(sheet!.getCell('A1').value).toBe('编号')
    expect(sheet!.getCell('A2').value).toBe('X-1')
    expect(sheet!.getCell('B2').value).toBe('无图')
    expect(sheet!.getCell('C2').value).toBe('编号: X-1\n专辑: Album')
    expect(sheet!.getCell('D2').value).toBe(5)
    expect(sheet!.getCell('D2').numFmt).toBe('$0.00')
    expect(sheet!.getCell('F2').value).toBe(36)
    expect(sheet!.getCell('F2').numFmt).toBe('¥0.00')
  })

  it('embeds an actual image for a URL and marks failures', async () => {
    const fetcher: ImageFetcher = async url => {
      if (url === 'fail') return null
      return { buffer: PNG_1PX, extension: 'png' }
    }

    const workbook = await buildExcelWorkbook(payload([
      { catalogNumber: 'X-1', imageUrl: 'ok', details: 'd', lowestPriceUsd: null, highestPriceUsd: null, lowestPriceCny: null, highestPriceCny: null },
      { catalogNumber: 'X-2', imageUrl: 'fail', details: 'd', lowestPriceUsd: null, highestPriceUsd: null, lowestPriceCny: null, highestPriceCny: null }
    ]), fetcher)

    const sheet = workbook.getWorksheet('Search Results')!
    expect(sheet.getCell('B2').value).toBe('')
    expect(sheet.getCell('B3').value).toBe('图片获取失败')
    expect(sheet.getImages().length).toBe(1)
  })

  it('reports image preparation progress for every row', async () => {
    const progress: Array<[number, number]> = []
    const fetcher: ImageFetcher = async () => ({ buffer: PNG_1PX, extension: 'png' })

    await buildExcelWorkbook(payload([
      { catalogNumber: 'X-1', imageUrl: 'ok', details: 'd', lowestPriceUsd: null, highestPriceUsd: null, lowestPriceCny: null, highestPriceCny: null },
      { catalogNumber: 'X-2', imageUrl: '', details: 'd', lowestPriceUsd: null, highestPriceUsd: null, lowestPriceCny: null, highestPriceCny: null }
    ]), fetcher, (current, total) => progress.push([current, total]))

    expect(progress).toEqual([[1, 2], [2, 2]])
  })
})

describe('writeExcelFile', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'scd-xlsx-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes a real xlsx file for rows without images', async () => {
    const filePath = join(dir, 'export.xlsx')
    await writeExcelFile(payload([
      { catalogNumber: 'X-1', imageUrl: '', details: 'd', lowestPriceUsd: 1, highestPriceUsd: 2, lowestPriceCny: 7.2, highestPriceCny: 14.4 }
    ]), filePath)

    expect(existsSync(filePath)).toBe(true)
  })
})
