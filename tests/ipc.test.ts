import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'

const { mockGetSettings, mockGetSetting, mockSetSetting, mockDeleteSetting } = vi.hoisted(() => ({
  mockGetSettings: vi.fn(),
  mockGetSetting: vi.fn(),
  mockSetSetting: vi.fn(),
  mockDeleteSetting: vi.fn()
}))

const { mockGetHistory, mockGetHistoryEntry, mockDeleteHistoryEntry, mockClearAllHistory } = vi.hoisted(() => ({
  mockGetHistory: vi.fn(),
  mockGetHistoryEntry: vi.fn(),
  mockDeleteHistoryEntry: vi.fn(),
  mockClearAllHistory: vi.fn()
}))

const { mockExecuteBatchQuery, mockCancelBatchQuery } = vi.hoisted(() => ({
  mockExecuteBatchQuery: vi.fn(),
  mockCancelBatchQuery: vi.fn()
}))

const { mockExportToExcel, mockDownloadImage } = vi.hoisted(() => ({
  mockExportToExcel: vi.fn(),
  mockDownloadImage: vi.fn()
}))

vi.mock('../src/main/settings', () => ({
  getSettings: mockGetSettings,
  getSetting: mockGetSetting,
  setSetting: mockSetSetting,
  deleteSetting: mockDeleteSetting
}))

vi.mock('../src/main/database/queries', () => ({
  getHistory: mockGetHistory,
  getHistoryEntry: mockGetHistoryEntry,
  deleteHistoryEntry: mockDeleteHistoryEntry,
  clearAllHistory: mockClearAllHistory
}))

vi.mock('../src/main/orchestrator', () => ({
  executeBatchQuery: mockExecuteBatchQuery,
  cancelBatchQuery: mockCancelBatchQuery
}))

vi.mock('../src/main/export', () => ({
  exportToExcel: mockExportToExcel
}))

vi.mock('../src/main/image', () => ({
  downloadImage: mockDownloadImage
}))

import { registerSettingsIpc } from '../src/main/ipc/settings'
import { registerHistoryIpc } from '../src/main/ipc/history'
import { registerOrchestratorIpc } from '../src/main/ipc/orchestrator'
import { registerExportIpc } from '../src/main/ipc/export'

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

describe('registerHistoryIpc', () => {
  it('registers history handlers', async () => {
    mockGetHistory.mockReturnValue([{ id: 1 }])
    mockGetHistoryEntry.mockReturnValue({ query: { id: 1 } })

    registerHistoryIpc()

    expect(await handler('getHistory')()).toEqual([{ id: 1 }])
    expect(await handler('getHistoryEntry')(null, 2)).toEqual({ query: { id: 1 } })

    await handler('deleteHistoryEntry')(null, 2)
    expect(mockDeleteHistoryEntry).toHaveBeenCalledWith(2)

    await handler('clearAllHistory')()
    expect(mockClearAllHistory).toHaveBeenCalled()
  })
})

describe('registerOrchestratorIpc', () => {
  it('registers orchestrator handlers', async () => {
    mockExecuteBatchQuery.mockResolvedValue([{ catalogNumber: 'X-1', results: [] }])
    mockCancelBatchQuery.mockReturnValue(undefined)

    registerOrchestratorIpc()

    expect(await handler('executeBatchQuery')(null, ['X-1'], false)).toEqual([
      { catalogNumber: 'X-1', results: [] }
    ])
    expect(mockExecuteBatchQuery).toHaveBeenCalledWith(['X-1'], false)

    await handler('cancelBatchQuery')()
    expect(mockCancelBatchQuery).toHaveBeenCalled()
  })
})

describe('registerExportIpc', () => {
  it('registers export handlers', async () => {
    mockExportToExcel.mockResolvedValue('/tmp/out.xlsx')
    mockDownloadImage.mockResolvedValue({ base64: 'x', mimeType: 'image/png' })

    registerExportIpc()

    expect(await handler('exportToExcel')(null, [])).toBe('/tmp/out.xlsx')
    expect(mockExportToExcel).toHaveBeenCalledWith([])

    expect(await handler('fetchImage')(null, 'https://example.com/a.png')).toEqual({
      base64: 'x',
      mimeType: 'image/png'
    })
    expect(mockDownloadImage).toHaveBeenCalledWith('https://example.com/a.png', undefined)
  })
})
