import { describe, it, expect } from 'vitest'
import { describeBrowserSessionFromUa } from '../src/main/browser/real-chrome'

describe('describeBrowserSessionFromUa', () => {
  it('masks a headless UA and classifies the session as headless', () => {
    const headlessUa = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/151.0.0.0 Safari/537.36'
    expect(describeBrowserSessionFromUa(headlessUa)).toEqual({
      maskedUa: 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
      mode: 'headless'
    })
  })

  it('keeps a headed browser unmasked', () => {
    const headedUa = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'
    expect(describeBrowserSessionFromUa(headedUa)).toEqual({ maskedUa: '', mode: 'headed' })
  })
})
