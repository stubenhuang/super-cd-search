import { logger } from '../logger'
import type {
  PublishTarget,
  PublishTargetLoginResult,
  PublishTargetStatus,
  PublishTargetTestResult
} from '../../shared/publish'
import { closePublishProfile, peekPublishProfileLogin, publishProfileId } from './profiles'
import {
  discogsTokenFingerprint,
  getPublishTarget,
  patchPublishTarget,
  resolveDiscogsToken
} from './targets'
import { loginTargetProfile } from './xianyu'
import { verifyDiscogsCredentials } from './discogs'

/**
 * Per-target login/credential operations for the settings page.
 *
 * Each 闲鱼 target owns a separate Chrome profile, so its login is completely
 * independent of both the other targets and the search channel's session.
 * Discogs has no session at all: its credential is the target's own token, and
 * 「已登录」 means that token was verified against `/oauth/identity`.
 */

const NOT_STARTED_HINT = '该目标还没有启动过独立浏览器：点「扫码登录」用这个目标自己的闲鱼账号登录'

/**
 * Last Discogs probe per target, so flipping through the settings page does not
 * re-check every target against the API. A SUCCESSFUL check also lands in
 * `tokenFingerprint` on disk, which is what keeps the switch unlocked without
 * network access; this cache only spares a repeated round trip.
 */
const PROBE_TTL_MS = 60_000
const probeCache = new Map<string, { status: PublishTargetStatus; at: number }>()

function invalidateProbe(targetId: string): void {
  probeCache.delete(targetId)
}

/** Test seam: a fresh process (or a new suite) must not inherit probe results. */
export function resetTargetStatusCache(): void {
  probeCache.clear()
}

/**
 * Whether the stored token has already been verified. A successful probe writes
 * the fingerprint, so this is a pure comparison: edit the token and it stops
 * matching, which is exactly「改过就得重新验证」.
 */
function hasVerifiedToken(target: PublishTarget): boolean {
  const token = (target.token ?? '').trim()
  if (!token) return false
  return (target.tokenFingerprint ?? '') === discogsTokenFingerprint(token)
}

/** Persist the account the token belongs to, plus the proof it was verified. */
function rememberDiscogsCredential(targetId: string, token: string, account?: string): void {
  patchPublishTarget(targetId, {
    tokenFingerprint: discogsTokenFingerprint(token),
    ...(account ? { account } : {})
  })
}

/**
 * Verify this target's own token against Discogs.
 *
 * `/oauth/identity` both validates the credential and reports which account it
 * belongs to, so a success is the only thing that unlocks the target. A failure
 * is cached briefly (so the settings page cannot hammer the API) but never
 * written to disk — the next visit retries.
 */
async function probeDiscogs(targetId: string, token: string): Promise<PublishTargetStatus> {
  const cached = probeCache.get(targetId)
  if (cached && Date.now() - cached.at < PROBE_TTL_MS) return cached.status

  const result = await verifyDiscogsCredentials(token)
  const status: PublishTargetStatus = result.ok
    ? {
        state: 'logged_in',
        ...(result.account ? { account: result.account } : {}),
        message: result.account ? `已通过校验：${result.account}` : 'Discogs Token 已通过校验'
      }
    : { state: 'logged_out', message: `${result.message}；请检查 Token 后重试` }

  if (result.ok) {
    // The fingerprint is durable proof of this verification, so the cache entry
    // is not needed afterwards.
    rememberDiscogsCredential(targetId, token, result.account)
  } else {
    probeCache.set(targetId, { status, at: Date.now() })
  }
  return status
}

export async function getTargetStatus(targetId: string): Promise<PublishTargetStatus> {
  const target = getPublishTarget(targetId)
  if (!target) return { state: 'logged_out', message: '发布目标不存在' }

  if (target.platform === 'discogs') {
    const token = resolveDiscogsToken(target)
    if (!token) {
      return {
        state: 'not_started',
        message: '未配置专用 Token：每个 Discogs 目标都需要自己的 Token，请点「编辑」填写'
      }
    }
    if (hasVerifiedToken(target)) {
      return target.account
        ? { state: 'logged_in', account: target.account, message: `已通过校验：${target.account}` }
        : { state: 'logged_in', message: 'Discogs Token 已通过校验' }
    }
    return probeDiscogs(targetId, token)
  }

  const snapshot = await peekPublishProfileLogin(publishProfileId(targetId))
  if (!snapshot) {
    const remembered = target.account
    return {
      state: 'not_started',
      ...(remembered ? { account: remembered } : {}),
      message: remembered ? `${NOT_STARTED_HINT}（上次登录：${remembered}）` : NOT_STARTED_HINT
    }
  }

  if (snapshot.state === 'logged_in') {
    return { state: 'logged_in', ...(snapshot.account ? { account: snapshot.account } : {}), message: '该目标已登录闲鱼' }
  }
  if (snapshot.state === 'expired') {
    return { state: 'logged_out', message: '该目标的闲鱼登录已过期：请重新「扫码登录」' }
  }
  return { state: 'logged_out', message: '该目标尚未登录闲鱼：点「扫码登录」' }
}

/** Open the target's own Chrome and wait for the QR login to complete. */
export async function loginTarget(targetId: string): Promise<PublishTargetLoginResult> {
  const target = getPublishTarget(targetId)
  if (!target) return { ok: false, message: '发布目标不存在' }
  if (target.platform !== 'xianyu') {
    return { ok: false, message: 'Discogs 目标不需要扫码登录，请用「测试连接」验证凭据' }
  }

  logger.info('publish.targets', 'publish target login started', { targetId })
  const result = await loginTargetProfile(targetId)
  if (result.ok) {
    // The detected nickname becomes the target's account; there is no manual
    // account field to keep in sync. `xianyuLoginAt` is what keeps the target
    //「就绪」after a restart, when its Chrome session is gone.
    patchPublishTarget(targetId, {
      xianyuLoginAt: Date.now(),
      ...(result.account ? { account: result.account } : {})
    })
    invalidateProbe(targetId)
  }
  return result
}

/**
 * 「退出登录」/ delete cleanup: close this target's Chrome and wipe its stored
 * login. The target configuration itself is untouched apart from the login
 * markers, which are dropped so the enable switch locks again.
 */
export async function forgetTarget(targetId: string): Promise<PublishTargetLoginResult> {
  const target = getPublishTarget(targetId)
  if (!target) return { ok: false, message: '发布目标不存在' }
  await closePublishProfile(publishProfileId(targetId), { wipe: true })
  if (target.platform === 'xianyu') {
    patchPublishTarget(targetId, { account: '', xianyuLoginAt: undefined })
  }
  invalidateProbe(targetId)
  logger.info('publish.targets', 'publish target login cleared', { targetId })
  return { ok: true, message: '已退出该目标的登录并清除其浏览器数据' }
}

/** 测试连接 for one target, using its own credentials/profile. */
export async function testTarget(targetId: string): Promise<PublishTargetTestResult> {
  const target = getPublishTarget(targetId)
  if (!target) return { ok: false, message: '发布目标不存在' }

  if (target.platform === 'discogs') {
    // `/oauth/identity` validates the token and reports which account it
    // belongs to, so the user never has to type the username.
    const token = resolveDiscogsToken(target)
    const result = await verifyDiscogsCredentials(token)
    if (result.ok && token) rememberDiscogsCredential(targetId, token, result.account)
    invalidateProbe(targetId)
    return result
  }

  const snapshot = await peekPublishProfileLogin(publishProfileId(targetId))
  if (!snapshot) {
    return { ok: false, message: '该目标的 Chrome 未启动：点「扫码登录」启动并用该目标自己的闲鱼账号登录' }
  }
  if (snapshot.state === 'logged_in') {
    if (snapshot.account) patchPublishTarget(targetId, { account: snapshot.account })
    invalidateProbe(targetId)
    return {
      ok: true,
      ...(snapshot.account ? { account: snapshot.account } : {}),
      message: snapshot.account ? `该目标已登录闲鱼：${snapshot.account}` : '该目标已登录闲鱼'
    }
  }
  if (snapshot.state === 'expired') return { ok: false, message: '该目标的闲鱼登录已过期：请重新「扫码登录」' }
  return { ok: false, message: '该目标尚未登录闲鱼：点「扫码登录」' }
}
