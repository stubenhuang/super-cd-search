## 思维方式
> 不清楚的地方要主动提问, 不要猜测, 确定好需求

## 项目定位

Super CD Search 面向 **CD 卖家**：按目录号批量查询多平台 CD 信息，聚合详情、比价、LLM 补全并导出 Excel。

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
