import { describe, it, expect } from 'vitest'
import { generateFingerprint } from '../src/main/browser/fingerprint'

describe('generateFingerprint', () => {
  it('returns a fingerprint with userAgent, viewport and webgl', () => {
    const fingerprint = generateFingerprint()
    expect(fingerprint).toHaveProperty('userAgent')
    expect(fingerprint).toHaveProperty('viewport.width')
    expect(fingerprint).toHaveProperty('viewport.height')
    expect(fingerprint).toHaveProperty('webgl.vendor')
    expect(fingerprint).toHaveProperty('webgl.renderer')
  })

  it('only picks values from the known pools', () => {
    const userAgents = new Set([
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 11_0_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
    ])
    const viewports = new Set(['1920x1080', '1680x1050', '1440x900', '1366x768', '1536x864'])

    for (let i = 0; i < 200; i++) {
      const fp = generateFingerprint()
      expect(userAgents.has(fp.userAgent)).toBe(true)
      expect(viewports.has(`${fp.viewport.width}x${fp.viewport.height}`)).toBe(true)
      expect(fp.webgl.vendor.length).toBeGreaterThan(0)
      expect(fp.webgl.renderer.length).toBeGreaterThan(0)
    }
  })
})
