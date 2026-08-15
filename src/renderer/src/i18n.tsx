import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Language } from '../../shared/types'

type Params = Record<string, string | number>

const zh = {
  // App header / chrome
  'panel.input': '输入',
  'panel.results': '结果',
  'export.button': '导出表格',
  'export.title': '将当前结果导出为 Excel',
  'export.exporting': '导出中…',
  'export.saved': '已导出',
  'export.failed': '导出失败',
  'export.catalogNumber': '编号',
  'export.image': '图片',
  'export.details': '详情',
  'export.lowestPrice': '最低价',
  'export.highestPrice': '最高价',
  'export.modalTitle': '导出表格',
  'export.directory': '目标目录',
  'export.directoryPlaceholder': '请选择导出目录',
  'export.pickDirectory': '选择目录…',
  'export.picking': '选择中…',
  'export.deepSearch': '导出前自动执行「深挖」',
  'export.deepSearchDesc': '对没有找到结果的编号执行一次深度搜索',
  'export.smartGenerate': '导出前自动「智能生成」补齐详情',
  'export.smartGenerateDesc': '对详情字段缺失的编号逐个调用 LLM 补齐',
  'export.smartGenerateWarning': '智能生成会逐个来源抓取详情页并调用 LLM，多个编号时可能耗时较长，请耐心等待。',
  'export.confirm': '开始导出',
  'export.cancel': '取消',
  'export.close': '关闭',
  'export.preparing': '正在准备导出…',
  'export.deepSearching': '正在深挖：{catalogNumber}…',
  'export.deepSearchingCount': '正在深挖 {count} 个编号…',
  'export.smartGenerating': '正在智能生成 ({current}/{total})：{catalogNumber}…',
  'export.preparingImages': '正在准备封面图片 ({current}/{total})…',
  'export.writing': '正在生成 Excel…',
  'panel.resizerTitle': '拖拽调整宽度（双击重置）',
  'settings.buttonTitle': '设置',
  'currency.usdTitle': '美元',
  'currency.cnyTitle': '人民币',

  // Input area
  'input.placeholder':
    '输入目录号（每行一个，或用逗号分隔）\n\n示例：\nTOCP-53001\nBVCP-21002\nSRCL-3101',
  'input.searchMode': '搜索模式',
  'searchMode.standard': '标准搜索（Discogs + eBay）',
  'searchMode.deep': '深度搜索（全部平台）',
  'searchMode.deepWarning': '深度搜索会查询全部平台（7 个数据源），速度较慢',
  'searchMode.deepWarningShort': '深度搜索速度较慢',
  'deepSearch.button': '深挖🪏',
  'deepSearch.digging': '深挖中...',
  'deepSearch.title': '对未找到结果的条目执行深度搜索',
  'search.button': '搜索',
  'search.searching': '搜索中...',
  'search.cancelling': '取消中...',
  'search.cancelTitle': '取消',

  // Errors
  'error.noCatalog': '请至少输入一个目录号',
  'error.maxCatalog': '最多允许 10 个目录号',
  'mobile.addedToast': '已从手机添加编号：{catalogNumber}',
  'error.noPlatforms': '当前搜索模式没有选择任何数据源，请在设置中配置',
  'error.queryFailed': '查询失败',

  // Progress / results
  'progress.done': '{done}/{total} 完成',
  'progress.cancelling': '正在取消...',
  'progress.querying': '查询中...',
  'results.placeholder': '搜索结果将显示在这里。',

  // Result cards
  'result.lowest': '★ 最低价',
  'result.highest': '▲ 最高价',
  'result.noImage': '无图',
  'result.viewDetails': '查看详情 →',
  'result.fixedPrice': '固定价格',
  'result.priceRange': '价格范围',
  'result.titleClick': '点击查看详细信息',
  'result.statusChallenge': '待验证',
  'result.statusChallengeHint': '请在设置中完成 Cloudflare 验证',
  'result.statusChallengeTitle': 'Cloudflare 验证未完成',
  'result.statusError': '请求错误',
  'result.statusErrorDefault': 'Error',
  'result.statusNotFound': '未找到',

  // Settings — navigation & chrome
  'settings.title': '设置',
  'settings.close': '关闭',
  'settings.badge': '配置',
  'settings.footerHint': '更改将在下次搜索时生效',
  'settings.cancel': '取消',
  'settings.save': '保存更改',
  'settings.saving': '保存中...',
  'settings.saved': '设置已保存',
  'settings.saveFailed': '保存设置失败',

  'nav.appearance': '外观',
  'nav.api': 'API 令牌',
  'nav.cookies': 'Cookies',
  'nav.proxy': '代理',
  'nav.lan': '局域网连接',
  'nav.sources': '搜索源',
  'nav.llm': 'LLM 配置',
  'nav.cloudflare': 'Cloudflare 验证',

  // Appearance
  'appearance.desc': '选择应用外观与显示语言。「跟随系统」会随操作系统的深色 / 浅色模式自动切换。',
  'appearance.theme': '主题',
  'theme.light': '白色',
  'theme.lightHint': '暖色纸张浅色主题',
  'theme.dark': '黑色',
  'theme.darkHint': '暖调深色主题',
  'theme.system': '跟随系统',
  'theme.systemHint': '跟随 macOS 外观',
  'appearance.language': '语言',

  // API tokens
  'api.desc': '为各平台配置 API 凭证。令牌会加密存储。',
  'api.discogs.pat': 'Personal Access Token',
  'api.discogs.patPlaceholder': '你的 Discogs API 令牌',
  'api.ebay.clientId': 'Client ID',
  'api.ebay.clientIdPlaceholder': '你的 eBay Client ID',
  'api.ebay.clientSecret': 'Client Secret',
  'api.ebay.clientSecretPlaceholder': '你的 eBay Client Secret',

  // Cookies
  'cookies.desc': '粘贴浏览器 Cookie 以便进行已登录抓取，从而访问受限地区的内容。',
  'cookies.label': '{name} Cookie',
  'cookies.placeholder': '在此粘贴 Cookie 字符串...',

  // Proxy
  'proxy.desc': '通过 SOCKS5 代理转发全部网络流量，用于隐私保护或地区访问。',
  'proxy.enable': '启用 SOCKS5 代理',
  'proxy.enableDesc': '所有请求都将通过代理转发',
  'proxy.host': '主机',
  'proxy.port': '端口',

  // LAN connection
  'lan.desc': '在本机启动一个只监听局域网地址的 HTTP 服务。手机与电脑连接同一 Wi-Fi 后，扫描二维码即可访问。服务绝不会绑定公网地址。',
  'lan.enable': '启用局域网连接',
  'lan.enableDesc': '允许同一局域网内的手机扫码连接到本机',
  'lan.bindAddress': '绑定 IP',
  'lan.refresh': '刷新检测',
  'lan.autoDetect': '自动检测（推荐）',
  'lan.customAddress': '手动输入…',
  'lan.customAddressLabel': '手动输入局域网 IPv4 地址',
  'lan.bindHint': '只会绑定 192.168.x.x / 10.x.x.x / 172.16-31.x.x 等局域网地址；公网 IP 会被拒绝。',
  'lan.providers': '条码解析供应商',
  'lan.providersDesc': '手机扫码后按从上到下的顺序查询；高置信度命中会直接添加并停止，低置信度会在手机上列出候选。',
  'lan.surugayaHint': '需要先在 Cloudflare 验证中完成 Suruga-ya 验证后才生效',
  'lan.moveUp': '上移',
  'lan.moveDown': '下移',
  'lan.disableProvider': '取消该供应商',
  'lan.disabledProviders': '已取消的供应商',
  'lan.port': '端口',
  'lan.stateRunning': '服务运行中：http://{host}:{port}/',
  'lan.stateDisabled': '服务未启用。保存并启用后才会显示二维码。',
  'lan.stateStopped': '服务已停止',
  'lan.stateError': '服务启动失败：{error}',
  'lan.stateNoNetwork': '未检测到局域网 IPv4 地址，请手动选择或输入',
  'lan.unknownError': '未知错误',
  'lan.scanHint': '使用手机相机扫描二维码，手机与电脑需连接同一局域网。',
  'lan.qrAlt': '局域网连接二维码',
  'lan.regenerateToken': '更换访问令牌',
  'lan.regenerating': '更换中…',
  'lan.tokenRegenerated': '访问令牌已更换，旧二维码立即失效',
  'lan.tokenRegenerateFailed': '更换访问令牌失败',

  // Search sources
  'sources.desc': '选择每种搜索模式查询的平台。标准模式默认 Discogs + eBay；深度模式默认全部平台。',
  'sources.fastMode': 'Fast Mode（跳过详情页）',
  'sources.fastModeDesc': '跳过商品详情页导航，以更少请求换取更快速度（详情字段可能缺失）',
  'sources.standard': '标准搜索',
  'sources.deep': '深度搜索',

  // Search cache
  'cache.label': '搜索缓存',
  'cache.desc': '清除本地缓存的查询结果与详情页数据',
  'cache.clear': '清空搜索缓存',
  'cache.cleared': '已清空搜索缓存',
  'cache.clearFailed': '清空缓存失败',

  // LLM
  'llm.desc': '配置 OpenAI 兼容 API。启用后，详情页字段缺失时可点击「智能生成」逐源补齐，搜索过程本身不会自动调用 LLM。',
  'llm.enable': '启用 LLM 智能生成',
  'llm.enableDesc': '允许在详情页使用 AI 补齐缺失字段（按需调用）',
  'llm.apiBaseUrl': 'API Base URL',
  'llm.apiBaseUrlHint': '可填服务商根地址或 /v1 地址（如 https://api.deepseek.com）；也可直接填完整的 .../chat/completions 地址',
  'llm.apiKey': 'API Key',
  'llm.model': 'Model',
  'llm.platformSelection': '智能生成数据源',
  'llm.smartSourcesHint': '智能生成固定排除 Discogs 与 eBay；只会逐个分析能搜索到商品的来源。',

  // Cloudflare
  'cloudflare.desc': 'Suruga-ya 与 ZenMarket 使用 Cloudflare 反爬。点击「验证」会启动一个真实 Chrome 窗口，请在里面手动完成验证；验证通过后，搜索会直接在这个 Chrome 里进行。',
  'cloudflare.status': '平台状态',
  'cloudflare.stateVerifying': '验证中…（请在打开的 Chrome 窗口完成验证）',
  'cloudflare.stateVerified': '已验证（有效期至 {expires}）',
  'cloudflare.stateVerifiedShort': '已验证',
  'cloudflare.stateExpired': '验证已过期（需重新验证）',
  'cloudflare.stateUnverified': 'Chrome 已启动，尚未验证',
  'cloudflare.stateStarting': 'Chrome 启动中…',
  'cloudflare.stateNotStarted': 'Chrome 未启动',
  'cloudflare.verify': '启动 Chrome 并验证',
  'cloudflare.verifying': '验证中…',
  'cloudflare.closeSession': '关闭 Chrome 会话',
  'cloudflare.hint': '提示：验证与搜索会在同一个真实 Chrome 窗口里进行。关闭该 Chrome 后需重新启动并验证；Cloudflare 验证有效期通常为 30 分钟～数小时。',
  'cloudflare.toastSuccess': 'Cloudflare 验证成功，可正常搜索了',
  'cloudflare.toastCancelled': '已取消验证',
  'cloudflare.toastFailed': '验证失败: {error}',
  'cloudflare.toastFailedUnknown': '验证失败',
  'cloudflare.unknownError': '未知错误',

  // Detail modal
  'detail.catalogNumber': '目录号',
  'detail.album': '专辑',
  'detail.artist': '艺术家',
  'detail.source': '来源: {platform}',
  'detail.label': '厂牌',
  'detail.format': '格式',
  'detail.country': '国家',
  'detail.released': '发行',
  'detail.genre': '类型',
  'detail.copy': '复制信息',
  'detail.copied': '已复制',
  'detail.close': '关闭',
  'detail.smartGenerate': '智能生成',
  'detail.smartGenerateTitle': '逐源获取详情页，用 LLM 补齐缺失字段',
  'detail.smartGenerating': '智能生成中…',
  'detail.smartMissing': '缺失: {fields}',
  'detail.smartNoLlm': '尚未配置 LLM，请先到「设置 → LLM 配置」启用并填写 API 信息',
  'detail.smartComplete': '详情字段已全部补齐',
  'detail.smartPartial': '已分析 {count} 个来源，仍有个别字段缺失',
  'detail.smartFailed': '智能生成失败，请稍后重试',
  'detail.smartSearching': '正在查找 {platform}…',
  'detail.smartFetching': '正在打开 {platform} 详情页…',
  'detail.smartAnalyzing': '正在用 LLM 分析 {platform}…',
  'detail.smartSkipped': '跳过 {platform}：{reason}',
  'detail.smartSkipDisabled': '已在 LLM 平台选择中禁用',
  'detail.smartSkipNotFound': '未搜索到商品',
  'detail.smartSkipNoLink': '没有商品链接',
  'detail.smartSkipCloudflare': 'Cloudflare 验证未完成',
  'detail.smartSkipFetch': '详情页获取失败',
  'detail.smartSkipLlm': 'LLM 分析失败',
  'detail.smartSkipUnknown': '跳过'
}

const en: Record<keyof typeof zh, string> = {
  'panel.input': 'Input',
  'panel.results': 'Results',
  'export.button': 'Export CSV',
  'export.title': 'Export current results as Excel',
  'export.exporting': 'Exporting…',
  'export.saved': 'Exported',
  'export.failed': 'Export Failed',
  'export.catalogNumber': 'Catalog Number',
  'export.image': 'Image',
  'export.details': 'Details',
  'export.lowestPrice': 'Lowest Price',
  'export.highestPrice': 'Highest Price',
  'export.modalTitle': 'Export CSV',
  'export.directory': 'Target Directory',
  'export.directoryPlaceholder': 'Choose an export directory',
  'export.pickDirectory': 'Choose Directory…',
  'export.picking': 'Choosing…',
  'export.deepSearch': 'Run deep search before exporting',
  'export.deepSearchDesc': 'Deep-search catalog numbers that had no results',
  'export.smartGenerate': 'Run smart generation before exporting',
  'export.smartGenerateDesc': 'Fill missing detail fields with the LLM source by source',
  'export.smartGenerateWarning': 'Smart generation fetches detail pages and calls the LLM source by source. It can take a long time with multiple catalog numbers.',
  'export.confirm': 'Start Export',
  'export.cancel': 'Cancel',
  'export.close': 'Close',
  'export.preparing': 'Preparing export…',
  'export.deepSearching': 'Deep searching: {catalogNumber}…',
  'export.deepSearchingCount': 'Deep searching {count} catalog numbers…',
  'export.smartGenerating': 'Smart generating ({current}/{total}): {catalogNumber}…',
  'export.preparingImages': 'Preparing cover images ({current}/{total})…',
  'export.writing': 'Generating Excel…',
  'panel.resizerTitle': 'Drag to resize (double-click to reset)',
  'settings.buttonTitle': 'Settings',
  'currency.usdTitle': 'US Dollar',
  'currency.cnyTitle': 'Chinese Yuan',

  'input.placeholder':
    'Enter catalog numbers (one per line or comma-separated)\n\nExample:\nTOCP-53001\nBVCP-21002\nSRCL-3101',
  'input.searchMode': 'Search Mode',
  'searchMode.standard': 'Standard (Discogs + eBay)',
  'searchMode.deep': 'Deep (All Platforms)',
  'searchMode.deepWarning': 'Deep search queries all platforms (7 data sources) and is slower',
  'searchMode.deepWarningShort': 'Deep search is slower',
  'deepSearch.button': 'Deep Dig 🪏',
  'deepSearch.digging': 'Digging...',
  'deepSearch.title': 'Deep-search the entries with no results',
  'search.button': 'Search',
  'search.searching': 'Searching...',
  'search.cancelling': 'Cancelling...',
  'search.cancelTitle': 'Cancel',

  'error.noCatalog': 'Please enter at least one catalog number',
  'error.maxCatalog': 'Maximum 10 catalog numbers allowed',
  'mobile.addedToast': 'Added from phone: {catalogNumber}',
  'error.noPlatforms': 'No data sources selected for the current search mode. Configure them in Settings.',
  'error.queryFailed': 'Query failed',

  'progress.done': '{done}/{total} done',
  'progress.cancelling': 'Cancelling...',
  'progress.querying': 'Querying...',
  'results.placeholder': 'Search results will appear here.',

  'result.lowest': '★ Lowest Price',
  'result.highest': '▲ Highest Price',
  'result.noImage': 'No Image',
  'result.viewDetails': 'View Details →',
  'result.fixedPrice': 'Fixed Price',
  'result.priceRange': 'Price Range',
  'result.titleClick': 'Click to view details',
  'result.statusChallenge': 'Verification Required',
  'result.statusChallengeHint': 'Complete Cloudflare verification in Settings',
  'result.statusChallengeTitle': 'Cloudflare verification incomplete',
  'result.statusError': 'Request Error',
  'result.statusErrorDefault': 'Error',
  'result.statusNotFound': 'Not Found',

  'settings.title': 'Settings',
  'settings.close': 'Close',
  'settings.badge': 'Configuration',
  'settings.footerHint': 'Changes apply on next search',
  'settings.cancel': 'Cancel',
  'settings.save': 'Save Changes',
  'settings.saving': 'Saving...',
  'settings.saved': 'Settings saved successfully',
  'settings.saveFailed': 'Failed to save settings',

  'nav.appearance': 'Appearance',
  'nav.api': 'API Tokens',
  'nav.cookies': 'Cookies',
  'nav.proxy': 'Proxy',
  'nav.lan': 'LAN Connection',
  'nav.sources': 'Search Sources',
  'nav.llm': 'LLM Config',
  'nav.cloudflare': 'Cloudflare Verification',

  'appearance.desc': 'Choose the app appearance and display language. "Follow System" tracks your OS dark / light mode.',
  'appearance.theme': 'Theme',
  'theme.light': 'Light',
  'theme.lightHint': 'Warm paper light theme',
  'theme.dark': 'Dark',
  'theme.darkHint': 'Warm dark theme',
  'theme.system': 'Follow System',
  'theme.systemHint': 'Follow macOS appearance',
  'appearance.language': 'Language',

  'api.desc': 'Configure API credentials for each platform. Tokens are stored securely and encrypted.',
  'api.discogs.pat': 'Personal Access Token',
  'api.discogs.patPlaceholder': 'Your Discogs API token',
  'api.ebay.clientId': 'Client ID',
  'api.ebay.clientIdPlaceholder': 'Your eBay Client ID',
  'api.ebay.clientSecret': 'Client Secret',
  'api.ebay.clientSecretPlaceholder': 'Your eBay Client Secret',

  'cookies.desc': 'Paste browser cookies for authenticated scraping. This allows access to region-restricted content.',
  'cookies.label': '{name} Cookies',
  'cookies.placeholder': 'Paste cookies string here...',

  'proxy.desc': 'Route all network traffic through a SOCKS5 proxy for privacy or region access.',
  'proxy.enable': 'Enable SOCKS5 Proxy',
  'proxy.enableDesc': 'All requests will be routed through the proxy',
  'proxy.host': 'Host',
  'proxy.port': 'Port',

  'lan.desc': 'Starts an HTTP server on this computer that listens on a LAN address only. With the phone on the same Wi-Fi, scan the QR code to connect. It never binds to a public address.',
  'lan.enable': 'Enable LAN Connection',
  'lan.enableDesc': 'Let phones on the same LAN scan the QR code and connect to this computer',
  'lan.bindAddress': 'Bind IP',
  'lan.refresh': 'Refresh',
  'lan.autoDetect': 'Auto-detect (Recommended)',
  'lan.customAddress': 'Enter manually…',
  'lan.customAddressLabel': 'Enter a LAN IPv4 address manually',
  'lan.bindHint': 'Only LAN addresses such as 192.168.x.x / 10.x.x.x / 172.16-31.x.x are accepted; public IPs are rejected.',
  'lan.providers': 'Barcode Lookup Providers',
  'lan.providersDesc': 'Phone barcode lookups query these sources top to bottom. A high-confidence match is added immediately; low-confidence matches are shown as candidates on the phone.',
  'lan.surugayaHint': 'Only active after completing Suruga-ya Cloudflare verification',
  'lan.moveUp': 'Move up',
  'lan.moveDown': 'Move down',
  'lan.disableProvider': 'Disable this provider',
  'lan.disabledProviders': 'Disabled providers',
  'lan.port': 'Port',
  'lan.stateRunning': 'Server running: http://{host}:{port}/',
  'lan.stateDisabled': 'Server disabled. Save with the switch on to show the QR code.',
  'lan.stateStopped': 'Server stopped',
  'lan.stateError': 'Server failed to start: {error}',
  'lan.stateNoNetwork': 'No LAN IPv4 address detected. Select or enter one manually.',
  'lan.unknownError': 'Unknown error',
  'lan.scanHint': 'Scan the code with your phone camera. The phone and computer must be on the same LAN.',
  'lan.qrAlt': 'LAN connection QR code',
  'lan.regenerateToken': 'Regenerate Access Token',
  'lan.regenerating': 'Regenerating…',
  'lan.tokenRegenerated': 'Access token regenerated; the old QR code is now invalid',
  'lan.tokenRegenerateFailed': 'Failed to regenerate access token',

  'sources.desc': 'Choose which platforms each search mode queries. Standard mode defaults to Discogs + eBay; deep mode defaults to every platform.',
  'sources.fastMode': 'Fast Mode (Skip Detail Pages)',
  'sources.fastModeDesc': 'Skip product-detail page visits for a faster, lower-traffic search (details may be omitted)',
  'sources.standard': 'Standard Search',
  'sources.deep': 'Deep Search',

  // Search cache
  'cache.label': 'Search Cache',
  'cache.desc': 'Clear locally cached query results and product details',
  'cache.clear': 'Clear Search Cache',
  'cache.cleared': 'Search cache cleared',
  'cache.clearFailed': 'Failed to clear cache',

  'llm.desc': 'Configure an OpenAI-compatible API. When enabled, missing detail fields can be filled on demand with "Smart Generate" — searches never call the LLM automatically.',
  'llm.enable': 'Enable LLM Smart Generate',
  'llm.enableDesc': 'Allow AI to fill missing detail fields on demand',
  'llm.apiBaseUrl': 'API Base URL',
  'llm.apiBaseUrlHint': 'Use the provider root or /v1 URL (e.g. https://api.deepseek.com), or the full .../chat/completions endpoint',
  'llm.apiKey': 'API Key',
  'llm.model': 'Model',
  'llm.platformSelection': 'Smart-fill Sources',
  'llm.smartSourcesHint': 'Smart generation always excludes Discogs and eBay; it only analyzes sources where a product was found.',

  'cloudflare.desc': 'Suruga-ya and ZenMarket use Cloudflare anti-bot protection. Clicking "Verify" opens a real Chrome window — complete the verification there manually; once verified, searches run inside that Chrome.',
  'cloudflare.status': 'Platform Status',
  'cloudflare.stateVerifying': 'Verifying… (complete verification in the opened Chrome window)',
  'cloudflare.stateVerified': 'Verified (valid until {expires})',
  'cloudflare.stateVerifiedShort': 'Verified',
  'cloudflare.stateExpired': 'Verification expired (re-verify required)',
  'cloudflare.stateUnverified': 'Chrome started, not yet verified',
  'cloudflare.stateStarting': 'Starting Chrome…',
  'cloudflare.stateNotStarted': 'Chrome not started',
  'cloudflare.verify': 'Launch Chrome & Verify',
  'cloudflare.verifying': 'Verifying…',
  'cloudflare.closeSession': 'Close Chrome Session',
  'cloudflare.hint': 'Tip: verification and search run in the same real Chrome window. Closing that Chrome requires restarting and re-verifying; Cloudflare verification usually lasts 30 minutes to a few hours.',
  'cloudflare.toastSuccess': 'Cloudflare verified — searching is ready',
  'cloudflare.toastCancelled': 'Verification cancelled',
  'cloudflare.toastFailed': 'Verification failed: {error}',
  'cloudflare.toastFailedUnknown': 'Verification failed',
  'cloudflare.unknownError': 'Unknown error',

  'detail.catalogNumber': 'Catalog Number',
  'detail.album': 'Album',
  'detail.artist': 'Artist',
  'detail.source': 'Source: {platform}',
  'detail.label': 'Label',
  'detail.format': 'Format',
  'detail.country': 'Country',
  'detail.released': 'Released',
  'detail.genre': 'Genre',
  'detail.copy': 'Copy Info',
  'detail.copied': 'Copied',
  'detail.close': 'Close',
  'detail.smartGenerate': 'Smart Generate',
  'detail.smartGenerateTitle': 'Fetch detail pages source by source and fill missing fields with LLM',
  'detail.smartGenerating': 'Generating…',
  'detail.smartMissing': 'Missing: {fields}',
  'detail.smartNoLlm': 'LLM is not configured. Enable it and fill in the API settings under Settings → LLM Config.',
  'detail.smartComplete': 'All detail fields are complete',
  'detail.smartPartial': 'Analyzed {count} sources, some fields are still missing',
  'detail.smartFailed': 'Smart generation failed, please retry',
  'detail.smartSearching': 'Searching {platform}…',
  'detail.smartFetching': 'Opening {platform} detail page…',
  'detail.smartAnalyzing': 'Analyzing {platform} with LLM…',
  'detail.smartSkipped': 'Skipped {platform}: {reason}',
  'detail.smartSkipDisabled': 'Disabled in LLM platform selection',
  'detail.smartSkipNotFound': 'No product found',
  'detail.smartSkipNoLink': 'No product link',
  'detail.smartSkipCloudflare': 'Cloudflare verification incomplete',
  'detail.smartSkipFetch': 'Failed to fetch detail page',
  'detail.smartSkipLlm': 'LLM analysis failed',
  'detail.smartSkipUnknown': 'Skipped'
}

const dictionaries: Record<Language, Record<TranslationKey, string>> = { zh, en }

export type TranslationKey = keyof typeof zh

interface I18nContextValue {
  language: Language
  setLanguage: (language: Language) => void
  t: (key: TranslationKey, params?: Params) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>('zh')

  useEffect(() => {
    let cancelled = false
    void window.electronAPI
      .getSetting('language')
      .then((saved) => {
        if (!cancelled) setLanguageState(saved === 'en' ? 'en' : 'zh')
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next)
    void window.electronAPI.setSetting('language', next).catch(() => {})
  }, [])

  const t = useCallback(
    (key: TranslationKey, params?: Params) => {
      const dict = dictionaries[language]
      let text = dict[key] ?? zh[key] ?? key
      if (params) {
        for (const [name, value] of Object.entries(params)) {
          text = text.replaceAll(`{${name}}`, String(value))
        }
      }
      return text
    },
    [language]
  )

  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) {
    throw new Error('useI18n must be used within an I18nProvider')
  }
  return ctx
}
