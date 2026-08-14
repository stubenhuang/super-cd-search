import { contextBridge, ipcRenderer } from 'electron'
import type {
  Settings,
  BatchQueryResult,
  ThrottleStatus,
  Platform,
  DisplayCurrency,
  CloudflarePlatform,
  CloudflareChallengeResult,
  CloudflareSessionStatus
} from '../shared/types'

const validSendChannels = ['toMain'] as const
const validReceiveChannels = ['fromMain', 'query:progress'] as const

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
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
  getUsdToDisplayRate: (target: DisplayCurrency): Promise<number> =>
    ipcRenderer.invoke('getUsdToDisplayRate', target),
  executeBatchQuery: (catalogNumbers: string[], platforms?: Platform[]): Promise<BatchQueryResult[]> =>
    ipcRenderer.invoke('executeBatchQuery', catalogNumbers, platforms),
  cancelBatchQuery: (): Promise<void> =>
    ipcRenderer.invoke('cancelBatchQuery'),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('openExternal', url),
  fetchImage: (url: string, size?: number): Promise<{ base64: string; mimeType: string } | null> =>
    ipcRenderer.invoke('fetchImage', url, size),
  startCloudflareChallenge: (platform: CloudflarePlatform): Promise<CloudflareChallengeResult> =>
    ipcRenderer.invoke('cloudflare:startChallenge', platform),
  cancelCloudflareChallenge: (): Promise<void> =>
    ipcRenderer.invoke('cloudflare:cancelChallenge'),
  getCloudflareStatus: (platform: CloudflarePlatform): Promise<CloudflareSessionStatus> =>
    ipcRenderer.invoke('cloudflare:getStatus', platform),
  closeCloudflareSession: (): Promise<void> =>
    ipcRenderer.invoke('cloudflare:close')
})
