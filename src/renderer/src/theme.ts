import type { ThemeMode } from '../../shared/types'

export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'super-cd-search:theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

// The currently selected theme mode. Kept module-level so the system-change
// listener only re-applies the theme while the user has chosen "system".
let currentMode: ThemeMode = 'light'

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'system') {
    return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
  }
  return mode === 'dark' ? 'dark' : 'light'
}

export function applyTheme(mode: ThemeMode): void {
  currentMode = mode
  const resolved = resolveTheme(mode)
  document.documentElement.setAttribute('data-theme', resolved)
  try {
    localStorage.setItem(STORAGE_KEY, resolved)
  } catch {
    // localStorage may be unavailable; theme still applies for this session.
  }
}

/** Apply a mode immediately and persist it for future launches. */
export async function saveTheme(mode: ThemeMode): Promise<void> {
  applyTheme(mode)
  try {
    await window.electronAPI.setSetting('theme', mode)
  } catch {
    // Persistence is best-effort; the in-session theme is already applied.
  }
}

/**
 * Apply the saved theme before React renders (avoiding a light-theme flash)
 * and keep following system changes while in "system" mode. Returns a cleanup
 * function that removes the system-color listener.
 */
export function initTheme(): () => void {
  const media = window.matchMedia(DARK_QUERY)

  const cached = localStorage.getItem(STORAGE_KEY)
  if (cached === 'dark' || cached === 'light') {
    document.documentElement.setAttribute('data-theme', cached)
  }

  const onSystemChange = () => {
    if (currentMode === 'system') applyTheme('system')
  }
  media.addEventListener('change', onSystemChange)

  void window.electronAPI
    .getSetting('theme')
    .then((saved) => {
      const mode: ThemeMode = saved === 'dark' || saved === 'system' ? saved : 'light'
      applyTheme(mode)
    })
    .catch(() => {})

  return () => media.removeEventListener('change', onSystemChange)
}
