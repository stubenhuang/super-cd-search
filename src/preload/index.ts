import { contextBridge, ipcRenderer } from 'electron'
import type {
  Settings,
  BatchQueryResult,
  ThrottleStatus,
  Platform,
  DisplayCurrency,
  LoginPlatform,
  LoginResult,
  LoginSessionStatus,
  DetailEnrichmentResult,
  QueryResult,
  CDDetails,
  LanCandidate,
  LanServerStatus,
  LanSearchState,
  SettingsTransferResult
} from '../shared/types'
import type { UpdateState } from '../shared/updater'
import type {
  PublishDraft,
  PublishOutcome,
  PublishPrepareRequest,
  PublishRunRequest,
  PublishTarget,
  PublishTargetLoginResult,
  PublishTargetStatus,
  PublishTargetTestResult
} from '../shared/publish'

const validSendChannels = ['toMain', 'renderer:log'] as const
const validReceiveChannels = [
  'fromMain',
  'query:progress',
  'detail:enrich-progress',
  'lan:catalog-added',
  'lan:input-changed',
  'lan:search-requested',
  'lan:mode-changed',
  'lan:flow-confirm',
  'lan:flow-skip',
  'lan:flow-close',
  'publish:progress',
  'updater:state'
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
  exportSettingsBackup: (password: string): Promise<SettingsTransferResult> =>
    ipcRenderer.invoke('settings:export-backup', password),
  importSettingsBackup: (password: string): Promise<SettingsTransferResult> =>
    ipcRenderer.invoke('settings:import-backup', password),
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
  cancelEnrichDetails: (): Promise<void> =>
    ipcRenderer.invoke('detail:enrich-cancel'),
  cancelBatchQuery: (): Promise<void> =>
    ipcRenderer.invoke('cancelBatchQuery'),
  listPublishTargets: (): Promise<PublishTarget[]> =>
    ipcRenderer.invoke('publish:list-targets'),
  testPublishTarget: (targetId: string): Promise<PublishTargetTestResult> =>
    ipcRenderer.invoke('publish:test-target', targetId),
  publishTargetStatus: (targetId: string): Promise<PublishTargetStatus> =>
    ipcRenderer.invoke('publish:target-status', targetId),
  loginPublishTarget: (targetId: string): Promise<PublishTargetLoginResult> =>
    ipcRenderer.invoke('publish:login-target', targetId),
  forgetPublishTarget: (targetId: string): Promise<PublishTargetLoginResult> =>
    ipcRenderer.invoke('publish:forget-target', targetId),
  preparePublish: (request: PublishPrepareRequest): Promise<PublishDraft> =>
    ipcRenderer.invoke('publish:prepare', request),
  runPublish: (request: PublishRunRequest): Promise<PublishOutcome> =>
    ipcRenderer.invoke('publish:run', request),
  cancelPublish: (): Promise<void> =>
    ipcRenderer.invoke('publish:cancel'),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('openExternal', url),
  fetchImage: (url: string, size?: number): Promise<{ base64: string; mimeType: string } | null> =>
    ipcRenderer.invoke('fetchImage', url, size),
  startLogin: (platform: LoginPlatform): Promise<LoginResult> =>
    ipcRenderer.invoke('login:start', platform),
  cancelLogin: (): Promise<void> =>
    ipcRenderer.invoke('login:cancel'),
  getLoginStatus: (platform: LoginPlatform): Promise<LoginSessionStatus> =>
    ipcRenderer.invoke('login:status', platform),
  closeLoginSession: (): Promise<void> =>
    ipcRenderer.invoke('login:close'),
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
    ipcRenderer.invoke('lan:setSearchState', state),
  getUpdateState: (): Promise<UpdateState> =>
    ipcRenderer.invoke('updater:getState'),
  checkForUpdates: (): Promise<UpdateState> =>
    ipcRenderer.invoke('updater:check'),
  downloadUpdate: (): Promise<UpdateState> =>
    ipcRenderer.invoke('updater:download'),
  installUpdate: (): Promise<boolean> =>
    ipcRenderer.invoke('updater:install')
})
