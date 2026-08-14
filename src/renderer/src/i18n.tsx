import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Language } from '../../shared/types'

type Params = Record<string, string | number>

const zh = {
  // App header / chrome
  'panel.input': '输入',
  'panel.results': '结果',
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
  'search.button': '搜索',
  'search.searching': '搜索中...',
  'search.cancelling': '取消中...',
  'search.cancelTitle': '取消',

  // Errors
  'error.noCatalog': '请至少输入一个目录号',
  'error.maxCatalog': '最多允许 10 个目录号',
  'error.noPlatforms': '当前搜索模式没有选择任何数据源，请在设置中配置',
  'error.queryFailed': '查询失败',

  // Progress / results
  'progress.done': '{done}/{total} 完成',
  'progress.cancelling': '正在取消...',
  'progress.querying': '查询中...',
  'results.placeholder': '搜索结果将显示在这里。',

  // Result cards
  'result.lowest': '★ 最低价',
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

  // Search sources
  'sources.desc': '选择每种搜索模式查询的平台。标准模式默认 Discogs + eBay；深度模式默认全部平台。',
  'sources.fastMode': 'Fast Mode（跳过详情页）',
  'sources.fastModeDesc': '跳过商品详情页导航，以更少请求换取更快速度（详情字段可能缺失）',
  'sources.standard': '标准搜索',
  'sources.deep': '深度搜索',

  // LLM
  'llm.desc': '配置 OpenAI 兼容 API，用于智能内容解析与元数据提取。',
  'llm.enable': '启用 LLM 解析',
  'llm.enableDesc': '使用 AI 从网页提取结构化数据',
  'llm.apiBaseUrl': 'API Base URL',
  'llm.apiKey': 'API Key',
  'llm.model': 'Model',
  'llm.temperature': 'Temperature',
  'llm.platformSelection': '平台选择',

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
  'detail.close': '关闭'
}

const en: Record<keyof typeof zh, string> = {
  'panel.input': 'Input',
  'panel.results': 'Results',
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
  'search.button': 'Search',
  'search.searching': 'Searching...',
  'search.cancelling': 'Cancelling...',
  'search.cancelTitle': 'Cancel',

  'error.noCatalog': 'Please enter at least one catalog number',
  'error.maxCatalog': 'Maximum 10 catalog numbers allowed',
  'error.noPlatforms': 'No data sources selected for the current search mode. Configure them in Settings.',
  'error.queryFailed': 'Query failed',

  'progress.done': '{done}/{total} done',
  'progress.cancelling': 'Cancelling...',
  'progress.querying': 'Querying...',
  'results.placeholder': 'Search results will appear here.',

  'result.lowest': '★ Lowest Price',
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

  'sources.desc': 'Choose which platforms each search mode queries. Standard mode defaults to Discogs + eBay; deep mode defaults to every platform.',
  'sources.fastMode': 'Fast Mode (Skip Detail Pages)',
  'sources.fastModeDesc': 'Skip product-detail page visits for a faster, lower-traffic search (details may be omitted)',
  'sources.standard': 'Standard Search',
  'sources.deep': 'Deep Search',

  'llm.desc': 'Configure an OpenAI-compatible API for intelligent content parsing and metadata extraction.',
  'llm.enable': 'Enable LLM Parsing',
  'llm.enableDesc': 'Use AI to extract structured data from web pages',
  'llm.apiBaseUrl': 'API Base URL',
  'llm.apiKey': 'API Key',
  'llm.model': 'Model',
  'llm.temperature': 'Temperature',
  'llm.platformSelection': 'Platform Selection',

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
  'detail.close': 'Close'
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
