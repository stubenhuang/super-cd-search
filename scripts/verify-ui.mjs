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
 *   artifacts/ui/shot-3b-lan-panel.png  LAN panel (header button; must not
 *                                    move/grow after opening)
 *   artifacts/ui/shot-6b-settings.png     settings panel (no bottom-left close
 *                                        button, footer save reads 保存)
 *   artifacts/ui/shot-4-publish-settings.png  发布目标面板（头部按钮打开，
 *                                              Discogs 编辑器：Token + 引导）
 *   artifacts/ui/shot-4b-publish-token.png     Discogs 目标编辑器（必填
 *                                              Token + 获取引导）
 *   artifacts/ui/shot-4c-publish-login.png     闲鱼目标编辑器（独立登录）
 *   artifacts/ui/shot-5-result-card.png        result card with the publish menu
 *   artifacts/ui/shot-6-publish-menu.png       publish target dropdown
 *   artifacts/ui/shot-7-publish-dialog.png     prefilled publish preview dialog
 *   artifacts/ui/shot-8-publish-add-entry.png  empty-state publish menu with the
 *                                              persistent「+ 发布目标」entry
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
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENTRY = join(REPO_ROOT, 'out', 'main', 'index.js')
const ARTIFACTS = join(REPO_ROOT, 'artifacts', 'ui')
const PROFILE = join(REPO_ROOT, 'artifacts', 'ui-profile')
const ISOLATED_HOME = join(REPO_ROOT, 'artifacts', 'ui-home')
const CONSOLE_LOG = join(ARTIFACTS, 'console.log')
const CACHE_FILE = join(PROFILE, 'search-cache.json')

/** Catalog number whose query result is seeded into the search cache. */
const SEEDED_CATALOG = 'SICP-6480'

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

/**
 * Seed the persistent query cache so a search returns a result without touching
 * the network. That is what lets this script render a real result card (and
 * therefore the publish menu and dialog). The cache key embeds the app's
 * QUERY_CACHE_VERSION, so read it from source instead of hardcoding it.
 */
function seedQueryCache() {
  const cacheSource = readFileSync(join(REPO_ROOT, 'src', 'main', 'queries', 'cache.ts'), 'utf8')
  const version = /QUERY_CACHE_VERSION\s*=\s*(\d+)/.exec(cacheSource)?.[1] ?? '5'
  // Without a Discogs token the app uses the 'web' cache context.
  const key = `v${version}:discogs:web:${SEEDED_CATALOG}`
  writeFileSync(
    CACHE_FILE,
    JSON.stringify({
      queryResults: {
        [key]: {
          value: {
            platform: 'discogs',
            name: 'Animals (2018 Remix)',
            artist: 'Pink Floyd',
            priceMin: 159.19,
            priceMax: 159.19,
            coverUrl: '',
            link: 'https://www.discogs.com/release/24580325',
            status: 'found'
          },
          fetchedAt: Date.now()
        }
      },
      productDetails: {},
      enrichments: {}
    }),
    'utf8'
  )
  console.log(`${TAG} seeded query cache entry ${key}`)
}

seedQueryCache()

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
    env: {
      ...process.env,
      HOME: ISOLATED_HOME,
      // The app launches its own real Chrome (login status, publishing) from
      // inside this script's sandbox, where it can neither initialise
      // Chromium's own sandbox (SIGTRAP within seconds → macOS
      // 「Google Chrome 意外退出」) nor reach the login Keychain (macOS
      // 「找不到钥匙串」). The flag adds --no-sandbox + --use-mock-keychain.
      SUPER_CD_CHROME_RESTRICTED: '1'
    },
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

  // 3b. The header actions must stay one aligned row: WiFi, the 发布目标
  //     button (moved out of the settings panel) and 设置 share the exact same
  //     size and baseline, in that order.
  const headerButtons = await window.locator('.app-header-actions button').evaluateAll(buttons =>
    buttons.map(button => {
      const box = button.getBoundingClientRect()
      return {
        cls: button.className,
        top: Math.round(box.top),
        height: Math.round(box.height),
        width: Math.round(box.width)
      }
    })
  )
  check(
    '头部三个按钮同一行、同尺寸（WiFi → 发布目标 → 设置）',
    headerButtons.length === 3 &&
      headerButtons[1].cls.includes('publish-targets-button') &&
      headerButtons.every(item =>
        item.top === headerButtons[0].top &&
        item.height === headerButtons[0].height &&
        item.width === headerButtons[0].width
      ),
    JSON.stringify(headerButtons)
  )

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

  // 5. The LAN phone page. Electron is itself a Chromium, so the page is
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

  // 5b. The LAN panel itself. It used to grow after opening (status/QR arrived
  //     after the first paint and re-centred the flex-centred panel), so the
  //     box must stay put once it appears, and the QR must already be there.
  await window.locator('.lan-button').click()
  await window.waitForSelector('.lan-settings-panel', { timeout: 10000 })
  const lanEasing = await window.locator('.lan-settings-panel').evaluate(node => getComputedStyle(node).animationTimingFunction)
  check('弹窗入场缓动无回弹（不再冲过终点）', lanEasing === 'cubic-bezier(0.22, 1, 0.36, 1)', lanEasing)
  // boundingBox() includes the entrance transform, so measure only after the
  // 0.35s animation has settled.
  await window.waitForTimeout(500)
  const lanBoxBefore = await window.locator('.lan-settings-panel').boundingBox()
  await window.waitForTimeout(1200)
  const lanBoxAfter = await window.locator('.lan-settings-panel').boundingBox()
  check(
    '局域网面板打开后不再位移/长高',
    lanBoxBefore && lanBoxAfter &&
      Math.abs(lanBoxAfter.y - lanBoxBefore.y) <= 1 &&
      Math.abs(lanBoxAfter.height - lanBoxBefore.height) <= 1,
    `before=${JSON.stringify(lanBoxBefore)} after=${JSON.stringify(lanBoxAfter)}`
  )
  check('局域网面板首帧即含二维码', (await window.locator('.st-qr-image').count()) === 1)
  await window.screenshot({ path: join(ARTIFACTS, 'shot-3b-lan-panel.png') })
  checkScreenshot('局域网连接面板', join(ARTIFACTS, 'shot-3b-lan-panel.png'))
  await window.locator('.lan-settings-panel .settings-footer button', { hasText: '取消' }).click()
  await window.waitForTimeout(200)
  // Still on the 石墨文档 tab here (step 6 switches back below), so assert the
  // overlay is gone rather than the search panel being visible.
  check('关闭局域网面板后弹窗消失', (await window.locator('.lan-settings-panel').count()) === 0)

  // 6. Going back must still work (the app stays interactive after tab switches).
  await window.locator('.app-tabs button', { hasText: '搜索' }).click()
  await window.waitForTimeout(200)
  check('切回搜索页仍可交互', await window.locator('.left-panel .catalog-input').isVisible())

  // 6b. Settings panel: the redundant bottom-left 关闭 button is gone, the
  //     footer save button reads 保存, and saving closes the panel.
  await window.locator('.settings-button').click()
  await window.waitForSelector('.settings-panel', { timeout: 5000 })
  check('设置面板左下角没有「关闭」按钮', (await window.locator('.st-close-button').count()) === 0)
  check('设置面板底部保留「取消」', (await window.locator('.settings-footer .st-btn-cancel', { hasText: '取消' }).count()) === 1)
  const settingsSave = window.locator('.settings-footer .st-btn-save')
  const settingsSaveText = (await settingsSave.innerText()).trim()
  check('保存按钮文案为「保存」', settingsSaveText === '保存', settingsSaveText)
  await window.screenshot({ path: join(ARTIFACTS, 'shot-6b-settings.png') })
  checkScreenshot('设置面板（无左下关闭按钮）', join(ARTIFACTS, 'shot-6b-settings.png'))
  await settingsSave.click()
  await window.waitForTimeout(400)
  check('点击保存后设置弹窗自动关闭', (await window.locator('.settings-overlay').count()) === 0)
  check('关闭设置后回到搜索页', await window.locator('.left-panel .catalog-input').isVisible())

  // 7. Publish targets: the panel (opened from the header button) must list
  //    every configured target, including disabled ones (a disabled target that
  //    vanishes can never be re-enabled), and the editor must open.
  await window.evaluate(async () => {
    await window.electronAPI.updateSettings({
      // Only Discogs is searched: its result comes from the seeded cache, so the
      // publish UI can be exercised without any network traffic.
      standardPlatforms: ['discogs'],
      publishTargets: [
        {
          id: 'ui-smoke-xianyu',
          platform: 'xianyu',
          name: '冒烟-闲鱼号',
          // `account` is auto-detected by the app, never typed by the user.
          account: '',
          enabled: true,
          createdAt: Date.now(),
          xianyuCondition: '几乎全新',
          uploadCover: true
        },
        {
          id: 'ui-smoke-discogs',
          platform: 'discogs',
          name: '冒烟-Discogs停用',
          account: 'demo-user',
          enabled: false,
          createdAt: Date.now(),
          currency: 'USD',
          condition: 'Very Good Plus (VG+)',
          status: 'For Sale',
          // Credentials are per-target now; without a verified token the target
          // is locked, which is exactly what the assertions below check.
          token: 'smoke-token'
        }
      ]
    })
  })

  await window.locator('.publish-targets-button').click()
  await window.waitForSelector('.publish-settings-panel', { timeout: 5000 })
  await window.waitForSelector('.publish-target-row', { timeout: 10000 })
  // The panel is auto-height and flex-centred: with per-target badges seeded
  // on the first paint, resolving probes must not move or grow it. Measured
  // again right before the first editor opens (that growth is user-initiated
  // and out of scope here). boundingBox() includes the entrance transform, so
  // wait for the 0.35s animation to settle before the first measurement.
  await window.waitForTimeout(500)
  const publishBoxOpen = await window.locator('.publish-settings-panel').boundingBox()

  const targetNames = await window.locator('.publish-target-name').allTextContents()
  check(
    '发布目标面板列出全部目标（含已停用）',
    targetNames.includes('冒烟-闲鱼号') && targetNames.includes('冒烟-Discogs停用'),
    JSON.stringify(targetNames)
  )
  check('发布目标面板条目数为 2', targetNames.length === 2, String(targetNames.length))

  // Every 闲鱼 target owns an independent login, and its row reports that with a
  // status badge — but the login controls now live in the editor, not the row.
  const xianyuRow = window.locator('.publish-target-row', { hasText: '冒烟-闲鱼号' })
  await xianyuRow.locator('.publish-status-badge').first().waitFor({ timeout: 20000 })
  const xianyuBadge = await xianyuRow.locator('.publish-status-badge').first().innerText()
  check(
    '闲鱼目标显示独立登录状态徽标',
    ['Chrome 未启动', '未登录', '状态未知', '已登录'].some(text => xianyuBadge.includes(text)),
    xianyuBadge
  )
  check(
    '闲鱼行内不再有「扫码登录」按钮（已移入编辑框）',
    (await xianyuRow.locator('button', { hasText: '扫码登录' }).count()) === 0
  )
  check(
    '闲鱼行内不再有「退出登录」按钮（已移入编辑框）',
    (await xianyuRow.locator('button', { hasText: '退出登录' }).count()) === 0
  )
  check(
    'Discogs 目标不显示闲鱼扫码登录按钮',
    (await window.locator('.publish-target-row', { hasText: '冒烟-Discogs停用' }).locator('button', { hasText: '扫码登录' }).count()) === 0
  )

  // The seeded 闲鱼 target is ENABLED, so its switch is unlocked on purpose and
  // can always be switched off. What the gate protects is turning a target ON:
  // see the Discogs target below, which is off and unverified.
  const xianyuSwitch = xianyuRow.locator('.st-switch input[type="checkbox"]')
  check('已启用的闲鱼目标开关仍是打开的（可随时关闭）', await xianyuSwitch.isChecked())
  check('已启用的闲鱼目标开关未被锁定', !(await xianyuSwitch.isDisabled()))

  const discogsRow = window.locator('.publish-target-row', { hasText: '冒烟-Discogs停用' })
  await discogsRow.locator('.publish-status-badge').first().waitFor({ timeout: 20000 })
  const discogsSwitch = discogsRow.locator('.st-switch input[type="checkbox"]')
  check('未校验的 Discogs 目标开关被锁定', await discogsSwitch.isDisabled())
  check(
    '锁定开关带禁用态样式',
    (await discogsRow.locator('.st-switch.publish-switch-locked').count()) === 1
  )
  const discogsLockHint = discogsRow.locator('.publish-target-lock-hint').first()
  // The Discogs probe is an API call: wait for「检查登录状态…」to be replaced by
  // the real reason before reading it.
  await window.waitForFunction(
    () => !(document.querySelector('.publish-target-lock-hint')?.textContent ?? '').includes('检查登录状态'),
    { timeout: 40000 }
  ).catch(() => {})
  const discogsLockText = await discogsLockHint.innerText()
  check(
    'Discogs 锁定原因提示 Token / 校验',
    discogsLockText.includes('Token') || discogsLockText.includes('校验'),
    discogsLockText
  )

  // A locked switch must stay off even when it is forced, not merely look grey.
  await discogsSwitch.click({ force: true }).catch(() => {})
  await window.waitForTimeout(200)
  check('强制点击锁定开关也不会被打开', !(await discogsSwitch.isChecked()))

  // Review feedback: rows must line up, both platform tags must share one
  // colour treatment, and the enable toggle belongs at the very end.
  const rowBoxes = await window.locator('.publish-target-row').evaluateAll(rows =>
    rows.map(row => {
      const box = row.getBoundingClientRect()
      return { left: Math.round(box.left), width: Math.round(box.width) }
    })
  )
  check(
    '两条目标行宽度/左边界对齐',
    rowBoxes.length === 2 && rowBoxes.every(box => box.left === rowBoxes[0].left && Math.abs(box.width - rowBoxes[0].width) <= 1),
    JSON.stringify(rowBoxes)
  )

  const badgeColors = await window.locator('.publish-platform-badge').evaluateAll(badges =>
    badges.map(badge => {
      const style = getComputedStyle(badge)
      return `${style.color}|${style.backgroundColor}|${style.borderColor}`
    })
  )
  check(
    '闲鱼/Discogs 标签颜色一致',
    badgeColors.length >= 2 && badgeColors.every(color => color === badgeColors[0]),
    JSON.stringify(badgeColors)
  )

  const headActionCounts = await window.locator('.publish-target-actions').evaluateAll(actions =>
    actions.map(action => {
      const last = action.lastElementChild
      const buttons = [...action.querySelectorAll('button')].map(button => button.textContent?.trim() ?? '')
      return {
        switchLast: Boolean(last && last.querySelector('input[type="checkbox"]')),
        hasLogin: buttons.some(label => label.includes('扫码登录') || label.includes('退出登录')),
        buttonCount: buttons.length
      }
    })
  )
  check('每行「开关」都在最后', headActionCounts.every(item => item.switchLast), JSON.stringify(headActionCounts))

  // The action strip must stay a single line for both platforms; a wrapped
  // switch was exactly the misalignment this layout fixes.
  const headSingleLine = await window.locator('.publish-target-actions').evaluateAll(actions =>
    actions.every(action => {
      // Vertically centred items of different heights share a centre, not a top,
      // when they sit on one line; a wrapped line shifts the centre by ~half the
      // container height.
      const centres = [...action.children].map(child => child.offsetTop + child.offsetHeight / 2)
      return centres.length > 0 && Math.max(...centres) - Math.min(...centres) <= 3
    })
  )
  check('每行的按钮与开关在同一行（未换行）', headSingleLine)
  check(
    '两条目标行的按钮数一致（登录按钮已移入编辑框）',
    headActionCounts.length === 2 && headActionCounts[0].buttonCount === headActionCounts[1].buttonCount,
    JSON.stringify(headActionCounts)
  )
  check('行内按钮不含扫码登录/退出登录', headActionCounts.every(item => !item.hasLogin), JSON.stringify(headActionCounts))

  // The login controls live in the editor now, which is also the only place
  // that manages the target's own session / credential.
  const publishBoxSettled = await window.locator('.publish-settings-panel').boundingBox()
  check(
    '发布目标面板打开后不再位移/长高（探测落定后位置不变）',
    publishBoxOpen && publishBoxSettled &&
      Math.abs(publishBoxSettled.y - publishBoxOpen.y) <= 1 &&
      Math.abs(publishBoxSettled.height - publishBoxOpen.height) <= 1,
    `open=${JSON.stringify(publishBoxOpen)} settled=${JSON.stringify(publishBoxSettled)}`
  )
  await xianyuRow.locator('button', { hasText: '编辑' }).first().click()
  await window.waitForSelector('.publish-editor', { timeout: 5000 })
  const editorLogin = window.locator('.publish-editor .publish-editor-login')
  check('编辑框内有该目标的登录区块', await editorLogin.isVisible())
  const editorLoginButtons = await editorLogin.locator('button').allTextContents()
  check(
    '编辑框内提供「扫码登录 / 退出登录」',
    editorLoginButtons.some(label => label.includes('扫码登录')) &&
      editorLoginButtons.some(label => label.includes('退出登录')),
    JSON.stringify(editorLoginButtons)
  )
  check(
    '编辑框内说明该目标的登录/校验状态',
    (await editorLogin.locator('.publish-editor-login-hint').first().innerText()).length > 0
  )
  await editorLogin.scrollIntoViewIfNeeded()
  await window.waitForTimeout(250)
  await window.screenshot({ path: join(ARTIFACTS, 'shot-4c-publish-login.png') })
  checkScreenshot('闲鱼目标编辑框（登录区块）', join(ARTIFACTS, 'shot-4c-publish-login.png'))
  await window.locator('.publish-editor-cancel').first().click()
  await window.waitForTimeout(200)

  // Discogs target: its editor owns the required token plus the how-to guide.
  await discogsRow.locator('button', { hasText: '编辑' }).first().click()
  await window.waitForSelector('.publish-editor', { timeout: 5000 })
  check(
    'Discogs 编辑框内提供「测试连接」校验入口',
    await window.locator('.publish-editor .publish-editor-login button', { hasText: '测试连接' }).first().isVisible()
  )
  const tokenField = window.locator('.publish-editor-token input#publish-target-token')
  check('Discogs 编辑框内 Token 输入框存在', await tokenField.isVisible())
  const tokenLabel = await window.locator('.publish-editor-token .st-label').first().innerText()
  check('Token 标记为必填（*）', tokenLabel.includes('*'), tokenLabel)
  const tokenHelp = await window.locator('.publish-editor-token-help').first().innerText()
  check(
    'Token 获取引导含步骤与 Discogs 入口',
    tokenHelp.includes('Discogs') && tokenHelp.includes('Generate new token'),
    tokenHelp.slice(0, 120)
  )
  // The editor opens below the fold: scroll it into view before shooting, or
  // the screenshot proves nothing about the new blocks.
  await window.locator('.publish-editor-token-help').first().scrollIntoViewIfNeeded()
  await window.waitForTimeout(250)
  await window.screenshot({ path: join(ARTIFACTS, 'shot-4b-publish-token.png') })
  checkScreenshot('Discogs 目标编辑框（Token + 引导）', join(ARTIFACTS, 'shot-4b-publish-token.png'))
  await window.locator('.publish-editor-cancel').first().click()
  await window.waitForTimeout(200)
  // Look for a labelled「账户」field rather than a specific id/placeholder, so the
  // assertion cannot go vacuous when the markup is refactored.
  const accountFields = await window.locator('.publish-editor .st-field').evaluateAll(fields =>
    fields.filter(field => (field.querySelector('label')?.textContent ?? '').includes('账户')).length
  )
  check('编辑器不再有手填「账户」输入项', accountFields === 0, `fields=${accountFields}`)

  await window.locator('button', { hasText: '新增发布目标' }).first().click()
  await window.waitForSelector('.publish-editor', { timeout: 5000 })
  check('新增发布目标编辑器可打开', await window.locator('.publish-editor').isVisible())
  await window.waitForTimeout(300)
  await window.screenshot({ path: join(ARTIFACTS, 'shot-4-publish-settings.png') })
  checkScreenshot('发布目标面板（新增编辑器）', join(ARTIFACTS, 'shot-4-publish-settings.png'))

  // Closing the panel must leave the app usable again.
  await window.locator('.publish-settings-panel .settings-footer button', { hasText: '关闭' }).click()
  await window.waitForTimeout(200)
  check('关闭发布目标面板后回到搜索页', await window.locator('.left-panel .catalog-input').isVisible())

  // 8. A real result card (from the seeded cache) must expose the publish menu,
  //    and picking a target must open the prefilled preview dialog.
  await window.locator('.left-panel .catalog-input').fill(SEEDED_CATALOG)
  // `.search-button` specifically: a text match would hit the 搜索 tab button.
  await window.locator('.search-button').click()
  await window.waitForSelector('.result-card', { timeout: 30000 })
  // .result-card enters with `card-enter 0.5s ... backwards`, so a screenshot
  // taken immediately would capture a nearly transparent card.
  await window.waitForTimeout(700)

  const cardText = await window.locator('.result-card').first().innerText()
  check('搜索结果卡片渲染（标题来自缓存结果）', cardText.includes('Animals (2018 Remix)'), cardText.slice(0, 80))
  check('卡片右上角出现「发布 ▾」按钮', await window.locator('.publish-menu-button').first().isVisible())
  await window.screenshot({ path: join(ARTIFACTS, 'shot-5-result-card.png') })
  checkScreenshot('搜索结果卡片', join(ARTIFACTS, 'shot-5-result-card.png'))

  await window.locator('.publish-menu-button').first().click()
  await window.waitForSelector('.publish-menu-item', { timeout: 5000 })
  await window.waitForTimeout(250)
  const menuItems = await window.locator('.publish-menu-item').allTextContents()
  check(
    '发布下拉只列启用中的目标',
    menuItems.some(item => item.includes('冒烟-闲鱼号')) && !menuItems.some(item => item.includes('冒烟-Discogs停用')),
    JSON.stringify(menuItems)
  )
  await window.screenshot({ path: join(ARTIFACTS, 'shot-6-publish-menu.png') })
  checkScreenshot('发布下拉', join(ARTIFACTS, 'shot-6-publish-menu.png'))

  // 闲鱼 draft building is offline (no release lookup), so this stays deterministic.
  await window.locator('.publish-menu-item', { hasText: '冒烟-闲鱼号' }).first().click()
  await window.waitForSelector('.publish-dialog', { timeout: 20000 })
  // The draft waits for the exchange-rate lookup before the CNY price lands, so
  // wait for the rendered form rather than reading the loading state.
  await window.waitForSelector('.publish-dialog .publish-input', { timeout: 30000 })
  // The dialog slides in (modal-slide-up 0.35s); let it settle before shooting.
  await window.waitForTimeout(400)
  // Field values live in inputs (innerText does not include them), so read the
  // prefilled title/price directly.
  const titleValue = await window.locator('#publish-field-title').inputValue()
  const priceValue = await window.locator('#publish-field-price').inputValue()
  check(
    '发布预览弹层已按结果预填（标题/价格）',
    titleValue.includes('Pink Floyd') && titleValue.includes('Animals') && Number(priceValue) > 0,
    `title="${titleValue}" price="${priceValue}"`
  )
  check('预览弹层包含标题输入框', await window.locator('.publish-dialog .publish-input').first().isVisible())
  await window.screenshot({ path: join(ARTIFACTS, 'shot-7-publish-dialog.png') })
  checkScreenshot('发布预览弹层', join(ARTIFACTS, 'shot-7-publish-dialog.png'))

  await window.locator('.publish-dialog-close').click()
  await window.waitForTimeout(200)
  check('关闭发布弹层后回到搜索页', await window.locator('.left-panel .catalog-input').isVisible())

  // 9. Discoverability: with NO publish target configured the result card must
  //    still show 发布 ▾, and its dropdown must offer the persistent
  //    「+ 发布目标」 entry, which opens the panel — that is how users learn
  //    the feature exists. Closing the panel is also what refreshes the card
  //    menus, so the empty state is reached through the real code path.
  await window.evaluate(async () => {
    await window.electronAPI.updateSettings({ publishTargets: [] })
  })
  await window.locator('.publish-targets-button').click()
  await window.waitForSelector('.publish-settings-panel', { timeout: 5000 })
  check('无目标时也能打开发布目标面板', await window.locator('.publish-settings-panel').isVisible())
  await window.locator('.publish-settings-panel .settings-footer button', { hasText: '关闭' }).click()
  await window.waitForTimeout(300)

  await window.locator('.left-panel .catalog-input').fill(SEEDED_CATALOG)
  await window.locator('.search-button').click()
  await window.waitForSelector('.result-card', { timeout: 30000 })
  await window.waitForTimeout(700)

  check('未配置目标时卡片仍显示「发布 ▾」按钮', await window.locator('.publish-menu-button').first().isVisible())
  await window.locator('.publish-menu-button').first().click()
  await window.waitForSelector('.publish-menu-dropdown', { timeout: 5000 })
  await window.waitForTimeout(250)
  const addEntry = window.locator('.publish-menu-item-add').first()
  const addEntryText = (await addEntry.innerText()).replace(/\s+/g, '')
  check('空态下拉提供「+ 发布目标」入口', addEntryText === '+发布目标', addEntryText)
  const emptyMenuTargets = await window.locator('.publish-menu-item:not(.publish-menu-item-add)').count()
  check('空态下拉不列任何目标', emptyMenuTargets === 0, String(emptyMenuTargets))
  await window.screenshot({ path: join(ARTIFACTS, 'shot-8-publish-add-entry.png') })
  checkScreenshot('空态发布下拉（+ 发布目标入口）', join(ARTIFACTS, 'shot-8-publish-add-entry.png'))

  await addEntry.click()
  await window.waitForSelector('.publish-settings-panel', { timeout: 5000 })
  check('点击「+ 发布目标」打开发布目标面板', await window.locator('.publish-settings-panel').isVisible())
  await window.locator('.publish-settings-panel .settings-footer button', { hasText: '关闭' }).click()
  await window.waitForTimeout(200)

  // 10. No renderer-side errors across every step above.
  check('渲染进程无 console.error', consoleErrors.length === 0, consoleErrors.join(' | '))
  check('渲染进程无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
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
