import { useState, useEffect, useCallback } from 'react'
import type { Settings, Platform, CloudflarePlatform, CloudflareSessionStatus } from './electron-api'
import { PLATFORMS, PLATFORM_LABELS, DEFAULT_STANDARD_PLATFORMS, DEFAULT_DEEP_PLATFORMS } from '../../shared/platforms'
import './Settings.css'

interface SettingsPanelProps {
  isOpen: boolean
  onClose: () => void
}

type SectionKey = 'api' | 'cookies' | 'proxy' | 'sources' | 'llm' | 'cloudflare'

export function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const [activeSection, setActiveSection] = useState<SectionKey>('api')
  const [discogsToken, setDiscogsToken] = useState('')
  const [ebayClientId, setEbayClientId] = useState('')
  const [ebayClientSecret, setEbayClientSecret] = useState('')
  const [cookiesDiscogs, setCookiesDiscogs] = useState('')
  const [cookiesEbay, setCookiesEbay] = useState('')
  const [cookiesKojima, setCookiesKojima] = useState('')
  const [cookiesHmv, setCookiesHmv] = useState('')
  const [cookiesYahoo, setCookiesYahoo] = useState('')
  const [cookiesCdjapan, setCookiesCdjapan] = useState('')
  const [cookiesTower, setCookiesTower] = useState('')
  const [proxyEnabled, setProxyEnabled] = useState(false)
  const [proxyHost, setProxyHost] = useState('')
  const [proxyPort, setProxyPort] = useState(1080)
  const [llmEnabled, setLlmEnabled] = useState(false)
  const [llmApiBaseUrl, setLlmApiBaseUrl] = useState('https://api.openai.com/v1')
  const [llmApiKey, setLlmApiKey] = useState('')
  const [llmModel, setLlmModel] = useState('gpt-4o-mini')
  const [llmTemperature, setLlmTemperature] = useState(0)
  const [llmPlatformDiscogs, setLlmPlatformDiscogs] = useState(true)
  const [llmPlatformEbay, setLlmPlatformEbay] = useState(true)
  const [llmPlatformKojima, setLlmPlatformKojima] = useState(true)
  const [llmPlatformHmv, setLlmPlatformHmv] = useState(true)
  const [llmPlatformYahoo, setLlmPlatformYahoo] = useState(true)
  const [llmPlatformCdjapan, setLlmPlatformCdjapan] = useState(true)
  const [llmPlatformTower, setLlmPlatformTower] = useState(true)
  const [llmPlatformSurugaya, setLlmPlatformSurugaya] = useState(true)
  const [llmPlatformZenmarket, setLlmPlatformZenmarket] = useState(true)
  const [cfSurugaya, setCfSurugaya] = useState<CloudflareSessionStatus>({ state: 'not_started' })
  const [cfZenmarket, setCfZenmarket] = useState<CloudflareSessionStatus>({ state: 'not_started' })
  const [cfBusy, setCfBusy] = useState<{ surugaya: boolean; zenmarket: boolean }>({ surugaya: false, zenmarket: false })
  const [standardPlatforms, setStandardPlatforms] = useState<Platform[]>(DEFAULT_STANDARD_PLATFORMS)
  const [deepPlatforms, setDeepPlatforms] = useState<Platform[]>(DEFAULT_DEEP_PLATFORMS)
  const [fastMode, setFastMode] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      loadSettings()
    }
  }, [isOpen])

  const refreshCloudflareStatus = useCallback(async () => {
    const [s, z] = await Promise.all([
      window.electronAPI.getCloudflareStatus('surugaya'),
      window.electronAPI.getCloudflareStatus('zenmarket')
    ])
    setCfSurugaya(s)
    setCfZenmarket(z)
  }, [])

  const handleCloudflareChallenge = async (platform: CloudflarePlatform) => {
    setCfBusy(prev => ({ ...prev, [platform]: true }))
    try {
      const result = await window.electronAPI.startCloudflareChallenge(platform)
      if (result.status === 'done') {
        setToast('Cloudflare 验证成功，可正常搜索了')
      } else if (result.status === 'cancelled') {
        setToast('已取消验证')
      } else {
        setToast(`验证失败: ${result.error || '未知错误'}`)
      }
      setTimeout(() => setToast(null), 4000)
    } catch {
      setToast('验证失败')
      setTimeout(() => setToast(null), 4000)
    } finally {
      setCfBusy(prev => ({ ...prev, [platform]: false }))
      void refreshCloudflareStatus()
    }
  }

  const handleCloseCloudflare = async () => {
    await window.electronAPI.closeCloudflareSession()
    void refreshCloudflareStatus()
  }

  const loadSettings = useCallback(async () => {
    const settings = await window.electronAPI.getSettings() as Settings
    setDiscogsToken(settings.discogsToken || '')
    setEbayClientId(settings.ebayClientId || '')
    setEbayClientSecret(settings.ebayClientSecret || '')
    setCookiesDiscogs(settings.cookies?.discogs || '')
    setCookiesEbay(settings.cookies?.ebay || '')
    setCookiesKojima(settings.cookies?.kojima || '')
    setCookiesHmv(settings.cookies?.hmv || '')
    setCookiesYahoo(settings.cookies?.yahoo || '')
    setCookiesCdjapan(settings.cookies?.cdjapan || '')
    setCookiesTower(settings.cookies?.tower || '')
    setProxyEnabled(settings.proxyEnabled || false)
    setProxyHost(settings.proxyHost || '')
    setProxyPort(settings.proxyPort || 1080)
    const llm = settings.llm
    setLlmEnabled(llm?.enabled || false)
    setLlmApiBaseUrl(llm?.apiBaseUrl || 'https://api.openai.com/v1')
    setLlmApiKey(llm?.apiKey || '')
    setLlmModel(llm?.model || 'gpt-4o-mini')
    setLlmTemperature(llm?.temperature ?? 0)
    setLlmPlatformDiscogs(llm?.platformEnabled?.discogs ?? true)
    setLlmPlatformEbay(llm?.platformEnabled?.ebay ?? true)
    setLlmPlatformKojima(llm?.platformEnabled?.kojima ?? true)
    setLlmPlatformHmv(llm?.platformEnabled?.hmv ?? true)
    setLlmPlatformYahoo(llm?.platformEnabled?.yahoo ?? true)
    setLlmPlatformCdjapan(llm?.platformEnabled?.cdjapan ?? true)
    setLlmPlatformTower(llm?.platformEnabled?.tower ?? true)
    setLlmPlatformSurugaya(llm?.platformEnabled?.surugaya ?? true)
    setLlmPlatformZenmarket(llm?.platformEnabled?.zenmarket ?? true)
    void refreshCloudflareStatus()
    setStandardPlatforms(settings.standardPlatforms ?? DEFAULT_STANDARD_PLATFORMS)
    setDeepPlatforms(settings.deepPlatforms ?? DEFAULT_DEEP_PLATFORMS)
    setFastMode(settings.fastMode || false)
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      await window.electronAPI.setSetting('discogsToken', discogsToken)
      await window.electronAPI.setSetting('ebayClientId', ebayClientId)
      await window.electronAPI.setSetting('ebayClientSecret', ebayClientSecret)
      await window.electronAPI.setSetting('cookies', {
        discogs: cookiesDiscogs,
        ebay: cookiesEbay,
        kojima: cookiesKojima,
        hmv: cookiesHmv,
        yahoo: cookiesYahoo,
        cdjapan: cookiesCdjapan,
        tower: cookiesTower
      })
      await window.electronAPI.setSetting('proxyEnabled', proxyEnabled)
      await window.electronAPI.setSetting('proxyHost', proxyHost)
      await window.electronAPI.setSetting('proxyPort', proxyPort)
      await window.electronAPI.setSetting('standardPlatforms', standardPlatforms)
      await window.electronAPI.setSetting('deepPlatforms', deepPlatforms)
      await window.electronAPI.setSetting('fastMode', fastMode)
      await window.electronAPI.setSetting('llm', {
        enabled: llmEnabled,
        apiBaseUrl: llmApiBaseUrl,
        apiKey: llmApiKey,
        model: llmModel,
        temperature: llmTemperature,
        platformEnabled: {
          discogs: llmPlatformDiscogs,
          ebay: llmPlatformEbay,
          kojima: llmPlatformKojima,
          hmv: llmPlatformHmv,
          yahoo: llmPlatformYahoo,
          cdjapan: llmPlatformCdjapan,
          tower: llmPlatformTower,
          surugaya: llmPlatformSurugaya,
          zenmarket: llmPlatformZenmarket
        }
      })
      setToast('Settings saved successfully')
      setTimeout(() => setToast(null), 3000)
    } catch (err) {
      setToast('Failed to save settings')
      setTimeout(() => setToast(null), 3000)
    } finally {
      setSaving(false)
    }
  }

  const togglePlatform = (list: Platform[], platform: Platform): Platform[] => {
    if (list.includes(platform)) {
      return list.filter(p => p !== platform)
    }
    // Keep the canonical platform order when adding a platform back.
    return PLATFORMS.filter(p => list.includes(p) || p === platform)
  }

  if (!isOpen) return null

  const navItems: { key: SectionKey; icon: string; label: string }[] = [
    { key: 'api', icon: '◆', label: 'API Tokens' },
    { key: 'cookies', icon: '◈', label: 'Cookies' },
    { key: 'proxy', icon: '◉', label: 'Proxy' },
    { key: 'sources', icon: '◎', label: 'Search Sources' },
    { key: 'llm', icon: '◇', label: 'LLM Config' },
    { key: 'cloudflare', icon: '◈', label: 'Cloudflare 验证' }
  ]

  const renderContent = () => {
    switch (activeSection) {
      case 'api':
        return (
          <div className="st-section-content">
            <div className="st-section-desc">
              Configure API credentials for each platform. Tokens are stored securely and encrypted.
            </div>
            <div className="st-field-group">
              <div className="st-field-group-title">
                <span className="st-icon">◆</span> Discogs
              </div>
              <div className="st-field">
                <label className="st-label">
                  <span className="st-label-icon">◆</span>
                  Personal Access Token
                </label>
                <div className="st-input-wrap">
                  <input
                    type="password"
                    className="st-input"
                    value={discogsToken}
                    onChange={e => setDiscogsToken(e.target.value)}
                    placeholder="Your Discogs API token"
                  />
                </div>
              </div>
            </div>
            <div className="st-field-group">
              <div className="st-field-group-title">
                <span className="st-icon">◆</span> eBay
              </div>
              <div className="st-field">
                <label className="st-label">
                  <span className="st-label-icon">◈</span>
                  Client ID
                </label>
                <input
                  type="text"
                  className="st-input"
                  value={ebayClientId}
                  onChange={e => setEbayClientId(e.target.value)}
                  placeholder="Your eBay Client ID"
                />
              </div>
              <div className="st-deco-divider">
                <div className="st-deco-line"></div>
                <div className="st-deco-diamond"></div>
                <div className="st-deco-line"></div>
              </div>
              <div className="st-field">
                <label className="st-label">
                  <span className="st-label-icon">◈</span>
                  Client Secret
                </label>
                <input
                  type="password"
                  className="st-input"
                  value={ebayClientSecret}
                  onChange={e => setEbayClientSecret(e.target.value)}
                  placeholder="Your eBay Client Secret"
                />
              </div>
            </div>
          </div>
        )

      case 'cookies':
        return (
          <div className="st-section-content">
            <div className="st-section-desc">
              Paste browser cookies for authenticated scraping. This allows access to region-restricted content.
            </div>
            <div className="st-field">
              <label className="st-label">
                <span className="st-label-icon">◈</span> Discogs Cookies
              </label>
              <textarea
                className="st-textarea"
                value={cookiesDiscogs}
                onChange={e => setCookiesDiscogs(e.target.value)}
                placeholder="Paste cookies string here..."
                rows={3}
              />
            </div>
            <div className="st-field">
              <label className="st-label">
                <span className="st-label-icon">◈</span> eBay Cookies
              </label>
              <textarea
                className="st-textarea"
                value={cookiesEbay}
                onChange={e => setCookiesEbay(e.target.value)}
                placeholder="Paste cookies string here..."
                rows={3}
              />
            </div>
            <div className="st-field">
              <label className="st-label">
                <span className="st-label-icon">◈</span> Kojima Rokuon Cookies
              </label>
              <textarea
                className="st-textarea"
                value={cookiesKojima}
                onChange={e => setCookiesKojima(e.target.value)}
                placeholder="Paste cookies string here..."
                rows={3}
              />
            </div>
            <div className="st-field">
              <label className="st-label">
                <span className="st-label-icon">◈</span> HMV Japan Cookies
              </label>
              <textarea
                className="st-textarea"
                value={cookiesHmv}
                onChange={e => setCookiesHmv(e.target.value)}
                placeholder="Paste cookies string here..."
                rows={3}
              />
            </div>
            <div className="st-field">
              <label className="st-label">
                <span className="st-label-icon">◈</span> Yahoo Shopping Cookies
              </label>
              <textarea
                className="st-textarea"
                value={cookiesYahoo}
                onChange={e => setCookiesYahoo(e.target.value)}
                placeholder="Paste cookies string here..."
                rows={3}
              />
            </div>
            <div className="st-field">
              <label className="st-label">
                <span className="st-label-icon">◈</span> CDJapan Cookies
              </label>
              <textarea
                className="st-textarea"
                value={cookiesCdjapan}
                onChange={e => setCookiesCdjapan(e.target.value)}
                placeholder="Paste cookies string here..."
                rows={3}
              />
            </div>
            <div className="st-field">
              <label className="st-label">
                <span className="st-label-icon">◈</span> Tower Records Cookies
              </label>
              <textarea
                className="st-textarea"
                value={cookiesTower}
                onChange={e => setCookiesTower(e.target.value)}
                placeholder="Paste cookies string here..."
                rows={3}
              />
            </div>
          </div>
        )

      case 'proxy':
        return (
          <div className="st-section-content">
            <div className="st-section-desc">
              Route all network traffic through a SOCKS5 proxy for privacy or region access.
            </div>
            <div className="st-toggle-row">
              <div className="st-toggle-info">
                <span className="st-toggle-title">Enable SOCKS5 Proxy</span>
                <span className="st-toggle-desc">All requests will be routed through the proxy</span>
              </div>
              <label className="st-switch">
                <input
                  type="checkbox"
                  checked={proxyEnabled}
                  onChange={e => setProxyEnabled(e.target.checked)}
                />
                <span className="st-slider"></span>
              </label>
            </div>
            <div className={proxyEnabled ? '' : 'st-section-disabled'}>
              <div className="st-inline-fields">
                <div className="st-field">
                  <label className="st-label">
                    <span className="st-label-icon">◈</span> Host
                  </label>
                  <input
                    type="text"
                    className="st-input"
                    value={proxyHost}
                    onChange={e => setProxyHost(e.target.value)}
                    placeholder="127.0.0.1"
                    disabled={!proxyEnabled}
                  />
                </div>
                <div className="st-field">
                  <label className="st-label">
                    <span className="st-label-icon">◈</span> Port
                  </label>
                  <input
                    type="number"
                    className="st-input"
                    value={proxyPort}
                    onChange={e => setProxyPort(parseInt(e.target.value, 10) || 1080)}
                    placeholder="1080"
                    disabled={!proxyEnabled}
                  />
                </div>
              </div>
            </div>
          </div>
        )

      case 'sources':
        return (
          <div className="st-section-content">
            <div className="st-section-desc">
              Choose which platforms each search mode queries. Standard mode defaults to Discogs + eBay; deep mode defaults to every platform.
            </div>
            <div className="st-toggle-row">
              <div className="st-toggle-info">
                <span className="st-toggle-title">Fast Mode（跳过详情页）</span>
                <span className="st-toggle-desc">Skip product-detail page visits for a faster, lower-traffic search (details may be omitted)</span>
              </div>
              <label className="st-switch">
                <input
                  type="checkbox"
                  checked={fastMode}
                  onChange={e => setFastMode(e.target.checked)}
                />
                <span className="st-slider"></span>
              </label>
            </div>
            <div className="st-field-group">
              <div className="st-field-group-title">
                <span className="st-icon">◆</span> 标准搜索（Standard）
              </div>
              <div className="st-platform-grid">
                {PLATFORMS.map(p => (
                  <label key={p} className={`st-check-item ${standardPlatforms.includes(p) ? 'checked' : ''}`}>
                    <input
                      type="checkbox"
                      checked={standardPlatforms.includes(p)}
                      onChange={() => setStandardPlatforms(togglePlatform(standardPlatforms, p))}
                    />
                    <span className="st-check-box"></span>
                    <span className="st-check-name">{PLATFORM_LABELS[p]}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="st-field-group">
              <div className="st-field-group-title">
                <span className="st-icon">◆</span> 深度搜索（Deep）
              </div>
              <div className="st-platform-grid">
                {PLATFORMS.map(p => (
                  <label key={p} className={`st-check-item ${deepPlatforms.includes(p) ? 'checked' : ''}`}>
                    <input
                      type="checkbox"
                      checked={deepPlatforms.includes(p)}
                      onChange={() => setDeepPlatforms(togglePlatform(deepPlatforms, p))}
                    />
                    <span className="st-check-box"></span>
                    <span className="st-check-name">{PLATFORM_LABELS[p]}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )

      case 'llm':
        return (
          <div className="st-section-content">
            <div className="st-section-desc">
              Configure an OpenAI-compatible API for intelligent content parsing and metadata extraction.
            </div>
            <div className="st-toggle-row">
              <div className="st-toggle-info">
                <span className="st-toggle-title">Enable LLM Parsing</span>
                <span className="st-toggle-desc">Use AI to extract structured data from web pages</span>
              </div>
              <label className="st-switch">
                <input
                  type="checkbox"
                  checked={llmEnabled}
                  onChange={e => setLlmEnabled(e.target.checked)}
                />
                <span className="st-slider"></span>
              </label>
            </div>
            <div className={llmEnabled ? '' : 'st-section-disabled'}>
              <div className="st-field">
                <label className="st-label">
                  <span className="st-label-icon">◈</span> API Base URL
                </label>
                <input
                  type="text"
                  className="st-input"
                  value={llmApiBaseUrl}
                  onChange={e => setLlmApiBaseUrl(e.target.value)}
                  placeholder="https://api.openai.com/v1"
                  disabled={!llmEnabled}
                />
              </div>
              <div className="st-field">
                <label className="st-label">
                  <span className="st-label-icon">◈</span> API Key
                </label>
                <input
                  type="password"
                  className="st-input"
                  value={llmApiKey}
                  onChange={e => setLlmApiKey(e.target.value)}
                  placeholder="sk-..."
                  disabled={!llmEnabled}
                />
              </div>
              <div className="st-field">
                <label className="st-label">
                  <span className="st-label-icon">◈</span> Model
                </label>
                <input
                  type="text"
                  className="st-input"
                  value={llmModel}
                  onChange={e => setLlmModel(e.target.value)}
                  placeholder="gpt-4o-mini"
                  disabled={!llmEnabled}
                />
              </div>
              <div className="st-field">
                <label className="st-label">
                  <span className="st-label-icon">◈</span> Temperature
                </label>
                <div className="st-range-wrap">
                  <input
                    type="range"
                    className="st-range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={llmTemperature}
                    onChange={e => setLlmTemperature(parseFloat(e.target.value))}
                    disabled={!llmEnabled}
                  />
                  <span className="st-range-value">{llmTemperature.toFixed(1)}</span>
                </div>
              </div>
              <div className="st-deco-divider">
                <div className="st-deco-line"></div>
                <div className="st-deco-diamond"></div>
                <div className="st-deco-line"></div>
              </div>
              <label className="st-label" style={{ marginBottom: '12px' }}>
                <span className="st-label-icon">◈</span> Platform Selection
              </label>
              <div className="st-platform-grid">
                <label className={`st-check-item ${llmPlatformDiscogs ? 'checked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={llmPlatformDiscogs}
                    onChange={e => setLlmPlatformDiscogs(e.target.checked)}
                    disabled={!llmEnabled}
                  />
                  <span className="st-check-box"></span>
                  <span className="st-check-name">Discogs</span>
                </label>
                <label className={`st-check-item ${llmPlatformEbay ? 'checked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={llmPlatformEbay}
                    onChange={e => setLlmPlatformEbay(e.target.checked)}
                    disabled={!llmEnabled}
                  />
                  <span className="st-check-box"></span>
                  <span className="st-check-name">eBay</span>
                </label>
                <label className={`st-check-item ${llmPlatformKojima ? 'checked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={llmPlatformKojima}
                    onChange={e => setLlmPlatformKojima(e.target.checked)}
                    disabled={!llmEnabled}
                  />
                  <span className="st-check-box"></span>
                  <span className="st-check-name">Kojima</span>
                </label>
                <label className={`st-check-item ${llmPlatformHmv ? 'checked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={llmPlatformHmv}
                    onChange={e => setLlmPlatformHmv(e.target.checked)}
                    disabled={!llmEnabled}
                  />
                  <span className="st-check-box"></span>
                  <span className="st-check-name">HMV</span>
                </label>
                <label className={`st-check-item ${llmPlatformYahoo ? 'checked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={llmPlatformYahoo}
                    onChange={e => setLlmPlatformYahoo(e.target.checked)}
                    disabled={!llmEnabled}
                  />
                  <span className="st-check-box"></span>
                  <span className="st-check-name">Yahoo</span>
                </label>
                <label className={`st-check-item ${llmPlatformCdjapan ? 'checked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={llmPlatformCdjapan}
                    onChange={e => setLlmPlatformCdjapan(e.target.checked)}
                    disabled={!llmEnabled}
                  />
                  <span className="st-check-box"></span>
                  <span className="st-check-name">CDJapan</span>
                </label>
                <label className={`st-check-item ${llmPlatformTower ? 'checked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={llmPlatformTower}
                    onChange={e => setLlmPlatformTower(e.target.checked)}
                    disabled={!llmEnabled}
                  />
                  <span className="st-check-box"></span>
                  <span className="st-check-name">Tower</span>
                </label>
                <label className={`st-check-item ${llmPlatformSurugaya ? 'checked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={llmPlatformSurugaya}
                    onChange={e => setLlmPlatformSurugaya(e.target.checked)}
                    disabled={!llmEnabled}
                  />
                  <span className="st-check-box"></span>
                  <span className="st-check-name">Suruga-ya</span>
                </label>
                <label className={`st-check-item ${llmPlatformZenmarket ? 'checked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={llmPlatformZenmarket}
                    onChange={e => setLlmPlatformZenmarket(e.target.checked)}
                    disabled={!llmEnabled}
                  />
                  <span className="st-check-box"></span>
                  <span className="st-check-name">ZenMarket</span>
                </label>
              </div>
            </div>
          </div>
        )

      case 'cloudflare':
        return (
          <div className="st-section-content">
            <div className="st-section-desc">
              Suruga-ya 与 ZenMarket 使用 Cloudflare 反爬。点击「验证」会启动一个真实 Chrome 窗口，请在里面手动完成验证；验证通过后，搜索会直接在这个 Chrome 里进行。
            </div>
            <div className="st-field-group">
              <div className="st-field-group-title">
                <span className="st-icon">◈</span> 平台状态
              </div>
              {([
                { platform: 'surugaya' as CloudflarePlatform, label: 'Suruga-ya', status: cfSurugaya, busy: cfBusy.surugaya },
                { platform: 'zenmarket' as CloudflarePlatform, label: 'ZenMarket', status: cfZenmarket, busy: cfBusy.zenmarket }
              ]).map(row => {
                const statusText = row.busy
                  ? '验证中…（请在打开的 Chrome 窗口完成验证）'
                  : row.status.state === 'verified'
                    ? `已验证${row.status.expiresAt ? `（有效期至 ${new Date(row.status.expiresAt).toLocaleString()}）` : ''}`
                    : row.status.state === 'expired'
                      ? '验证已过期（需重新验证）'
                      : row.status.state === 'unverified'
                        ? 'Chrome 已启动，尚未验证'
                        : row.status.state === 'starting'
                          ? 'Chrome 启动中…'
                          : 'Chrome 未启动'
                return (
                  <div key={row.platform} className="st-field">
                    <label className="st-label">
                      <span className="st-label-icon">◈</span> {row.label}
                    </label>
                    <div className="st-cf-status">{statusText}</div>
                    <div className="st-cf-actions">
                      <button
                        type="button"
                        className="st-btn-save"
                        onClick={() => void handleCloudflareChallenge(row.platform)}
                        disabled={row.busy}
                      >
                        {row.busy ? '验证中…' : '启动 Chrome 并验证'}
                      </button>
                    </div>
                  </div>
                )
              })}
              <div className="st-cf-actions" style={{ marginTop: '14px' }}>
                <button type="button" className="st-btn-cancel" onClick={() => void handleCloseCloudflare()}>
                  关闭 Chrome 会话
                </button>
              </div>
              <div className="st-section-desc" style={{ marginTop: '12px' }}>
                提示：验证与搜索会在同一个真实 Chrome 窗口里进行。关闭该 Chrome 后需重新启动并验证；Cloudflare 验证有效期通常为 30 分钟～数小时。
              </div>
            </div>
          </div>
        )
    }
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={e => e.stopPropagation()}>
        {/* Sidebar */}
        <nav className="settings-sidebar">
          <div className="settings-sidebar-header">
            <h2>Settings</h2>
            <div className="st-divider">
              <div className="st-divider-line"></div>
              <div className="st-divider-diamond"></div>
            </div>
          </div>
          <div className="settings-nav">
            {navItems.map(item => (
              <button
                key={item.key}
                className={`settings-nav-item ${activeSection === item.key ? 'active' : ''}`}
                onClick={() => setActiveSection(item.key)}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>
          <div className="settings-sidebar-footer">
            <button className="st-close-button" onClick={onClose}>
              <span>✕</span> Close
            </button>
          </div>
        </nav>

        {/* Main Content */}
        <div className="settings-main">
          <div className="settings-content-header">
            <h3>{navItems.find(i => i.key === activeSection)?.label}</h3>
            <span className="st-section-badge">Configuration</span>
          </div>
          <div className="settings-scroll">
            {renderContent()}
          </div>
          <footer className="settings-footer">
            <span className="st-footer-hint">Changes apply on next search</span>
            <div className="st-footer-actions">
              <button className="st-btn-cancel" onClick={onClose}>Cancel</button>
              <button className="st-btn-save" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </footer>
        </div>

        {toast && <div className={`st-toast ${toast.includes('Failed') ? 'error' : ''}`}>{toast}</div>}
      </div>
    </div>
  )
}
