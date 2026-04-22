import { contextBridge, ipcRenderer } from 'electron'

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
  getSettings: () => ipcRenderer.invoke('getSettings'),
  getSetting: (key: string) => ipcRenderer.invoke('getSetting', key),
  setSetting: (key: string, value: unknown) => ipcRenderer.invoke('setSetting', key, value),
  deleteSetting: (key: string) => ipcRenderer.invoke('deleteSetting', key),
  getThrottleStatus: () => ipcRenderer.invoke('getThrottleStatus'),
  executeBatchQuery: (catalogNumbers: string[]) => ipcRenderer.invoke('executeBatchQuery', catalogNumbers),
  getHistory: () => ipcRenderer.invoke('getHistory'),
  getHistoryEntry: (queryId: number) => ipcRenderer.invoke('getHistoryEntry', queryId),
  deleteHistoryEntry: (queryId: number) => ipcRenderer.invoke('deleteHistoryEntry', queryId),
  clearAllHistory: () => ipcRenderer.invoke('clearAllHistory')
})
