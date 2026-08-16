import { contextBridge, ipcRenderer } from 'electron'
import type {
  Settings,
  BatchQueryResult,
  ThrottleStatus,
  Platform,
  DisplayCurrency,
  CloudflarePlatform,
  CloudflareChallengeResult,
  CloudflareSessionStatus,
  DetailEnrichmentResult,
  ExportFileResult,
  ExcelExportPayload,
  DirectorySelectResult,
  QueryResult,
  CDDetails,
  LanCandidate,
  LanServerStatus
} from '../shared/types'

const validSendChannels = ['toMain', 'renderer:log'] as const
const validReceiveChannels = ['fromMain', 'query:progress', 'detail:enrich-progress', 'export:progress', 'lan:catalog-added'] as const

const validLogLevels = new Set(['debug', 'info', 'warn', 'error'])

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  send: (channel: string, data: unknown) => {
    if (validSendChannels.includes(channel as typeof validSendChannels[number])) {
      ipcRenderer.send(channel, data)
    }
  },
  receive: (channel: string, func: (...args: unknown[]) => void) => {
    if (validReceiveChannels.includes(channel as typeof validReceiveChannels[number])) {
      const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => func(...args)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    }
    return () => {}
  },
  log: (level: string, tag: string, message: string, meta?: Record<string, unknown>) => {
    const safeLevel = validLogLevels.has(level) ? level : 'info'
    ipcRenderer.send('renderer:log', safeLevel, tag, message, meta)
  },
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('getSettings'),
  getSetting: <K extends keyof Settings>(key: K): Promise<Settings[K] | undefined> =>
    ipcRenderer.invoke('getSetting', key),
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> =>
    ipcRenderer.invoke('setSetting', key, value),
  updateSettings: (values: Partial<Settings>): Promise<void> =>
    ipcRenderer.invoke('updateSettings', values),
  deleteSetting: <K extends keyof Settings>(key: K): Promise<void> =>
    ipcRenderer.invoke('deleteSetting', key),
  clearSearchCache: (): Promise<void> => ipcRenderer.invoke('clearSearchCache'),
  getThrottleStatus: (): Promise<ThrottleStatus> => ipcRenderer.invoke('getThrottleStatus'),
  getUsdToDisplayRate: (target: DisplayCurrency): Promise<number> =>
    ipcRenderer.invoke('getUsdToDisplayRate', target),
  executeBatchQuery: (catalogNumbers: string[], platforms?: Platform[]): Promise<BatchQueryResult[]> =>
    ipcRenderer.invoke('executeBatchQuery', catalogNumbers, platforms),
  enrichDetails: (
    catalogNumber: string,
    existingResults: QueryResult[],
    knownDetails?: CDDetails | null
  ): Promise<DetailEnrichmentResult> =>
    ipcRenderer.invoke('detail:enrich', catalogNumber, existingResults, knownDetails),
  cancelBatchQuery: (): Promise<void> =>
    ipcRenderer.invoke('cancelBatchQuery'),
  exportExcel: (defaultFileName: string, payload: ExcelExportPayload, targetDirectory?: string): Promise<ExportFileResult> =>
    ipcRenderer.invoke('export:excel', defaultFileName, payload, targetDirectory),
  selectExportDirectory: (): Promise<DirectorySelectResult> =>
    ipcRenderer.invoke('export:select-directory'),
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
    ipcRenderer.invoke('cloudflare:close'),
  getLanStatus: (): Promise<LanServerStatus> =>
    ipcRenderer.invoke('lan:getStatus'),
  getLanCandidates: (): Promise<LanCandidate[]> =>
    ipcRenderer.invoke('lan:getCandidates'),
  applyLanServer: (): Promise<LanServerStatus> =>
    ipcRenderer.invoke('lan:apply'),
  regenerateLanToken: (): Promise<LanServerStatus> =>
    ipcRenderer.invoke('lan:regenerateToken'),
  setLanSearchAvailability: (available: boolean): Promise<void> =>
    ipcRenderer.invoke('lan:setAvailability', available),
  setLanSearchCatalogCount: (count: number): Promise<void> =>
    ipcRenderer.invoke('lan:setCatalogCount', count)
})
