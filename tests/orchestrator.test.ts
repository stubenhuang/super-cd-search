import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BrowserWindow } from 'electron'

const {
  mockQueryDiscogs, mockQueryEbay, mockQueryKojima, mockQueryHmv, mockQueryYahoo,
  mockQueryCdjapan, mockQueryTower, mockQueryXianyu, mockQueryTaobao,
  mockDownloadImage, mockFlushPlatformTables, mockLoadArchivedFoundResults
} = vi.hoisted(() => ({
  mockQueryDiscogs: vi.fn(),
  mockQueryEbay: vi.fn(),
  mockQueryKojima: vi.fn(),
  mockQueryHmv: vi.fn(),
  mockQueryYahoo: vi.fn(),
  mockQueryCdjapan: vi.fn(),
  mockQueryTower: vi.fn(),
  mockQueryXianyu: vi.fn(),
  mockQueryTaobao: vi.fn(),
  mockDownloadImage: vi.fn(),
  mockFlushPlatformTables: vi.fn(),
  mockLoadArchivedFoundResults: vi.fn()
}))

vi.mock('../src/main/queries/discogs', () => ({ queryDiscogs: mockQueryDiscogs }))
vi.mock('../src/main/queries/ebay', () => ({ queryEbay: mockQueryEbay }))
vi.mock('../src/main/queries/kojima', () => ({ queryKojima: mockQueryKojima }))
vi.mock('../src/main/queries/hmv', () => ({ queryHmv: mockQueryHmv }))
vi.mock('../src/main/queries/yahoo', () => ({ queryYahoo: mockQueryYahoo }))
vi.mock('../src/main/queries/cdjapan', () => ({ queryCdjapan: mockQueryCdjapan }))
vi.mock('../src/main/queries/tower', () => ({ queryTower: mockQueryTower }))
vi.mock('../src/main/queries/xianyu', () => ({ queryXianyu: mockQueryXianyu }))
vi.mock('../src/main/queries/taobao', () => ({ queryTaobao: mockQueryTaobao }))
vi.mock('../src/main/image', () => ({ downloadImage: mockDownloadImage }))
vi.mock('../src/main/feishu/platform-tables', () => ({ flushPlatformTables: mockFlushPlatformTables }))
vi.mock('../src/main/feishu/archived', () => ({ loadArchivedFoundResults: mockLoadArchivedFoundResults }))

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

const foundWith = (platform: string, name: string | null, artist: string | null) => ({
  platform,
  name,
  artist,
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
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([{ isDestroyed: () => false, webContents: { send: sendMock } }] as never)

  mockQueryDiscogs.mockResolvedValue(found('discogs'))
  mockQueryEbay.mockResolvedValue(found('ebay'))
  mockQueryKojima.mockResolvedValue(found('kojima'))
  mockQueryHmv.mockResolvedValue(found('hmv'))
  mockQueryYahoo.mockResolvedValue(found('yahoo'))
  mockQueryCdjapan.mockResolvedValue(found('cdjapan'))
  mockQueryTower.mockResolvedValue(found('tower'))
  mockQueryXianyu.mockResolvedValue(found('xianyu'))
  mockQueryTaobao.mockResolvedValue(found('taobao'))
  mockDownloadImage.mockResolvedValue({ base64: 'BASE64', mimeType: 'image/jpeg' })
  mockLoadArchivedFoundResults.mockResolvedValue(new Map())
})

afterEach(() => {
  cancelBatchQuery()
})

describe('executeBatchQuery', () => {
  it('runs all platforms for each catalog number and normalizes input', async () => {
    const results = await executeBatchQuery(['uccg90530', 'UICD-6234'])

    expect(results.map(r => r.catalogNumber)).toEqual(['UCCG-90530', 'UICD-6234'])
    expect(results[0].results).toHaveLength(7)
    expect(mockQueryDiscogs).toHaveBeenCalledWith('UCCG-90530', expect.anything())
    expect(mockQueryEbay).toHaveBeenCalledWith('UCCG-90530', expect.anything())
    expect(mockQueryKojima).toHaveBeenCalledWith('UCCG-90530', expect.anything())
    expect(mockQueryHmv).toHaveBeenCalledWith('UCCG-90530', expect.anything())
    expect(mockQueryYahoo).toHaveBeenCalledWith('UCCG-90530', expect.anything())
    expect(mockQueryCdjapan).toHaveBeenCalledWith('UCCG-90530', expect.anything())
    expect(mockQueryTower).toHaveBeenCalledWith('UCCG-90530', expect.anything())

    // Progress events are emitted per platform
    const events = sendMock.mock.calls.map(([channel, data]) => ({ channel, event: data.event }))
    expect(events.filter(e => e.channel === 'query:progress' && e.event === 'query:start')).toHaveLength(2)
    expect(events.filter(e => e.event === 'query:complete')).toHaveLength(2)

    // The per-platform Feishu flush sees the finished batch once.
    expect(mockFlushPlatformTables).toHaveBeenCalledTimes(1)
    expect(mockFlushPlatformTables).toHaveBeenCalledWith(results)
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

    const results = await executeBatchQuery(['X-1'])

    // Fast platforms must not wait for the slow one.
    expect(called).toEqual(['ebay', 'kojima', 'hmv', 'yahoo', 'cdjapan', 'tower', 'discogs'])
    expect(results[0].results.map(r => r.platform)).toEqual(['discogs', 'ebay', 'kojima', 'hmv', 'yahoo', 'cdjapan', 'tower'])
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
    expect(results[0].results).toHaveLength(7)
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
    // A cancelled batch must not archive anything.
    expect(mockFlushPlatformTables).not.toHaveBeenCalled()
  })

  it('runs Taobao as a second-phase keyword source and Xianyu as a second-phase image source', async () => {
    const coverUrl = 'https://cover.example/x.jpg'
    const calls: string[] = []
    mockQueryDiscogs.mockImplementation(async () => {
      calls.push('discogs')
      return { ...found('discogs'), coverUrl }
    })
    mockQueryXianyu.mockImplementation(async () => { calls.push('xianyu'); return found('xianyu') })
    mockQueryTaobao.mockImplementation(async () => { calls.push('taobao'); return found('taobao') })

    const results = await executeBatchQuery(['X-1'], ['discogs', 'taobao', 'xianyu'])

    expect(calls[0]).toBe('discogs')
    expect(calls).toContain('taobao')
    expect(calls).toContain('xianyu')
    // Both Taobao (keyword) and Xianyu (image) now run in phase two, after the
    // phase-one text source. They are enqueued together; the image source is
    // registered first, so its query is invoked before Taobao's.
    expect(calls.indexOf('taobao')).toBeGreaterThan(calls.indexOf('discogs'))
    expect(calls.indexOf('xianyu')).toBeGreaterThan(calls.indexOf('discogs'))
    expect(calls.indexOf('xianyu')).toBeLessThan(calls.indexOf('taobao'))
    expect(mockDownloadImage).toHaveBeenCalledTimes(1)
    expect(mockDownloadImage).toHaveBeenCalledWith(coverUrl, 1000)
    expect(mockQueryTaobao).toHaveBeenCalledWith('X-1', 'Artist Album', expect.anything())
    expect(mockQueryXianyu).toHaveBeenCalledWith('X-1', 'BASE64', expect.anything())
    expect(results[0].results.map(r => r.platform)).toEqual(['discogs', 'xianyu', 'taobao'])
    expect(sendMock.mock.calls.filter(([, data]) => data.event === 'query:complete')).toHaveLength(1)
  })

  it('builds the Taobao keyword as "{artist} {name}" from phase-one results', async () => {
    mockQueryDiscogs.mockResolvedValue(foundWith('discogs', 'Animals', 'Pink Floyd'))

    await executeBatchQuery(['X-1'], ['discogs', 'taobao'])

    expect(mockQueryTaobao).toHaveBeenCalledWith('X-1', 'Pink Floyd Animals', expect.anything())
  })

  it('uses only the album name for the keyword when the artist is missing', async () => {
    mockQueryDiscogs.mockResolvedValue(foundWith('discogs', 'Animals', null))

    await executeBatchQuery(['X-1'], ['discogs', 'taobao'])

    expect(mockQueryTaobao).toHaveBeenCalledWith('X-1', 'Animals', expect.anything())
  })

  it('uses only the artist for the keyword when the album name is missing', async () => {
    mockQueryDiscogs.mockResolvedValue(foundWith('discogs', null, 'Pink Floyd'))

    await executeBatchQuery(['X-1'], ['discogs', 'taobao'])

    expect(mockQueryTaobao).toHaveBeenCalledWith('X-1', 'Pink Floyd', expect.anything())
  })

  it('does not duplicate the keyword when artist equals album name', async () => {
    mockQueryDiscogs.mockResolvedValue(foundWith('discogs', 'Pink Floyd', 'Pink Floyd'))

    await executeBatchQuery(['X-1'], ['discogs', 'taobao'])

    expect(mockQueryTaobao).toHaveBeenCalledWith('X-1', 'Pink Floyd', expect.anything())
  })

  it('skips the paid Taobao search without issuing a request when no album/artist is available', async () => {
    mockQueryDiscogs.mockResolvedValue(foundWith('discogs', null, null))

    const results = await executeBatchQuery(['X-1'], ['discogs', 'taobao'])

    expect(mockQueryTaobao).not.toHaveBeenCalled()
    expect(results[0].results.find(r => r.platform === 'taobao'))
      .toMatchObject({ status: 'not_found', error: '无可用专辑信息，无法执行淘宝搜索' })
  })

  it('skips only the image source with a clear not_found when no cover is available', async () => {
    const results = await executeBatchQuery(['X-1'], ['discogs', 'taobao', 'xianyu'])

    // Taobao is keyword-based and must still run without a cover.
    expect(mockQueryTaobao).toHaveBeenCalledWith('X-1', 'Artist Album', expect.anything())
    expect(mockQueryXianyu).not.toHaveBeenCalled()
    expect(results[0].results.find(r => r.platform === 'xianyu'))
      .toMatchObject({ status: 'not_found', error: '无可用封面图，无法执行以图搜物' })
  })

  it('skips only the image source when the cover download fails', async () => {
    mockQueryDiscogs.mockResolvedValue({ ...found('discogs'), coverUrl: 'https://cover.example/x.jpg' })
    mockDownloadImage.mockResolvedValue(null)

    const results = await executeBatchQuery(['X-1'], ['discogs', 'taobao', 'xianyu'])

    expect(mockQueryTaobao).toHaveBeenCalledWith('X-1', 'Artist Album', expect.anything())
    expect(mockQueryXianyu).not.toHaveBeenCalled()
    expect(results[0].results.find(r => r.platform === 'xianyu'))
      .toMatchObject({ status: 'not_found', error: '封面图下载失败，无法执行以图搜物' })
  })

  it('keeps the default platform set free of paid Apify sources', async () => {
    await executeBatchQuery(['X-1'])
    expect(mockQueryTaobao).not.toHaveBeenCalled()
    expect(mockQueryXianyu).not.toHaveBeenCalled()
  })

  it('contains an Apify source failure without breaking the batch', async () => {
    mockQueryDiscogs.mockResolvedValue({ ...found('discogs'), coverUrl: 'https://cover.example/x.jpg' })
    mockQueryTaobao.mockRejectedValue(new Error('Apify down'))

    const results = await executeBatchQuery(['X-1'], ['discogs', 'taobao', 'xianyu'])

    expect(results[0].results.find(r => r.platform === 'taobao')).toMatchObject({ status: 'error', error: 'Apify down' })
    expect(results[0].results.find(r => r.platform === 'xianyu')?.status).toBe('found')
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

  describe('Feishu archive reuse', () => {
    it('skips the live query for a channel already found, but keeps the others', async () => {
      mockLoadArchivedFoundResults.mockResolvedValue(new Map([
        ['UCCG-90530', new Map([['discogs', { ...found('discogs'), name: 'Archived Album' }]])]
      ]))

      const results = await executeBatchQuery(['uccg90530'], ['discogs', 'ebay'])

      expect(mockLoadArchivedFoundResults).toHaveBeenCalledWith(['UCCG-90530'], expect.anything())
      expect(mockQueryDiscogs).not.toHaveBeenCalled()
      expect(mockQueryEbay).toHaveBeenCalledTimes(1)
      expect(results[0].results.find(r => r.platform === 'discogs')?.name).toBe('Archived Album')

      // A skipped channel still emits the usual progress/result events.
      const payloads = sendMock.mock.calls.map(([, payload]) => payload as Record<string, unknown>)
      expect(payloads.some(p => p.platform === 'discogs' && p.status === 'complete')).toBe(true)
      expect(payloads.some(p => p.platform === 'discogs' && p.event === 'query:result')).toBe(true)
    })

    it('skips cover download and both paid Apify calls when phase two is archived', async () => {
      mockLoadArchivedFoundResults.mockResolvedValue(new Map([
        ['X-1', new Map([['xianyu', found('xianyu')], ['taobao', found('taobao')]])]
      ]))

      const results = await executeBatchQuery(['X-1'], ['discogs', 'xianyu', 'taobao'])

      expect(mockDownloadImage).not.toHaveBeenCalled()
      expect(mockQueryXianyu).not.toHaveBeenCalled()
      expect(mockQueryTaobao).not.toHaveBeenCalled()
      expect(results[0].results.filter(r => r.platform === 'xianyu' || r.platform === 'taobao'))
        .toHaveLength(2)
    })

    it('still resolves prerequisites for phase-two channels that are not archived', async () => {
      mockLoadArchivedFoundResults.mockResolvedValue(new Map([
        ['X-1', new Map([['taobao', found('taobao')]])]
      ]))
      mockQueryDiscogs.mockResolvedValue({ ...found('discogs'), coverUrl: 'https://cover.example/x.jpg' })

      await executeBatchQuery(['X-1'], ['discogs', 'xianyu', 'taobao'])

      expect(mockQueryTaobao).not.toHaveBeenCalled()
      expect(mockDownloadImage).toHaveBeenCalledTimes(1)
      expect(mockQueryXianyu).toHaveBeenCalledTimes(1)
    })

    it('falls back to live queries when the archive lookup returns nothing', async () => {
      mockLoadArchivedFoundResults.mockResolvedValue(new Map())

      await executeBatchQuery(['X-1'], ['discogs', 'ebay'])

      expect(mockQueryDiscogs).toHaveBeenCalledTimes(1)
      expect(mockQueryEbay).toHaveBeenCalledTimes(1)
    })
  })
})
