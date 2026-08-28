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
  QueryResult,
  CDDetails,
  LanCandidate,
  LanServerStatus,
  LanSearchState,
  CDLibraryRecord,
  CDLibraryRecordInput,
  CDLibraryListQuery,
  CDLibraryListResult,
  CDLibraryImportResult,
  CDLibraryUpsertResult,
  PublishPlatform,
  PublishResult,
  PublishSnapshot
} from '../shared/types'

const validSendChannels = ['toMain', 'renderer:log'] as const
const validReceiveChannels = [
  'fromMain',
  'query:progress',
  'detail:enrich-progress',
  'export:progress',
  'lan:catalog-added',
  'lan:input-changed',
  'lan:search-requested',
  'lan:mode-changed',
  'lan:flow-confirm',
  'lan:flow-skip',
  'lan:flow-close',
  'library:publish-updated'
] as const

const validLogLevels = new Set(['debug', 'info', 'warn', 'error'])

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  setTitleBarOverlay: (overlay: { color?: string; symbolColor?: string; height?: number }): Promise<boolean> =>
    ipcRenderer.invoke('window:setTitleBarOverlay', overlay),
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
  listLibraryRecords: (query: CDLibraryListQuery): Promise<CDLibraryListResult> =>
    ipcRenderer.invoke('library:list', query),
  createLibraryRecord: (input: CDLibraryRecordInput): Promise<CDLibraryRecord> =>
    ipcRenderer.invoke('library:create', input),
  updateLibraryRecord: (catalogNumber: string, input: CDLibraryRecordInput): Promise<CDLibraryRecord> =>
    ipcRenderer.invoke('library:update', catalogNumber, input),
  upsertLibraryRecords: (inputs: CDLibraryRecordInput[]): Promise<CDLibraryUpsertResult> =>
    ipcRenderer.invoke('library:upsert-search-results', inputs),
  deleteLibraryRecords: (catalogNumbers: string[]): Promise<number> =>
    ipcRenderer.invoke('library:delete', catalogNumbers),
  importLibraryExcel: (): Promise<CDLibraryImportResult> =>
    ipcRenderer.invoke('library:import-excel'),
  exportLibraryExcel: (
    catalogNumbers: string[],
    headers: string[],
    defaultFileName: string,
    targetDirectory?: string
  ): Promise<ExportFileResult> =>
    ipcRenderer.invoke('library:export-excel', catalogNumbers, headers, defaultFileName, targetDirectory),
  getLibraryImage: (catalogNumber: string): Promise<{ base64: string; mimeType: string } | null> =>
    ipcRenderer.invoke('library:image', catalogNumber),
  publishLibraryRecords: (catalogNumbers: string[]): Promise<PublishResult> =>
    ipcRenderer.invoke('library:publish', catalogNumbers),
  finishPublishBatch: (): Promise<PublishResult> =>
    ipcRenderer.invoke('library:finish-publish'),
  getPublishSnapshot: (): Promise<PublishSnapshot> =>
    ipcRenderer.invoke('library:get-publish-snapshot'),
  setPublishState: (catalogNumber: string, published: boolean): Promise<void> =>
    ipcRenderer.invoke('library:set-publish-state', catalogNumber, published),
  setPublishPlatforms: (catalogNumber: string, platforms: PublishPlatform[]): Promise<void> =>
    ipcRenderer.invoke('library:set-publish-platforms', catalogNumber, platforms),
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
    ipcRenderer.invoke('lan:setCatalogCount', count),
  setLanSearchState: (state: LanSearchState): Promise<void> =>
    ipcRenderer.invoke('lan:setSearchState', state)
})
