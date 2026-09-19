import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'

const {
  mockBuildPublishDraft,
  mockCancelPublish,
  mockForgetTarget,
  mockGetTargetStatus,
  mockListEnabledPublishTargets,
  mockLoginTarget,
  mockRunPublish,
  mockTestTarget
} = vi.hoisted(() => ({
  mockBuildPublishDraft: vi.fn(),
  mockCancelPublish: vi.fn(),
  mockForgetTarget: vi.fn(),
  mockGetTargetStatus: vi.fn(),
  mockListEnabledPublishTargets: vi.fn(),
  mockLoginTarget: vi.fn(),
  mockRunPublish: vi.fn(),
  mockTestTarget: vi.fn()
}))

vi.mock('../src/main/publish', () => ({
  buildPublishDraft: mockBuildPublishDraft,
  cancelPublish: mockCancelPublish,
  forgetTarget: mockForgetTarget,
  getTargetStatus: mockGetTargetStatus,
  listEnabledPublishTargets: mockListEnabledPublishTargets,
  loginTarget: mockLoginTarget,
  runPublish: mockRunPublish,
  testTarget: mockTestTarget
}))

import { registerPublishIpc } from '../src/main/ipc/publish'

function handler(channel: string) {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([registered]) => registered === channel)
  if (!call) throw new Error(`No handler registered for ${channel}`)
  return call[1]
}

const CHANNELS = [
  'publish:list-targets',
  'publish:test-target',
  'publish:target-status',
  'publish:login-target',
  'publish:forget-target',
  'publish:prepare',
  'publish:run',
  'publish:cancel'
]

beforeEach(() => {
  vi.clearAllMocks()
  registerPublishIpc()
})

describe('registerPublishIpc', () => {
  it('registers every publish channel exactly once', () => {
    for (const channel of CHANNELS) {
      expect(vi.mocked(ipcMain.handle).mock.calls.filter(([registered]) => registered === channel)).toHaveLength(1)
      expect(() => handler(channel)).not.toThrow()
    }
    expect(vi.mocked(ipcMain.handle)).toHaveBeenCalledTimes(CHANNELS.length)
  })

  it('publish:list-targets returns the enabled targets', async () => {
    const targets = [{ id: 't-1', platform: 'xianyu', name: '闲鱼', account: '', enabled: true, createdAt: 1 }]
    mockListEnabledPublishTargets.mockReturnValue(targets)
    expect(await handler('publish:list-targets')()).toEqual(targets)
  })
})

describe('publish:test-target', () => {
  it('forwards the target id to testTarget and returns its result', async () => {
    mockTestTarget.mockResolvedValue({ ok: true, message: '已连接：seller' })

    expect(await handler('publish:test-target')(null, 'd-1')).toEqual({ ok: true, message: '已连接：seller' })
    expect(mockTestTarget).toHaveBeenCalledTimes(1)
    expect(mockTestTarget).toHaveBeenCalledWith('d-1')
  })

  it('returns the per-target 闲鱼 failure unchanged', async () => {
    mockTestTarget.mockResolvedValue({ ok: false, message: '该目标尚未登录闲鱼：点「扫码登录」' })
    expect(await handler('publish:test-target')(null, 'x-1')).toEqual({
      ok: false,
      message: '该目标尚未登录闲鱼：点「扫码登录」'
    })
  })

  it('turns an internal Error failure into an ok:false result instead of rejecting', async () => {
    mockTestTarget.mockRejectedValue(new Error('network down'))
    await expect(handler('publish:test-target')(null, 'd-1')).resolves.toEqual({ ok: false, message: 'network down' })
  })

  it('stringifies non-Error failures', async () => {
    mockTestTarget.mockRejectedValue('plain failure')
    await expect(handler('publish:test-target')(null, 'x-1')).resolves.toEqual({ ok: false, message: 'plain failure' })
  })
})

describe('publish:target-status', () => {
  it('forwards the target id to getTargetStatus', async () => {
    const status = { state: 'logged_in', account: '闲鱼小铺', message: '该目标已登录闲鱼' }
    mockGetTargetStatus.mockResolvedValue(status)

    expect(await handler('publish:target-status')(null, 'x-1')).toBe(status)
    expect(mockGetTargetStatus).toHaveBeenCalledWith('x-1')
  })

  it('reports a readable logged_out status when the lookup throws', async () => {
    mockGetTargetStatus.mockRejectedValue(new Error('settings corrupted'))
    await expect(handler('publish:target-status')(null, 'x-1')).resolves.toEqual({
      state: 'logged_out',
      message: 'settings corrupted'
    })
  })
})

describe('publish:login-target', () => {
  it('forwards the target id to loginTarget', async () => {
    const result = { ok: true, account: '闲鱼小铺', message: '已登录：闲鱼小铺' }
    mockLoginTarget.mockResolvedValue(result)

    expect(await handler('publish:login-target')(null, 'x-1')).toBe(result)
    expect(mockLoginTarget).toHaveBeenCalledWith('x-1')
  })

  it('returns ok:false instead of rejecting when the login flow throws', async () => {
    mockLoginTarget.mockRejectedValue(new Error('chrome crashed'))
    await expect(handler('publish:login-target')(null, 'x-1')).resolves.toEqual({
      ok: false,
      message: 'chrome crashed'
    })
  })
})

describe('publish:forget-target', () => {
  it('forwards the target id to forgetTarget', async () => {
    const result = { ok: true, message: '已退出该目标的登录并清除其浏览器数据' }
    mockForgetTarget.mockResolvedValue(result)

    expect(await handler('publish:forget-target')(null, 'x-1')).toBe(result)
    expect(mockForgetTarget).toHaveBeenCalledWith('x-1')
  })

  it('returns ok:false instead of rejecting when the wipe throws', async () => {
    mockForgetTarget.mockRejectedValue(new Error('EBUSY'))
    await expect(handler('publish:forget-target')(null, 'x-1')).resolves.toEqual({ ok: false, message: 'EBUSY' })
  })
})

describe('publish:prepare', () => {
  it('forwards the request to buildPublishDraft and returns the draft', async () => {
    const draft = { targetId: 't-1', platform: 'xianyu', fields: [], meta: {}, warnings: [], blockers: [] }
    mockBuildPublishDraft.mockResolvedValue(draft)
    const request = { catalogNumber: 'X-1', targetId: 't-1', results: [], descriptionText: 'd' }

    expect(await handler('publish:prepare')(null, request)).toBe(draft)
    expect(mockBuildPublishDraft).toHaveBeenCalledWith(request)
  })
})

describe('publish:run', () => {
  it('returns the outcome unchanged', async () => {
    const outcome = { status: 'published', platform: 'discogs', targetName: 'D', catalogNumber: 'X-1', listingId: '1' }
    mockRunPublish.mockResolvedValue(outcome)
    const request = { targetId: 'd-1', catalogNumber: 'X-1', fields: [] }

    expect(await handler('publish:run')(null, request)).toBe(outcome)
    expect(mockRunPublish).toHaveBeenCalledWith(request)
  })
})

describe('publish:cancel', () => {
  it('calls cancelPublish', () => {
    handler('publish:cancel')()
    expect(mockCancelPublish).toHaveBeenCalledTimes(1)
  })
})
