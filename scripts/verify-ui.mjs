#!/usr/bin/env node
/**
 * UI smoke check for the built Electron app.
 *
 * Launches the real app (from `out/`, so run `npm run build` first) through
 * playwright-core's experimental `_electron` API, asserts that the shell and
 * the tab pages render, and writes screenshots for a human (or an agent) to
 * look at:
 *
 *   artifacts/ui/shot-1-search.png   desktop search tab
 *   artifacts/ui/shot-2-shimo.png    desktop 石墨文档 placeholder tab
 *   artifacts/ui/shot-3-mobile.png   LAN phone search page (rendered in a
 *                                    throwaway hidden Electron window)
 *   artifacts/ui/console.log         main-process + renderer console output
 *
 * Everything runs against a throwaway profile inside `artifacts/`, so the
 * user's real app data (settings, logs, login session) is never touched.
 *
 * Usage:
 *   npm run verify:ui
 *   node scripts/verify-ui.mjs          # requires a prior `npm run build`
 *
 * Exit codes:
 *   0  every check passed
 *   1  at least one check failed
 *   2  usage/precondition problem (no build output)
 */
import { _electron as electron } from 'playwright-core'
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENTRY = join(REPO_ROOT, 'out', 'main', 'index.js')
const ARTIFACTS = join(REPO_ROOT, 'artifacts', 'ui')
const PROFILE = join(REPO_ROOT, 'artifacts', 'ui-profile')
const ISOLATED_HOME = join(REPO_ROOT, 'artifacts', 'ui-home')
const CONSOLE_LOG = join(ARTIFACTS, 'console.log')

const TAG = '[verify-ui]'
/** A screenshot smaller than this is almost certainly a blank frame. */
const MIN_SCREENSHOT_BYTES = 5 * 1024
/** Renderer console errors that are tolerated (substring match). */
const CONSOLE_ERROR_ALLOWLIST = [
  // The renderer's index.html ships a meta CSP that also declares
  // frame-ancestors, which Chromium refuses to honour from a meta tag and
  // reports as a console error. Benign, and emitted on every app start.
  "The Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element."
]

if (!existsSync(ENTRY)) {
  console.error(`${TAG} no build output at out/main/index.js — run "npm run build" first`)
  process.exit(2)
}

// Fresh, workspace-local profile every run keeps the check deterministic and
// guarantees the real userData directory is never read or written.
for (const dir of [PROFILE, ISOLATED_HOME]) {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
}
mkdirSync(ARTIFACTS, { recursive: true })

const results = []
const logLines = []
const consoleErrors = []
const pageErrors = []

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok) })
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`)
}

function checkScreenshot(name, path) {
  if (!existsSync(path)) {
    check(`${name}截图`, false, `未生成 ${path}`)
    return
  }
  const bytes = statSync(path).size
  check(`${name}截图`, bytes >= MIN_SCREENSHOT_BYTES, `${bytes} bytes`)
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

/** Enable the LAN server on a free loopback port; returns its status. */
async function enableLan(window, port) {
  return await window.evaluate(async candidatePort => {
    await window.electronAPI.updateSettings({
      lanEnabled: true,
      lanHost: '127.0.0.1',
      lanPort: candidatePort
    })
    return window.electronAPI.applyLanServer()
  }, port)
}

let app = null
let exitCode = 0

try {
  app = await electron.launch({
    cwd: REPO_ROOT,
    args: [
      '.',
      `--user-data-dir=${PROFILE}`,
      // Required under a restricted sandbox, and keeps Chromium's own profile
      // writes inside the throwaway directory.
      '--no-sandbox',
      // Keep rendering alive when the window is occluded, otherwise macOS
      // screenshots can come back blank.
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding'
    ],
    env: { ...process.env, HOME: ISOLATED_HOME },
    timeout: 60000
  })

  app.process().stdout?.on('data', data => logLines.push(`[main:out] ${data}`))
  app.process().stderr?.on('data', data => logLines.push(`[main:err] ${data}`))
  app.process().on('exit', (code, signal) => logLines.push(`[main:exit] code=${code} signal=${signal}`))

  const window = await app.firstWindow()
  window.on('console', message => {
    logLines.push(`[renderer:${message.type()}] ${message.text()}`)
    if (message.type() === 'error' && !CONSOLE_ERROR_ALLOWLIST.some(entry => message.text().includes(entry))) {
      consoleErrors.push(message.text())
    }
  })
  window.on('pageerror', error => {
    logLines.push(`[renderer:pageerror] ${error.message}`)
    pageErrors.push(error.message)
  })

  await window.waitForSelector('.app-tabs', { timeout: 30000 })

  // 1. App shell boots from the built bundle.
  const url = window.url()
  const title = await window.title()
  check(
    '应用启动（构建产物 + 标题）',
    url.endsWith('/out/renderer/index.html') && title === 'Super CD Search',
    `url=${url} title=${title}`
  )

  // 2. Tab bar exposes exactly the two expected tabs.
  const tabs = await window.locator('.app-tabs button').allTextContents()
  check('标签栏为 [搜索, 石墨文档]', JSON.stringify(tabs) === JSON.stringify(['搜索', '石墨文档']), JSON.stringify(tabs))
  const shellText = await window.locator('body').innerText()
  check('界面无「CD 库」残留文案', !shellText.includes('CD 库'))

  // 3. The search tab still renders its two panels.
  const hasInput = await window.locator('.left-panel .catalog-input').isVisible()
  const hasResultsPlaceholder = await window.locator('.right-panel .placeholder-text').isVisible()
  const currencyButtons = await window.locator('.currency-toggle button').count()
  check(
    '搜索页（输入框 / 结果占位 / 币种切换）',
    hasInput && hasResultsPlaceholder && currencyButtons === 2,
    `input=${hasInput} placeholder=${hasResultsPlaceholder} currency=${currencyButtons}`
  )
  await window.screenshot({ path: join(ARTIFACTS, 'shot-1-search.png') })
  checkScreenshot('搜索页', join(ARTIFACTS, 'shot-1-search.png'))

  // 4. The 石墨文档 tab shows the placeholder and nothing else.
  await window.locator('.app-tabs button', { hasText: '石墨文档' }).click()
  await window.waitForSelector('.shimo-placeholder', { timeout: 10000 })
  const lines = await window.locator('.shimo-line').allTextContents()
  check('石墨文档占位文案为 [规划中, 敬请期待]', JSON.stringify(lines) === JSON.stringify(['规划中', '敬请期待']), JSON.stringify(lines))

  const geometry = await window.locator('.shimo-placeholder').evaluate(node => {
    const box = node.getBoundingClientRect()
    const main = node.parentElement.getBoundingClientRect()
    const line = node.querySelector('.shimo-line')
    return {
      dx: Math.round(box.left + box.width / 2 - (main.left + main.width / 2)),
      dy: Math.round(box.top + box.height / 2 - (main.top + main.height / 2)),
      fontSize: line ? parseFloat(getComputedStyle(line).fontSize) : 0
    }
  })
  check(
    '占位内容在内容区居中（±2px）',
    Math.abs(geometry.dx) <= 2 && Math.abs(geometry.dy) <= 2,
    `dx=${geometry.dx} dy=${geometry.dy}`
  )
  check('占位文案字号为大字（≥28px）', geometry.fontSize >= 28, `${geometry.fontSize}px`)
  await window.screenshot({ path: join(ARTIFACTS, 'shot-2-shimo.png') })
  checkScreenshot('石墨文档占位页', join(ARTIFACTS, 'shot-2-shimo.png'))

  // 5. No renderer-side errors during any of the above.
  check('渲染进程无 console.error', consoleErrors.length === 0, consoleErrors.join(' | '))
  check('渲染进程无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))

  // 6. The LAN phone page. Electron is itself a Chromium, so the page is
  //    rendered in a throwaway hidden window instead of requiring a separate
  //    browser download (playwright-core ships no browser of its own).
  let status = await enableLan(window, await freePort())
  if (status.state !== 'running') {
    // One retry: the port may have been grabbed between probe and bind.
    status = await enableLan(window, await freePort())
  }
  if (status.state !== 'running' || !status.url) {
    check('手机端搜索页（LAN 服务启动）', false, `state=${status.state} error=${status.error ?? ''}`)
  } else {
    const mobileWindowPromise = app.waitForEvent('window', { timeout: 20000 })
    void mobileWindowPromise.catch(() => {})
    await app.evaluate(async ({ BrowserWindow }, url) => {
      const mobile = new BrowserWindow({
        width: 390,
        height: 844,
        show: false,
        paintWhenInitiallyHidden: true
      })
      await mobile.loadURL(url)
    }, status.url)

    const mobileWindow = await mobileWindowPromise
    await mobileWindow.waitForSelector('#panel-search', { timeout: 10000 })
    const mobileText = await mobileWindow.locator('body').innerText()
    check(
      '手机端搜索页内容（有搜索/扫码，无发布/CD 库）',
      mobileText.includes('远程搜索') &&
        mobileText.includes('扫码添加编号') &&
        !mobileText.includes('发布') &&
        !mobileText.includes('CD 库')
    )
    await mobileWindow.screenshot({ path: join(ARTIFACTS, 'shot-3-mobile.png') })
    checkScreenshot('手机端搜索页', join(ARTIFACTS, 'shot-3-mobile.png'))
    await mobileWindow.close()
  }

  // 7. Going back must still work (the app stays interactive after tab switches).
  await window.locator('.app-tabs button', { hasText: '搜索' }).click()
  await window.waitForTimeout(200)
  check('切回搜索页仍可交互', await window.locator('.left-panel .catalog-input').isVisible())
} catch (error) {
  check('冒烟脚本执行完成', false, error instanceof Error ? `${error.message}` : String(error))
} finally {
  if (app) {
    try {
      await app.close()
    } catch {
      logLines.push('[verify-ui] app.close() failed')
    }
  }

  const failed = results.filter(result => !result.ok)
  writeFileSync(
    CONSOLE_LOG,
    `${results.map(result => `${result.ok ? 'PASS' : 'FAIL'} ${result.name}`).join('\n')}\n\n${logLines.join('')}`,
    'utf8'
  )

  console.log(`${TAG} ${results.length - failed.length} passed / ${failed.length} failed`)
  console.log(`${TAG} artifacts: artifacts/ui/`)
  exitCode = failed.length > 0 ? 1 : 0
}

process.exit(exitCode)
