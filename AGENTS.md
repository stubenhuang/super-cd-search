## 思维方式
> 不清楚的地方要主动提问, 不要猜测, 确定好需求

## 项目定位

Super CD Search 面向 **CD 卖家**：按目录号批量查询多平台 CD 信息，聚合详情、比价、LLM 补全，并支持把结果发布到闲鱼 / Discogs。

## 技术栈

- 语言：**TypeScript**（`strict`），少量 JavaScript（`scripts/*.mjs` 构建脚本、LAN 移动端内联页面脚本）。
- 桌面壳：**Electron**，三进程结构 —— 主进程 `src/main/`、预加载 `src/preload/`、渲染进程 `src/renderer/`，共享类型在 `src/shared/`，通过 IPC 通信。
- 构建/打包：**electron-vite**（Vite）+ `@vitejs/plugin-react`，产物 `out/`；打包用 **electron-builder**。
- 前端：**React 19**（函数组件 + Hooks），纯 CSS，无路由与状态管理库。
- 抓取/解析：**Puppeteer**（`puppeteer-extra` + stealth 插件、`socks-proxy-agent` 代理）、**jsdom** + `@mozilla/readability`。
- 主要依赖：`electron-store`（配置）、`electron-updater`（更新）、`zxing-wasm`（条码）、Node 内置 `http`（局域网移动端服务）。

## 日志规范

- 主进程统一用 `logger`（`src/main/logger.ts`），禁止直接 `console.*`。
- 级别：`debug` < `info` < `warn` < `error`。
- 格式：`logger.debug('module.tag', 'message', { meta })`。
- 开发默认 `debug`，打包默认 `info`；支持 `--log-level=debug` 和 `SUPER_CD_LOG_LEVEL`。
- 敏感信息（key/token/cookie）必须脱敏，长内容自动截断。
- 渲染进程日志用 `window.electronAPI.log(level, tag, message, meta)`。

## 测试规范

- 框架：Vitest，测试放在 `tests/*.test.ts`。
- Electron 依赖通过 `tests/setup.ts` mock。
- 纯函数必须直接单测，网络/浏览器逻辑用 mock。
- 覆盖率阈值：语句/分支/函数/行 ≥ 70%。
- 命令：
  - `npm test`
  - `npm run test:coverage`
  - `npm run typecheck`
  - `npm run verify:ui`（界面冒烟，见下节；不在 `npm test` 内）

## 界面验证（UI 冒烟）

- **改了界面就要跑 `npm run verify:ui`**（先 `build`，再用 playwright-core `_electron` 启动真实 Electron 跑 `scripts/verify-ui.mjs`）。触发范围：`src/renderer/**`、`i18n.tsx`、任何 `*.css`、`src/main/lan/mobile.ts`。
- **必须 `read_image` 看图**（`artifacts/ui/*.png`，含 `console.log`；目录已 gitignore）：断言通过 ≠ 界面没问题，排版/遮挡只有看图才知道。
- 脚本用工作区内临时 profile，不碰真实 userData；失败非 0 退出并保留产物，先看 `console.log`。
- 新增/改界面功能时在 `scripts/verify-ui.mjs` 补一条 `check(name, ok, detail)`。依赖固定 `playwright-core ^1.63.0` + `Electron 41.x`。
- 受限宿主里跑应用（扫码登录 / 抓取 / 发布会自己 `spawn` Chrome）需 `SUPER_CD_CHROME_RESTRICTED=1` 才会加 `--no-sandbox --use-mock-keychain`（`puppeteer.launch()` 的默认参数在这里不生效），否则会 SIGTRAP 秒退或弹钥匙串错误。

## 发布版本（release）

- 用户说「发布新版本」就一次做完：**测试 → bump → tag → 等 CI → release note**。
- 版本号以 **tag 为唯一事实来源**，CI（`.github/workflows/build-release.yml`，`on: push tags v*`）用 tag 回写后再打包。
- 发布前跑 `npm test`、`npm run typecheck`；动了界面还要 `npm run verify:ui`。
- 步骤：`npm version <X.Y.Z> --no-git-tag-version` → 与改动同一个提交 → `git push origin main` → 打 `v<X.Y.Z>` tag 并推送 → 等 CI 双平台成功，确认 Release 里有 macOS/Windows 安装包与 `latest*.yml` 才算完成。
- Release note：讲**本次 tag 与上一个 tag 的差异**（用户视角中文），先 `git log --oneline <上一个tag>..HEAD`；草稿存 `artifacts/release-notes-v<版本>.md`（已 gitignore）。
- 写回 GitHub 不能用 `gh`（未安装）：token 在 `~/.zshrc` 的 `GH_TOKEN`，先 `. ~/.zshrc`；`PATCH /releases/tags/<tag>` 会 404，要 `GET` 拿到 release **id** 再 PATCH。禁止明文回显/提交 token、禁止空正文覆盖。
- 不要本地 `npm run dist` / `pack` 出包，不要重复推同一 tag，不要改动已发布的 tag。
