# Super CD Search

一款 Electron 桌面应用，支持通过目录号在多个平台批量查询 CD 信息。

## 功能特性

- **多平台搜索**：从 Discogs、eBay、Kojima Rokuon、HMV、Yahoo Shopping、CDJapan、Tower Records、Suruga-ya、ZenMarket 查询 CD 信息
- **详情聚合**：详情页汇总所有来源，有效字段最多的来源优先，其余来源补缺，尽量拼出完整元数据
- **智能生成**：详情字段缺失时，可按 Tower → HMV → CDJapan → Kojima → Yahoo → Suruga-ya → ZenMarket 的可靠性顺序逐源抓取详情页并调用 LLM 补齐（固定排除 Discogs 与 eBay；搜索过程不会自动调用 LLM）
- **批量处理**：同时搜索多个目录号
- **并行加速**：同一目录号的多平台并行查询、按域名智能限速
- **缓存加速**：查询结果、产品详情页与 LLM 智能生成结果缓存（1 天、跨会话磁盘持久化，可在设置中一键清空）、SOCKS 代理连接复用、封面缩略图懒加载
- **价格对比**：跨平台比较价格
- **币种切换**：价格支持美元（USD）与人民币（CNY）显示切换
- **主题切换**：支持白色、黑色与跟随系统三种外观
- **语言切换**：界面支持中文 / English 双语切换

## 支持平台

| 平台 | 方式 | 备注 |
|------|------|------|
| Discogs | API + 网页抓取 | 需配置 API Token 以获得最佳结果 |
| eBay | API + 网页抓取 | 需配置 OAuth 凭证 |
| Kojima Rokuon | 网页抓取 | 日本 CD 零售商 |
| HMV Japan | 网页抓取 | 日本 CD 零售商 |
| Yahoo Shopping | 网页抓取 | 日本电商平台 |
| CDJapan | 网页抓取 | 日本 CD 直邮商店，按目录号直达商品页 |
| Tower Records | 网页抓取 | 日本最大唱片连锁 |
| Suruga-ya | 网页抓取 | 日本二手商店，需先在设置中完成 Cloudflare 验证 |
| ZenMarket | 网页抓取 | 日本代购平台，需先在设置中完成 Cloudflare 验证 |

## 安装

### 环境要求

- Node.js 18+
- npm

### 开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

> Windows 下可直接用 `.\super-cd.ps1 fresh`（等价于清理 + 构建 + 启动开发服务器）。

### 测试

```bash
# 运行单元测试
npm test

# 运行单元测试并检查覆盖率（要求各指标 ≥ 70%）
npm run test:coverage
```

### 构建

```bash
# 生产构建
npm run build

# 打包为 macOS 应用 (DMG/ZIP)
npm run dist

# 打包为 Windows 应用 (ZIP / portable)
npm run dist:win
```

> Windows 下也可用 `.\super-cd.ps1 win` 打包；macOS / Linux 下用 `./super-cd.sh win` 交叉打包 Windows 应用。

## 配置

可在设置面板中配置 API 凭证与搜索源：

- **外观（Appearance）**：支持「白色」「黑色」「跟随系统」三种主题（选择「跟随系统」时随 macOS 深色 / 浅色模式自动切换），并可切换界面语言（中文 / English）
- **搜索源（Search Sources）**：分别管理「标准搜索」与「深度搜索」两种模式所查询的平台（默认标准 = Discogs + eBay，深度 = 全部平台）
- **Fast Mode（跳过详情页）**：跳过商品详情页导航，以更少请求换取更快速度（详情字段可能缺失）
- **LLM 智能生成**：配置 OpenAI 兼容 API 后，详情页出现缺失字段时会显示「智能生成」按钮；点击后按可靠性顺序逐源抓取详情页，仅向 LLM 询问缺失字段，补齐即停（不会在搜索时自动解析，且固定排除 Discogs 与 eBay）
- **Cloudflare 验证**：Suruga-ya 与 ZenMarket 使用 Cloudflare 反爬，需在设置面板点击「启动 Chrome 并验证」，应用会拉起一个真实 Chrome 窗口；在里面手动完成一次 Cloudflare 验证后，搜索会直接在这个 Chrome 里进行（需保持该 Chrome 窗口开启，验证有效期通常 30 分钟～数小时，失效后重新验证即可）
- **Discogs API Token**：Discogs 个人访问令牌
- **eBay Client ID**：eBay 开发者门户 OAuth 客户端 ID
- **eBay Client Secret**：eBay 开发者门户 OAuth 客户端密钥

凭证使用加密方式本地存储。

## 调试日志

- 开发模式（`npm run dev`）默认输出 **DEBUG** 级别日志到控制台
- 打包后的应用默认输出 **INFO** 级别，并写入日志文件：
  - macOS: `~/Library/Application Support/super-cd-search/logs/super-cd-YYYYMMDD.log`
  - Windows: `%APPDATA%/super-cd-search/logs/super-cd-YYYYMMDD.log`
- 手动开启 DEBUG：
  - 启动参数：`super-cd --log-level=debug`
  - 环境变量：`SUPER_CD_LOG_LEVEL=debug`
- 日志每天轮转，单文件超过 5 MB 自动轮转，最多保留 10 个文件
- 日志会自动脱敏 API Key、Token、Cookie 等敏感信息，长内容自动截断
- 渲染进程的关键操作（搜索、深挖、智能生成、设置保存）也会转发到主进程日志

## 技术栈

- **Electron** - 桌面应用框架
- **React** - UI 组件
- **TypeScript** - 类型安全
- **Puppeteer** - 网页抓取

## 许可证

MIT
