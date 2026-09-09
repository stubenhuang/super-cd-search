// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { applyTheme } from '../src/renderer/src/theme'
import { TITLE_BAR_OVERLAY_COLORS, TITLE_BAR_OVERLAY_HEIGHT } from '../src/shared/theme'

describe('applyTheme', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme')
  })

  it('always applies the dark theme', () => {
    applyTheme()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('pushes the dark overlay colors to a Windows host', () => {
    const setTitleBarOverlay = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('electronAPI', { platform: 'win32', setTitleBarOverlay })
    try {
      applyTheme()
      expect(setTitleBarOverlay).toHaveBeenCalledWith(TITLE_BAR_OVERLAY_COLORS)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('ignores overlay failures on a Windows host', () => {
    const setTitleBarOverlay = vi.fn().mockRejectedValue(new Error('no overlay'))
    vi.stubGlobal('electronAPI', { platform: 'win32', setTitleBarOverlay })
    try {
      expect(() => applyTheme()).not.toThrow()
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('does not touch the overlay on other platforms', () => {
    const setTitleBarOverlay = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('electronAPI', { platform: 'darwin', setTitleBarOverlay })
    try {
      applyTheme()
      expect(setTitleBarOverlay).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('title bar overlay colors', () => {
  it('exposes a dark palette and the header-matching height', () => {
    expect(TITLE_BAR_OVERLAY_COLORS.color).toMatch(/^#[0-9A-Fa-f]{6}$/)
    expect(TITLE_BAR_OVERLAY_COLORS.symbolColor).toMatch(/^#[0-9A-Fa-f]{6}$/)
    expect(TITLE_BAR_OVERLAY_HEIGHT).toBe(56)
  })
})
