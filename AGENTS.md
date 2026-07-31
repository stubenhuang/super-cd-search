# AGENTS.md

本文件为 Codex (Codex.ai/code) 在此仓库中工作时提供指导。

## 语言偏好

**永远使用中文回复用户。** 所有对话、解释、更新说明都必须用中文。代码注释可以用英文，但与用户的沟通必须用中文。

## 构建与开发命令

```bash
npm run dev          # 启动开发服务器（热重载）
npm run build        # 生产构建（输出到 ./out）
npm run preview       # 预览生产构建
npm run typecheck    # TypeScript 类型检查
npm run lint         # 代码检查（当前为空操作）
npm run rebuild      # 重新构建 better-sqlite3 原生模块
npm run dist         # 构建并打包为 macOS 应用（DMG/ZIP）
```

## 架构概览

这是一个 macOS Electron 桌面应用，用于通过目录号批量查询多个平台（Discogs、eBay、Kojima Rokuon、HMV、Yahoo Shopping）的 CD 信息。

### 进程结构

```
src/
├── main/          # Electron 主进程 (Node.js)
├── preload/       # IPC 上下文桥接
└── renderer/      # React UI（浏览器环境）
```

### 主进程组件

**浏览器池** (`src/main/browser/`)
- 管理带隐身插件的共享 Puppeteer 实例
- 最多 2 个并发浏览器，带指纹随机化
- 使用 `browserPool.acquire()` / `browserPool.release()` 模式

**限流器** (`src/main/throttle/`)
- 按域名限速（请求间 2-6 秒随机延迟）
- 429 响应时指数退避（2s → 4s → 8s，最多 3 次重试）

**编排器** (`src/main/orchestrator/`)
- 协调跨平台批量查询
- 最多 3 个并发目录号，每批最多 10 个
- 通过 `win.webContents.send('query:progress', data)` 发送进度事件

**平台查询** (`src/main/queries/`)
- 每个平台导出 `queryPlatform(catalogNumber: string): Promise<QueryResult>`
- 优先使用 API（如已配置凭证），否则回退到网页抓取
- 所有价格通过 `src/main/currency/` 转换为 USD

**数据库** (`src/main/database/`)
- SQLite via better-sqlite3，WAL 模式
- 表：`queries`（catalog_number, created_at）和 `results`（query_id, platform, name, artist, price_min, price_max, cover_url, link, status）
- 存储位置：`~/Library/Application Support/super-cd-search/super-cd-search.db`

**设置** (`src/main/settings/`)
- 使用 electron-store 加密存储敏感数据（API 令牌、cookies）
- 关键设置：`discogsToken`、`ebayClientId`、`ebayClientSecret`、`cookies`

**导出** (`src/main/export/`)
- 基于 ExcelJS 导出 .xlsx，带原生保存对话框

### IPC 通信

渲染进程 → 主进程：`ipcRenderer.invoke()` 用于异步操作
主进程 → 渲染进程：`win.webContents.send()` 用于进度事件

详见 `src/preload/index.ts` 查看暴露的 API 方法。

## 提交规则

- **README.md** 是项目介绍文档，须保持简洁。每次提交代码前，需判断本次变更是否需要同步更新 README.md（如新增平台、修改架构、变更命令等），若需要则一并更新。

## 关键模式

- **浏览器获取**：始终用 `try/finally` 将浏览器释放回池中
- **限流**：所有 HTTP 请求使用 `throttledFetch(domain, url)`
- **货币**：任何非 USD 价格调用 `convertToUSDWithFallback()`
- **数据库事务**：多个插入操作用 `db.transaction(() => { ... })` 包装
