// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveTheme, applyTheme } from '../src/renderer/src/theme'

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
})
