import { useState, useEffect, useCallback } from 'react'
import type { Settings, Platform } from './electron-api'
import { PLATFORMS, PLATFORM_LABELS, DEFAULT_STANDARD_PLATFORMS, DEFAULT_DEEP_PLATFORMS } from '../../shared/platforms'
import './Settings.css'

interface SettingsPanelProps {
  isOpen: boolean
  onClose: () => void
}

type SectionKey = 'api' | 'cookies' | 'proxy' | 'sources' | 'llm'

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
  const [standardPlatforms, setStandardPlatforms] = useState<Platform[]>(DEFAULT_STANDARD_PLATFORMS)
  const [deepPlatforms, setDeepPlatforms] = useState<Platform[]>(DEFAULT_DEEP_PLATFORMS)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      loadSettings()
    }
  }, [isOpen])

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
    setStandardPlatforms(settings.standardPlatforms ?? DEFAULT_STANDARD_PLATFORMS)
    setDeepPlatforms(settings.deepPlatforms ?? DEFAULT_DEEP_PLATFORMS)
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
          tower: llmPlatformTower
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
    { key: 'llm', icon: '◇', label: 'LLM Config' }
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
