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

  it('only subscribes on whitelisted channels', async () => {
    api = await loadPreload()
    const fn = vi.fn()
    api.receive('query:progress', fn)
    api.receive('fromMain', fn)
    api.receive('danger', fn)
    expect(ipcRenderer.on).toHaveBeenCalledTimes(2)
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

    await api.executeBatchQuery(['X-1'], ['discogs', 'ebay'])
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('executeBatchQuery', ['X-1'], ['discogs', 'ebay'])

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
