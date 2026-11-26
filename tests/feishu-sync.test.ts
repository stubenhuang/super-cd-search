import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FeishuSettings, QueryResult } from '../src/shared/types'
import { DEFAULT_FEISHU_SETTINGS } from '../src/shared/feishu'
import { deleteSetting, setSetting } from '../src/main/settings'

const {
  mockEnsureFields,
  mockFindRecordIds,
  mockFindArchivedResults,
  mockBatchCreate,
  mockBatchUpdate,
  mockTestConnection,
  mockDecideImageValue,
  mockApplyImageDecision
} = vi.hoisted(() => ({
  mockEnsureFields: vi.fn(),
  mockFindRecordIds: vi.fn(),
  mockFindArchivedResults: vi.fn(),
  mockBatchCreate: vi.fn(),
  mockBatchUpdate: vi.fn(),
  mockTestConnection: vi.fn(),
  mockDecideImageValue: vi.fn(),
  mockApplyImageDecision: vi.fn()
}))

vi.mock('../src/main/feishu/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/feishu/client')>()
  return {
    ...actual,
    ensureFields: mockEnsureFields,
    findRecordIds: mockFindRecordIds,
    findArchivedResults: mockFindArchivedResults,
    batchCreate: mockBatchCreate,
    batchUpdate: mockBatchUpdate,
    testFeishuConnection: mockTestConnection
  }
})

vi.mock('../src/main/feishu/media', () => ({
  createImageSyncContext: vi.fn((settings: unknown) => ({ settings, uploads: 0, maxUploads: 200 })),
  decideImageValue: mockDecideImageValue,
  applyImageDecision: mockApplyImageDecision
}))

import { resetFeishuSyncState, syncToFeishu, testFeishu } from '../src/main/feishu/sync'

const CONFIG: FeishuSettings = {
  enabled: true,
  appId: 'cli_a1',
  appSecret: 'secret',
  appToken: 'appTOKEN',
  tableId: 'tblXYZ',
  mappingTableId: 'tblMAP',
  syncImages: false
}

function found(name: string): QueryResult {
  return {
    platform: 'discogs', name, artist: 'Artist',
    priceMin: 10, priceMax: 20, coverUrl: 'https://img/a.jpg',
    link: 'https://discogs/a', status: 'found'
  }
}

const oneRow = (name: string) => ({ catalogNumber: 'X-1', results: [found(name)] })

beforeEach(() => {
  vi.resetAllMocks()
  deleteSetting('feishu')
  resetFeishuSyncState()
  mockEnsureFields.mockResolvedValue(new Map<string, number>())
  mockFindRecordIds.mockResolvedValue(new Map())
  mockFindArchivedResults.mockResolvedValue(new Map())
  mockBatchCreate.mockImplementation(async (_settings, records: unknown[]) =>
    (records as unknown[]).map((_, index) => `rec-new-${index}`))
  mockBatchUpdate.mockImplementation(async (_settings, updates: unknown[]) => (updates as unknown[]).length)
  mockTestConnection.mockResolvedValue({ ok: true, message: '连接成功' })
  mockDecideImageValue.mockResolvedValue({ action: 'keep-url' })
  mockApplyImageDecision.mockImplementation((fields, column, decision) => {
    const result: Record<string, unknown> = { ...fields }
    if (decision.action === 'write-attachment') result[column] = decision.value
    else if (decision.action === 'omit') delete result[column]
    return result
  })
})

describe('syncToFeishu', () => {
  it('skips silently when the master switch is off', async () => {
    setSetting('feishu', { ...CONFIG, enabled: false })
    const result = await syncToFeishu({ rows: [oneRow('A')] })
    expect(result.status).toBe('skipped')
    expect(mockEnsureFields).not.toHaveBeenCalled()
  })

  it('skips silently when any credential is missing', async () => {
    setSetting('feishu', { ...CONFIG, tableId: '  ' })
    const result = await syncToFeishu({ rows: [oneRow('A')] })
    expect(result.status).toBe('skipped')
    expect(mockEnsureFields).not.toHaveBeenCalled()
  })

  it('skips silently for an empty batch', async () => {
    setSetting('feishu', CONFIG)
    expect((await syncToFeishu({ rows: [] })).status).toBe('skipped')
    expect(mockEnsureFields).not.toHaveBeenCalled()
  })

  it('creates new rows and updates existing ones, reporting counts', async () => {
    setSetting('feishu', CONFIG)
    mockFindRecordIds.mockResolvedValue(new Map([['X-2', 'rec-2']]))

    const result = await syncToFeishu({
      rows: [
        { catalogNumber: 'X-1', results: [found('New')] },
        { catalogNumber: 'X-2', results: [found('Existing')] }
      ]
    })

    expect(result).toEqual({ status: 'ok', created: 1, updated: 1, failed: 0 })
    expect(mockFindRecordIds).toHaveBeenCalledWith(expect.objectContaining({ tableId: 'tblXYZ' }), ['X-1', 'X-2'])
    const created = mockBatchCreate.mock.calls[0][1] as Array<Record<string, string>>
    expect(created).toHaveLength(1)
    expect(created[0]['编号']).toBe('X-1')
    expect(JSON.parse(created[0].priceAll)).toEqual({ discogs: { priceMin: 10, priceMax: 20 } })
    const updated = mockBatchUpdate.mock.calls[0][1] as Array<{ record_id: string; fields: Record<string, string> }>
    expect(updated[0].record_id).toBe('rec-2')
  })

  it('reads back the archive and merges it into resultsJson by platform', async () => {
    setSetting('feishu', CONFIG)
    const archived: QueryResult = {
      platform: 'hmv', name: 'Archived', artist: 'A', priceMin: 30, priceMax: 40,
      coverUrl: 'https://img/hmv.jpg', link: 'https://hmv/a', status: 'found'
    }
    mockFindArchivedResults.mockResolvedValue(new Map([['X-1', JSON.stringify([archived])]]))

    const result = await syncToFeishu({ rows: [oneRow('Fresh')] })

    expect(result.status).toBe('ok')
    expect(mockFindArchivedResults).toHaveBeenCalledWith(
      expect.objectContaining({ tableId: 'tblXYZ' }), ['X-1']
    )
    const created = mockBatchCreate.mock.calls[0][1] as Array<Record<string, string>>
    const parsed = JSON.parse(created[0].resultsJson) as QueryResult[]
    expect(parsed.map(r => r.platform)).toEqual(['discogs', 'hmv'])
  })

  it('still archives the batch when the archive read fails', async () => {
    setSetting('feishu', CONFIG)
    mockFindArchivedResults.mockRejectedValueOnce(new Error('search timeout'))

    const result = await syncToFeishu({ rows: [oneRow('Fresh')] })

    expect(result.status).toBe('ok')
    expect(result.created).toBe(1)
    const created = mockBatchCreate.mock.calls[0][1] as Array<Record<string, string>>
    expect((JSON.parse(created[0].resultsJson) as QueryResult[]).map(r => r.platform)).toEqual(['discogs'])
  })

  it('deduplicates catalog numbers within one batch (last row wins)', async () => {
    setSetting('feishu', CONFIG)
    const result = await syncToFeishu({ rows: [oneRow('First'), oneRow('Second')] })
    expect(result.created).toBe(1)
    expect(mockFindRecordIds).toHaveBeenCalledWith(expect.anything(), ['X-1'])
    const created = mockBatchCreate.mock.calls[0][1] as Array<Record<string, string>>
    expect(created[0].name).toBe('Second')
  })

  it('serializes overlapping syncs so the second one updates what the first created', async () => {
    setSetting('feishu', CONFIG)
    let release!: () => void
    mockEnsureFields.mockImplementationOnce(() => new Promise(resolve => {
      release = () => resolve(new Map<string, number>())
    }))

    const first = syncToFeishu({ rows: [oneRow('A')] })
    const second = syncToFeishu({ rows: [oneRow('B')] })
    await Promise.resolve()
    expect(mockEnsureFields).toHaveBeenCalledTimes(1)
    expect(mockBatchCreate).not.toHaveBeenCalled()

    release()
    const [r1, r2] = await Promise.all([first, second])
    expect(r1).toEqual({ status: 'ok', created: 1, updated: 0, failed: 0 })
    expect(r2).toEqual({ status: 'ok', created: 0, updated: 1, failed: 0 })
    expect(mockEnsureFields).toHaveBeenCalledTimes(2)
    expect(mockBatchCreate).toHaveBeenCalledTimes(1)
    expect(mockBatchUpdate).toHaveBeenCalledTimes(1)
    expect((mockBatchUpdate.mock.calls[0][1] as Array<{ record_id: string }>)[0].record_id).toBe('rec-new-0')
  })

  it('never inserts when findRecordIds already knows the record', async () => {
    setSetting('feishu', CONFIG)
    mockFindRecordIds.mockResolvedValue(new Map([['X-1', 'rec-existing']]))

    const result = await syncToFeishu({ rows: [oneRow('Existing')] })

    expect(result).toEqual({ status: 'ok', created: 0, updated: 1, failed: 0 })
    expect(mockBatchCreate).not.toHaveBeenCalled()
    expect((mockBatchUpdate.mock.calls[0][1] as Array<{ record_id: string }>)[0].record_id).toBe('rec-existing')
  })

  it('turns failures into an error outcome and leaves the queue usable', async () => {
    setSetting('feishu', CONFIG)
    mockEnsureFields.mockRejectedValueOnce(new Error('network down'))

    const failed = await syncToFeishu({ rows: [oneRow('A')] })
    expect(failed.status).toBe('error')
    expect(failed.message).toContain('network down')
    expect(mockBatchCreate).not.toHaveBeenCalled()

    const recovered = await syncToFeishu({ rows: [oneRow('B')] })
    expect(recovered.status).toBe('ok')
  })

  it('surfaces the primary-field guidance as a sync error', async () => {
    setSetting('feishu', CONFIG)
    mockEnsureFields.mockRejectedValueOnce(new Error('飞书多维表格的主字段（首列）必须命名为「编号」'))

    const result = await syncToFeishu({ rows: [oneRow('A')] })
    expect(result.status).toBe('error')
    expect(result.message).toContain('主字段（首列）必须命名为「编号」')
    expect(mockBatchCreate).not.toHaveBeenCalled()
  })
})

describe('syncToFeishu image decisions', () => {
  it('passes the actual field type to the decision and writes a file_token list', async () => {
    setSetting('feishu', { ...CONFIG, syncImages: true })
    mockEnsureFields.mockResolvedValue(new Map([['coverUrl', 17]]))
    mockDecideImageValue.mockResolvedValue({ action: 'write-attachment', value: [{ file_token: 'tok-1' }] })

    const result = await syncToFeishu({ rows: [oneRow('A')] })

    expect(result.status).toBe('ok')
    expect(mockDecideImageValue).toHaveBeenCalledWith(
      expect.anything(), 'https://img/a.jpg', 'coverUrl', 17
    )
    const created = mockBatchCreate.mock.calls[0][1] as Array<Record<string, unknown>>
    expect(created[0].coverUrl).toEqual([{ file_token: 'tok-1' }])
  })

  it('omits the image column entirely (never a URL string) when the decision says omit', async () => {
    setSetting('feishu', CONFIG)
    mockEnsureFields.mockResolvedValue(new Map([['coverUrl', 17]]))
    mockDecideImageValue.mockResolvedValue({ action: 'omit' })

    await syncToFeishu({ rows: [oneRow('A')] })

    const created = mockBatchCreate.mock.calls[0][1] as Array<Record<string, unknown>>
    expect(created[0]).not.toHaveProperty('coverUrl')
  })
})

describe('testFeishu', () => {
  it('rejects incomplete config without making a request', async () => {
    expect(await testFeishu(DEFAULT_FEISHU_SETTINGS)).toMatchObject({ ok: false })
    expect(mockTestConnection).not.toHaveBeenCalled()
  })

  it('probes with trimmed credentials even while syncing is disabled', async () => {
    const result = await testFeishu({ ...CONFIG, enabled: false, appToken: '  appTOKEN  ' })
    expect(result).toEqual({ ok: true, message: '连接成功' })
    expect(mockTestConnection).toHaveBeenCalledWith(expect.objectContaining({ appToken: 'appTOKEN' }))
  })
})
