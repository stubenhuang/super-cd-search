# Super CD Search

一款 Electron 桌面应用，支持通过目录号在多个平台批量查询 CD 信息。

## 功能特性

- **多平台搜索**：从 Discogs、eBay、Kojima Rokuon、HMV、Yahoo Shopping、CDJapan、Tower Records、Suruga-ya、ZenMarket 查询 CD 信息
- **批量处理**：同时搜索多个目录号
- **并行加速**：同一目录号的多平台并行查询、按域名智能限速
- **缓存加速**：查询结果与产品详情页缓存（1 小时、跨会话磁盘持久化）、SOCKS 代理连接复用、封面缩略图懒加载
- **价格对比**：跨平台比较价格
- **币种切换**：价格支持美元（USD）与人民币（CNY）显示切换

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
```

## 配置

可在设置面板中配置 API 凭证与搜索源：

- **搜索源（Search Sources）**：分别管理「标准搜索」与「深度搜索」两种模式所查询的平台（默认标准 = Discogs + eBay，深度 = 全部平台）
- **Fast Mode（跳过详情页）**：跳过商品详情页导航，以更少请求换取更快速度（详情字段可能缺失）
- **Cloudflare 验证**：Suruga-ya 与 ZenMarket 使用 Cloudflare 反爬，需在设置面板点击「启动 Chrome 并验证」，应用会拉起一个真实 Chrome 窗口；在里面手动完成一次 Cloudflare 验证后，搜索会直接在这个 Chrome 里进行（需保持该 Chrome 窗口开启，验证有效期通常 30 分钟～数小时，失效后重新验证即可）
- **Discogs API Token**：Discogs 个人访问令牌
- **eBay Client ID**：eBay 开发者门户 OAuth 客户端 ID
- **eBay Client Secret**：eBay 开发者门户 OAuth 客户端密钥

凭证使用加密方式本地存储。

## 技术栈

- **Electron** - 桌面应用框架
- **React** - UI 组件
- **TypeScript** - 类型安全
- **Puppeteer** - 网页抓取

## 许可证

MIT
