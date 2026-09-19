import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockPeekPublishProfileLogin,
  mockClosePublishProfile,
  mockLoginTargetProfile,
  mockVerifyDiscogsCredentials,
  mockStore
} = vi.hoisted(() => ({
  mockPeekPublishProfileLogin: vi.fn(),
  mockClosePublishProfile: vi.fn(),
  mockLoginTargetProfile: vi.fn(),
  mockVerifyDiscogsCredentials: vi.fn(),
  mockStore: { data: {} as Record<string, unknown> }
}))

vi.mock('../src/main/publish/profiles', () => ({
  publishProfileId: (id: string) => `target-${id}`,
  peekPublishProfileLogin: mockPeekPublishProfileLogin,
  closePublishProfile: mockClosePublishProfile
}))
vi.mock('../src/main/publish/xianyu', () => ({ loginTargetProfile: mockLoginTargetProfile }))
vi.mock('../src/main/publish/discogs', () => ({ verifyDiscogsCredentials: mockVerifyDiscogsCredentials }))
// An in-memory settings store lets the REAL targets module do the persistence
// work (normalize + patch + resolve), which is what this suite is checking.
vi.mock('../src/main/settings', () => ({
  getSetting: (key: string) => mockStore.data[key],
  updateSettings: (values: Record<string, unknown>) => {
    Object.assign(mockStore.data, values)
  }
}))

import { forgetTarget, getTargetStatus, loginTarget, resetTargetStatusCache, testTarget } from '../src/main/publish/status'
import { discogsTokenFingerprint, getPublishTarget } from '../src/main/publish/targets'

const XIANYU_TARGET = {
  id: 'x-1',
  platform: 'xianyu',
  name: '闲鱼小店',
  account: 'me',
  enabled: true,
  createdAt: 1
}

const DISCOGS_TARGET = {
  id: 'd-1',
  platform: 'discogs',
  name: '我的 Discogs',
  account: 'seller',
  enabled: true,
  createdAt: 1
}

function setTargets(targets: unknown[]): void {
  mockStore.data.publishTargets = targets
}

beforeEach(() => {
  vi.clearAllMocks()
  mockStore.data = {}
  resetTargetStatusCache()
  mockPeekPublishProfileLogin.mockResolvedValue(null)
  mockClosePublishProfile.mockResolvedValue(undefined)
  mockLoginTargetProfile.mockResolvedValue({ ok: false, message: 'not configured' })
  mockVerifyDiscogsCredentials.mockResolvedValue({ ok: true, account: 'seller', message: '已连接：seller' })
})

describe('getTargetStatus: unknown target', () => {
  it('reports an unknown target as logged_out', async () => {
    setTargets([])
    await expect(getTargetStatus('missing')).resolves.toEqual({ state: 'logged_out', message: '发布目标不存在' })
    expect(mockPeekPublishProfileLogin).not.toHaveBeenCalled()
  })
})

describe('getTargetStatus: discogs', () => {
  it('reports a missing per-target token as not_started (no global fallback)', async () => {
    mockStore.data.discogsToken = ''
    setTargets([DISCOGS_TARGET])
    await expect(getTargetStatus('d-1')).resolves.toEqual({
      state: 'not_started',
      message: '未配置专用 Token：每个 Discogs 目标都需要自己的 Token，请点「编辑」填写'
    })
    expect(mockVerifyDiscogsCredentials).not.toHaveBeenCalled()
  })

  it('copies the global token into a tokenless target once, then still re-verifies it', async () => {
    mockStore.data.discogsToken = 'global-token'
    setTargets([{ ...DISCOGS_TARGET, token: '', account: '' }])

    // The migration makes the old global token this target's own token, so the
    // user is not silently locked out after the fallback was removed...
    await getTargetStatus('d-1')
    expect(mockVerifyDiscogsCredentials).toHaveBeenCalledWith('global-token')
    // ...but it is not trusted until it has actually been checked.
    expect(getPublishTarget('d-1')?.token).toBe('global-token')
  })

  it('verifies an unverified token and persists its account + fingerprint', async () => {
    setTargets([{ ...DISCOGS_TARGET, token: 'tok', account: '' }])
    await expect(getTargetStatus('d-1')).resolves.toEqual({
      state: 'logged_in',
      account: 'seller',
      message: '已通过校验：seller'
    })
    expect(mockVerifyDiscogsCredentials).toHaveBeenCalledWith('tok')
    expect(getPublishTarget('d-1')?.tokenFingerprint).toBe(discogsTokenFingerprint('tok'))
  })

  it('trusts a matching fingerprint without calling Discogs again', async () => {
    setTargets([{ ...DISCOGS_TARGET, token: 'tok', tokenFingerprint: discogsTokenFingerprint('tok') }])
    await expect(getTargetStatus('d-1')).resolves.toEqual({
      state: 'logged_in',
      account: 'seller',
      message: '已通过校验：seller'
    })
    expect(mockVerifyDiscogsCredentials).not.toHaveBeenCalled()
  })

  it('re-verifies after the token changed (stale fingerprint)', async () => {
    setTargets([{ ...DISCOGS_TARGET, token: 'tok-new', tokenFingerprint: discogsTokenFingerprint('tok-old') }])
    const status = await getTargetStatus('d-1')
    expect(status.state).toBe('logged_in')
    expect(mockVerifyDiscogsCredentials).toHaveBeenCalledWith('tok-new')
    expect(getPublishTarget('d-1')?.tokenFingerprint).toBe(discogsTokenFingerprint('tok-new'))
  })

  it('reports a rejected token as logged_out without unlocking it', async () => {
    mockVerifyDiscogsCredentials.mockResolvedValue({ ok: false, message: 'Discogs 认证失败（401）：Token 无效或权限不足' })
    setTargets([{ ...DISCOGS_TARGET, token: 'bad', account: '' }])

    await expect(getTargetStatus('d-1')).resolves.toEqual({
      state: 'logged_out',
      message: 'Discogs 认证失败（401）：Token 无效或权限不足；请检查 Token 后重试'
    })
    expect(getPublishTarget('d-1')?.tokenFingerprint).toBeUndefined()
  })

  it('caches a failed probe briefly so the settings page cannot hammer the API', async () => {
    mockVerifyDiscogsCredentials.mockResolvedValue({ ok: false, message: '网络错误' })
    setTargets([{ ...DISCOGS_TARGET, token: 'tok', account: '' }])

    await getTargetStatus('d-1')
    await getTargetStatus('d-1')
    expect(mockVerifyDiscogsCredentials).toHaveBeenCalledTimes(1)
  })
})

describe('getTargetStatus: xianyu', () => {
  it('reports not_started and remembers the last account when the profile is not running', async () => {
    setTargets([{ ...XIANYU_TARGET, account: '闲鱼小铺' }])
    mockPeekPublishProfileLogin.mockResolvedValue(null)

    await expect(getTargetStatus('x-1')).resolves.toEqual({
      state: 'not_started',
      account: '闲鱼小铺',
      message: '该目标还没有启动过独立浏览器：点「扫码登录」用这个目标自己的闲鱼账号登录（上次登录：闲鱼小铺）'
    })
    expect(mockPeekPublishProfileLogin).toHaveBeenCalledWith('target-x-1')
  })

  it('reports not_started with the scan hint when no account was ever detected', async () => {
    setTargets([{ ...XIANYU_TARGET, account: '' }])
    mockPeekPublishProfileLogin.mockResolvedValue(null)

    const status = await getTargetStatus('x-1')
    expect(status).toEqual({
      state: 'not_started',
      message: '该目标还没有启动过独立浏览器：点「扫码登录」用这个目标自己的闲鱼账号登录'
    })
    expect(status.account).toBeUndefined()
  })

  it('reports a running logged_in profile with its account', async () => {
    setTargets([XIANYU_TARGET])
    mockPeekPublishProfileLogin.mockResolvedValue({ state: 'logged_in', account: '闲鱼小铺' })

    await expect(getTargetStatus('x-1')).resolves.toEqual({
      state: 'logged_in',
      account: '闲鱼小铺',
      message: '该目标已登录闲鱼'
    })
  })

  it('omits the account when the profile is logged in but unnamed', async () => {
    setTargets([XIANYU_TARGET])
    mockPeekPublishProfileLogin.mockResolvedValue({ state: 'logged_in', account: '' })

    const status = await getTargetStatus('x-1')
    expect(status.state).toBe('logged_in')
    expect(status.account).toBeUndefined()
  })

  it('reports an expired profile', async () => {
    setTargets([XIANYU_TARGET])
    mockPeekPublishProfileLogin.mockResolvedValue({ state: 'expired', account: '' })

    await expect(getTargetStatus('x-1')).resolves.toEqual({
      state: 'logged_out',
      message: '该目标的闲鱼登录已过期：请重新「扫码登录」'
    })
  })

  it('reports a running but logged_out profile', async () => {
    setTargets([XIANYU_TARGET])
    mockPeekPublishProfileLogin.mockResolvedValue({ state: 'logged_out', account: '' })

    await expect(getTargetStatus('x-1')).resolves.toEqual({
      state: 'logged_out',
      message: '该目标尚未登录闲鱼：点「扫码登录」'
    })
  })
})

describe('loginTarget', () => {
  it('reports an unknown target without starting Chrome', async () => {
    setTargets([])
    await expect(loginTarget('missing')).resolves.toEqual({ ok: false, message: '发布目标不存在' })
    expect(mockLoginTargetProfile).not.toHaveBeenCalled()
  })

  it('tells a Discogs target that there is nothing to scan', async () => {
    setTargets([DISCOGS_TARGET])
    await expect(loginTarget('d-1')).resolves.toEqual({
      ok: false,
      message: 'Discogs 目标不需要扫码登录，请用「测试连接」验证凭据'
    })
    expect(mockLoginTargetProfile).not.toHaveBeenCalled()
  })

  it('persists the detected account and login time after a successful scan', async () => {
    setTargets([XIANYU_TARGET])
    mockLoginTargetProfile.mockResolvedValue({ ok: true, account: '闲鱼小铺', message: '已登录：闲鱼小铺' })

    await expect(loginTarget('x-1')).resolves.toEqual({ ok: true, account: '闲鱼小铺', message: '已登录：闲鱼小铺' })
    expect(mockLoginTargetProfile).toHaveBeenCalledWith('x-1')

    const stored = getPublishTarget('x-1')!
    expect(stored.account).toBe('闲鱼小铺')
    expect(stored.xianyuLoginAt).toBeGreaterThan(0)
  })

  it('persists only the login time when the scan detected no account', async () => {
    setTargets([{ ...XIANYU_TARGET, account: '' }])
    mockLoginTargetProfile.mockResolvedValue({ ok: true, message: '已登录闲鱼' })

    await expect(loginTarget('x-1')).resolves.toEqual({ ok: true, message: '已登录闲鱼' })

    const stored = getPublishTarget('x-1')!
    expect(stored.account).toBe('')
    expect(stored.xianyuLoginAt).toBeGreaterThan(0)
  })

  it('does not touch the stored account when the scan failed', async () => {
    setTargets([XIANYU_TARGET])
    mockLoginTargetProfile.mockResolvedValue({ ok: false, message: 'Chrome 窗口已关闭，登录未完成' })

    await expect(loginTarget('x-1')).resolves.toEqual({ ok: false, message: 'Chrome 窗口已关闭，登录未完成' })

    const stored = getPublishTarget('x-1')!
    expect(stored.account).toBe('me')
    expect(stored.xianyuLoginAt).toBeUndefined()
  })
})

describe('forgetTarget', () => {
  it('wipes the target own Chrome profile and locks it again', async () => {
    setTargets([{ ...XIANYU_TARGET, xianyuLoginAt: 123 }])
    await expect(forgetTarget('x-1')).resolves.toEqual({
      ok: true,
      message: '已退出该目标的登录并清除其浏览器数据'
    })
    expect(mockClosePublishProfile).toHaveBeenCalledTimes(1)
    expect(mockClosePublishProfile).toHaveBeenCalledWith('target-x-1', { wipe: true })
    // Logging out drops the login markers, so the enable switch locks again.
    const after = getPublishTarget('x-1')
    expect(after?.xianyuLoginAt).toBeUndefined()
    expect(after?.account).toBe('')
  })

  it('does nothing for an unknown target', async () => {
    setTargets([])
    await expect(forgetTarget('missing')).resolves.toEqual({ ok: false, message: '发布目标不存在' })
    expect(mockClosePublishProfile).not.toHaveBeenCalled()
  })
})

describe('testTarget', () => {
  it('reports an unknown target', async () => {
    setTargets([])
    await expect(testTarget('missing')).resolves.toEqual({ ok: false, message: '发布目标不存在' })
  })

  it('verifies a tokenless target against the migrated global token', async () => {
    // The target has no token of its own, so the read-time migration adopts the
    // global one;「测试连接」then verifies that adopted value.
    mockStore.data.discogsToken = '  global-tok  '
    setTargets([DISCOGS_TARGET])

    await expect(testTarget('d-1')).resolves.toEqual({ ok: true, account: 'seller', message: '已连接：seller' })
    expect(mockVerifyDiscogsCredentials).toHaveBeenCalledWith('global-tok')
    expect(mockPeekPublishProfileLogin).not.toHaveBeenCalled()
    expect(getPublishTarget('d-1')?.token).toBe('global-tok')
  })

  it('uses the per-target token and persists the account plus its fingerprint', async () => {
    mockStore.data.discogsToken = 'global-tok'
    setTargets([{ ...DISCOGS_TARGET, account: '', token: 'target-tok' }])
    mockVerifyDiscogsCredentials.mockResolvedValue({ ok: true, account: 'other-seller', message: '已连接：other-seller' })

    await expect(testTarget('d-1')).resolves.toEqual({
      ok: true,
      account: 'other-seller',
      message: '已连接：other-seller'
    })
    expect(mockVerifyDiscogsCredentials).toHaveBeenCalledWith('target-tok')
    expect(getPublishTarget('d-1')?.account).toBe('other-seller')
    // The fingerprint is what unlocks the enable switch.
    expect(getPublishTarget('d-1')?.tokenFingerprint).toBe(discogsTokenFingerprint('target-tok'))
  })

  it('keeps the stored account when the Discogs verification fails', async () => {
    mockStore.data.discogsToken = 'global-tok'
    setTargets([DISCOGS_TARGET])
    mockVerifyDiscogsCredentials.mockResolvedValue({
      ok: false,
      message: 'Discogs 认证失败（401）：Token 无效或权限不足'
    })

    await expect(testTarget('d-1')).resolves.toEqual({
      ok: false,
      message: 'Discogs 认证失败（401）：Token 无效或权限不足'
    })
    expect(mockVerifyDiscogsCredentials).toHaveBeenCalledWith('global-tok')
    // The stored account survives, but no fingerprint is written, so the target
    // stays locked until a check actually succeeds.
    expect(getPublishTarget('d-1')?.account).toBe('seller')
    expect(getPublishTarget('d-1')?.tokenFingerprint).toBeUndefined()
  })

  it('asks the user to start the target Chrome when the profile is not running', async () => {
    setTargets([XIANYU_TARGET])
    mockPeekPublishProfileLogin.mockResolvedValue(null)

    await expect(testTarget('x-1')).resolves.toEqual({
      ok: false,
      message: '该目标的 Chrome 未启动：点「扫码登录」启动并用该目标自己的闲鱼账号登录'
    })
  })

  it('reports a running logged_in profile with its account', async () => {
    setTargets([XIANYU_TARGET])
    mockPeekPublishProfileLogin.mockResolvedValue({ state: 'logged_in', account: '闲鱼小铺' })

    await expect(testTarget('x-1')).resolves.toEqual({
      ok: true,
      account: '闲鱼小铺',
      message: '该目标已登录闲鱼：闲鱼小铺'
    })
    expect(getPublishTarget('x-1')?.account).toBe('闲鱼小铺')
  })

  it('reports a running logged_in profile without an account', async () => {
    setTargets([XIANYU_TARGET])
    mockPeekPublishProfileLogin.mockResolvedValue({ state: 'logged_in', account: '' })

    await expect(testTarget('x-1')).resolves.toEqual({ ok: true, message: '该目标已登录闲鱼' })
  })

  it('reports an expired profile', async () => {
    setTargets([XIANYU_TARGET])
    mockPeekPublishProfileLogin.mockResolvedValue({ state: 'expired', account: '' })

    await expect(testTarget('x-1')).resolves.toEqual({
      ok: false,
      message: '该目标的闲鱼登录已过期：请重新「扫码登录」'
    })
  })

  it('reports a logged_out profile', async () => {
    setTargets([XIANYU_TARGET])
    mockPeekPublishProfileLogin.mockResolvedValue({ state: 'logged_out', account: '' })

    await expect(testTarget('x-1')).resolves.toEqual({ ok: false, message: '该目标尚未登录闲鱼：点「扫码登录」' })
  })
})
