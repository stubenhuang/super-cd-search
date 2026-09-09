import { TITLE_BAR_OVERLAY_COLORS } from '../../shared/theme'

// The app ships a single theme. The appearance settings section was removed,
// so the UI always renders the dark palette and nothing is persisted.

// On Windows the frameless title bar draws its native window controls with
// app-provided colors, so keep them in sync with the dark palette.
function syncWindowControlsOverlay(): void {
  if (window.electronAPI?.platform !== 'win32') return
  void window.electronAPI.setTitleBarOverlay(TITLE_BAR_OVERLAY_COLORS).catch(() => {
    // Cosmetic only; ignore failures (e.g. overlay unavailable).
  })
}

/** Apply the dark theme before React renders to avoid a light-theme flash. */
export function applyTheme(): void {
  document.documentElement.setAttribute('data-theme', 'dark')
  syncWindowControlsOverlay()
}
