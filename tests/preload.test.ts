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
    api.receive('danger', fn)
    expect(ipcRenderer.on).toHaveBeenCalledTimes(4)
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

    await api.exportExcel('result.xlsx', { headers: ['编号'], rows: [] }, '/tmp/exports')
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('export:excel', 'result.xlsx', { headers: ['编号'], rows: [] }, '/tmp/exports')

    await api.selectExportDirectory()
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('export:select-directory')

    await api.cancelBatchQuery()
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('cancelBatchQuery')

    await api.openExternal('https://example.com')
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('openExternal', 'https://example.com')

    await api.fetchImage('https://example.com/a.png')
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('fetchImage', 'https://example.com/a.png', undefined)

    await api.fetchImage('https://example.com/a.png', 240)
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('fetchImage', 'https://example.com/a.png', 240)
  })
})
