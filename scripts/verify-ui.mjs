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
 *   artifacts/ui/shot-3-mobile.png   LAN phone search page (rendered in a
 *                                    throwaway hidden Electron window)
 *   artifacts/ui/shot-3b-lan-panel.png  LAN panel (header button; must not
 *                                    move/grow after opening)
 *   artifacts/ui/shot-6b-settings.png     settings panel (no bottom-left close
 *                                        button, footer save reads 保存)
 *   artifacts/ui/shot-6b-apify.png        Apify 搜索源设置分区（Token /
 *                                        Actor / 运行参数）
 *   artifacts/ui/shot-6b-feishu.png       飞书多维表格设置分区（开关 / 凭证）
 *   artifacts/ui/shot-5-result-card.png        result card from the seeded cache
 *   artifacts/ui/shot-7-platform-detail.png    expanded per-platform detail panel
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
 * the network. That is what lets this script render a real result card. The
 * cache key embeds the app's
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
            status: 'found',
            // Raw rows that also feed the per-platform Feishu detail table.
            // Empty cover_image and a relative uri deliberately exercise the
            // placeholder / non-link paths in PlatformDetailPanel.
            rawItems: [
              {
                id: 24580325,
                title: 'Animals (2018 Remix)',
                catno: 'SICP-6480',
                year: '2018',
                format: 'CD, Album',
                cover_image: '',
                uri: '/release/24580325',
                communityHave: 120,
                communityWant: 45
              },
              {
                id: 24580326,
                title: 'Animals (2018 Remix) [Limited]',
                catno: 'SICP-6480',
                year: '2018',
                format: 'CD',
                cover_image: '',
                uri: '/release/24580326',
                communityHave: 10,
                communityWant: 3
              }
            ]
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
      HOME: ISOLATED_HOME
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

  await window.waitForSelector('.app-main', { timeout: 30000 })

  // 1. App shell boots from the built bundle.
  const url = window.url()
  const title = await window.title()
  check(
    '应用启动（构建产物 + 标题）',
    url.endsWith('/out/renderer/index.html') && title === 'Super CD Search',
    `url=${url} title=${title}`
  )

  // 2. No leftover copy from retired features.
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

  // 3b. The header actions must stay one aligned row: WiFi and 设置 share the
  //     exact same size and baseline, in that order.
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
    '头部两个按钮同一行、同尺寸（WiFi → 设置）',
    headerButtons.length === 2 &&
      headerButtons.every(item =>
        item.top === headerButtons[0].top &&
        item.height === headerButtons[0].height &&
        item.width === headerButtons[0].width
      ),
    JSON.stringify(headerButtons)
  )

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
      '手机端搜索页内容（有搜索/扫码，无 CD 库）',
      mobileText.includes('远程搜索') &&
        mobileText.includes('扫码添加编号') &&
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
  // Assert the overlay is gone after closing the LAN panel.
  check('关闭局域网面板后弹窗消失', (await window.locator('.lan-settings-panel').count()) === 0)

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

  // 6b-2. The Apify section and the Taobao/Xianyu platforms must be reachable
  //       from the settings nav and the sources grid respectively.
  const apifyNav = window.locator('.settings-nav-item', { hasText: '淘宝 / 闲鱼 (Apify)' })
  check('设置导航出现「淘宝 / 闲鱼 (Apify)」分区', (await apifyNav.count()) === 1)
  await apifyNav.click()
  await window.waitForTimeout(200)
  check('Apify 分区提供 Token 密码输入框', (await window.locator('.st-section-content input[type="password"]').count()) === 1)
  check('Apify 分区提供两个 Actor ID 输入框', (await window.locator('.st-section-content input[type="text"]').count()) === 2)
  check('Apify 分区提供三个运行参数数字输入框', (await window.locator('.st-section-content input[type="number"]').count()) === 3)
  await window.screenshot({ path: join(ARTIFACTS, 'shot-6b-apify.png') })
  checkScreenshot('Apify 搜索源设置分区', join(ARTIFACTS, 'shot-6b-apify.png'))

  // 6b-3. The Feishu archiving section must expose the master switch, all
  //       four credential inputs (one of them a password field) and the
  //       mapping-table id input.
  const feishuNav = window.locator('.settings-nav-item', { hasText: '飞书多维表格' })
  check('设置导航出现「飞书多维表格」分区', (await feishuNav.count()) === 1)
  await feishuNav.click()
  await window.waitForTimeout(200)
  check('飞书分区提供启用开关', (await window.locator('[data-field="feishu-enabled"]').count()) === 1)
  check('飞书分区提供图片同步开关', (await window.locator('[data-field="feishu-syncImages"]').count()) === 1)
  check('图片同步开关默认关闭', !(await window.locator('[data-field="feishu-syncImages"]').isChecked()))
  const feishuFields = ['feishu-appId', 'feishu-appSecret', 'feishu-appToken', 'feishu-tableId']
  const feishuCounts = await Promise.all(feishuFields.map(field => window.locator(`[data-field="${field}"]`).count()))
  check('飞书分区提供四个凭证输入框', feishuCounts.every(count => count === 1), JSON.stringify(feishuCounts))
  check('飞书分区把 App Secret 作为密码输入框',
    (await window.locator('[data-field="feishu-appSecret"][type="password"]').count()) === 1)
  check('飞书分区提供映射表 Table ID 输入框',
    (await window.locator('[data-field="feishu-mappingTableId"]').count()) === 1)
  check('飞书分区提供测试连接按钮',
    (await window.locator('.st-section-content .st-btn-cancel', { hasText: '测试连接' }).count()) === 1)
  await window.screenshot({ path: join(ARTIFACTS, 'shot-6b-feishu.png') })
  checkScreenshot('飞书多维表格设置分区', join(ARTIFACTS, 'shot-6b-feishu.png'))
  // The mapping-table input sits below the fold; scroll to it for a visual check.
  await window.locator('[data-field="feishu-mappingTableId"]').scrollIntoViewIfNeeded()
  await window.waitForTimeout(200)
  await window.screenshot({ path: join(ARTIFACTS, 'shot-6b-feishu-mapping.png') })
  checkScreenshot('飞书映射表 Table ID 输入框', join(ARTIFACTS, 'shot-6b-feishu-mapping.png'))

  await window.locator('.settings-nav-item', { hasText: '搜索源' }).click()
  await window.waitForTimeout(200)
  const sourceLabels = await window.locator('.st-platform-grid .st-check-name').allInnerTexts()
  check('搜索源勾选框包含闲鱼与淘宝',
    sourceLabels.includes('闲鱼') && sourceLabels.includes('淘宝'),
    JSON.stringify(sourceLabels))

  await settingsSave.click()
  await window.waitForTimeout(400)
  check('点击保存后设置弹窗自动关闭', (await window.locator('.settings-overlay').count()) === 0)
  check('关闭设置后回到搜索页', await window.locator('.left-panel .catalog-input').isVisible())

  // 7. Only Discogs is searched: its result comes from the seeded cache, so
  //    the result card renders without any network traffic.
  await window.evaluate(async () => {
    await window.electronAPI.updateSettings({ standardPlatforms: ['discogs'] })
  })

  // 8. A real result card from the seeded cache must render correctly.
  await window.locator('.left-panel .catalog-input').fill(SEEDED_CATALOG)
  // `.search-button` specifically: a text match would hit the 搜索 tab button.
  await window.locator('.search-button').click()
  await window.waitForSelector('.result-card', { timeout: 30000 })
  // .result-card enters with `card-enter 0.5s ... backwards`, so a screenshot
  // taken immediately would capture a nearly transparent card.
  await window.waitForTimeout(700)

  const cardText = await window.locator('.result-card').first().innerText()
  check('搜索结果卡片渲染（标题来自缓存结果）', cardText.includes('Animals (2018 Remix)'), cardText.slice(0, 80))
  await window.screenshot({ path: join(ARTIFACTS, 'shot-5-result-card.png') })
  checkScreenshot('搜索结果卡片', join(ARTIFACTS, 'shot-5-result-card.png'))

  // 8b. The per-platform detail panel: toggle, tabs, table and collapse.
  const detailToggle = window.locator('.result-detail-toggle')
  check('结果行含平台详情展开按钮', (await detailToggle.count()) === 1)
  check('展开按钮初始 aria-expanded=false', (await detailToggle.getAttribute('aria-expanded')) === 'false')
  await detailToggle.click()
  await window.waitForSelector('.platform-detail-panel', { timeout: 5000 })
  check('展开后 aria-expanded=true', (await detailToggle.getAttribute('aria-expanded')) === 'true')
  const tabTexts = await window.locator('.platform-detail-tab').allInnerTexts()
  check('出现 Discogs 平台标签', tabTexts.includes('Discogs'), JSON.stringify(tabTexts))
  const tableText = await window.locator('.platform-detail-table').innerText()
  check('明细表格含缓存原始行与列名',
    tableText.includes('Animals (2018 Remix)') && tableText.includes('title'), tableText.slice(0, 80))
  check('明细表格按原始条数渲染',
    (await window.locator('.platform-detail-table tbody tr').count()) === 2)
  check('相对路径 uri 与空封面不渲染为链接',
    (await window.locator('.platform-detail-table a').count()) === 0)
  const scrollState = await window.locator('.platform-detail-table-scroll').evaluate(el => {
    const scrollWidth = el.scrollWidth
    const clientWidth = el.clientWidth
    el.scrollLeft = scrollWidth
    const after = el.scrollLeft
    el.scrollLeft = 0
    return { scrollWidth, clientWidth, after }
  })
  check('明细表格可横向滚动查看全部列',
    scrollState.scrollWidth > scrollState.clientWidth && scrollState.after > 0,
    JSON.stringify(scrollState))
  await window.waitForTimeout(500)
  await window.screenshot({ path: join(ARTIFACTS, 'shot-7-platform-detail.png') })
  checkScreenshot('平台详情展开面板', join(ARTIFACTS, 'shot-7-platform-detail.png'))
  await detailToggle.click()
  check('再次点击收起面板', (await window.locator('.platform-detail-panel').count()) === 0)

  // 9. No renderer-side errors across every step above.
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
