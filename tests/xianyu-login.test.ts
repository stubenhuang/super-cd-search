import { describe, it, expect } from 'vitest'
import { checkLoginState, LOGIN_DEFS, type LoginCookie } from '../src/main/publish/xianyu-login'

const def = LOGIN_DEFS.xianyu

const cookie = (overrides: Partial<LoginCookie>): LoginCookie => ({
  name: 'unb',
  value: '123456',
  domain: '.goofish.com',
  ...overrides
})

describe('checkLoginState', () => {
  it('reports logged in when an unexpired login cookie exists on the right domain', () => {
    const cookies = [cookie({ expires: 4102444800 })]
    expect(checkLoginState(cookies, def, 1700000000000)).toBe('logged_in')
  })

  it('reports expired when every matching cookie is past its expiry', () => {
    const cookies = [cookie({ expires: 1600000000 })]
    expect(checkLoginState(cookies, def, 1700000000000)).toBe('expired')
  })

  it('treats session cookies (no expiry) as active', () => {
    expect(checkLoginState([cookie({})], def, 1700000000000)).toBe('logged_in')
    expect(checkLoginState([cookie({ expires: -1 })], def, 1700000000000)).toBe('logged_in')
  })

  it('reports logged out for wrong name, wrong domain, or empty value', () => {
    expect(checkLoginState([cookie({ name: 'other' })], def)).toBe('logged_out')
    expect(checkLoginState([cookie({ domain: '.taobao.com' })], def)).toBe('logged_out')
    expect(checkLoginState([cookie({ value: '' })], def)).toBe('logged_out')
    expect(checkLoginState([], def)).toBe('logged_out')
  })

  it('expires take precedence over logged out only when a matching cookie exists', () => {
    const mixed = [cookie({ expires: 1600000000 }), cookie({ domain: '.other.com' })]
    expect(checkLoginState(mixed, def, 1700000000000)).toBe('expired')
  })
})
