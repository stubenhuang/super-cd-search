// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveTheme, applyTheme } from '../src/renderer/src/theme'
import { resolveThemeMode, TITLE_BAR_OVERLAY_COLORS, TITLE_BAR_OVERLAY_HEIGHT } from '../src/shared/theme'

function setSystemDark(isDark: boolean) {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
    matches: isDark,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn()
  })))
}

describe('resolveTheme', () => {
  it('returns explicit light/dark modes unchanged', () => {
    setSystemDark(false)
    expect(resolveTheme('light')).toBe('light')
    expect(resolveTheme('dark')).toBe('dark')
  })

  it('follows the system preference for system mode', () => {
    setSystemDark(false)
    expect(resolveTheme('system')).toBe('light')

    setSystemDark(true)
    expect(resolveTheme('system')).toBe('dark')
  })
})

describe('resolveThemeMode (shared)', () => {
  it('resolves every persisted mode without touching the DOM', () => {
    expect(resolveThemeMode('light', true)).toBe('light')
    expect(resolveThemeMode('dark', false)).toBe('dark')
    expect(resolveThemeMode('system', false)).toBe('light')
    expect(resolveThemeMode('system', true)).toBe('dark')
    expect(resolveThemeMode(undefined, true)).toBe('light')
  })

  it('provides overlay colors for both resolved themes', () => {
    expect(TITLE_BAR_OVERLAY_COLORS.light.color).toMatch(/^#[0-9A-Fa-f]{6}$/)
    expect(TITLE_BAR_OVERLAY_COLORS.light.symbolColor).toMatch(/^#[0-9A-Fa-f]{6}$/)
    expect(TITLE_BAR_OVERLAY_COLORS.dark.color).toMatch(/^#[0-9A-Fa-f]{6}$/)
    expect(TITLE_BAR_OVERLAY_COLORS.dark.symbolColor).toMatch(/^#[0-9A-Fa-f]{6}$/)
    expect(TITLE_BAR_OVERLAY_HEIGHT).toBe(56)
  })
})

describe('applyTheme', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  it('sets the data-theme attribute and caches the resolved value', () => {
    setSystemDark(false)
    applyTheme('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(localStorage.getItem('super-cd-search:theme')).toBe('dark')
  })

  it('resolves system mode to a concrete theme value', () => {
    setSystemDark(true)
    applyTheme('system')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(localStorage.getItem('super-cd-search:theme')).toBe('dark')
  })

  it('pushes matching overlay colors to a Windows host', async () => {
    const setTitleBarOverlay = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('electronAPI', { platform: 'win32', setTitleBarOverlay })
    setSystemDark(false)
    try {
      applyTheme('dark')
      expect(setTitleBarOverlay).toHaveBeenCalledWith(TITLE_BAR_OVERLAY_COLORS.dark)
      applyTheme('light')
      expect(setTitleBarOverlay).toHaveBeenLastCalledWith(TITLE_BAR_OVERLAY_COLORS.light)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
