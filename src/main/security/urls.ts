const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:'])

export function isSafeExternalUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 4096) return false
  try {
    return EXTERNAL_PROTOCOLS.has(new URL(value).protocol)
  } catch {
    return false
  }
}

/** Only the exact Vite development origin may remain inside the app window. */
export function isAllowedRendererNavigation(value: string, devServerUrl?: string): boolean {
  if (!devServerUrl) return false
  try {
    return new URL(value).origin === new URL(devServerUrl).origin
  } catch {
    return false
  }
}

/** Reject loopback/link-local/private literal hosts exposed through renderer IPC. */
export function isPrivateNetworkUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.replace(/^\[|\]$/g, '').toLowerCase()
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true
    if (hostname.includes(':') && (
      hostname === '::1' || hostname.startsWith('fe80:') || hostname.startsWith('fc') || hostname.startsWith('fd')
    )) return true
    const parts = hostname.split('.').map(Number)
    if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false
    const [a, b] = parts
    return a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
  } catch {
    return true
  }
}
