# Super CD Search

一款 Electron 桌面应用，支持通过目录号在多个平台批量查询 CD 信息。

## 功能特性

- **多平台搜索**：从 Discogs、eBay、Kojima Rokuon、HMV、Yahoo Shopping、CDJapan、Tower Records 查询 CD 信息；另可选开启淘宝「按专辑名/艺人名关键词搜索」与闲鱼「以图搜物」（均通过 Apify 云端 Actor）
- **详情聚合**：详情页汇总所有来源，有效字段最多的来源优先，其余来源补缺，尽量拼出完整元数据
- **智能生成**：详情字段缺失时，可按 Tower → HMV → CDJapan → Kojima → Yahoo 的可靠性顺序逐源抓取详情页并调用 LLM 补齐（固定排除 Discogs 与 eBay；搜索过程不会自动调用 LLM）
- **批量处理**：同时搜索多个目录号
- **并行加速**：同一目录号的多平台并行查询、按域名智能限速
- **缓存加速**：查询结果、产品详情页与 LLM 智能生成结果缓存（1 天、跨会话磁盘持久化，可在设置中一键清空）、SOCKS 代理连接复用、封面缩略图懒加载
- **价格对比**：跨平台比较价格
- **币种切换**：价格支持美元（USD）与人民币（CNY）显示切换
- **固定界面**：界面固定为中文 + 深色主题
- **局域网连接**：点击首页顶部的手机连接图标，启动只监听局域网地址的本地服务，手机扫码即可连接（二维码内含随机访问令牌，不会绑定公网地址）
- **手机远程搜索**：手机搜索页与电脑端搜索框双向同步（含标准/深度模式切换），可远程输入目录号并一键触发电脑端执行搜索（沿用桌面端完整状态机：进度、深度搜索/智能补全阶段、完成汇总）；深挖/智能生成的确认弹窗也可在手机端远程操作
- **手机扫码添加编号**：手机搜索页可拍照识别 CD 条码，按 Discogs → Tower → HMV → Yahoo 的优先级反查目录号并加入电脑搜索框（可在设置中调整顺序/停用）；高置信度直接添加，低置信度在手机上显示候选
- **自动更新**：启动时自动检查 GitHub Release，后台下载新版本，下载完成后右下角提示「重启升级」（设置 → 关于与更新 可手动检查或关闭）
- **结果归档飞书**：可把每次搜索结果按目录号自动写入飞书智能多维表格「汇总表」（首列主字段 `编号` 为主键覆盖更新，含主结果信息、详情字段与所有平台价格的 JSON）；也可配置「映射表 Table ID」，把每个平台的原始搜索结果另存到各自独立的数据表（由应用自动建表并按平台写回映射），默认关闭，配置见下方「飞书多维表格」

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
| 闲鱼 | 以图搜物（Apify） | 需配置 Apify Token 并在「搜索源」勾选；取文字搜索结果封面图反查二手商品，价格换算为 USD |
| 淘宝 | 关键词搜索（Apify） | 取文字源结果的「艺人名 + 专辑名」作 keyword 查淘宝/天猫商品，价格换算为 USD；无可用专辑信息时跳过；需配置 Apify Token 并在「搜索源」勾选，默认关闭、按次计费 |

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

# 界面冒烟：构建后启动真实 Electron，检查标签页/关键元素并截图（需要图形会话）
# 产物：artifacts/ui/（若干张截图 + console.log，已在 .gitignore 中）
npm run verify:ui
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

- **搜索源（Search Sources）**：分别管理「标准搜索」与「深度搜索」两种模式所查询的平台（默认标准 = Discogs + eBay，深度 = 全部平台）
- **Fast Mode（跳过详情页）**：跳过商品详情页导航，以更少请求换取更快速度（详情字段可能缺失）
- **LLM 智能生成**：配置 OpenAI 兼容 API 后，详情页出现缺失字段时会显示「智能生成」按钮；点击后按可靠性顺序逐源抓取详情页，仅向 LLM 询问缺失字段，补齐即停（不会在搜索时自动解析，且固定排除 Discogs 与 eBay）
- **局域网连接（LAN Connection）**：点击首页顶部的手机图标打开独立面板；启用后在本机启动一个只绑定局域网 IPv4 地址的 HTTP 服务（公网 IP 会被拒绝），并提供含随机访问令牌的二维码。手机扫码即可打开连接页面，在「搜索」页可拍照识别 CD 条码（通过供应商链反查目录号并加入桌面搜索框），也可直接编辑与电脑端双向同步的搜索框并远程触发电脑端执行搜索、实时查看进度与入库结果。条码解析供应商的顺序/启停仍在「设置 → 条码解析供应商」中配置
- **Discogs API Token**：Discogs 个人访问令牌
- **eBay Client ID**：eBay 开发者门户 OAuth 客户端 ID
- **eBay Client Secret**：eBay 开发者门户 OAuth 客户端密钥
- **淘宝 / 闲鱼 (Apify)**：填写 Apify API Token（在 Apify Console → API & Integrations 获取），可调整两个 Actor ID 与返回条数 / 超时。两个源都通过 Apify 云端 Actor 运行、按次计费、默认不启用，启用前需在「搜索源」勾选对应平台。
  - **淘宝**是**按专辑名 + 艺人名关键词搜索**（不是以图搜物）：默认 Actor `zen-studio~taobao-search-scraper`（Limited permissions，4.7★ / 数百月活）。它要等文字源跑完，取第一个有结果平台（按平台顺序）的 `artist` / `name` 拼成 `"艺人 专辑名"` 作 `keyword`；只有其中一个就用那一个，**两者都缺则跳过淘宝并返回「无可用专辑信息」，不发付费请求**。关闭详情补全与评论以控制费用。该 Actor 要求 `maxItems ≥ 10`，因此「淘宝结果数」设置范围为 10-1000（默认 10），设置值即实际请求条数，也用于价格区间取前 N 条。
  - **闲鱼**仍是以图搜物：默认 Actor `zen-studio~goofish-xianyu-visual-search-scraper`，取同批次文字搜索结果的**第一张封面图**、以裸 base64 传入（`imageBase64`/`maxItems`/`detailLevel`/`sortBy`），不会把封面 URL 发给 Apify；没有可用封面时返回「无可用封面图」而不发起付费请求。淘宝与闲鱼同在文字源之后的第二阶段并行运行，但淘宝不需要封面。
  - 曾先后试过的 `apivault_labs~1688-image-search`（依赖第三方 Fatkun 接口、需 Full permissions 批准、淘宝卡片常「无法验证」）与 `dev00~taobao-reverse-image-search`（输入合法但内部报 `Schema validation failed`）都已确认不可用，其 ID 会在读取设置时自动迁移到当前默认值，自定义 ID 不覆盖。**两个源的请求输入各按默认 Actor 定制**，改填自定义 Actor 前请确认字段一致。令牌只通过 `Authorization` 请求头发送，不写入日志；运行失败时卡片会附上 Actor 的 `SUMMARY` / `ERRORS` 诊断内容（读不到时提示去 Apify Console 查看）。
- **Apify 网络错误**：请求遇到传输层 `fetch failed`（断连 / DNS / TLS 等）时，状态轮询与结果读取这类幂等 GET 会自动重试最多 3 次；启动运行的 POST 不会重试（避免重复计费）。重试耗尽后卡片会显示具体原因码（如 `ECONNRESET`、`UND_ERR_SOCKET`），同一条原因也会写入应用日志目录（macOS 为 `~/Library/Application Support/super-cd-search/logs/`），便于区分是网络问题还是 Token / 权限问题。
- **飞书多维表格（Feishu Bitable）**：填写自建应用的 App ID / App Secret，以及目标多维表格的 App Token / Table ID（均在表格 URL 与开放平台应用详情中获取），打开「启用自动同步」开关。应用需开通「查看、评论、编辑和管理多维表格」权限并发布版本。**前置设置：把表格第一列（主字段 / 索引列）命名为 `编号`** —— 飞书规定首列为主字段且不允许通过 API 更换，应用不会自动创建这一列；主字段不是 `编号` 时同步会报错，「测试连接」也会给出提示。开启后，搜索、深挖、智能生成完成时自动把结果按目录号归档到表格：以首列 `编号` 为主键做 upsert（同一编号只覆盖、不重复），首次同步自动补建其余 11 个字段（`name` / `artist` / `coverUrl` / `status` / `error` / `label` / `format` / `country` / `released` / `genre` / `priceAll`）。`priceAll` 是 JSON 字符串，按平台名记录 `priceMin` / `priceMax`（均为 USD 归一化数值，无价格为 `null`）。建议先点「测试连接」验证配置；同步失败不影响搜索，凭证只保存在本机加密配置中且仅通过 `Authorization` 请求头发送。默认关闭，配置不完整时不会发起任何飞书请求。
- **飞书各平台独立数据表（可选）**：上面的 Table ID 仍是「汇总表」。如果想把每个平台的**原始搜索结果**也分别存档，可在同一设置里再填一个「映射表 Table ID」：
  - 所有表（汇总表、映射表、各平台表）必须放在**同一个多维表格 App**（即上面填的 App Token）里。
  - 在该 App 里新建**一张空数据表**作为映射表，把它的 `?table=` 值填到「映射表 Table ID」。映射表的首列（主字段）**名字随意、留默认即可，也不要命名为 `编号`**；应用会自动补建 `tableId` 列，并写入「平台ID → tableId」映射行。
  - 应用需在该多维表格的**高级权限**里被添加为「文档应用（可管理）」并发布版本，否则自动建表 / 建字段会返回权限错误（`1254302`）。
  - 首次搜索时，应用会为每个有原始结果的平台自动创建 `CD数据-<平台>` 数据表（列按各平台实际返回的字段分别设定），把 `平台ID → tableId` 写回映射表，并**每个原始条目写一行**：主键 `编号 = 目录号#序号`，另有 `目录号`、`序号` 两列。Discogs(API)、eBay、淘宝、闲鱼通常有多条，Kojima / HMV / Yahoo / CDJapan / Tower 等只解析首条结果故只有一行。重搜同一目录号为 upsert（不重复），但某次结果条数变少时旧的高位行会保留（不做删除）。平台表里价格保留原始值（淘宝/闲鱼为人民币 `priceCNY`、日本站为日元原文 `priceText`），USD 归一化只在汇总表的 `priceAll` 里。
  - 映射表 Table ID 留空时只同步汇总表；同步在整批搜索完成后按平台一次性写入，取消的批次不写，失败只记录日志、不影响搜索结果。
- **飞书表格里直接显示封面图片（可选）**：飞书多维表格的文本 / 超链接字段不会渲染图片，只有**附件字段（type 17）**能在单元格里显示缩略图；开放平台也没有「传图片 URL 由飞书代下载」的接口。因此开启设置里的「同步封面图片（显示为附件）」后，应用会自己下载封面（复用带防盗链 Referer 的 800px JPEG 缩图、阻断私网 URL），调用 `drive/v1/medias/upload_all`（`parent_type=bitable_image`、`parent_node=<App Token>`）把字节上传到同一个多维表格 App，拿到 `file_token` 后以 `[{file_token}]` 写入附件字段。
  - **前置设置（一次性）**：在飞书界面手动把图片列的字段类型改为「附件」：汇总表 `coverUrl`；各平台表 `cover_image`（Discogs）、`imageUrl`（eBay）、`coverUrl`（其余平台）。飞书改字段类型会**静默清空该列已有的 URL 文本且不可恢复**，应用不会自动调用改类型接口；应用自动新建的平台表会直接把图片列建成附件类型。列仍是文本时应用继续写 URL 文本并在日志里给出改类型提示。
  - 权限：应用需开通「查看、评论、编辑和管理多维表格」或「上传图片和附件到云文档」权限并发布版本，且在该多维表格里被添加为「文档应用（可管理）」。
  - 限制与降级：`upload_all` 单文件 ≤20MB、5 QPS、每天 1 万次、不支持并发；上传挂在现有飞书串行队列里限速，同一 `App Token + URL` 的 `file_token` 会缓存复用（汇总表与所有平台表共用），单批次最多上传 200 张。下载 / 上传失败只跳过该图，不影响文本同步；开关关闭时绝不下载或上传任何图片字节，且新建表格的图片列仍为文本字段、继续保存 URL 字符串（不会悄悄改成附件列）。开关默认关闭。

凭证使用加密方式本地存储。

## 发布与版本

- **版本号以 git tag 为准**：推送 `v1.0.1` 后，GitHub Actions 在打包前执行 `npm version 1.0.1 --no-git-tag-version`，因此安装包、自动更新清单（`latest.yml` / `latest-mac.yml`）与 Release 的版本一定与 tag 一致。仓库里的 `package.json` 不需要手动改。
- 发布步骤：

```bash
npm version patch        # 或 minor / major；会同时更新 package.json 与 package-lock.json 并打 tag
git push --follow-tags   # 触发 .github/workflows/build-release.yml
```

- 工作流会在 push `v*` tag 时构建 macOS（dmg + zip）与 Windows（NSIS 安装包 + portable + zip），上传 Release，并调用 `scripts/verify-release-manifest.mjs` 校验 `latest*.yml`：版本号必须来自 tag，清单里声明的文件名必须在 `release/` 下真实存在。
- **产物命名不允许出现空格**（统一为 `super-cd-search-<version>...`）：electron-builder 写入 `latest*.yml` 时把空格替换为 `-`，而 GitHub 上传资源时会把空格替换为 `.`，两者不一致会导致 electron-updater 下载 404。

## 自动更新

- 基于 `electron-updater`，从 GitHub Release 拉取新版本。
- **v1.0.2 及更早的安装包不支持自动升级**（当时的更新清单文件名与 GitHub 资源名不一致，会 404），请手动下载最新安装包重装一次；v1.0.3 起自动更新可用。
- 支持自动更新的包：macOS dmg / zip、Windows NSIS 安装包。**Windows 便携版（portable）无法自更新**，请改用安装包版本。
- 启动约 5 秒后后台检查：发现新版本即自动下载，右下角出现进度卡片；下载完成后点击「重启升级」安装并重启。
- 设置 → **关于与更新**：显示当前版本、手动「检查更新」、「在 GitHub 查看」以及「自动检查更新」开关（关闭后不再后台检查）。

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
