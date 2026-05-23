import { contextBridge, ipcRenderer } from 'electron'
import type { Settings, BatchQueryResult, ThrottleStatus, HistoryBatch, HistoryEntry } from '../shared/types'

const validSendChannels = ['toMain'] as const
const validReceiveChannels = ['fromMain', 'query:progress'] as const

contextBridge.exposeInMainWorld('electronAPI', {
  send: (channel: string, data: unknown) => {
    if (validSendChannels.includes(channel as typeof validSendChannels[number])) {
      ipcRenderer.send(channel, data)
    }
  },
  receive: (channel: string, func: (...args: unknown[]) => void) => {
    if (validReceiveChannels.includes(channel as typeof validReceiveChannels[number])) {
      ipcRenderer.on(channel, (_event, ...args) => func(...args))
    }
  },
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('getSettings'),
  getSetting: <K extends keyof Settings>(key: K): Promise<Settings[K] | undefined> =>
    ipcRenderer.invoke('getSetting', key),
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> =>
    ipcRenderer.invoke('setSetting', key, value),
  deleteSetting: <K extends keyof Settings>(key: K): Promise<void> =>
    ipcRenderer.invoke('deleteSetting', key),
  getThrottleStatus: (): Promise<ThrottleStatus> => ipcRenderer.invoke('getThrottleStatus'),
  executeBatchQuery: (catalogNumbers: string[], includeKojima?: boolean): Promise<BatchQueryResult[]> =>
    ipcRenderer.invoke('executeBatchQuery', catalogNumbers, includeKojima),
  cancelBatchQuery: (): Promise<void> =>
    ipcRenderer.invoke('cancelBatchQuery'),
  getHistory: (): Promise<HistoryBatch[]> => ipcRenderer.invoke('getHistory'),
  getHistoryEntry: (queryId: number): Promise<HistoryEntry | null> =>
    ipcRenderer.invoke('getHistoryEntry', queryId),
  deleteHistoryEntry: (queryId: number): Promise<void> =>
    ipcRenderer.invoke('deleteHistoryEntry', queryId),
  clearAllHistory: (): Promise<void> => ipcRenderer.invoke('clearAllHistory'),
  exportToExcel: (results: BatchQueryResult[]): Promise<string | null> =>
    ipcRenderer.invoke('exportToExcel', results),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('openExternal', url)
})
