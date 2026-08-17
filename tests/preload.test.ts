import { describe, it, expect, vi, beforeEach } from 'vitest'
import { contextBridge, ipcRenderer } from 'electron'

type ElectronApi = Record<string, (...args: never[]) => unknown>

let api: ElectronApi

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

async function loadPreload(): Promise<ElectronApi> {
  await import('../src/preload/index')
  const calls = vi.mocked(contextBridge.exposeInMainWorld).mock.calls
  return calls[0][1] as ElectronApi
}

describe('preload API', () => {
  it('exposes electronAPI on the main world', async () => {
    api = await loadPreload()
    expect(vi.mocked(contextBridge.exposeInMainWorld).mock.calls[0][0]).toBe('electronAPI')
    expect(api).toBeDefined()
  })

  it('only sends on whitelisted channels', async () => {
    api = await loadPreload()
    api.send('toMain', { x: 1 })
    api.send('evil-channel', { x: 1 })
    expect(ipcRenderer.send).toHaveBeenCalledTimes(1)
    expect(ipcRenderer.send).toHaveBeenCalledWith('toMain', { x: 1 })
  })

  it('forwards renderer logs with a safe level', async () => {
    api = await loadPreload()
    api.log('debug', 'app.search', 'search started', { catalogNumber: 'X-1' })
    api.log('bogus', 'app.search', 'falls back to info')

    expect(ipcRenderer.send).toHaveBeenCalledWith('renderer:log', 'debug', 'app.search', 'search started', { catalogNumber: 'X-1' })
    expect(ipcRenderer.send).toHaveBeenCalledWith('renderer:log', 'info', 'app.search', 'falls back to info', undefined)
  })

  it('only subscribes on whitelisted channels', async () => {
    api = await loadPreload()
    const fn = vi.fn()
    api.receive('query:progress', fn)
    api.receive('fromMain', fn)
    api.receive('detail:enrich-progress', fn)
    api.receive('export:progress', fn)
    api.receive('lan:catalog-added', fn)
    api.receive('lan:input-changed', fn)
    api.receive('lan:search-requested', fn)
    api.receive('lan:mode-changed', fn)
    api.receive('lan:flow-confirm', fn)
    api.receive('lan:flow-skip', fn)
    api.receive('lan:flow-close', fn)
    api.receive('library:publish-updated', fn)
    api.receive('danger', fn)
    expect(ipcRenderer.on).toHaveBeenCalledTimes(12)
  })

  it('forwards settings calls to ipcRenderer.invoke', async () => {
    api = await loadPreload()
    vi.mocked(ipcRenderer.invoke).mockResolvedValue('token')

    await api.getSettings()
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('getSettings')

    await api.getSetting('discogsToken')
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('getSetting', 'discogsToken')

    await api.setSetting('discogsToken', 'abc')
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('setSetting', 'discogsToken', 'abc')

    await api.deleteSetting('discogsToken')
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('deleteSetting', 'discogsToken')
  })

  it('forwards query, image and external calls', async () => {
    api = await loadPreload()
    vi.mocked(ipcRenderer.invoke).mockResolvedValue([])

    await api.getThrottleStatus()
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('getThrottleStatus')

    await api.getUsdToDisplayRate('CNY')
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('getUsdToDisplayRate', 'CNY')

    await api.executeBatchQuery(['X-1'], ['discogs', 'ebay'])
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('executeBatchQuery', ['X-1'], ['discogs', 'ebay'])

    await api.enrichDetails('X-1', [], null)
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('detail:enrich', 'X-1', [], null)

    await api.cancelBatchQuery()
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('cancelBatchQuery')

    await api.openExternal('https://example.com')
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('openExternal', 'https://example.com')

    await api.fetchImage('https://example.com/a.png')
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('fetchImage', 'https://example.com/a.png', undefined)

    await api.fetchImage('https://example.com/a.png', 240)
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('fetchImage', 'https://example.com/a.png', 240)
  })

  it('forwards LAN connection calls to ipcRenderer.invoke', async () => {
    api = await loadPreload()
    vi.mocked(ipcRenderer.invoke).mockResolvedValue({ state: 'disabled' })

    await api.getLanStatus()
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('lan:getStatus')

    await api.getLanCandidates()
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('lan:getCandidates')

    await api.applyLanServer()
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('lan:apply')

    await api.regenerateLanToken()
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('lan:regenerateToken')

    await api.setLanSearchAvailability(true)
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('lan:setAvailability', true)

    await api.setLanSearchCatalogCount(10)
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('lan:setCatalogCount', 10)

    const state = { phase: 'searching', input: 'X-1', busy: true }
    await api.setLanSearchState(state)
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('lan:setSearchState', state)
  })

  it('forwards CD library calls to ipcRenderer.invoke', async () => {
    api = await loadPreload()
    vi.mocked(ipcRenderer.invoke).mockResolvedValue({ records: [] })
    const input = { catalogNumber: 'X-1', imageUrl: '', details: '', lowestPriceUsd: null, highestPriceUsd: null, lowestPriceCny: null, highestPriceCny: null }

    await api.listLibraryRecords({ catalogQuery: 'X', page: 1, pageSize: 20 })
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('library:list', { catalogQuery: 'X', page: 1, pageSize: 20 })
    await api.createLibraryRecord(input)
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('library:create', input)
    await api.updateLibraryRecord('X-1', input)
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('library:update', 'X-1', input)
    await api.upsertLibraryRecords([input])
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('library:upsert-search-results', [input])
    await api.deleteLibraryRecords(['X-1'])
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('library:delete', ['X-1'])
    await api.importLibraryExcel()
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('library:import-excel')
    await api.exportLibraryExcel(['X-1'], ['编号'], 'out.xlsx')
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('library:export-excel', ['X-1'], ['编号'], 'out.xlsx', undefined)
    await api.getLibraryImage('X-1')
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('library:image', 'X-1')
    await api.publishLibraryRecords(['X-1'])
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('library:publish', ['X-1'])
    await api.finishPublishBatch()
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('library:finish-publish')
    await api.getPublishSnapshot()
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('library:get-publish-snapshot')
    await api.setPublishState('X-1', true)
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('library:set-publish-state', 'X-1', true)
    await api.setPublishPlatforms('X-1', ['taobao'])
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('library:set-publish-platforms', 'X-1', ['taobao'])
  })
})
