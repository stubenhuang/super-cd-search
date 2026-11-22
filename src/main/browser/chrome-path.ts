import { existsSync } from 'fs'

/**
 * Candidate paths to a Chrome/Chromium/Edge executable, checked in order.
 * Covers macOS, Windows (machine-wide and per-user installs) and Linux.
 */
const CHROME_CANDIDATES = [
  // macOS
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  // Windows — machine-wide installs
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  // Windows — per-user installs (LOCALAPPDATA)
  `${process.env.LOCALAPPDATA ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.LOCALAPPDATA ?? ''}\\Microsoft\\Edge\\Application\\msedge.exe`,
  // Linux
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
]

/**
 * Find an installed Chrome/Chromium/Edge executable. Honors the CHROME_PATH
 * environment variable first, then falls back to the well-known install paths.
 * Empty candidates are skipped because `existsSync('')` is always false.
 */
export function findChromeExecutable(): string | null {
  const fromEnv = process.env.CHROME_PATH
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Extra flags for the Chrome the app launches itself (QR login, scraping,
 * publishing) when the app runs inside a *restricted host* — a CI runner, or a
 * restricted dev shell such as the automated UI smoke run.
 *
 * Two things break there, both of which plain `puppeteer.launch()` would have
 * handled for us (the app spawns Chrome itself and then connects over CDP, so
 * puppeteer's default args never apply):
 *
 *  - Chromium initialises its own sandbox at startup; inside an outer sandbox
 *    that fails and the process aborts with SIGTRAP within seconds, making
 *    macOS show a「Google Chrome 意外退出」dialog on every launch.
 *  - Chrome stores its "Safe Storage" key in the login Keychain. With no
 *    reachable Keychain, macOS shows a「找不到钥匙串」sheet. Puppeteer passes
 *    `--use-mock-keychain` by default; we have to do it ourselves.
 *
 * Opt in with `SUPER_CD_CHROME_RESTRICTED=1`. Production never sets it, so real
 * users keep both the Chromium sandbox and the real Keychain.
 */
export function restrictedHostChromeArgs(): string[] {
  return process.env.SUPER_CD_CHROME_RESTRICTED === '1'
    ? ['--no-sandbox', '--use-mock-keychain']
    : []
}

/** Message shown when no usable Chrome is installed (CHROME_PATH also works). */
export const CHROME_NOT_FOUND_MESSAGE = '未找到 Google Chrome，请先安装（或将 CHROME_PATH 指向 Chrome 可执行文件）'

/**
 * Chrome flags for a profile directory the app owns and connects to over CDP.
 *
 * Used by the per-target publishing profiles (publish/profiles.ts) to launch
 * a real Chrome over CDP:
 *
 *  - `--remote-debugging-port=0` picks a free port, written to
 *    `DevToolsActivePort` inside `dir` (see waitForDevToolsPort).
 *  - Headless sessions have no window at all; headed ones start parked
 *    off-screen (macOS keeps a sliver visible — the best a headed window can do)
 *    and are revealed only while a human is needed.
 *  - The backgrounding flags keep a parked/occluded window's page fully active,
 *    so a background scrape is never timer-throttled.
 */
export function chromeLaunchArgs(dir: string, mode: 'headed' | 'headless'): string[] {
  return [
    '--remote-debugging-port=0',
    `--user-data-dir=${dir}`,
    ...restrictedHostChromeArgs(),
    '--no-first-run',
    '--no-default-browser-check',
    ...(mode === 'headless' ? ['--headless', '--window-size=1280,1000'] : ['--window-position=-32000,-32000']),
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    'about:blank'
  ]
}
