import { errorMessage } from '../../shared/utils'
import { ipcMain } from 'electron'
import { clearShimoSession } from '../shimo/session'
import { logger } from '../logger'

export function registerShimoIpc(): void {
  ipcMain.handle('shimo:clear-session', async () => {
    logger.info('ipc.shimo', 'shimo:clear-session invoked')
    try {
      await clearShimoSession()
      return { ok: true }
    } catch (err) {
      const message = errorMessage(err)
      logger.error('ipc.shimo', 'failed to clear 石墨 webview session', { error: message })
      return { ok: false, message }
    }
  })
}
