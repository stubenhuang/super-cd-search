import { ipcMain } from 'electron'
import { getUsdToDisplayRate } from '../currency'
import type { DisplayCurrency } from '../../shared/types'

export function registerCurrencyIpc(): void {
  ipcMain.handle('getUsdToDisplayRate', (_event, target: DisplayCurrency) => {
    return getUsdToDisplayRate(target)
  })
}
