import { BrowserWindow, dialog, ipcMain } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'
import type { DirectorySelectResult, ExcelExportPayload, ExportFileResult, ExportProgress } from '../../shared/types'
import { writeExcelFile } from '../excel/exporter'
import { logger } from '../logger'

function emitExportProgress(progress: ExportProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('export:progress', progress)
  }
}

export function registerExportIpc(): void {
  ipcMain.handle('export:select-directory', async (): Promise<DirectorySelectResult> => {
    logger.debug('ipc.export', 'export:select-directory invoked')
    try {
      const result = await dialog.showOpenDialog({
        title: '选择导出目录',
        properties: ['openDirectory', 'createDirectory']
      })

      const path = result.filePaths?.[0]
      if (result.canceled || !path) {
        logger.debug('ipc.export', 'export directory selection cancelled')
        return { status: 'cancelled' }
      }

      logger.debug('ipc.export', 'export directory selected', { path })
      return { status: 'selected', path }
    } catch (err) {
      logger.warn('ipc.export', 'export directory selection failed', { error: err instanceof Error ? err.message : String(err) })
      return { status: 'cancelled' }
    }
  })

  ipcMain.handle(
    'export:excel',
    async (_event, defaultFileName: string, payload: ExcelExportPayload, targetDirectory?: string): Promise<ExportFileResult> => {
      logger.debug('ipc.export', 'export:excel invoked', {
        defaultFileName,
        rowCount: payload?.rows?.length ?? 0,
        targetDirectory: targetDirectory ?? null
      })

      try {
        let filePath: string

        if (targetDirectory) {
          mkdirSync(targetDirectory, { recursive: true })
          filePath = join(targetDirectory, defaultFileName)
        } else {
          const result = await dialog.showSaveDialog({
            title: '导出 Excel',
            defaultPath: defaultFileName,
            filters: [{ name: 'Excel', extensions: ['xlsx'] }]
          })

          if (result.canceled || !result.filePath) {
            logger.debug('ipc.export', 'Excel export cancelled by user')
            return { status: 'cancelled' }
          }
          filePath = result.filePath
        }

        await writeExcelFile(payload, filePath, undefined, (current, total) => {
          emitExportProgress({ phase: 'images', current, total })
        })
        logger.info('ipc.export', 'Excel exported', { filePath, rowCount: payload.rows.length })
        return { status: 'saved', filePath }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.warn('ipc.export', 'Excel export failed', { error: message })
        return { status: 'error', error: message }
      }
    }
  )
}
