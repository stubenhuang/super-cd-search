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
- **Excel 导出**：结果页一键导出编号、实际封面图片、详情及美元/人民币最低价和最高价；导出前可选择目标目录，并自动执行「深挖」或「智能生成」补齐
- **本地 CD 库**：搜索、深挖和智能生成后的有效结果自动写入 SQLite；支持手动增改、编号搜索、分页、选择、批量删除以及新版 7 列 Excel 导入/导出
- **双币种价格列**：Excel 与 CD 库统一保存最低价($)、最高价($)、最低价(￥)、最高价(￥)四个数值字段，人民币价格按入库时汇率固定
- **币种切换**：价格支持美元（USD）与人民币（CNY）显示切换
- **主题切换**：支持白色、黑色与跟随系统三种外观
- **语言切换**：界面支持中文 / English 双语切换
- **局域网连接**：点击首页顶部的手机连接图标，启动只监听局域网地址的本地服务，手机扫码即可连接（二维码内含随机访问令牌，不会绑定公网地址）
- **手机远程搜索**：手机「搜索」页与电脑端搜索框双向同步（含标准/深度模式切换），可远程输入目录号并一键触发电脑端执行搜索（沿用桌面端完整状态机：进度、深度搜索/智能补全阶段、完成汇总）；深挖/智能生成的确认弹窗也可在手机端远程操作；找到的结果自动保存到 CD 库，手机端同步显示新增/更新条数
- **手机扫码添加编号**：手机「搜索」页可拍照识别 CD 条码，按 Discogs → Tower → HMV → Yahoo → Suruga-ya 的优先级反查目录号并加入电脑搜索框（可在设置中调整顺序/停用；Suruga-ya 需先完成 Cloudflare 验证）；高置信度直接添加，低置信度在手机上显示候选

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

开发和打包统一使用项目脚本 `super-cd.sh`（macOS / Linux）和 `super-cd.ps1`（Windows）。

```bash
# 1. 安装依赖
npm install

# 2. 清理 + 构建 + 启动开发服务器
# macOS / Linux
./super-cd.sh fresh

# Windows (PowerShell)
.\super-cd.ps1 fresh
```

### 测试

```bash
# 运行单元测试
npm test

# 运行单元测试并检查覆盖率（要求各指标 ≥ 70%）
npm run test:coverage
```

### 构建与打包

```bash
# 打包 macOS DMG（macOS / Linux）
./super-cd.sh mac

# 交叉打包 Windows ZIP（macOS / Linux）
./super-cd.sh win

# Windows (PowerShell) 打包 Windows ZIP
.\super-cd.ps1 win
```

脚本命令一览：

| 命令 | 说明 |
|------|------|
| `./super-cd.sh fresh` / `.\super-cd.ps1 fresh` | 清理 `out/`、`release/`，重新构建并启动开发服务器 |
| `./super-cd.sh mac` | 清理 + 构建 + 打包 macOS DMG |
| `./super-cd.sh win` / `.\super-cd.ps1 win` | 清理 + 构建 + 打包 Windows ZIP |
| `./super-cd.sh help` | 查看脚本帮助 |

## 配置

可在设置面板中配置 API 凭证与搜索源：

- **外观（Appearance）**：支持「白色」「黑色」「跟随系统」三种主题（选择「跟随系统」时随 macOS 深色 / 浅色模式自动切换），并可切换界面语言（中文 / English）
- **搜索源（Search Sources）**：分别管理「标准搜索」与「深度搜索」两种模式所查询的平台（默认标准 = Discogs + eBay，深度 = 全部平台）
- **Fast Mode（跳过详情页）**：跳过商品详情页导航，以更少请求换取更快速度（详情字段可能缺失）
- **LLM 智能生成**：配置 OpenAI 兼容 API 后，详情页出现缺失字段时会显示「智能生成」按钮；点击后按可靠性顺序逐源抓取详情页，仅向 LLM 询问缺失字段，补齐即停（不会在搜索时自动解析，且固定排除 Discogs 与 eBay）
- **Cloudflare 验证**：Suruga-ya 与 ZenMarket 使用 Cloudflare 反爬，需在设置面板点击「启动 Chrome 并验证」，应用会拉起一个真实 Chrome 窗口；在里面手动完成一次 Cloudflare 验证后，搜索会直接在这个 Chrome 里进行（需保持该 Chrome 窗口开启，验证有效期通常 30 分钟～数小时，失效后重新验证即可）
- **局域网连接（LAN Connection）**：点击首页顶部的手机图标打开独立面板；启用后在本机启动一个只绑定局域网 IPv4 地址的 HTTP 服务（公网 IP 会被拒绝），并提供含随机访问令牌的二维码。手机扫码即可打开连接页面，在「搜索」页可拍照识别 CD 条码（通过供应商链反查目录号并加入桌面搜索框），也可直接编辑与电脑端双向同步的搜索框并远程触发电脑端执行搜索、实时查看进度与入库结果。条码解析供应商的顺序/启停仍在「设置 → 条码解析供应商」中配置
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
