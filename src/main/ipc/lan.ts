import { ipcMain } from 'electron'
import type { LanSearchState } from '../../shared/types'
import {
  applyLanServer,
  getLanServerStatus,
  listLanCandidates,
  regenerateLanToken,
  setLanSearchAvailability,
  setLanSearchCatalogCount,
  setLanSearchState
} from '../lan'

export function registerLanIpc(): void {
  ipcMain.handle('lan:getStatus', () => getLanServerStatus())

  ipcMain.handle('lan:getCandidates', () => listLanCandidates())

  ipcMain.handle('lan:apply', () => applyLanServer())

  ipcMain.handle('lan:regenerateToken', () => regenerateLanToken())

  ipcMain.handle('lan:setAvailability', (_event, available: boolean) => {
    setLanSearchAvailability(available === true)
  })

  ipcMain.handle('lan:setCatalogCount', (_event, count: number) => {
    setLanSearchCatalogCount(Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0)
  })

  ipcMain.handle('lan:setSearchState', (_event, state: LanSearchState) => {
    setLanSearchState(state)
  })
}
