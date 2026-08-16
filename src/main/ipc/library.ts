import { BrowserWindow, dialog, ipcMain } from 'electron'
import { existsSync, mkdirSync } from 'fs'
import { basename, dirname, isAbsolute, join } from 'path'
import type {
  CDLibraryImportResult,
  CDLibraryListQuery,
  CDLibraryRecordInput,
  ExcelExportPayload,
  ExportFileResult
} from '../../shared/types'
import { parseLibraryExcel } from '../excel/importer'
import { writeExcelFile, type ImageFetcher } from '../excel/exporter'
import { downloadImage } from '../image'
import {
  createLibraryRecord,
  deleteLibraryRecords,
  getEmbeddedLibraryImage,
  getLibraryRecords,
  listLibraryRecords,
  updateLibraryRecord,
  upsertImportedRecords,
  upsertLibraryRecords
} from '../library'
import { logger } from '../logger'
import { getSetting, setSetting } from '../settings'

function emitLibraryExportProgress(current: number, total: number): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('export:progress', { phase: 'images', current, total })
  }
}

function validateCatalogNumbers(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error('编号列表格式无效')
  }
  return value
}

export function registerLibraryIpc(): void {
  ipcMain.handle('library:list', (_event, query: CDLibraryListQuery) => listLibraryRecords(query))

  ipcMain.handle('library:create', (_event, input: CDLibraryRecordInput) => {
    const record = createLibraryRecord(input)
    logger.info('ipc.library', 'library record created', { catalogNumber: record.catalogNumber })
    return record
  })

  ipcMain.handle('library:update', (_event, catalogNumber: string, input: CDLibraryRecordInput) => {
    const record = updateLibraryRecord(String(catalogNumber ?? ''), input)
    logger.info('ipc.library', 'library record updated', { catalogNumber: record.catalogNumber })
    return record
  })

  ipcMain.handle('library:upsert-search-results', (_event, inputs: CDLibraryRecordInput[]) => {
    upsertLibraryRecords(inputs)
    logger.debug('ipc.library', 'search results persisted to library', { count: inputs.length })
  })

  ipcMain.handle('library:delete', (_event, catalogNumbers: string[]) => {
    const deleted = deleteLibraryRecords(validateCatalogNumbers(catalogNumbers))
    logger.info('ipc.library', 'library records deleted', { deleted })
    return deleted
  })

  ipcMain.handle('library:image', (_event, catalogNumber: string) => {
    const image = getEmbeddedLibraryImage(String(catalogNumber ?? ''))
    return image ? { base64: image.buffer.toString('base64'), mimeType: image.mimeType } : null
  })

  ipcMain.handle('library:import-excel', async (): Promise<CDLibraryImportResult> => {
    try {
      const result = await dialog.showOpenDialog({
        title: '导入 CD 库 Excel',
        properties: ['openFile'],
        filters: [{ name: 'Excel', extensions: ['xlsx'] }]
      })
      const filePath = result.filePaths?.[0]
      if (result.canceled || !filePath) {
        return { status: 'cancelled', added: 0, updated: 0, skipped: 0, errors: [] }
      }
      const parsed = await parseLibraryExcel(filePath)
      const counts = upsertImportedRecords(parsed.records)
      logger.info('ipc.library', 'library Excel imported', {
        filePath,
        added: counts.added,
        updated: counts.updated,
        skipped: parsed.errors.length
      })
      return {
        status: 'imported',
        ...counts,
        skipped: parsed.errors.length,
        errors: parsed.errors
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.warn('ipc.library', 'library Excel import failed', { error: message })
      return { status: 'error', added: 0, updated: 0, skipped: 0, errors: [], error: message }
    }
  })

  ipcMain.handle(
    'library:export-excel',
    async (
      _event,
      catalogNumbers: string[],
      headers: string[],
      defaultFileName: string,
      targetDirectory?: string
    ): Promise<ExportFileResult> => {
      try {
        const selected = validateCatalogNumbers(catalogNumbers)
        if (selected.length === 0) throw new Error('请先选择要导出的记录')
        if (!Array.isArray(headers) || headers.length !== 7 || headers.some(header => typeof header !== 'string')) {
          throw new Error('Excel 表头格式无效')
        }
        if (typeof defaultFileName !== 'string' || basename(defaultFileName) !== defaultFileName || !defaultFileName.toLowerCase().endsWith('.xlsx')) {
          throw new Error('导出文件名格式无效')
        }
        if (targetDirectory !== undefined && (typeof targetDirectory !== 'string' || !isAbsolute(targetDirectory))) {
          throw new Error('导出目录格式无效')
        }
        const records = getLibraryRecords(selected)
        if (records.length === 0) throw new Error('所选记录不存在')

        let filePath: string
        if (targetDirectory) {
          mkdirSync(targetDirectory, { recursive: true })
          filePath = join(targetDirectory, defaultFileName)
        } else {
          const lastDirectory = getSetting('lastExportDirectory')
          const save = await dialog.showSaveDialog({
            title: '导出 CD 库 Excel',
            defaultPath: lastDirectory && existsSync(lastDirectory)
              ? join(lastDirectory, defaultFileName)
              : defaultFileName,
            filters: [{ name: 'Excel', extensions: ['xlsx'] }]
          })
          if (save.canceled || !save.filePath) return { status: 'cancelled' }
          filePath = save.filePath
        }

        const rows = records.map(record => ({
          catalogNumber: record.catalogNumber,
          imageUrl: record.hasEmbeddedImage ? `library:${record.catalogNumber}` : record.imageUrl,
          details: record.details,
          lowestPriceUsd: record.lowestPriceUsd,
          highestPriceUsd: record.highestPriceUsd,
          lowestPriceCny: record.lowestPriceCny,
          highestPriceCny: record.highestPriceCny
        }))
        const payload: ExcelExportPayload = { headers, rows }
        const imageFetcher: ImageFetcher = async reference => {
          if (reference.startsWith('library:')) {
            const image = getEmbeddedLibraryImage(reference.slice('library:'.length))
            if (!image) return null
            return { buffer: image.buffer, extension: image.mimeType === 'image/png' ? 'png' : 'jpeg' }
          }
          const image = await downloadImage(reference, 110)
          if (!image) return null
          return {
            buffer: Buffer.from(image.base64, 'base64'),
            extension: image.mimeType === 'image/png' ? 'png' : 'jpeg'
          }
        }
        await writeExcelFile(payload, filePath, imageFetcher, emitLibraryExportProgress)
        setSetting('lastExportDirectory', targetDirectory || dirname(filePath))
        logger.info('ipc.library', 'library Excel exported', { filePath, rowCount: rows.length })
        return { status: 'saved', filePath }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.warn('ipc.library', 'library Excel export failed', { error: message })
        return { status: 'error', error: message }
      }
    }
  )
}
