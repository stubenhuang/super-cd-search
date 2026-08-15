import { ipcMain } from 'electron'
import {
  applyLanServer,
  getLanServerStatus,
  listLanCandidates,
  regenerateLanToken,
  setLanSearchAvailability
} from '../lan'

export function registerLanIpc(): void {
  ipcMain.handle('lan:getStatus', () => getLanServerStatus())

  ipcMain.handle('lan:getCandidates', () => listLanCandidates())

  ipcMain.handle('lan:apply', () => applyLanServer())

  ipcMain.handle('lan:regenerateToken', () => regenerateLanToken())

  ipcMain.handle('lan:setAvailability', (_event, available: boolean) => {
    setLanSearchAvailability(available === true)
  })
}
