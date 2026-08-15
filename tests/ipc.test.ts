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

const { mockEnrichDetails } = vi.hoisted(() => ({
  mockEnrichDetails: vi.fn()
}))

const { mockLogFromRenderer } = vi.hoisted(() => ({
  mockLogFromRenderer: vi.fn()
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

vi.mock('../src/main/llm/enrich', () => ({
  enrichDetails: mockEnrichDetails
}))

vi.mock('../src/main/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  },
  logFromRenderer: mockLogFromRenderer
}))

import { registerSettingsIpc } from '../src/main/ipc/settings'
import { registerOrchestratorIpc } from '../src/main/ipc/orchestrator'
import { registerImageIpc } from '../src/main/ipc/image'
import { registerCurrencyIpc } from '../src/main/ipc/currency'
import { registerCloudflareIpc } from '../src/main/ipc/cloudflare'
import { registerEnrichmentIpc } from '../src/main/ipc/enrich'
import { registerLoggingIpc } from '../src/main/ipc/log'

function handler(channel: string) {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === channel)
  if (!call) throw new Error(`No handler registered for ${channel}`)
  return call[1]
}

function onHandler(channel: string) {
  const call = vi.mocked(ipcMain.on).mock.calls.find(([ch]) => ch === channel)
  if (!call) throw new Error(`No listener registered for ${channel}`)
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

describe('registerEnrichmentIpc', () => {
  it('registers the detail:enrich handler', async () => {
    const enriched = {
      status: 'partial',
      llmConfigured: true,
      details: { label: 'L', format: 'CD', country: null, released: null, genre: null },
      missingFields: ['country', 'released', 'genre'],
      analyzedPlatforms: ['tower'],
      attemptedPlatforms: ['tower'],
      skippedPlatforms: []
    }
    mockEnrichDetails.mockResolvedValue(enriched)

    registerEnrichmentIpc()

    expect(await handler('detail:enrich')(null, 'X-1', [], undefined)).toEqual(enriched)
    expect(mockEnrichDetails).toHaveBeenCalledWith('X-1', [], undefined)
  })
})

describe('registerLoggingIpc', () => {
  it('forwards renderer:log messages to the logger', () => {
    registerLoggingIpc()

    onHandler('renderer:log')(null, 'debug', 'app.search', 'search started', { catalogNumber: 'X-1' })
    expect(mockLogFromRenderer).toHaveBeenCalledWith('debug', 'app.search', 'search started', { catalogNumber: 'X-1' })

    onHandler('renderer:log')(null, 'info', 'app.search', 'no meta')
    expect(mockLogFromRenderer).toHaveBeenCalledWith('info', 'app.search', 'no meta', undefined)
  })
})
