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
