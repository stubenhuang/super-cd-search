import { createContext, useCallback, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'

type Params = Record<string, string | number>

const zh = {
  // App header / chrome
  'panel.input': '输入',
  'panel.results': '结果',
  'tab.search': '搜索',
  'tab.library': 'CD 库',
  'export.failed': '导出失败',
  'export.catalogNumber': '编号',
  'export.image': '图片',
  'export.details': '详情',
  'export.lowestPriceUsd': '最低价($)',
  'export.highestPriceUsd': '最高价($)',
  'export.lowestPriceCny': '最低价(￥)',
  'export.highestPriceCny': '最高价(￥)',
  'autoFlow.deepDigTitle': '深挖',
  'autoFlow.deepDigBody': '有 {count} 个编号在标准搜索中未找到结果。深挖将对这些编号追加查询更多平台（{platforms}），结果更全但耗时更长。',
  'autoFlow.platformsMore': '等 {count} 个平台',
  'autoFlow.deepDigRun': '执行深挖',
  'autoFlow.skip': '跳过',
  'autoFlow.smartTitle': '智能生成',
  'autoFlow.smartBody': '检测到 {count} 个编号的详情字段不完整（厂牌 / 格式 / 国家 / 发行日期 / 类型）。智能生成将逐个访问平台商品页并调用已配置的 LLM 补齐缺失字段；多个编号时耗时较长，并会消耗 LLM API 额度。',
  'autoFlow.smartRun': '开始智能生成',
  'autoFlow.smartProgress': '正在智能生成 ({current}/{total})：{catalogNumber}…',
  'autoFlow.smartDone': '智能生成完成',
  'autoFlow.smartDoneFailed': '{failed} 个编号生成失败',
  'autoFlow.smartPhase.searching': '正在搜索 {platform}…',
  'autoFlow.smartPhase.fetching': '正在抓取 {platform} 商品页…',
  'autoFlow.smartPhase.analyzing': '正在 AI 分析 {platform} 页面…',
  'autoFlow.smartPhase.preparing': '正在准备…',
  'autoFlow.cancel': '取消智能生成',
  'autoFlow.cancelling': '正在取消…',
  'autoFlow.smartCancelled': '已取消，已完成 {completed} / {total}',
  'autoFlow.close': '关闭',
  'settings.buttonTitle': '设置',
  'currency.usdTitle': '美元',
  'currency.cnyTitle': '人民币',
  'library.searchPlaceholder': '按编号搜索…',
  'library.add': '手动新增',
  'library.searchUpsertToast': '这次搜索新入库 {inserted} 个 CD，更新 {updated} 个 CD，请到「CD 库」查看吧',
  'library.newBadge': '新',
  'library.import': '导入 Excel',
  'library.importing': '导入中…',
  'library.exportSelected': '导出',
  'library.deleteSelected': '删除所选',
  'library.selected': '已选择 {count} 条',
  'library.empty': 'CD 库中还没有记录。搜索到的结果会自动保存在这里。',
  'library.noMatches': '没有匹配的编号。',
  'library.loading': '正在加载 CD 库…',
  'library.actions': '操作',
  'library.edit': '编辑',
  'library.delete': '删除',
  'library.previous': '上一页',
  'library.next': '下一页',
  'library.page': '第 {page} / {pages} 页，共 {total} 条',
  'library.pageSize': '每页',
  'library.addTitle': '新增 CD 记录',
  'library.editTitle': '编辑 CD 记录',
  'library.imageUrl': '图片网址',
  'library.embeddedImage': '当前记录包含 Excel 内嵌图片',
  'library.removeEmbeddedImage': '删除当前内嵌图片',
  'library.details': '详情',
  'library.save': '保存',
  'library.cancel': '取消',
  'library.deleteOneConfirm': '确定删除 {catalogNumber} 吗？此操作不可撤销。',
  'library.deleteManyConfirm': '确定删除选中的 {count} 条记录吗？此操作不可撤销。',
  'library.importDone': '导入完成：新增 {added} 条，覆盖 {updated} 条，跳过 {skipped} 条。',
  'library.importErrors': '部分行未导入：{errors}',
  'library.exportDone': '已导出所选记录。',
  'library.publishSelected': '发布',
  'library.publishConfirm': '将开始新一轮发布：选中的 {count} 条 CD 会推送到手机端「发布」页。\n已有发布状态不会被重置；关闭发布页即结束本轮。确定继续吗？',
  'library.lanOffHint': '局域网服务未开启，手机暂时无法查看：请先在首页打开「局域网连接」。',
  'library.publishStateColumn': '发布状态',
  'library.publishPlatformColumn': '发布平台',
  'library.publishedYes': '已发布',
  'library.publishedNo': '未发布',
  'library.publishBatchTitle': '本轮发布',
  'library.closeRoundConfirm': '关闭将结束本轮发布，手机端内容将立即清空。确定关闭吗？',
  'library.finishPublish': '发布完成',
  'library.filter': '筛选',
  'library.filterAll': '全部',
  'library.resetFilter': '重置',
  'library.needSelection': '请先勾选要操作的条目。',
  'library.publishEmpty': '当前没有进行中的发布。',
  'library.publishStats': '共 {total} 条 · 已发布 {published} · 平台标记 {platforms}',
  'library.copy': '复制',
  'library.copyDetails': '复制详情',
  'library.copied': '已复制 ✓',
  'library.copyFailed': '复制失败，请重试',
  'library.noDetails': '（无详情）',
  'library.close': '关闭',
  'library.platformTaobao': '淘宝',
  'library.platformXianyu': '闲鱼',
  'library.platformDiscogs': 'Discogs',
  'library.storageError': 'CD 库操作失败：{error}',
  'library.priceMinUsd': '最低价($)',
  'library.priceMaxUsd': '最高价($)',
  'library.priceMinCny': '最低价(￥)',
  'library.priceMaxCny': '最高价(￥)',

  // Input area
  'input.placeholder':
    '输入目录号（每行一个，或用逗号分隔）\n\n示例：\nTOCP-53001\nBVCP-21002\nSRCL-3101',
  'input.searchMode': '搜索模式',
  'searchMode.standard': '标准搜索',
  'searchMode.deep': '深度搜索',
  'searchMode.deepWarning': '深度搜索会查询所有勾选的平台，速度较慢',
  'searchMode.deepWarningShort': '深度搜索速度较慢',
  'search.button': '搜索',
  'search.searching': '搜索中...',
  'search.deepDigging': '深挖中...',
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
  'progress.deepDig': '深挖中',
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
  'result.statusChallengeHint': '请在设置中完成扫码登录',
  'result.statusChallengeTitle': '渠道登录未完成',
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

  'nav.api': 'API 令牌',
  'nav.proxy': '代理',
  'nav.lan': '局域网连接',
  'nav.barcodeProviders': '条码解析供应商',
  'nav.sources': '搜索源',
  'nav.llm': 'LLM 配置',
  'nav.login': '特殊渠道（扫码登录）',
  'nav.backup': '备份与恢复',
  'nav.about': '关于与更新',

  // About & auto update
  'about.desc': '应用会自动检查 GitHub 上的新版本并在后台下载，下载完成后提示你重启升级。便携版 / 开发版不支持自动更新，请到 GitHub 下载安装包。',
  'about.currentVersion': '当前版本',
  'about.autoUpdate': '自动检查更新',
  'about.autoUpdateDesc': '每次启动时检查 GitHub 上的新版本',
  'about.checkNow': '检查更新',
  'about.checking': '正在检查更新…',
  'about.idle': '尚未检查更新',
  'about.upToDate': '当前已是最新版本',
  'about.available': '发现新版本 {version}，正在后台下载…',
  'about.downloading': '正在下载更新 {percent}%',
  'about.downloaded': '新版本 {version} 已下载完成，重启即可升级',
  'about.download': '下载更新',
  'about.install': '重启并升级',
  'about.checkFailed': '检查更新失败：{error}',
  'about.unsupported': '当前版本不支持自动更新（开发版或便携版），请到 GitHub 下载安装包',
  'about.viewOnGithub': '在 GitHub 查看',
  'about.releaseNotes': '更新说明',
  'update.banner.checking': '正在检查更新…',
  'update.banner.available': '发现新版本 {version}，正在后台下载…',
  'update.banner.downloading': '正在下载更新 {percent}%',
  'update.banner.downloaded': '新版本 {version} 已下载完成',
  'update.banner.install': '重启升级',
  'update.banner.later': '稍后',

  // Backup & restore
  'backup.desc': '将全部设置（含 API 密钥）导出为加密文件；导入时需输入相同密码。局域网配对凭证不会包含在内。',
  'backup.password': '设置密码',
  'backup.passwordHint': '至少 8 位',
  'backup.confirmPassword': '确认密码',
  'backup.export': '导出设置文件',
  'backup.exporting': '导出中…',
  'backup.import': '选择文件并导入',
  'backup.importing': '导入中…',
  'backup.importPassword': '备份密码',
  'backup.importHint': '导入后仅覆盖文件中实际包含的配置项。',
  'backup.exportDone': '设置已导出到加密文件',
  'backup.importDone': '设置已导入并生效',
  'backup.error.weak': '密码至少需要 8 位',
  'backup.error.mismatch': '两次输入的密码不一致',
  'backup.error.badPassword': '密码错误，无法解密',
  'backup.error.corrupt': '备份文件损坏或格式不正确',
  'backup.error.unsupported': '备份文件版本过新，请升级应用后再导入',
  'backup.error.io': '文件操作失败',

  // API tokens
  'api.desc': '为各平台配置 API 凭证。令牌会加密存储。',
  'api.discogs.pat': 'Personal Access Token',
  'api.discogs.patPlaceholder': '你的 Discogs API 令牌',
  'api.ebay.clientId': 'Client ID',
  'api.ebay.clientIdPlaceholder': '你的 eBay Client ID',
  'api.ebay.clientSecret': 'Client Secret',
  'api.ebay.clientSecretPlaceholder': '你的 eBay Client Secret',

  // Proxy
  'proxy.desc': '通过 SOCKS5 代理转发全部网络流量，用于隐私保护或地区访问。',
  'proxy.enable': '启用 SOCKS5 代理',
  'proxy.enableDesc': '所有请求都将通过代理转发',
  'proxy.host': '主机',
  'proxy.port': '端口',

  // LAN connection
  'lan.buttonTitle': '局域网连接',
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
  'sources.desc': '选择每种搜索模式查询的平台。标准模式默认 Discogs + eBay；深度模式默认全部平台。闲鱼 / 淘宝渠道需扫码登录，且仅在勾选后参与搜索。',
  'sources.fastMode': 'Fast Mode（跳过详情页）',
  'sources.fastModeDesc': '跳过商品详情页导航，以更少请求换取更快速度（详情字段可能缺失）',
  'sources.standard': '标准搜索',
  'sources.deep': '深度搜索',
  'sources.channelXianyu': '闲鱼',
  'sources.channelTaobao': '淘宝图搜',
  'sources.channelVerified': '已登录',
  'sources.channelNotVerified': '未登录',

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

  // Special channels (QR-code login)
  'login.desc': '特殊渠道共用一个真实 Chrome 会话：闲鱼 / 淘宝需扫码登录。渠道需在「搜索源」中勾选、且登录有效才会参与搜索；登录与搜索都在这个 Chrome 窗口里进行。',
  'login.status': '平台状态',
  'login.stateVerified': '已登录（有效期至 {expires}）',
  'login.stateVerifiedShort': '已登录',
  'login.stateExpired': '登录已过期（需重新扫码）',
  'login.stateUnverified': 'Chrome 已启动，尚未登录',
  'login.stateStarting': 'Chrome 启动中…',
  'login.stateNotStarted': 'Chrome 未启动',
  'login.closeSession': '关闭 Chrome 会话',
  'login.hint': '提示：登录与搜索会在同一个真实 Chrome 窗口里进行。关闭该 Chrome 后需重新启动并扫码登录；登录有效期由平台决定，失效后重新扫码即可。',
  'login.toastFailedUnknown': '登录失败',
  'login.unknownError': '未知错误',
  'channels.xianyu': '闲鱼（goofish 网页）',
  'channels.taobao': '淘宝图搜（拍立淘）',
  'channels.login': '扫码登录',
  'channels.loggingIn': '登录中…（请在打开的 Chrome 窗口完成扫码）',
  'channels.toastSuccess': '登录成功，可正常搜索了',
  'channels.toastCancelled': '已取消登录',
  'channels.toastFailed': '登录失败: {error}',

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
  'detail.smartMissing': '缺失: {fields}'
}

export type TranslationKey = keyof typeof zh

interface I18nContextValue {
  t: (key: TranslationKey, params?: Params) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

/**
 * The UI is Chinese-only: the appearance settings section (which used to hold
 * the language switch) was removed, so `t` always reads the zh table.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const t = useCallback((key: TranslationKey, params?: Params) => {
    let text = zh[key] ?? key
    if (params) {
      for (const [name, value] of Object.entries(params)) {
        text = text.replaceAll(`{${name}}`, String(value))
      }
    }
    return text
  }, [])

  const value = useMemo(() => ({ t }), [t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) {
    throw new Error('useI18n must be used within an I18nProvider')
  }
  return ctx
}
