/**
 * Shared helpers for the embedded 石墨文档 web page.
 *
 * The 石墨文档 tab embeds the real shimo.im web app inside an Electron
 * `<webview>` (a personal 石墨 account has no open API, so the web app itself
 * is the integration surface). Everything here is a pure function so the
 * domain lock can be unit-tested without Electron.
 */

/** Persistent session partition for the embedded page; isolates its cookies
 * from both the app's own session and the 闲鱼/淘宝 Chrome profiles. */
export const SHIMO_PARTITION = 'persist:shimo'

/** Landing page of the 石墨 workspace (file list), used by the toolbar home. */
export const SHIMO_WORKSPACE_URL = 'https://shimo.im/workspace'

/** Only shimo.im (and its subdomains) may load inside the embedded page. */
export const SHIMO_HOST = 'shimo.im'

/**
 * What the embedded page is allowed to do with a navigation URL.
 * - `allow`:    stays inside the webview (shimo.im itself)
 * - `external`: hand to the system browser (any other https/http target)
 * - `block`:    non-navigable schemes (javascript:, data:, …)
 */
export type GuestNavigationAction = 'allow' | 'external' | 'block'

const NAVIGABLE_PROTOCOLS = new Set(['http:', 'https:'])

/** True when the URL is an https shimo.im (or subdomain) page. */
export function isShimoUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) return false
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return false
    const host = url.hostname.toLowerCase()
    return host === SHIMO_HOST || host.endsWith(`.${SHIMO_HOST}`)
  } catch {
    return false
  }
}

/**
 * Normalize a user-pasted 石墨 link: accepts a bare `shimo.im/...` host, adds
 * the scheme, upgrades `http:` to `https:`, and rejects anything that is not
 * an https shimo.im URL. Returns null when the input cannot be used.
 */
export function normalizeShimoUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return null
  }
  if (url.hostname.toLowerCase() !== SHIMO_HOST && !url.hostname.toLowerCase().endsWith(`.${SHIMO_HOST}`)) return null
  if (url.pathname === '' || url.pathname === '/') return null
  // A pasted http:// link is silently upgraded: shimo.im is https-only.
  if (url.protocol === 'http:') url.protocol = 'https:'
  if (url.protocol !== 'https:') return null
  return url.toString()
}

/**
 * Decide what should happen when the embedded page tries to navigate to
 * `value`. shimo.im targets stay in the webview, other http(s) targets open
 * in the system browser, everything else is blocked.
 */
export function classifyGuestNavigation(value: unknown): GuestNavigationAction {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) return 'block'
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'block'
  }
  if (!NAVIGABLE_PROTOCOLS.has(url.protocol)) return 'block'
  if (isShimoUrl(url.toString())) return 'allow'
  return 'external'
}

/**
 * Redact a 石墨 link for logs: the document identifier in the path is a
 * capability (whoever has the link can open the doc), so logs only keep the
 * host plus the first path segment.
 */
export function redactShimoUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return ''
  try {
    const url = new URL(value)
    return `${url.host}${url.pathname.split('/')[1] ? `/${url.pathname.split('/')[1]}` : ''}`
  } catch {
    return '<invalid-url>'
  }
}
