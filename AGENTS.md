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

- **触发条件**：改动涉及界面时必须跑，不能只跑单测 —— `src/renderer/**`、`src/renderer/src/i18n.tsx`、任何 `*.css`、`src/renderer/src/Publish.tsx`、`src/main/lan/mobile.ts`（局域网手机端内联页面）。
- **命令**：`npm run verify:ui`（先 `npm run build`，再用 playwright-core 的 `_electron` 启动真实 Electron 跑 `scripts/verify-ui.mjs`）。
- **必须看图**：截图输出到 `artifacts/ui/*.png`，用 `read_image` 打开确认视觉效果；**断言通过不等于界面没问题**（排版、居中、遮挡只有看图才知道）。
- **产物**：`artifacts/ui/` 下有多张截图（搜索页 / 石墨文档占位页 / 手机端搜索页 / 发布目标设置 / 发布目标编辑框 / 结果卡片 / 发布下拉 / 发布预览弹层）与 `console.log`（主进程 + 渲染进程日志）。目录已 gitignore。
- **隔离要求**：脚本强制使用工作区内的临时 profile（`artifacts/ui-profile/`、`artifacts/ui-home/`），禁止读写用户真实 userData（`~/Library/Application Support/super-cd-search`）。
- **失败处理**：断言失败时命令以非 0 退出，产物保留；先看 `console.log`，再按需补断言。
- **维护**：新增/修改界面功能时，在 `scripts/verify-ui.mjs` 里补一条对应断言（沿用 `check(name, ok, detail)`），让后续改动可以被同一条命令验证。
- `_electron` 是 Playwright 的 experimental API，依赖组合固定为 `playwright-core ^1.63.0` + `Electron 41.x`（已验证可用）。
- **应用自己启动的 Chrome**（扫码登录 / 抓取 / 发布）在受限宿主里有两处坑：无法初始化 Chromium 自身 sandbox（SIGTRAP 秒退 → macOS 弹「Google Chrome 意外退出」），以及连不上登录钥匙串（macOS 弹「找不到钥匙串」）。因为我们是自己 `spawn` Chrome 再 CDP 连接，`puppeteer.launch()` 的默认参数（含 `--use-mock-keychain`）并不生效。`scripts/verify-ui.mjs` 因此传 `SUPER_CD_CHROME_RESTRICTED=1`（仅该开关打开时加 `--no-sandbox --use-mock-keychain`，生产不受影响）；在任何受限 shell 里手动跑应用时同样可以这样设置。

## 发布版本（release）

- **触发条件**：用户说「发布新版本 / 提交并 push 并生成新版本」时，**一次性做完**下面全部步骤（打包、Release 正文、CI 成功确认），不要只做一半就收尾。
- **版本号来源**：**git tag 是唯一事实来源** —— CI（`.github/workflows/build-release.yml`，`on: push tags v*`）会先 `npm version "$VERSION" --no-git-tag-version` 回写，再打包。
- **发布前必跑**：`npm test`；`npm run typecheck`；改动涉及界面时 `npm run verify:ui`（见上节，并要 `read_image` 看图）。
- **步骤**：
  1. 确认工作区状态；版本号 bump 与本次改动**放在同一个提交**里：
     ```bash
     npm version <X.Y.Z> --no-git-tag-version   # 只改 package.json / package-lock.json
     git add -A && git commit -m "feat: …"
     git push origin main
     ```
  2. 打 tag 并推送（tag 必须是 `vX.Y.Z`，工作流靠它推导版本号）：
     ```bash
     git tag -a v<X.Y.Z> -m "v<X.Y.Z>" && git push origin v<X.Y.Z>
     ```
  3. 等 CI 两个平台建完（约 5 分钟），确认三件事，然后才可以说「发布完成」：
     - job 全部 `success`；Release 里同时有 macOS（`.dmg` + `.zip` 及 `.blockmap`）与 Windows（`setup.exe` + `win.zip`）；`latest.yml` / `latest-mac.yml` 也在（自动更新靠它们）
     - 可用 curl 查：`https://api.github.com/repos/stubenhuang/super-cd-search/actions/runs?per_page=3`
- **Release 正文（release note）**：
  - 正文必须描述**本次 tag 与上一个 tag 之间的差异**（用户视角，中文）。不要想当然：先 `git log --oneline <上一个tag>..HEAD`，注意有些大功能是在上一个 tag **之后**才合并的。
  - 写好后存到 `artifacts/release-notes-v<版本>.md`（`artifacts/` 已 gitignore），方便用户复核与后续微调。
- **用 API 更新正文（本机没有 gh CLI）**：
  - `gh auth status` 会报 command not found；token 在 shell 的 `~/.zshrc` 里以 `GH_TOKEN` 导出，非交互 shell 不会自动加载，用前先 `. ~/.zshrc`。
  - **坑**：`PATCH /releases/tags/<tag>` 会返回 404，必须用做 `GET` 拿到的 release **id** 再 PATCH。
  - 示例（一条命令完成「取 id + 比对差异 + 写回」，避免 heredoc 与 API 调用拆开导致 token 失效）：
    ```bash
    set -a && . ~/.zshrc >/dev/null 2>&1; set +a
    python3 - <<'PY'
    import json, os, urllib.request
    token = os.environ['GH_TOKEN']
    body = open('artifacts/release-notes-v1.0.5.md', encoding='utf-8').read().strip()
    hdr = {'Authorization': f'Bearer {token}', 'Accept': 'application/vnd.github+json',
           'Content-Type': 'application/json', 'User-Agent': 'super-cd-search-release-notes'}
    base = 'https://api.github.com/repos/stubenhuang/super-cd-search/releases'
    with urllib.request.urlopen(urllib.request.Request(f'{base}/tags/v1.0.5', headers=hdr)) as r:
        rid = json.load(r)['id']
    req = urllib.request.Request(f'{base}/{rid}', data=json.dumps({'body': body}).encode(),
                                 method='PATCH', headers=hdr)
    with urllib.request.urlopen(req) as r:
        out = json.load(r)
    print('updated:', out['tag_name'], '| assets:', len(out['assets']))
    PY
    ```
  - **禁止**把 token 明文写进文件、命令回显或提交；**禁止**用空正文覆盖（会清掉现有内容）。
- **不要做**：本地跑 `npm run dist` / `npm run pack` 出包（CI 会做）；重复推同一个 tag；对已发布的 tag 追加改动（只能发新版本号）。
