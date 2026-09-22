import { describe, it, expect } from 'vitest'
import {
  SHIMO_PARTITION,
  SHIMO_WORKSPACE_URL,
  classifyGuestNavigation,
  isShimoUrl,
  normalizeShimoUrl,
  redactShimoUrl
} from '../src/shared/shimo'

describe('isShimoUrl', () => {
  it('accepts https shimo.im pages and subdomains', () => {
    expect(isShimoUrl('https://shimo.im/sheets/AbCdEf/xy12/')).toBe(true)
    expect(isShimoUrl('https://shimo.im/workspace')).toBe(true)
    expect(isShimoUrl('https://app.shimo.im/x')).toBe(true)
    expect(isShimoUrl('https://SHIMO.IM/workspace')).toBe(true)
  })

  it('rejects non-https, look-alike hosts and non-URLs', () => {
    expect(isShimoUrl('http://shimo.im/workspace')).toBe(false)
    expect(isShimoUrl('https://shimo.im.evil.com/workspace')).toBe(false)
    expect(isShimoUrl('https://notshimo.im/workspace')).toBe(false)
    expect(isShimoUrl('javascript:alert(1)')).toBe(false)
    expect(isShimoUrl('')).toBe(false)
    expect(isShimoUrl(undefined)).toBe(false)
    expect(isShimoUrl(42)).toBe(false)
    expect(isShimoUrl('x'.repeat(4097))).toBe(false)
  })
})

describe('normalizeShimoUrl', () => {
  it('keeps a valid sheet URL as-is', () => {
    expect(normalizeShimoUrl('https://shimo.im/sheets/AbCdEf/xy12/'))
      .toBe('https://shimo.im/sheets/AbCdEf/xy12/')
    expect(normalizeShimoUrl(SHIMO_WORKSPACE_URL)).toBe(SHIMO_WORKSPACE_URL)
  })

  it('adds the scheme and trims whitespace', () => {
    expect(normalizeShimoUrl('  shimo.im/sheets/abc  ')).toBe('https://shimo.im/sheets/abc')
  })

  it('upgrades http to https and normalizes the host', () => {
    expect(normalizeShimoUrl('http://shimo.im/workspace')).toBe('https://shimo.im/workspace')
    expect(normalizeShimoUrl('HTTP://SHIMO.IM/workspace')).toBe('https://shimo.im/workspace')
  })

  it('rejects anything that is not a shimo.im document URL', () => {
    expect(normalizeShimoUrl('')).toBeNull()
    expect(normalizeShimoUrl('   ')).toBeNull()
    expect(normalizeShimoUrl(null)).toBeNull()
    expect(normalizeShimoUrl(123)).toBeNull()
    expect(normalizeShimoUrl('https://example.com')).toBeNull()
    expect(normalizeShimoUrl('https://shimo.im/')).toBeNull()
    expect(normalizeShimoUrl('shimo.im')).toBeNull()
    expect(normalizeShimoUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeShimoUrl('https://shimo.im.evil.com/workspace')).toBeNull()
  })
})

describe('classifyGuestNavigation', () => {
  it('keeps shimo.im navigations inside the embedded page', () => {
    expect(classifyGuestNavigation('https://shimo.im/sheets/AbCdEf/xy12/')).toBe('allow')
    expect(classifyGuestNavigation('https://shimo.im/workspace')).toBe('allow')
  })

  it('hands other http(s) targets to the system browser', () => {
    expect(classifyGuestNavigation('https://www.discogs.com/release/1')).toBe('external')
    expect(classifyGuestNavigation('http://shimo.im/workspace')).toBe('external')
  })

  it('blocks non-navigable schemes', () => {
    expect(classifyGuestNavigation('javascript:alert(1)')).toBe('block')
    expect(classifyGuestNavigation('data:text/html,<b>x</b>')).toBe('block')
    expect(classifyGuestNavigation('file:///etc/passwd')).toBe('block')
    expect(classifyGuestNavigation('')).toBe('block')
    expect(classifyGuestNavigation('shimo.im')).toBe('block')
    expect(classifyGuestNavigation(undefined)).toBe('block')
  })
})

describe('redactShimoUrl', () => {
  it('keeps only host + first path segment (the doc id stays out of logs)', () => {
    expect(redactShimoUrl('https://shimo.im/sheets/AbCdEf/xy12/')).toBe('shimo.im/sheets')
    expect(redactShimoUrl('https://shimo.im/workspace')).toBe('shimo.im/workspace')
    expect(redactShimoUrl('https://shimo.im/')).toBe('shimo.im')
  })

  it('never throws on garbage input', () => {
    expect(redactShimoUrl('')).toBe('')
    expect(redactShimoUrl(':::')).toBe('<invalid-url>')
    expect(redactShimoUrl(undefined)).toBe('')
  })
})

describe('partition constants', () => {
  it('uses a dedicated persistent partition for the guest session', () => {
    expect(SHIMO_PARTITION).toBe('persist:shimo')
  })
})
