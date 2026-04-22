import { contextBridge, ipcRenderer } from 'electron'

const validSendChannels = ['toMain'] as const
const validReceiveChannels = ['fromMain'] as const

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
  getThrottleStatus: () => ipcRenderer.invoke('getThrottleStatus')
})
