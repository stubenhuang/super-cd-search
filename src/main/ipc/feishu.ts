import { ipcMain } from 'electron'
import type { FeishuSettings } from '../../shared/types'
import {
  emptySyncResult,
  type FeishuSyncPayload,
  type FeishuSyncResult,
  type FeishuTestResult
} from '../../shared/feishu'
import { errorMessage } from '../../shared/utils'
import { syncToFeishu, testFeishu } from '../feishu/sync'
import { logger } from '../logger'

export function registerFeishuIpc(): void {
  ipcMain.handle('feishu:sync', async (_event, payload: FeishuSyncPayload): Promise<FeishuSyncResult> => {
    try {
      if (!payload || !Array.isArray(payload.rows)) return emptySyncResult('skipped')
      return await syncToFeishu(payload)
    } catch (err) {
      logger.warn('feishu', 'sync ipc failed', { error: errorMessage(err) })
      return emptySyncResult('error', errorMessage(err))
    }
  })

  ipcMain.handle('feishu:test', async (_event, settings: FeishuSettings): Promise<FeishuTestResult> => {
    try {
      if (!settings) return { ok: false, message: '请先填写飞书配置' }
      return await testFeishu(settings)
    } catch (err) {
      return { ok: false, message: errorMessage(err) }
    }
  })
}
