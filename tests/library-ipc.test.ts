import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dialog, ipcMain } from 'electron'
import { tmpdir } from 'os'
import { join } from 'path'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  upsert: vi.fn(),
  remove: vi.fn(),
  image: vi.fn(),
  records: vi.fn(),
  imported: vi.fn(),
  startRound: vi.fn(),
  finishRound: vi.fn(),
  snapshot: vi.fn(),
  setPublished: vi.fn(),
  setPlatforms: vi.fn(),
  parse: vi.fn(),
  write: vi.fn(),
  download: vi.fn(),
  getSetting: vi.fn(),
  setSetting: vi.fn()
}))

vi.mock('../src/main/library', () => ({
  listLibraryRecords: mocks.list,
  createLibraryRecord: mocks.create,
  updateLibraryRecord: mocks.update,
  upsertLibraryRecords: mocks.upsert,
  deleteLibraryRecords: mocks.remove,
  getEmbeddedLibraryImage: mocks.image,
  getLibraryRecords: mocks.records,
  upsertImportedRecords: mocks.imported,
  setRecordPublishState: mocks.setPublished,
  setRecordPublishPlatforms: mocks.setPlatforms
}))

vi.mock('../src/main/publish/round', () => ({
  startPublishRound: mocks.startRound,
  finishPublishRound: mocks.finishRound,
  getPublishSnapshot: mocks.snapshot
}))

vi.mock('../src/main/excel/importer', () => ({ parseLibraryExcel: mocks.parse }))
vi.mock('../src/main/excel/exporter', () => ({ writeExcelFile: mocks.write }))
vi.mock('../src/main/image', () => ({ downloadImage: mocks.download }))
vi.mock('../src/main/settings', () => ({ getSetting: mocks.getSetting, setSetting: mocks.setSetting }))
vi.mock('../src/main/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import { registerLibraryIpc } from '../src/main/ipc/library'

const sevenHeaders = ['编号', '图片', '详情', '最低价($)', '最高价($)', '最低价(￥)', '最高价(￥)']

function handler(channel: string) {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([registered]) => registered === channel)
  if (!call) throw new Error(`Missing handler: ${channel}`)
  return call[1]
}

beforeEach(() => {
  vi.clearAllMocks()
  registerLibraryIpc()
})

describe('library IPC', () => {
  it('forwards CRUD and embedded-image calls', async () => {
    const input = { catalogNumber: 'X-1', imageUrl: '', details: '', lowestPriceUsd: null, highestPriceUsd: null, lowestPriceCny: null, highestPriceCny: null }
    mocks.list.mockReturnValue({ records: [], total: 0, page: 1, pageSize: 20 })
    mocks.create.mockReturnValue({ ...input, hasEmbeddedImage: false, createdAt: 1, updatedAt: 1 })
    mocks.update.mockReturnValue({ ...input, details: 'x', hasEmbeddedImage: false, createdAt: 1, updatedAt: 2 })
    mocks.remove.mockReturnValue(1)
    mocks.image.mockReturnValue({ buffer: Buffer.from('img'), mimeType: 'image/png' })
    mocks.upsert.mockReturnValue({ inserted: ['X-1'], updated: ['X-2'] })

    expect(await handler('library:list')(null, { catalogQuery: '', page: 1, pageSize: 20 })).toMatchObject({ total: 0 })
    await handler('library:create')(null, input)
    expect(mocks.create).toHaveBeenCalledWith(input)
    await handler('library:update')(null, 'X-1', { ...input, details: 'x' })
    expect(mocks.update).toHaveBeenCalledWith('X-1', { ...input, details: 'x' })
    expect(await handler('library:upsert-search-results')(null, [input])).toEqual({ inserted: ['X-1'], updated: ['X-2'] })
    expect(mocks.upsert).toHaveBeenCalledWith([input])
    expect(await handler('library:delete')(null, ['X-1'])).toBe(1)
    expect(await handler('library:image')(null, 'X-1')).toEqual({ base64: Buffer.from('img').toString('base64'), mimeType: 'image/png' })
  })

  it('imports valid rows and returns partial errors', async () => {
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: ['/tmp/in.xlsx'] })
    mocks.parse.mockResolvedValue({ records: [{ catalogNumber: 'X-1' }], errors: [{ row: 3, message: 'bad' }], inputRows: 2 })
    mocks.imported.mockReturnValue({ added: 1, updated: 0 })

    expect(await handler('library:import-excel')()).toEqual({
      status: 'imported', added: 1, updated: 0, skipped: 1, errors: [{ row: 3, message: 'bad' }]
    })
  })

  it('handles cancelled and failed imports without mutating the library', async () => {
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: true, filePaths: [] })
    expect(await handler('library:import-excel')()).toEqual({
      status: 'cancelled', added: 0, updated: 0, skipped: 0, errors: []
    })
    expect(mocks.parse).not.toHaveBeenCalled()

    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/bad.xlsx'] })
    mocks.parse.mockRejectedValueOnce(new Error('bad workbook'))
    expect(await handler('library:import-excel')()).toMatchObject({ status: 'error', error: 'bad workbook' })
  })

  it('rejects invalid delete input and returns null for records without embedded images', async () => {
    mocks.image.mockReturnValue(null)
    expect(await handler('library:image')(null, 'X-1')).toBeNull()
    expect(() => handler('library:delete')(null, 'X-1')).toThrow('编号列表格式无效')
    expect(() => handler('library:delete')(null, [1])).toThrow('编号列表格式无效')
  })

  it('exports selected records in the requested order with seven columns', async () => {
    mocks.records.mockReturnValue([{
      catalogNumber: 'X-2', imageUrl: '', hasEmbeddedImage: false, details: 'd',
      lowestPriceUsd: 1, highestPriceUsd: 2, lowestPriceCny: 7, highestPriceCny: 14,
      createdAt: 1, updatedAt: 1
    }])
    mocks.write.mockResolvedValue(undefined)
    const directory = join(tmpdir(), 'scd-library-ipc')
    const result = await handler('library:export-excel')(
      null,
      ['X-2'],
      sevenHeaders,
      'out.xlsx',
      directory
    )
    expect(result).toMatchObject({ status: 'saved' })
    expect(mocks.write).toHaveBeenCalledWith(
      expect.objectContaining({ rows: [expect.objectContaining({ catalogNumber: 'X-2', lowestPriceUsd: 1 })] }),
      join(directory, 'out.xlsx'),
      expect.any(Function),
      expect.any(Function)
    )
  })

  it('supports embedded and remote export images and reports save cancellation', async () => {
    const baseRecord = {
      details: 'd', lowestPriceUsd: 1, highestPriceUsd: 2, lowestPriceCny: 7, highestPriceCny: 14,
      createdAt: 1, updatedAt: 1
    }
    mocks.records.mockReturnValue([
      { ...baseRecord, catalogNumber: 'IMG-1', imageUrl: '', hasEmbeddedImage: true },
      { ...baseRecord, catalogNumber: 'URL-1', imageUrl: 'https://example.com/a.png', hasEmbeddedImage: false }
    ])
    mocks.image.mockReturnValue({ buffer: Buffer.from('embedded'), mimeType: 'image/jpeg' })
    mocks.download.mockResolvedValue({ base64: Buffer.from('remote').toString('base64'), mimeType: 'image/png' })
    mocks.write.mockImplementation(async (_payload, _filePath, fetcher, progress) => {
      expect(await fetcher('library:IMG-1')).toMatchObject({ extension: 'jpeg' })
      expect(await fetcher('https://example.com/a.png')).toMatchObject({ extension: 'png' })
      progress?.(1, 2)
    })

    const directory = join(tmpdir(), 'scd-library-ipc-images')
    expect(await handler('library:export-excel')(
      null, ['IMG-1', 'URL-1'], sevenHeaders, 'images.xlsx', directory
    )).toMatchObject({ status: 'saved' })

    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true, filePath: '' })
    expect(await handler('library:export-excel')(
      null, ['IMG-1'], sevenHeaders, 'cancelled.xlsx'
    )).toEqual({ status: 'cancelled' })
  })

  it('returns export errors for empty or missing selections', async () => {
    expect(await handler('library:export-excel')(null, [], sevenHeaders, 'out.xlsx')).toMatchObject({
      status: 'error', error: '请先选择要导出的记录'
    })
    mocks.records.mockReturnValue([])
    expect(await handler('library:export-excel')(null, ['MISSING'], sevenHeaders, 'out.xlsx')).toMatchObject({
      status: 'error', error: '所选记录不存在'
    })
  })

  it('starts publish rounds and reports errors', async () => {
    mocks.startRound.mockReturnValue(2)
    expect(await handler('library:publish')(null, ['A-1', 'B-2'])).toEqual({ status: 'published', count: 2 })
    expect(mocks.startRound).toHaveBeenCalledWith(['A-1', 'B-2'])

    mocks.startRound.mockReturnValue(0)
    expect(await handler('library:publish')(null, ['GONE'])).toMatchObject({
      status: 'error', error: '所选记录都不在 CD 库中'
    })

    expect(await handler('library:publish')(null, [])).toMatchObject({ status: 'error' })
    expect(await handler('library:publish')(null, 'X-1')).toMatchObject({ status: 'error', error: '编号列表格式无效' })
  })

  it('finishes the publish round and reports errors', async () => {
    expect(await handler('library:finish-publish')()).toEqual({ status: 'finished' })
    expect(mocks.finishRound).toHaveBeenCalled()
  })

  it('serves the publish snapshot for the desktop manager', async () => {
    mocks.snapshot.mockReturnValue({ publishedAt: 1710000000000, items: [] })
    expect(await handler('library:get-publish-snapshot')()).toEqual({ publishedAt: 1710000000000, items: [] })
  })

  it('forwards desktop publish-state and platform edits', async () => {
    await handler('library:set-publish-state')(null, 'A-1', true)
    expect(mocks.setPublished).toHaveBeenCalledWith('A-1', true)

    await handler('library:set-publish-platforms')(null, 'A-1', ['taobao', 'xianyu'])
    expect(mocks.setPlatforms).toHaveBeenCalledWith('A-1', ['taobao', 'xianyu'])

    expect(() => handler('library:set-publish-state')(null, 'A-1', 'yes')).toThrow('发布状态格式无效')
    mocks.setPlatforms.mockImplementationOnce(() => { throw new Error('平台列表无效') })
    expect(() => handler('library:set-publish-platforms')(null, 'A-1', ['jd'])).toThrow('平台列表无效')
  })
})
