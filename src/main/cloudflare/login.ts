import type { LoginPlatform } from '../../shared/types'

/**
 * Per-platform login definitions for the shared real-Chrome window.
 *
 * Cloudflare-protected platforms verify via the cf_clearance cookie set after
 * the challenge; the marketplace channels (taobao/xianyu) verify via the
 * Taobao SSO user cookies (`unb` is the member id, `tracknick` the nickname)
 * that only exist after a successful QR-code login.
 */
export interface LoginDefinition {
  /** Page opened when the user starts a login/verification flow. */
  loginUrl: string
  /**
   * URL whose cookie jar scope the platform's login cookies live in. Cookie
   * checks must pass this URL explicitly: `page.cookies()` without arguments
   * only returns cookies for the shared page's *current* URL, which after a
   * login on another platform would wrongly report this one as logged out.
   */
  cookieUrl: string
  /** Cookie domain suffix that must carry the login cookies. */
  domainSuffix: string
  /** Any of these cookies present (unexpired) counts as logged in. */
  cookieNames: string[]
}

export const LOGIN_DEFS: Record<LoginPlatform, LoginDefinition> = {
  surugaya: {
    loginUrl: 'https://www.suruga-ya.jp/',
    cookieUrl: 'https://www.suruga-ya.jp/',
    domainSuffix: 'suruga-ya.jp',
    cookieNames: ['cf_clearance']
  },
  zenmarket: {
    loginUrl: 'https://zenmarket.jp/',
    cookieUrl: 'https://zenmarket.jp/',
    domainSuffix: 'zenmarket.jp',
    cookieNames: ['cf_clearance']
  },
  taobao: {
    loginUrl: 'https://login.taobao.com/member/login.jhtml',
    cookieUrl: 'https://www.taobao.com/',
    domainSuffix: 'taobao.com',
    cookieNames: ['unb', 'tracknick']
  },
  xianyu: {
    loginUrl: 'https://www.goofish.com/',
    cookieUrl: 'https://www.goofish.com/',
    domainSuffix: 'goofish.com',
    cookieNames: ['unb']
  }
}

export function isCloudflareLoginPlatform(platform: LoginPlatform): boolean {
  return platform === 'surugaya' || platform === 'zenmarket'
}

/** Minimal structural shape of a Puppeteer cookie, for pure testing. */
export interface LoginCookie {
  name: string
  value: string
  domain: string
  /** Unix seconds; session cookies use a non-positive value. */
  expires?: number
}

export type LoginState = 'logged_in' | 'expired' | 'logged_out'

/**
 * Derive the login state for one platform from the browser's cookies. A
 * matching cookie that has already expired (unix seconds in the past) maps to
 * 'expired' so the UI can ask for a re-login instead of a first login.
 */
export function checkLoginState(cookies: LoginCookie[], def: LoginDefinition, nowMs: number = Date.now()): LoginState {
  const candidates = cookies.filter(
    c => def.cookieNames.includes(c.name) && c.domain.includes(def.domainSuffix) && c.value
  )
  if (candidates.length === 0) return 'logged_out'
  const nowSec = nowMs / 1000
  const active = candidates.find(c => !(typeof c.expires === 'number' && c.expires > 0 && c.expires <= nowSec))
  return active ? 'logged_in' : 'expired'
}
