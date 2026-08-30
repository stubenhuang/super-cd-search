import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BrowserWindow } from 'electron'

const {
  mockQueryDiscogs, mockQueryEbay, mockQueryKojima, mockQueryHmv, mockQueryYahoo,
  mockQueryCdjapan, mockQueryTower, mockQuerySurugaya, mockQueryZenmarket,
  mockQueryXianyu, mockQueryTaobaoImage, mockGetEmbeddedLibraryImage, mockDownloadImage
} = vi.hoisted(() => ({
  mockQueryDiscogs: vi.fn(),
  mockQueryEbay: vi.fn(),
  mockQueryKojima: vi.fn(),
  mockQueryHmv: vi.fn(),
  mockQueryYahoo: vi.fn(),
  mockQueryCdjapan: vi.fn(),
  mockQueryTower: vi.fn(),
  mockQuerySurugaya: vi.fn(),
  mockQueryZenmarket: vi.fn(),
  mockQueryXianyu: vi.fn(),
  mockQueryTaobaoImage: vi.fn(),
  mockGetEmbeddedLibraryImage: vi.fn(),
  mockDownloadImage: vi.fn()
}))

vi.mock('../src/main/queries/discogs', () => ({ queryDiscogs: mockQueryDiscogs }))
vi.mock('../src/main/queries/ebay', () => ({ queryEbay: mockQueryEbay }))
vi.mock('../src/main/queries/kojima', () => ({ queryKojima: mockQueryKojima }))
vi.mock('../src/main/queries/hmv', () => ({ queryHmv: mockQueryHmv }))
vi.mock('../src/main/queries/yahoo', () => ({ queryYahoo: mockQueryYahoo }))
vi.mock('../src/main/queries/cdjapan', () => ({ queryCdjapan: mockQueryCdjapan }))
vi.mock('../src/main/queries/tower', () => ({ queryTower: mockQueryTower }))
vi.mock('../src/main/queries/surugaya', () => ({ querySurugaya: mockQuerySurugaya }))
vi.mock('../src/main/queries/zenmarket', () => ({ queryZenmarket: mockQueryZenmarket }))
vi.mock('../src/main/queries/xianyu', () => ({ queryXianyu: mockQueryXianyu }))
vi.mock('../src/main/queries/taobao', () => ({ queryTaobaoImage: mockQueryTaobaoImage }))
vi.mock('../src/main/library', () => ({ getEmbeddedLibraryImage: mockGetEmbeddedLibraryImage }))
vi.mock('../src/main/image', () => ({ downloadImage: mockDownloadImage }))

import {
  executeBatchQuery,
  cancelBatchQuery,
  isBatchQueryRunning,
  type BatchQueryResult
} from '../src/main/orchestrator'

const found = (platform: string) => ({
  platform,
  name: 'Album',
  artist: 'Artist',
  priceMin: 10,
  priceMax: 20,
  coverUrl: null,
  link: null,
  status: 'found' as const
})

let sendMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  sendMock = vi.fn()
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([{ webContents: { send: sendMock } }] as never)

  mockQueryDiscogs.mockResolvedValue(found('discogs'))
  mockQueryEbay.mockResolvedValue(found('ebay'))
  mockQueryKojima.mockResolvedValue(found('kojima'))
  mockQueryHmv.mockResolvedValue(found('hmv'))
  mockQueryYahoo.mockResolvedValue(found('yahoo'))
  mockQueryCdjapan.mockResolvedValue(found('cdjapan'))
  mockQueryTower.mockResolvedValue(found('tower'))
  mockQuerySurugaya.mockResolvedValue(found('surugaya'))
  mockQueryZenmarket.mockResolvedValue(found('zenmarket'))
  mockQueryXianyu.mockResolvedValue(found('xianyu'))
  mockQueryTaobaoImage.mockResolvedValue(found('taobao'))
  mockGetEmbeddedLibraryImage.mockReturnValue({ buffer: Buffer.from('cover'), mimeType: 'image/jpeg' })
  mockDownloadImage.mockResolvedValue({ base64: Buffer.from('downloaded').toString('base64'), mimeType: 'image/jpeg' })
})

afterEach(() => {
  cancelBatchQuery()
})

describe('executeBatchQuery', () => {
  it('runs all platforms for each catalog number and normalizes input', async () => {
    const results = await executeBatchQuery(['uccg90530', 'UICD-6234'])

    expect(results.map(r => r.catalogNumber)).toEqual(['UCCG-90530', 'UICD-6234'])
    expect(results[0].results).toHaveLength(9)
    expect(mockQueryDiscogs).toHaveBeenCalledWith('UCCG-90530', expect.anything())
    expect(mockQueryEbay).toHaveBeenCalledWith('UCCG-90530', expect.anything())
    expect(mockQueryKojima).toHaveBeenCalledWith('UCCG-90530', expect.anything())
    expect(mockQueryHmv).toHaveBeenCalledWith('UCCG-90530', expect.anything())
    expect(mockQueryYahoo).toHaveBeenCalledWith('UCCG-90530', expect.anything())
    expect(mockQueryCdjapan).toHaveBeenCalledWith('UCCG-90530', expect.anything())
    expect(mockQueryTower).toHaveBeenCalledWith('UCCG-90530', expect.anything())
    expect(mockQuerySurugaya).toHaveBeenCalledWith('UCCG-90530', expect.anything())
    expect(mockQueryZenmarket).toHaveBeenCalledWith('UCCG-90530', expect.anything())

    // Progress events are emitted per platform
    const events = sendMock.mock.calls.map(([channel, data]) => ({ channel, event: data.event }))
    expect(events.filter(e => e.channel === 'query:progress' && e.event === 'query:start')).toHaveLength(2)
    expect(events.filter(e => e.event === 'query:complete')).toHaveLength(2)
  })

  it('only queries the platforms passed in', async () => {
    const results = await executeBatchQuery(['X-1'], ['discogs', 'ebay', 'hmv', 'yahoo'])
    expect(results[0].results.map(r => r.platform)).toEqual(['discogs', 'ebay', 'hmv', 'yahoo'])
    expect(mockQueryKojima).not.toHaveBeenCalled()
    expect(mockQueryCdjapan).not.toHaveBeenCalled()
    expect(mockQueryTower).not.toHaveBeenCalled()
  })

  it('throws when no platforms are selected', async () => {
    await expect(executeBatchQuery(['X-1'], [])).rejects.toThrow('No platforms selected')
  })

  it('runs platforms concurrently within a catalog and keeps canonical order', async () => {
    const called: string[] = []
    mockQueryDiscogs.mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
      called.push('discogs')
      return found('discogs')
    })
    mockQueryEbay.mockImplementation(async () => { called.push('ebay'); return found('ebay') })
    mockQueryKojima.mockImplementation(async () => { called.push('kojima'); return found('kojima') })
    mockQueryHmv.mockImplementation(async () => { called.push('hmv'); return found('hmv') })
    mockQueryYahoo.mockImplementation(async () => { called.push('yahoo'); return found('yahoo') })
    mockQueryCdjapan.mockImplementation(async () => { called.push('cdjapan'); return found('cdjapan') })
    mockQueryTower.mockImplementation(async () => { called.push('tower'); return found('tower') })
    mockQuerySurugaya.mockImplementation(async () => { called.push('surugaya'); return found('surugaya') })
    mockQueryZenmarket.mockImplementation(async () => { called.push('zenmarket'); return found('zenmarket') })

    const results = await executeBatchQuery(['X-1'])

    // Fast platforms must not wait for the slow one.
    expect(called).toEqual(['ebay', 'kojima', 'hmv', 'yahoo', 'cdjapan', 'tower', 'surugaya', 'zenmarket', 'discogs'])
    expect(results[0].results.map(r => r.platform)).toEqual(['discogs', 'ebay', 'kojima', 'hmv', 'yahoo', 'cdjapan', 'tower', 'surugaya', 'zenmarket'])
  })

  it('throws when no catalog numbers are provided', async () => {
    await expect(executeBatchQuery(['  ', ''])).rejects.toThrow('No catalog numbers provided')
    await expect(executeBatchQuery([])).rejects.toThrow('No catalog numbers provided')
  })

  it('throws when more than 10 catalog numbers are provided', async () => {
    const tooMany = Array.from({ length: 11 }, (_, i) => `X-${i}`)
    await expect(executeBatchQuery(tooMany)).rejects.toThrow('Maximum 10 catalog numbers allowed')
  })

  it('deduplicates catalog numbers after normalization', async () => {
    const results = await executeBatchQuery(['uccg90530', 'UCCG-90530', ' uccg 90530 '], ['discogs'])
    expect(results.map(result => result.catalogNumber)).toEqual(['UCCG-90530'])
    expect(mockQueryDiscogs).toHaveBeenCalledTimes(1)
  })

  it('records per-platform errors and continues with other platforms', async () => {
    mockQueryEbay.mockRejectedValue(new Error('eBay is down'))

    const results = await executeBatchQuery(['X-1'])
    const ebayResult = results[0].results.find(r => r.platform === 'ebay')
    expect(ebayResult).toMatchObject({ status: 'error', error: 'eBay is down' })
    expect(results[0].results).toHaveLength(9)
  })

  it('runs the taobao image search after the text platforms with the library cover', async () => {
    const results = await executeBatchQuery(['X-1'], ['discogs', 'taobao'])

    expect(mockQueryTaobaoImage).toHaveBeenCalledWith(
      'X-1',
      { buffer: Buffer.from('cover'), mimeType: 'image/jpeg' },
      expect.anything()
    )
    expect(results[0].results.map(r => r.platform)).toEqual(['discogs', 'taobao'])
    expect(results[0].results[1]).toMatchObject({ platform: 'taobao', status: 'found' })
  })

  it('downloads the cover from text-platform results when the library has none', async () => {
    mockGetEmbeddedLibraryImage.mockReturnValue(null)
    mockQueryDiscogs.mockResolvedValue({ ...found('discogs'), coverUrl: 'https://img.discogs.com/cover.jpg' })

    await executeBatchQuery(['X-1'], ['discogs', 'taobao'])

    expect(mockDownloadImage).toHaveBeenCalledWith('https://img.discogs.com/cover.jpg', 500, true)
    expect(mockQueryTaobaoImage).toHaveBeenCalledWith(
      'X-1',
      { buffer: Buffer.from('downloaded'), mimeType: 'image/jpeg' },
      expect.anything()
    )
  })

  it('skips the taobao image search with a not-found result when no cover exists', async () => {
    mockGetEmbeddedLibraryImage.mockReturnValue(null)

    const results = await executeBatchQuery(['X-1'], ['taobao'])

    expect(mockQueryTaobaoImage).not.toHaveBeenCalled()
    const taobaoResult = results[0].results[0]
    expect(taobaoResult).toMatchObject({ platform: 'taobao', status: 'not_found' })
    expect(taobaoResult.error).toContain('无可用封面图')
  })

  it('aborts in-flight queries and emits a batch-cancelled event', async () => {
    let resolveDiscogs: (value: unknown) => void = () => {}
    mockQueryDiscogs.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveDiscogs = resolve
        })
    )

    const promise = executeBatchQuery(['X-1'])
    await vi.waitFor(() => expect(mockQueryDiscogs).toHaveBeenCalled())

    cancelBatchQuery()
    resolveDiscogs(found('discogs'))

    const results: BatchQueryResult[] = await promise
    expect(results).toEqual([])
    expect(sendMock.mock.calls.some(([, data]) => data.event === 'query:batch-cancelled')).toBe(true)
  })

  it('exposes whether a batch query is currently running', async () => {
    let resolveDiscogs: (value: unknown) => void = () => {}
    mockQueryDiscogs.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveDiscogs = resolve
        })
    )

    expect(isBatchQueryRunning()).toBe(false)
    const promise = executeBatchQuery(['X-1'])
    await vi.waitFor(() => expect(isBatchQueryRunning()).toBe(true))

    resolveDiscogs(found('discogs'))
    await promise
    expect(isBatchQueryRunning()).toBe(false)
  })
})
