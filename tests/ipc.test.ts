import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'

const { mockGetSettings, mockGetSetting, mockSetSetting, mockDeleteSetting } = vi.hoisted(() => ({
  mockGetSettings: vi.fn(),
  mockGetSetting: vi.fn(),
  mockSetSetting: vi.fn(),
  mockDeleteSetting: vi.fn()
}))

const { mockStartChallenge, mockCancelChallenge, mockGetStatus, mockCloseChrome } = vi.hoisted(() => ({
  mockStartChallenge: vi.fn(),
  mockCancelChallenge: vi.fn(),
  mockGetStatus: vi.fn(),
  mockCloseChrome: vi.fn()
}))

const { mockExecuteBatchQuery, mockCancelBatchQuery } = vi.hoisted(() => ({
  mockExecuteBatchQuery: vi.fn(),
  mockCancelBatchQuery: vi.fn()
}))

const { mockDownloadImage } = vi.hoisted(() => ({
  mockDownloadImage: vi.fn()
}))

const { mockGetUsdToDisplayRate } = vi.hoisted(() => ({
  mockGetUsdToDisplayRate: vi.fn()
}))

vi.mock('../src/main/settings', () => ({
  getSettings: mockGetSettings,
  getSetting: mockGetSetting,
  setSetting: mockSetSetting,
  deleteSetting: mockDeleteSetting
}))

vi.mock('../src/main/cloudflare', () => ({
  startCloudflareChallenge: mockStartChallenge,
  cancelCloudflareChallenge: mockCancelChallenge,
  getCloudflareStatus: mockGetStatus,
  closeCloudflareChrome: mockCloseChrome
}))

vi.mock('../src/main/orchestrator', () => ({
  executeBatchQuery: mockExecuteBatchQuery,
  cancelBatchQuery: mockCancelBatchQuery
}))

vi.mock('../src/main/image', () => ({
  downloadImage: mockDownloadImage
}))

vi.mock('../src/main/currency', () => ({
  getUsdToDisplayRate: mockGetUsdToDisplayRate
}))

import { registerSettingsIpc } from '../src/main/ipc/settings'
import { registerOrchestratorIpc } from '../src/main/ipc/orchestrator'
import { registerImageIpc } from '../src/main/ipc/image'
import { registerCurrencyIpc } from '../src/main/ipc/currency'
import { registerCloudflareIpc } from '../src/main/ipc/cloudflare'

function handler(channel: string) {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === channel)
  if (!call) throw new Error(`No handler registered for ${channel}`)
  return call[1]
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('registerSettingsIpc', () => {
  it('registers settings handlers', async () => {
    mockGetSettings.mockReturnValue({ discogsToken: 't' })
    mockGetSetting.mockReturnValue('x')

    registerSettingsIpc()

    expect(await handler('getSettings')()).toEqual({ discogsToken: 't' })
    expect(await handler('getSetting')(null, 'discogsToken')).toBe('x')

    await handler('setSetting')(null, 'discogsToken', 'abc')
    expect(mockSetSetting).toHaveBeenCalledWith('discogsToken', 'abc')

    await handler('deleteSetting')(null, 'discogsToken')
    expect(mockDeleteSetting).toHaveBeenCalledWith('discogsToken')
  })
})

describe('registerOrchestratorIpc', () => {
  it('registers orchestrator handlers', async () => {
    mockExecuteBatchQuery.mockResolvedValue([{ catalogNumber: 'X-1', results: [] }])
    mockCancelBatchQuery.mockReturnValue(undefined)

    registerOrchestratorIpc()

    expect(await handler('executeBatchQuery')(null, ['X-1'], ['discogs'])).toEqual([
      { catalogNumber: 'X-1', results: [] }
    ])
    expect(mockExecuteBatchQuery).toHaveBeenCalledWith(['X-1'], ['discogs'])

    await handler('cancelBatchQuery')()
    expect(mockCancelBatchQuery).toHaveBeenCalled()
  })
})

describe('registerImageIpc', () => {
  it('registers the fetchImage handler', async () => {
    mockDownloadImage.mockResolvedValue({ base64: 'x', mimeType: 'image/png' })

    registerImageIpc()

    expect(await handler('fetchImage')(null, 'https://example.com/a.png')).toEqual({
      base64: 'x',
      mimeType: 'image/png'
    })
    expect(mockDownloadImage).toHaveBeenCalledWith('https://example.com/a.png', undefined)
  })
})

describe('registerCurrencyIpc', () => {
  it('registers the getUsdToDisplayRate handler', async () => {
    mockGetUsdToDisplayRate.mockResolvedValue(7.2)

    registerCurrencyIpc()

    expect(await handler('getUsdToDisplayRate')(null, 'CNY')).toBe(7.2)
    expect(mockGetUsdToDisplayRate).toHaveBeenCalledWith('CNY')
  })
})

describe('registerCloudflareIpc', () => {
  it('registers the challenge lifecycle handlers', async () => {
    mockStartChallenge.mockResolvedValue({ status: 'done' })
    mockGetStatus.mockResolvedValue({ state: 'verified', expiresAt: 123 })
    mockCloseChrome.mockResolvedValue(undefined)
    mockCancelChallenge.mockReturnValue(undefined)

    registerCloudflareIpc()

    expect(await handler('cloudflare:startChallenge')(null, 'surugaya')).toEqual({ status: 'done' })
    expect(mockStartChallenge).toHaveBeenCalledWith('surugaya')

    expect(await handler('cloudflare:getStatus')(null, 'surugaya')).toEqual({
      state: 'verified',
      expiresAt: 123
    })

    await handler('cloudflare:close')()
    expect(mockCloseChrome).toHaveBeenCalled()

    await handler('cloudflare:cancelChallenge')()
    expect(mockCancelChallenge).toHaveBeenCalled()
  })
})
