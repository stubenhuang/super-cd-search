import { describe, it, expect, vi, afterEach } from 'vitest'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { app } from 'electron'
import { LOGIN_DEFS } from '../src/main/login/defs'

/**
 * Only the pure/deterministic behaviour of the multi-profile manager is tested
 * here. `acquirePublishPage` really spawns Chrome, so it is deliberately never
 * called: every test uses a fresh module instance (no sessions, no root dir
 * unless the test initialises one).
 */

async function loadProfiles() {
  return await import('../src/main/publish/profiles')
}

afterEach(() => {
  vi.resetModules()
})

const FUTURE = Math.floor(Date.now() / 1000) + 3600

function fakeCookiePage(cookies: unknown[] | (() => unknown[])) {
  return {
    cookies: vi.fn(async () => {
      const value = typeof cookies === 'function' ? cookies() : cookies
      if (value instanceof Error) throw value
      return value
    })
  }
}

describe('publishProfileId', () => {
  it('prefixes the target id so profile dirs stay distinguishable', async () => {
    const { publishProfileId } = await loadProfiles()
    expect(publishProfileId('abc-123')).toBe('target-abc-123')
    expect(publishProfileId('')).toBe('target-')
  })
})

describe('publishProfileDir', () => {
  it('falls back to a temp root before initPublishProfiles without throwing', async () => {
    const { publishProfileDir } = await loadProfiles()
    expect(publishProfileDir('target-x')).toBe(join(tmpdir(), 'super-cd-search-publish', 'target-x'))
  })

  it('uses <userData>/publish-profiles after initPublishProfiles', async () => {
    const { initPublishProfiles, publishProfileDir } = await loadProfiles()
    initPublishProfiles(app.getPath('userData'))
    expect(publishProfileDir('target-x')).toBe(join('/tmp', 'publish-profiles', 'target-x'))
  })

  it('sanitizes characters that could escape the profile root', async () => {
    const { initPublishProfiles, publishProfileDir } = await loadProfiles()
    initPublishProfiles('/tmp/ud-root')

    const dir = publishProfileDir('target-../../etc pass中文')
    expect(dir).toBe(join('/tmp/ud-root', 'publish-profiles', 'target-______etc_pass__'))

    const root = join('/tmp/ud-root', 'publish-profiles')
    const inside = relative(root, dir)
    expect(inside).not.toContain('..')
    expect(inside.startsWith(sep)).toBe(false)
    expect(dir.startsWith(root + sep)).toBe(true)
  })

  it('collapses a windows-style separator too', async () => {
    const { initPublishProfiles, publishProfileDir } = await loadProfiles()
    initPublishProfiles('/tmp/ud-root')
    expect(publishProfileDir('target-a\\b:c')).toBe(join('/tmp/ud-root', 'publish-profiles', 'target-a_b_c'))
  })
})

describe('session bookkeeping without launching Chrome', () => {
  it('starts with no running profiles', async () => {
    const { listRunningPublishProfiles } = await loadProfiles()
    expect(listRunningPublishProfiles()).toEqual([])
  })

  it('reports unknown profiles as not running and unpeekable', async () => {
    const profiles = await loadProfiles()
    expect(profiles.isPublishProfileRunning('nope')).toBe(false)
    await expect(profiles.peekPublishProfileLogin('nope')).resolves.toBeNull()
    // Nothing created the profile directory, i.e. no Chrome was launched.
    expect(existsSync(profiles.publishProfileDir('nope'))).toBe(false)
    expect(profiles.listRunningPublishProfiles()).toEqual([])
  })

  it('closing an unknown profile (even with wipe) is a safe no-op', async () => {
    const profiles = await loadProfiles()
    await expect(profiles.closePublishProfile('nope', { wipe: true })).resolves.toBeUndefined()
    await expect(profiles.closePublishProfile('nope')).resolves.toBeUndefined()
    await expect(profiles.closeAllPublishProfiles()).resolves.toBeUndefined()
    expect(profiles.listRunningPublishProfiles()).toEqual([])
  })

  it('revealing/parking an unknown profile is a safe no-op', async () => {
    const profiles = await loadProfiles()
    await expect(profiles.revealPublishWindow('nope')).resolves.toBeUndefined()
    await expect(profiles.parkPublishWindow('nope')).resolves.toBeUndefined()
  })
})

describe('readXianyuLogin', () => {
  it('prefers the decoded tracknick nickname over unb', async () => {
    const { readXianyuLogin } = await loadProfiles()
    const page = fakeCookiePage([
      { name: 'tracknick', value: encodeURIComponent('闲鱼 小铺'), domain: '.goofish.com', expires: FUTURE },
      { name: 'unb', value: '12345', domain: '.goofish.com', expires: FUTURE }
    ])

    await expect(readXianyuLogin(page as never)).resolves.toEqual({ state: 'logged_in', account: '闲鱼 小铺' })
    expect(page.cookies).toHaveBeenCalledWith(LOGIN_DEFS.xianyu.cookieUrl)
  })

  it('falls back to the unb member id when there is no nickname', async () => {
    const { readXianyuLogin } = await loadProfiles()
    const page = fakeCookiePage([{ name: 'unb', value: '12345', domain: '.goofish.com', expires: FUTURE }])
    await expect(readXianyuLogin(page as never)).resolves.toEqual({ state: 'logged_in', account: '12345' })
  })

  it('reports an empty account when neither cookie is present', async () => {
    const { readXianyuLogin } = await loadProfiles()
    const page = fakeCookiePage([])
    await expect(readXianyuLogin(page as never)).resolves.toEqual({ state: 'logged_out', account: '' })
  })

  it('keeps the state but picks no account when the login cookie is expired', async () => {
    const { readXianyuLogin } = await loadProfiles()
    const page = fakeCookiePage([{ name: 'unb', value: '12345', domain: '.goofish.com', expires: 1 }])
    await expect(readXianyuLogin(page as never)).resolves.toEqual({ state: 'expired', account: '12345' })
  })

  it('treats a cookie read failure as logged out instead of throwing', async () => {
    const { readXianyuLogin } = await loadProfiles()
    const page = fakeCookiePage(new Error('target closed'))
    await expect(readXianyuLogin(page as never)).resolves.toEqual({ state: 'logged_out', account: '' })
  })

  it('returns the raw value when the cookie is not valid percent-encoding', async () => {
    const { readXianyuLogin } = await loadProfiles()
    const page = fakeCookiePage([{ name: 'tracknick', value: '%E0%A4%A', domain: '.goofish.com', expires: FUTURE }])
    await expect(readXianyuLogin(page as never)).resolves.toEqual({ state: 'logged_out', account: '%E0%A4%A' })
  })
})
