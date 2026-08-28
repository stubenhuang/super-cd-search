import type { ThemeMode } from './types'

export type ResolvedTheme = 'light' | 'dark'

// Colors for the native Window Controls Overlay shown by the Windows frameless
// title bar (titleBarStyle: 'hidden' + titleBarOverlay). The overlay sits on
// the app header, whose top edge is `--bg-secondary`, and its glyphs use
// `--text-primary`; keep these in sync with the CSS variables.
export const TITLE_BAR_OVERLAY_COLORS: Record<ResolvedTheme, { color: string; symbolColor: string }> = {
  light: { color: '#EDE6DA', symbolColor: '#2C2520' },
  dark: { color: '#26211A', symbolColor: '#F5EEE3' }
}

/** Height of the window-controls strip; matches the 56px app header. */
export const TITLE_BAR_OVERLAY_HEIGHT = 56

/**
 * Resolve a persisted theme mode to light/dark. `systemIsDark` stands in for
 * the platform's dark-mode detection: `matchMedia` in the renderer,
 * `nativeTheme` in the main process.
 */
export function resolveThemeMode(mode: ThemeMode | undefined, systemIsDark: boolean): ResolvedTheme {
  if (mode === 'dark') return 'dark'
  if (mode === 'system') return systemIsDark ? 'dark' : 'light'
  return 'light'
}
