import { describe, it, expect } from 'vitest'
import { isPublishPath } from '../src/main/publish/xianyu'

/**
 * Regression guard for the seller-workbench URL check: a naive
 * `/\/(publish|sell)/` also matches `https://seller.goofish.com/` (the `//seller`
 * segment contains `/sell`), which silently skipped the click that opens the
 * publishing form.
 */
describe('isPublishPath', () => {
  it('treats the seller workbench home as NOT a publish page', () => {
    expect(isPublishPath('https://seller.goofish.com/')).toBe(false)
    expect(isPublishPath('https://seller.goofish.com')).toBe(false)
    expect(isPublishPath('https://seller.goofish.com/#/home')).toBe(false)
  })

  it('recognises real publish paths', () => {
    expect(isPublishPath('https://seller.goofish.com/publish')).toBe(true)
    expect(isPublishPath('https://seller.goofish.com/sell/publish')).toBe(true)
    expect(isPublishPath('https://seller.goofish.com/sell')).toBe(true)
    expect(isPublishPath('https://seller.goofish.com/#/publish')).toBe(true)
  })

  it('does not mistake unrelated paths for a publish page', () => {
    expect(isPublishPath('https://seller.goofish.com/order/list')).toBe(false)
    expect(isPublishPath('https://www.goofish.com/')).toBe(false)
    expect(isPublishPath('not a url')).toBe(false)
  })
})
