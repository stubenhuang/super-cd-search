import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BrowserWindow } from 'electron'

const { mockCreateDiscogsListing, mockPublishToXianyu, mockIsBatchQueryRunning, mockGetSetting } = vi.hoisted(() => ({
  mockCreateDiscogsListing: vi.fn(),
  mockPublishToXianyu: vi.fn(),
  mockIsBatchQueryRunning: vi.fn(),
  mockGetSetting: vi.fn()
}))

vi.mock('../src/main/publish/discogs', () => ({
  createDiscogsListing: mockCreateDiscogsListing,
  verifyDiscogsCredentials: vi.fn(),
  searchReleaseCandidates: vi.fn()
}))
vi.mock('../src/main/publish/xianyu', () => ({
  publishToXianyu: mockPublishToXianyu,
  loginTargetProfile: vi.fn(),
  peekTargetLogin: vi.fn()
}))
vi.mock('../src/main/orchestrator', () => ({
  isBatchQueryRunning: mockIsBatchQueryRunning,
  executeBatchQuery: vi.fn(),
  cancelBatchQuery: vi.fn()
}))
vi.mock('../src/main/settings', () => ({ getSetting: mockGetSetting }))
vi.mock('../src/main/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import { runPublish, cancelPublish, isPublishRunning } from '../src/main/publish'
import type { PublishField, PublishRunRequest, PublishTarget } from '../src/shared/publish'
import type { XianyuPublishInput, XianyuPublishResult } from '../src/main/publish/xianyu'

const DISCOGS_TARGET: PublishTarget = {
  id: 'd-1',
  platform: 'discogs',
  name: '我的 Discogs',
  account: 'seller',
  enabled: true,
  createdAt: 1
}

const XIANYU_TARGET: PublishTarget = {
  id: 'x-1',
  platform: 'xianyu',
  name: '闲鱼小店',
  account: 'me',
  enabled: true,
  createdAt: 1
}

function setTargets(targets: PublishTarget[], token = ''): void {
  mockGetSetting.mockImplementation((key: string) => {
    if (key === 'publishTargets') return targets
    if (key === 'discogsToken') return token
    return undefined
  })
}

function field(key: string, value: string | number | boolean): PublishField {
  return { key, labelKey: `publish.field.${key}`, kind: 'text', value }
}

function runRequest(targetId: string, fields: PublishField[]): PublishRunRequest {
  return { targetId, catalogNumber: 'X-1', fields }
}

function discogsRequest(fields: PublishField[] = [field('release', '123'), field('condition', 'Very Good Plus (VG+)'), field('price', '19.99')]) {
  return runRequest('d-1', fields)
}

function xianyuRequest(fields: PublishField[] = [field('title', 'Album'), field('price', '99')]) {
  return runRequest('x-1', fields)
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function progressEvents(send: ReturnType<typeof vi.fn>) {
  return send.mock.calls
    .filter(([channel]) => channel === 'publish:progress')
    .map(([, payload]) => payload as { stage: string; message: string; targetId: string; catalogNumber: string; needsUserAction?: boolean })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsBatchQueryRunning.mockReturnValue(false)
  mockGetSetting.mockReturnValue([])
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([])
})

describe('runPublish: guards', () => {
  it('reports an unknown target as an error', async () => {
    setTargets([])
    const outcome = await runPublish(discogsRequest())
    expect(outcome).toEqual({
      status: 'error',
      platform: 'discogs',
      targetName: '',
      catalogNumber: 'X-1',
      error: '发布目标不存在，请到设置中重新配置'
    })
  })

  it('refuses to start while a publish is already running', async () => {
    setTargets([XIANYU_TARGET])
    const pending = deferred<XianyuPublishResult>()
    mockPublishToXianyu.mockReturnValue(pending.promise)

    const first = runPublish(xianyuRequest())
    expect(isPublishRunning()).toBe(true)
    const second = await runPublish(xianyuRequest())
    expect(second.status).toBe('error')
    expect(second.error).toContain('已有发布任务正在进行中')
    expect(second.platform).toBe('xianyu')
    expect(second.targetName).toBe('闲鱼小店')

    pending.resolve({ status: 'cancelled', artifacts: [], filled: [], missed: [], message: 'x' })
    expect((await first).status).toBe('cancelled')
    expect(isPublishRunning()).toBe(false)
  })

  it('refuses to start while a batch search is running', async () => {
    setTargets([XIANYU_TARGET])
    mockIsBatchQueryRunning.mockReturnValue(true)
    const outcome = await runPublish(xianyuRequest())
    expect(outcome.status).toBe('error')
    expect(outcome.error).toContain('搜索正在进行中')
    expect(mockPublishToXianyu).not.toHaveBeenCalled()
    expect(isPublishRunning()).toBe(false)
  })
})

describe('runPublish: discogs', () => {
  it('fails without a token', async () => {
    setTargets([DISCOGS_TARGET], '')
    const outcome = await runPublish(discogsRequest())
    expect(outcome.status).toBe('error')
    expect(outcome.error).toContain('Token')
    expect(mockCreateDiscogsListing).not.toHaveBeenCalled()
  })

  it('fails when no release is selected', async () => {
    setTargets([DISCOGS_TARGET], 'tok')
    const outcome = await runPublish(discogsRequest([field('condition', 'Very Good Plus (VG+)'), field('price', '19.99')]))
    expect(outcome.error).toBe('请选择要发布的 Discogs Release')
  })

  it('fails when no condition is selected', async () => {
    setTargets([DISCOGS_TARGET], 'tok')
    const outcome = await runPublish(discogsRequest([field('release', '123'), field('price', '19.99')]))
    expect(outcome.error).toBe('请选择唱片成色')
  })

  it('fails when the price is not a positive number', async () => {
    setTargets([DISCOGS_TARGET], 'tok')
    const zero = await runPublish(
      discogsRequest([field('release', '123'), field('condition', 'Very Good Plus (VG+)'), field('price', '0')])
    )
    expect(zero.error).toBe('价格必须是大于 0 的数字')

    const notANumber = await runPublish(
      discogsRequest([field('release', '123'), field('condition', 'Very Good Plus (VG+)'), field('price', 'abc')])
    )
    expect(notANumber.error).toBe('价格必须是大于 0 的数字')
    expect(mockCreateDiscogsListing).not.toHaveBeenCalled()
  })

  it('publishes and returns the listing id/url', async () => {
    setTargets([DISCOGS_TARGET], 'tok')
    mockCreateDiscogsListing.mockResolvedValue({
      listingId: '55',
      listingUrl: 'https://www.discogs.com/sell/item/55'
    })

    const outcome = await runPublish(discogsRequest())

    expect(outcome).toEqual({
      status: 'published',
      platform: 'discogs',
      targetName: '我的 Discogs',
      catalogNumber: 'X-1',
      listingId: '55',
      listingUrl: 'https://www.discogs.com/sell/item/55'
    })
    expect(mockCreateDiscogsListing).toHaveBeenCalledTimes(1)
    const [token, input, signal] = mockCreateDiscogsListing.mock.calls[0]!
    expect(token).toBe('tok')
    expect(input).toEqual({
      releaseId: 123,
      condition: 'Very Good Plus (VG+)',
      price: 19.99,
      status: 'For Sale',
      sleeveCondition: '',
      comments: '',
      allowOffers: false,
      externalId: '',
      location: '',
      weight: null,
      formatQuantity: null
    })
    expect(signal).toBeInstanceOf(AbortSignal)
    expect((signal as AbortSignal).aborted).toBe(false)
  })

  it('forwards every optional field from the form', async () => {
    setTargets([DISCOGS_TARGET], 'tok')
    mockCreateDiscogsListing.mockResolvedValue({ listingId: '1', listingUrl: 'u' })
    await runPublish(
      discogsRequest([
        field('release', '999'),
        field('condition', 'Near Mint (NM or M-)'),
        field('price', '10.5'),
        field('status', 'Draft'),
        field('sleeveCondition', 'Generic'),
        field('comments', '  hello  '),
        field('allowOffers', true),
        field('externalId', ' X-1 '),
        field('location', ' 上海 '),
        field('weight', '180.6'),
        field('formatQuantity', '2')
      ])
    )
    expect(mockCreateDiscogsListing.mock.calls[0]![1]).toEqual({
      releaseId: 999,
      condition: 'Near Mint (NM or M-)',
      price: 10.5,
      status: 'Draft',
      sleeveCondition: 'Generic',
      comments: 'hello',
      allowOffers: true,
      externalId: 'X-1',
      location: '上海',
      weight: 180.6,
      formatQuantity: 2
    })
  })

  it('turns a createDiscogsListing failure into an error outcome', async () => {
    setTargets([DISCOGS_TARGET], 'tok')
    mockCreateDiscogsListing.mockRejectedValue(new Error('Discogs 拒绝了该发布内容（422）'))
    const outcome = await runPublish(discogsRequest())
    expect(outcome.status).toBe('error')
    expect(outcome.error).toContain('422')
    expect(outcome.platform).toBe('discogs')
    expect(isPublishRunning()).toBe(false)
  })
})

describe('runPublish: xianyu', () => {
  it('returns a published outcome with the item URL', async () => {
    setTargets([XIANYU_TARGET])
    mockPublishToXianyu.mockResolvedValue({
      status: 'published',
      listingUrl: 'https://www.goofish.com/item?id=9',
      artifacts: ['/tmp/a.png'],
      filled: ['title'],
      missed: []
    })

    const outcome = await runPublish(xianyuRequest())

    expect(outcome.status).toBe('published')
    expect(outcome.listingUrl).toBe('https://www.goofish.com/item?id=9')
    expect(outcome.artifacts).toEqual(['/tmp/a.png'])
    expect(outcome.platform).toBe('xianyu')
  })

  it('drops a listing URL that points at the seller workbench', async () => {
    setTargets([XIANYU_TARGET])
    mockPublishToXianyu.mockResolvedValue({
      status: 'published',
      listingUrl: 'https://seller.goofish.com/',
      artifacts: [],
      filled: [],
      missed: []
    })
    const outcome = await runPublish(xianyuRequest())
    expect(outcome.status).toBe('published')
    expect(outcome).not.toHaveProperty('listingUrl')
  })

  it('maps a cancelled 闲鱼 run to a cancelled outcome with its message', async () => {
    setTargets([XIANYU_TARGET])
    mockPublishToXianyu.mockResolvedValue({
      status: 'cancelled',
      artifacts: [],
      filled: [],
      missed: ['title'],
      message: '等待超时：没有检测到发布成功'
    })
    const outcome = await runPublish(xianyuRequest())
    expect(outcome.status).toBe('cancelled')
    expect(outcome.error).toBe('等待超时：没有检测到发布成功')
    expect(outcome.platform).toBe('xianyu')
  })

  it('forwards the form fields and uploadCover to publishToXianyu', async () => {
    setTargets([{ ...XIANYU_TARGET, uploadCover: false }])
    mockPublishToXianyu.mockResolvedValue({ status: 'published', artifacts: [], filled: [], missed: [] })
    await runPublish(
      xianyuRequest([
        field('title', ' Album '),
        field('description', ' desc '),
        field('price', '99'),
        field('condition', '全新'),
        field('image', 'https://cdn/c.jpg')
      ])
    )
    const input = mockPublishToXianyu.mock.calls[0]![0] as XianyuPublishInput
    expect(input.targetId).toBe('x-1')
    expect(input.catalogNumber).toBe('X-1')
    expect(input.title).toBe('Album')
    expect(input.description).toBe('desc')
    expect(input.price).toBe('99')
    expect(input.condition).toBe('全新')
    expect(input.imageUrl).toBe('https://cdn/c.jpg')
    expect(input.uploadCover).toBe(false)
    expect(input.signal).toBeInstanceOf(AbortSignal)
    expect(input.onProgress).toBeTypeOf('function')
  })

  it('turns an unexpected rejection into a cancelled outcome when aborted', async () => {
    setTargets([XIANYU_TARGET])
    mockPublishToXianyu.mockImplementation(async () => {
      // Abort from the outside exactly like the UI's cancel button does.
      cancelPublish()
      await Promise.resolve()
      throw new Error('Aborted')
    })
    const outcome = await runPublish(xianyuRequest())
    expect(outcome.status).toBe('cancelled')
    expect(outcome.platform).toBe('xianyu')
  })

  it('turns a non-abort rejection into an error outcome', async () => {
    setTargets([XIANYU_TARGET])
    mockPublishToXianyu.mockRejectedValue(new Error('打不开闲鱼卖家工作台'))
    const outcome = await runPublish(xianyuRequest())
    expect(outcome.status).toBe('error')
    expect(outcome.error).toBe('打不开闲鱼卖家工作台')
  })
})

describe('runPublish: progress events', () => {
  it('emits preparing → done for a successful Discogs publish', async () => {
    const send = vi.fn()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { isDestroyed: () => false, webContents: { send } } as unknown as BrowserWindow
    ])
    setTargets([DISCOGS_TARGET], 'tok')
    mockCreateDiscogsListing.mockResolvedValue({ listingId: '1', listingUrl: 'u' })

    await runPublish(discogsRequest())

    const events = progressEvents(send)
    expect(events.length).toBeGreaterThan(0)
    expect(events[0]!.stage).toBe('preparing')
    expect(events.at(-1)!.stage).toBe('done')
    expect(events.at(-1)!.message).toContain('Discogs')
    expect(events.every(entry => entry.catalogNumber === 'X-1' && entry.targetId === 'd-1')).toBe(true)
  })

  it('marks the manual submit handoff for 闲鱼', async () => {
    const send = vi.fn()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { isDestroyed: () => false, webContents: { send } } as unknown as BrowserWindow
    ])
    setTargets([XIANYU_TARGET])
    mockPublishToXianyu.mockImplementation(async (input: XianyuPublishInput) => {
      input.onProgress('正在填写发布表单…')
      input.onProgress('请在浏览器窗口中确认并点击「发布」', true)
      return { status: 'published', artifacts: [], filled: [], missed: [] }
    })

    await runPublish(xianyuRequest())

    const events = progressEvents(send)
    expect(events.map(entry => entry.stage)).toContain('filling')
    expect(events.map(entry => entry.stage)).toContain('awaiting-user')
    expect(events.find(entry => entry.stage === 'awaiting-user')!.needsUserAction).toBe(true)
    expect(events.at(-1)!.stage).toBe('done')
  })

  it('emits an error stage when the publish fails', async () => {
    const send = vi.fn()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { isDestroyed: () => false, webContents: { send } } as unknown as BrowserWindow
    ])
    setTargets([DISCOGS_TARGET], 'tok')
    mockCreateDiscogsListing.mockRejectedValue(new Error('boom'))

    const outcome = await runPublish(discogsRequest())

    expect(outcome.status).toBe('error')
    const events = progressEvents(send)
    expect(events.at(-1)!.stage).toBe('error')
    expect(events.at(-1)!.message).toBe('boom')
  })

  it('skips destroyed windows', async () => {
    const send = vi.fn()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { isDestroyed: () => true, webContents: { send } } as unknown as BrowserWindow
    ])
    setTargets([DISCOGS_TARGET], 'tok')
    mockCreateDiscogsListing.mockResolvedValue({ listingId: '1', listingUrl: 'u' })

    await runPublish(discogsRequest())
    expect(send).not.toHaveBeenCalled()
  })
})

describe('cancelPublish / isPublishRunning', () => {
  it('aborts the signal handed to the running publish', async () => {
    setTargets([XIANYU_TARGET])
    const pending = deferred<XianyuPublishResult>()
    let captured: XianyuPublishInput | undefined
    mockPublishToXianyu.mockImplementation((input: XianyuPublishInput) => {
      captured = input
      return pending.promise
    })

    const running = runPublish(xianyuRequest())
    await Promise.resolve()
    expect(isPublishRunning()).toBe(true)
    expect(captured!.signal.aborted).toBe(false)

    cancelPublish()
    expect(captured!.signal.aborted).toBe(true)

    pending.resolve({ status: 'cancelled', artifacts: [], filled: [], missed: [], message: 'cancelled' })
    expect((await running).status).toBe('cancelled')
    expect(isPublishRunning()).toBe(false)
  })

  it('is a safe no-op when nothing is running', () => {
    expect(isPublishRunning()).toBe(false)
    expect(() => cancelPublish()).not.toThrow()
    expect(isPublishRunning()).toBe(false)
  })
})
