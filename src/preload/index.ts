import { contextBridge, ipcRenderer } from 'electron'

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Placeholder for future IPC methods
  send: (channel: string, data: unknown) => {
    const validChannels = ['toMain']
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data)
    }
  },
  receive: (channel: string, func: (...args: unknown[]) => void) => {
    const validChannels = ['fromMain']
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_event, ...args) => func(...args))
    }
  }
})
