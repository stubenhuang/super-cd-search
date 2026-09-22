import { session } from 'electron'
import { SHIMO_PARTITION } from '../../shared/shimo'

/**
 * Cookie/storage session of the embedded 石墨文档 web page. It lives in a
 * dedicated persistent partition so it is fully isolated from the app's own
 * session and from the 闲鱼/淘宝 login Chrome profiles.
 */

/** Wipe the embedded page's session (cookies, storage) — the 退出登录 action. */
export async function clearShimoSession(): Promise<void> {
  const shimoSession = session.fromPartition(SHIMO_PARTITION)
  await shimoSession.clearStorageData()
}
