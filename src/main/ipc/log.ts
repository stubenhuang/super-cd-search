import { ipcMain } from 'electron'
import { logFromRenderer, type LoggerMeta } from '../logger'

export function registerLoggingIpc(): void {
  ipcMain.on('renderer:log', (_event, level: unknown, tag: unknown, message: unknown, meta?: unknown) => {
    logFromRenderer(
      typeof level === 'string' ? level : 'info',
      typeof tag === 'string' ? tag : 'unknown',
      typeof message === 'string' ? message : String(message),
      meta && typeof meta === 'object' ? (meta as LoggerMeta) : undefined
    )
  })
}
