import { logger } from '../logger'
import type { PublishTargetLoginResult, PublishTargetStatus, PublishTargetTestResult } from '../../shared/publish'
import { closePublishProfile, peekPublishProfileLogin, publishProfileId } from './profiles'
import { getPublishTarget, patchPublishTarget, resolveDiscogsToken } from './targets'
import { loginTargetProfile } from './xianyu'
import { verifyDiscogsCredentials } from './discogs'

/**
 * Per-target login/credential operations for the settings page.
 *
 * Each 闲鱼 target owns a separate Chrome profile, so its login is completely
 * independent of both the other targets and the search channel's session.
 */

const NOT_STARTED_HINT = '该目标还没有启动过独立浏览器：点「扫码登录」用这个目标自己的闲鱼账号登录'

export async function getTargetStatus(targetId: string): Promise<PublishTargetStatus> {
  const target = getPublishTarget(targetId)
  if (!target) return { state: 'logged_out', message: '发布目标不存在' }

  if (target.platform === 'discogs') {
    const token = resolveDiscogsToken(target)
    if (!token) return { state: 'logged_out', message: '未配置 Discogs Token（可在「API 令牌」分区或本目标内填写）' }
    return target.account
      ? { state: 'logged_in', account: target.account, message: `凭据已配置：${target.account}（可点「测试连接」重新验证）` }
      : { state: 'logged_in', message: '已配置 Discogs Token；点「测试连接」可自动识别账号' }
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
    // account field to keep in sync.
    patchPublishTarget(targetId, {
      xianyuLoginAt: Date.now(),
      ...(result.account ? { account: result.account } : {})
    })
  }
  return result
}

/**
 * 「退出登录」/ delete cleanup: close this target's Chrome and wipe its stored
 * login. The target configuration itself is untouched.
 */
export async function forgetTarget(targetId: string): Promise<PublishTargetLoginResult> {
  const target = getPublishTarget(targetId)
  if (!target) return { ok: false, message: '发布目标不存在' }
  await closePublishProfile(publishProfileId(targetId), { wipe: true })
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
    const result = await verifyDiscogsCredentials(resolveDiscogsToken(target))
    if (result.ok && result.account) patchPublishTarget(targetId, { account: result.account })
    return result
  }

  const snapshot = await peekPublishProfileLogin(publishProfileId(targetId))
  if (!snapshot) {
    return { ok: false, message: '该目标的 Chrome 未启动：点「扫码登录」启动并用该目标自己的闲鱼账号登录' }
  }
  if (snapshot.state === 'logged_in') {
    if (snapshot.account) patchPublishTarget(targetId, { account: snapshot.account })
    return {
      ok: true,
      ...(snapshot.account ? { account: snapshot.account } : {}),
      message: snapshot.account ? `该目标已登录闲鱼：${snapshot.account}` : '该目标已登录闲鱼'
    }
  }
  if (snapshot.state === 'expired') return { ok: false, message: '该目标的闲鱼登录已过期：请重新「扫码登录」' }
  return { ok: false, message: '该目标尚未登录闲鱼：点「扫码登录」' }
}
