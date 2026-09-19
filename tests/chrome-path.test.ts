import { describe, it, expect, afterEach } from 'vitest'
import { restrictedHostChromeArgs } from '../src/main/browser/chrome-path'

/**
 * The app launches its own Chrome for QR login / scraping / publishing.
 *
 * Inside a restricted host (CI, the automated UI smoke run) that Chrome must
 * relax two things: it cannot initialise Chromium's own sandbox (SIGTRAP within
 * seconds → macOS「Google Chrome 意外退出」) and it cannot reach the login
 * Keychain (macOS「找不到钥匙串」). Because the app spawns Chrome itself and
 * only then connects over CDP, `puppeteer.launch()`'s defaults — including
 * `--use-mock-keychain` — never apply, so the escape hatch has to be explicit
 * and must stay off in production.
 */
describe('restrictedHostChromeArgs', () => {
  const original = process.env.SUPER_CD_CHROME_RESTRICTED

  afterEach(() => {
    if (original === undefined) delete process.env.SUPER_CD_CHROME_RESTRICTED
    else process.env.SUPER_CD_CHROME_RESTRICTED = original
  })

  it('keeps Chromium sandbox and the real Keychain by default', () => {
    delete process.env.SUPER_CD_CHROME_RESTRICTED
    expect(restrictedHostChromeArgs()).toEqual([])
  })

  it('relaxes both only when explicitly opted in', () => {
    process.env.SUPER_CD_CHROME_RESTRICTED = '1'
    expect(restrictedHostChromeArgs()).toEqual(['--no-sandbox', '--use-mock-keychain'])

    process.env.SUPER_CD_CHROME_RESTRICTED = '0'
    expect(restrictedHostChromeArgs()).toEqual([])
  })
})
