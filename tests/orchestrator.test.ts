import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BrowserWindow } from 'electron'

const { mockQueryDiscogs, mockQueryEbay, mockQueryKojima, mockQueryHmv, mockQueryYahoo } = vi.hoisted(() => ({
  mockQueryDiscogs: vi.fn(),
  mockQueryEbay: vi.fn(),
  mockQueryKojima: vi.fn(),
  mockQueryHmv: vi.fn(),
  mockQueryYahoo: vi.fn()
}))

const { mockGetDatabase } = vi.hoisted(() => ({
  mockGetDatabase: vi.fn()
}))

vi.mock('../src/main/queries/discogs', () => ({ queryDiscogs: mockQueryDiscogs }))
vi.mock('../src/main/queries/ebay', () => ({ queryEbay: mockQueryEbay }))
vi.mock('../src/main/queries/kojima', () => ({ queryKojima: mockQueryKojima }))
vi.mock('../src/main/queries/hmv', () => ({ queryHmv: mockQueryHmv }))
vi.mock('../src/main/queries/yahoo', () => ({ queryYahoo: mockQueryYahoo }))
vi.mock('../src/main/database', () => ({ getDatabase: mockGetDatabase }))

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
let insertQueryRun: ReturnType<typeof vi.fn>
let insertResultRun: ReturnType<typeof vi.fn>
let fakeDb: {
  prepare: ReturnType<typeof vi.fn>
  transaction: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  vi.clearAllMocks()
  sendMock = vi.fn()
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([{ webContents: { send: sendMock } }] as never)

  insertQueryRun = vi.fn(() => ({ lastInsertRowid: 1 }))
  insertResultRun = vi.fn()
  fakeDb = {
    prepare: vi.fn((sql: string) => {
      if (sql.startsWith('INSERT INTO queries')) return { run: insertQueryRun }
      return { run: insertResultRun }
    }),
    transaction: vi.fn((fn: () => void) => () => fn())
  }
  mockGetDatabase.mockReturnValue(fakeDb)

  mockQueryDiscogs.mockResolvedValue(found('discogs'))
  mockQueryEbay.mockResolvedValue(found('ebay'))
  mockQueryKojima.mockResolvedValue(found('kojima'))
  mockQueryHmv.mockResolvedValue(found('hmv'))
  mockQueryYahoo.mockResolvedValue(found('yahoo'))
})

afterEach(() => {
  cancelBatchQuery()
})

describe('executeBatchQuery', () => {
  it('runs all platforms for each catalog number and normalizes input', async () => {
    const results = await executeBatchQuery(['uccg90530', 'UICD-6234'])

    expect(results.map(r => r.catalogNumber)).toEqual(['UCCG-90530', 'UICD-6234'])
    expect(results[0].results).toHaveLength(5)
    expect(mockQueryDiscogs).toHaveBeenCalledWith('UCCG-90530')
    expect(mockQueryEbay).toHaveBeenCalledWith('UCCG-90530')
    expect(mockQueryKojima).toHaveBeenCalledWith('UCCG-90530')
    expect(mockQueryHmv).toHaveBeenCalledWith('UCCG-90530')
    expect(mockQueryYahoo).toHaveBeenCalledWith('UCCG-90530')

    // Each catalog is persisted inside a transaction
    expect(insertQueryRun).toHaveBeenCalledTimes(2)
    expect(insertResultRun).toHaveBeenCalledTimes(10)

    // Progress events are emitted per platform
    const events = sendMock.mock.calls.map(([channel, data]) => ({ channel, event: data.event }))
    expect(events.filter(e => e.channel === 'query:progress' && e.event === 'query:start')).toHaveLength(2)
    expect(events.filter(e => e.event === 'query:complete')).toHaveLength(2)
  })

  it('skips Kojima when includeKojima is false', async () => {
    const results = await executeBatchQuery(['X-1'], false)
    expect(results[0].results.map(r => r.platform)).toEqual(['discogs', 'ebay', 'hmv', 'yahoo'])
    expect(mockQueryKojima).not.toHaveBeenCalled()
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
    expect(results[0].results).toHaveLength(5)
    expect(insertResultRun).toHaveBeenCalledTimes(5)
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
