/**
 * Cookie-driven login detection for the goofish (闲鱼) seller workbench.
 *
 * 闲鱼 publishing drives a real Chrome per target (see profiles.ts); the
 * session is identified by the Taobao SSO member cookie `unb` (and the
 * `tracknick` nickname) that only exists after a successful QR-code login.
 * These helpers are the only thing publishing needs from the old login
 * definitions — the marketplace search channels that shared them are gone.
 */

/** Minimal structural shape of a Puppeteer cookie, for pure testing. */
export interface LoginCookie {
  name: string
  value: string
  domain: string
  /** Unix seconds; session cookies use a non-positive value. */
  expires?: number
}

export interface LoginDefinition {
  /** URL whose cookie jar scope the login cookies live in. */
  cookieUrl: string
  /** Cookie domain suffix that must carry the login cookies. */
  domainSuffix: string
  /** Any of these cookies present (unexpired) counts as logged in. */
  cookieNames: string[]
}

export const LOGIN_DEFS: { xianyu: LoginDefinition } = {
  xianyu: {
    cookieUrl: 'https://www.goofish.com/',
    domainSuffix: 'goofish.com',
    cookieNames: ['unb']
  }
}

export type LoginState = 'logged_in' | 'expired' | 'logged_out'

/**
 * Derive the login state from the browser's cookies. A matching cookie that
 * has already expired (unix seconds in the past) maps to 'expired' so the UI
 * can ask for a re-login instead of a first login.
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
