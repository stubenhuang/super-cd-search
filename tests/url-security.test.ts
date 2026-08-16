import { describe, expect, it } from 'vitest'
import { isAllowedRendererNavigation, isPrivateNetworkUrl, isSafeExternalUrl } from '../src/main/security/urls'

describe('URL security policy', () => {
  it('only permits normal web URLs for external opening', () => {
    expect(isSafeExternalUrl('https://example.com/release/1')).toBe(true)
    expect(isSafeExternalUrl('http://example.com')).toBe(true)
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeExternalUrl('custom-scheme://payload')).toBe(false)
    expect(isSafeExternalUrl('not a url')).toBe(false)
    expect(isSafeExternalUrl(42)).toBe(false)
    expect(isSafeExternalUrl(`https://example.com/${'x'.repeat(4096)}`)).toBe(false)
  })

  it('matches the exact development origin rather than a localhost prefix', () => {
    const devUrl = 'http://localhost:5173/'
    expect(isAllowedRendererNavigation('http://localhost:5173/settings', devUrl)).toBe(true)
    expect(isAllowedRendererNavigation('http://localhost:9999/', devUrl)).toBe(false)
    expect(isAllowedRendererNavigation('http://localhost.evil.test/', devUrl)).toBe(false)
    expect(isAllowedRendererNavigation('https://localhost:5173/', devUrl)).toBe(false)
    expect(isAllowedRendererNavigation('https://example.com/', undefined)).toBe(false)
    expect(isAllowedRendererNavigation('not a url', devUrl)).toBe(false)
    expect(isAllowedRendererNavigation('https://example.com/', 'not a url')).toBe(false)
  })

  it('identifies private literal image targets', () => {
    expect(isPrivateNetworkUrl('http://127.0.0.1/image')).toBe(true)
    expect(isPrivateNetworkUrl('http://192.168.1.4/image')).toBe(true)
    expect(isPrivateNetworkUrl('http://[::1]/image')).toBe(true)
    expect(isPrivateNetworkUrl('http://router.localhost/image')).toBe(true)
    expect(isPrivateNetworkUrl('http://10.0.0.1/image')).toBe(true)
    expect(isPrivateNetworkUrl('http://100.64.0.1/image')).toBe(true)
    expect(isPrivateNetworkUrl('http://169.254.1.1/image')).toBe(true)
    expect(isPrivateNetworkUrl('http://172.16.0.1/image')).toBe(true)
    expect(isPrivateNetworkUrl('http://198.18.0.1/image')).toBe(true)
    expect(isPrivateNetworkUrl('http://224.0.0.1/image')).toBe(true)
    expect(isPrivateNetworkUrl('http://8.8.8.8/image')).toBe(false)
    expect(isPrivateNetworkUrl('not a url')).toBe(true)
    expect(isPrivateNetworkUrl('https://images.example.com/cover.jpg')).toBe(false)
  })
})
