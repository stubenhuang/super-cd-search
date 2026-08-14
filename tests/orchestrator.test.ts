import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BrowserWindow } from 'electron'

const { mockQueryDiscogs, mockQueryEbay, mockQueryKojima, mockQueryHmv, mockQueryYahoo, mockQueryCdjapan, mockQueryTower, mockQuerySurugaya, mockQueryZenmarket } = vi.hoisted(() => ({
  mockQueryDiscogs: vi.fn(),
  mockQueryEbay: vi.fn(),
  mockQueryKojima: vi.fn(),
  mockQueryHmv: vi.fn(),
  mockQueryYahoo: vi.fn(),
  mockQueryCdjapan: vi.fn(),
  mockQueryTower: vi.fn(),
  mockQuerySurugaya: vi.fn(),
  mockQueryZenmarket: vi.fn()
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

import {
  executeBatchQuery,
  cancelBatchQuery,
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
})

afterEach(() => {
  cancelBatchQuery()
})

describe('executeBatchQuery', () => {
  it('runs all platforms for each catalog number and normalizes input', async () => {
    const results = await executeBatchQuery(['uccg90530', 'UICD-6234'])

    expect(results.map(r => r.catalogNumber)).toEqual(['UCCG-90530', 'UICD-6234'])
    expect(results[0].results).toHaveLength(9)
    expect(mockQueryDiscogs).toHaveBeenCalledWith('UCCG-90530')
    expect(mockQueryEbay).toHaveBeenCalledWith('UCCG-90530')
    expect(mockQueryKojima).toHaveBeenCalledWith('UCCG-90530')
    expect(mockQueryHmv).toHaveBeenCalledWith('UCCG-90530')
    expect(mockQueryYahoo).toHaveBeenCalledWith('UCCG-90530')
    expect(mockQueryCdjapan).toHaveBeenCalledWith('UCCG-90530')
    expect(mockQueryTower).toHaveBeenCalledWith('UCCG-90530')
    expect(mockQuerySurugaya).toHaveBeenCalledWith('UCCG-90530')
    expect(mockQueryZenmarket).toHaveBeenCalledWith('UCCG-90530')

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

  it('records per-platform errors and continues with other platforms', async () => {
    mockQueryEbay.mockRejectedValue(new Error('eBay is down'))

    const results = await executeBatchQuery(['X-1'])
    const ebayResult = results[0].results.find(r => r.platform === 'ebay')
    expect(ebayResult).toMatchObject({ status: 'error', error: 'eBay is down' })
    expect(results[0].results).toHaveLength(9)
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
})
