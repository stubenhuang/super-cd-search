import ExcelJS from 'exceljs'
import { dialog } from 'electron'
import type { BatchQueryResult } from '../../shared/types'

function formatPrice(price: number | null): string {
  if (price === null) return '-'
  return `$${price.toFixed(2)}`
}

export async function exportToExcel(results: BatchQueryResult[]): Promise<string | null> {
  const { filePath } = await dialog.showSaveDialog({
    title: 'Export Results to Excel',
    defaultPath: `cd-search-results-${new Date().toISOString().split('T')[0]}.xlsx`,
    filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
  })

  if (!filePath) return null

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Super CD Search'
  workbook.created = new Date()

  const worksheet = workbook.addWorksheet('Results')

  worksheet.columns = [
    { header: 'Catalog Number', key: 'catalogNumber', width: 20 },
    { header: 'Name', key: 'name', width: 40 },
    { header: 'Artist', key: 'artist', width: 25 },
    { header: 'Discogs Price', key: 'discogsPrice', width: 15 },
    { header: 'eBay Price', key: 'ebayPrice', width: 15 },
    { header: 'Kojima Rokuon Price', key: 'kojimaPrice', width: 18 },
    { header: 'Cover Image URL', key: 'coverUrl', width: 50 },
    { header: 'Discogs Link', key: 'discogsLink', width: 50 },
    { header: 'eBay Link', key: 'ebayLink', width: 50 },
    { header: 'Kojima Link', key: 'kojimaLink', width: 50 }
  ]

  worksheet.getRow(1).font = { bold: true }
  worksheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' }
  }

  for (const result of results) {
    const discogs = result.results.find(r => r.platform === 'discogs')
    const ebay = result.results.find(r => r.platform === 'ebay')
    const kojima = result.results.find(r => r.platform === 'kojima')

    const foundResult = result.results.find(r => r.status === 'found' && r.name)

    worksheet.addRow({
      catalogNumber: result.catalogNumber,
      name: foundResult?.name || '-',
      artist: foundResult?.artist || '-',
      discogsPrice: discogs?.status === 'found' ? formatPrice(discogs.priceMin) : '-',
      ebayPrice: ebay?.status === 'found' ? formatPrice(ebay.priceMin) : '-',
      kojimaPrice: kojima?.status === 'found' ? formatPrice(kojima.priceMin) : '-',
      coverUrl: foundResult?.coverUrl || '-',
      discogsLink: discogs?.status === 'found' ? discogs.link || '-' : '-',
      ebayLink: ebay?.status === 'found' ? ebay.link || '-' : '-',
      kojimaLink: kojima?.status === 'found' ? kojima.link || '-' : '-'
    })
  }

  await workbook.xlsx.writeFile(filePath)
  return filePath
}
