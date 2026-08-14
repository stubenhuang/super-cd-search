import { useState, useEffect, useCallback } from 'react'
import type { Settings, Platform, CloudflarePlatform, CloudflareSessionStatus, ThemeMode, Language } from './electron-api'
import { PLATFORMS, PLATFORM_LABELS, DEFAULT_STANDARD_PLATFORMS, DEFAULT_DEEP_PLATFORMS } from '../../shared/platforms'
import { saveTheme } from './theme'
import { useI18n } from './i18n'
import './Settings.css'

interface SettingsPanelProps {
  isOpen: boolean
  onClose: () => void
}

type SectionKey = 'api' | 'cookies' | 'proxy' | 'sources' | 'llm' | 'cloudflare' | 'appearance'

export function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const { t, language, setLanguage } = useI18n()
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
  const [theme, setTheme] = useState<ThemeMode>('light')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

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
        setToast({ kind: 'success', text: t('cloudflare.toastSuccess') })
      } else if (result.status === 'cancelled') {
        setToast({ kind: 'success', text: t('cloudflare.toastCancelled') })
      } else {
        setToast({ kind: 'error', text: t('cloudflare.toastFailed', { error: result.error || t('cloudflare.unknownError') }) })
      }
      setTimeout(() => setToast(null), 4000)
    } catch {
      setToast({ kind: 'error', text: t('cloudflare.toastFailedUnknown') })
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
    setTheme(settings.theme || 'light')
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
      setToast({ kind: 'success', text: t('settings.saved') })
      setTimeout(() => setToast(null), 3000)
    } catch {
      setToast({ kind: 'error', text: t('settings.saveFailed') })
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
    { key: 'appearance', icon: '◐', label: t('nav.appearance') },
    { key: 'api', icon: '◆', label: t('nav.api') },
    { key: 'cookies', icon: '◈', label: t('nav.cookies') },
    { key: 'proxy', icon: '◉', label: t('nav.proxy') },
    { key: 'sources', icon: '◎', label: t('nav.sources') },
    { key: 'llm', icon: '◇', label: t('nav.llm') },
    { key: 'cloudflare', icon: '◈', label: t('nav.cloudflare') }
  ]

  const renderContent = () => {
    switch (activeSection) {
      case 'api':
        return (
          <div className="st-section-content">
            <div className="st-section-desc">
              {t('api.desc')}
            </div>
            <div className="st-field-group">
              <div className="st-field-group-title">
                <span className="st-icon">◆</span> Discogs
              </div>
              <div className="st-field">
                <label className="st-label">
                  <span className="st-label-icon">◆</span>
                  {t('api.discogs.pat')}
                </label>
                <div className="st-input-wrap">
                  <input
                    type="password"
                    className="st-input"
                    value={discogsToken}
                    onChange={e => setDiscogsToken(e.target.value)}
                    placeholder={t('api.discogs.patPlaceholder')}
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
                  {t('api.ebay.clientId')}
                </label>
                <input
                  type="text"
                  className="st-input"
                  value={ebayClientId}
                  onChange={e => setEbayClientId(e.target.value)}
                  placeholder={t('api.ebay.clientIdPlaceholder')}
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
                  {t('api.ebay.clientSecret')}
                </label>
                <input
                  type="password"
                  className="st-input"
                  value={ebayClientSecret}
                  onChange={e => setEbayClientSecret(e.target.value)}
                  placeholder={t('api.ebay.clientSecretPlaceholder')}
                />
              </div>
            </div>
          </div>
        )

      case 'cookies':
        return (
          <div className="st-section-content">
            <div className="st-section-desc">
              {t('cookies.desc')}
            </div>
            <div className="st-field">
              <label className="st-label">
                <span className="st-label-icon">◈</span> {t('cookies.label', { name: 'Discogs' })}
              </label>
              <textarea
                className="st-textarea"
                value={cookiesDiscogs}
                onChange={e => setCookiesDiscogs(e.target.value)}
                placeholder={t('cookies.placeholder')}
                rows={3}
              />
            </div>
            <div className="st-field">
              <label className="st-label">
                <span className="st-label-icon">◈</span> {t('cookies.label', { name: 'eBay' })}
              </label>
              <textarea
                className="st-textarea"
                value={cookiesEbay}
                onChange={e => setCookiesEbay(e.target.value)}
                placeholder={t('cookies.placeholder')}
                rows={3}
              />
            </div>
            <div className="st-field">
              <label className="st-label">
                <span className="st-label-icon">◈</span> {t('cookies.label', { name: 'Kojima Rokuon' })}
              </label>
              <textarea
                className="st-textarea"
                value={cookiesKojima}
                onChange={e => setCookiesKojima(e.target.value)}
                placeholder={t('cookies.placeholder')}
                rows={3}
              />
            </div>
            <div className="st-field">
              <label className="st-label">
                <span className="st-label-icon">◈</span> {t('cookies.label', { name: 'HMV Japan' })}
              </label>
              <textarea
                className="st-textarea"
                value={cookiesHmv}
                onChange={e => setCookiesHmv(e.target.value)}
                placeholder={t('cookies.placeholder')}
                rows={3}
              />
            </div>
            <div className="st-field">
              <label className="st-label">
                <span className="st-label-icon">◈</span> {t('cookies.label', { name: 'Yahoo Shopping' })}
              </label>
              <textarea
                className="st-textarea"
                value={cookiesYahoo}
                onChange={e => setCookiesYahoo(e.target.value)}
                placeholder={t('cookies.placeholder')}
                rows={3}
              />
            </div>
            <div className="st-field">
              <label className="st-label">
                <span className="st-label-icon">◈</span> {t('cookies.label', { name: 'CDJapan' })}
              </label>
              <textarea
                className="st-textarea"
                value={cookiesCdjapan}
                onChange={e => setCookiesCdjapan(e.target.value)}
                placeholder={t('cookies.placeholder')}
                rows={3}
              />
            </div>
            <div className="st-field">
              <label className="st-label">
                <span className="st-label-icon">◈</span> {t('cookies.label', { name: 'Tower Records' })}
              </label>
              <textarea
                className="st-textarea"
                value={cookiesTower}
                onChange={e => setCookiesTower(e.target.value)}
                placeholder={t('cookies.placeholder')}
                rows={3}
              />
            </div>
          </div>
        )

      case 'proxy':
        return (
          <div className="st-section-content">
            <div className="st-section-desc">
              {t('proxy.desc')}
            </div>
            <div className="st-toggle-row">
              <div className="st-toggle-info">
                <span className="st-toggle-title">{t('proxy.enable')}</span>
                <span className="st-toggle-desc">{t('proxy.enableDesc')}</span>
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
                    <span className="st-label-icon">◈</span> {t('proxy.host')}
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
                    <span className="st-label-icon">◈</span> {t('proxy.port')}
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
              {t('sources.desc')}
            </div>
            <div className="st-toggle-row">
              <div className="st-toggle-info">
                <span className="st-toggle-title">{t('sources.fastMode')}</span>
                <span className="st-toggle-desc">{t('sources.fastModeDesc')}</span>
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
                <span className="st-icon">◆</span> {t('sources.standard')}
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
                <span className="st-icon">◆</span> {t('sources.deep')}
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
              {t('llm.desc')}
            </div>
            <div className="st-toggle-row">
              <div className="st-toggle-info">
                <span className="st-toggle-title">{t('llm.enable')}</span>
                <span className="st-toggle-desc">{t('llm.enableDesc')}</span>
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
                  <span className="st-label-icon">◈</span> {t('llm.apiBaseUrl')}
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
                  <span className="st-label-icon">◈</span> {t('llm.apiKey')}
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
                  <span className="st-label-icon">◈</span> {t('llm.model')}
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
                  <span className="st-label-icon">◈</span> {t('llm.temperature')}
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
                <span className="st-label-icon">◈</span> {t('llm.platformSelection')}
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
              {t('cloudflare.desc')}
            </div>
            <div className="st-field-group">
              <div className="st-field-group-title">
                <span className="st-icon">◈</span> {t('cloudflare.status')}
              </div>
              {([
                { platform: 'surugaya' as CloudflarePlatform, label: 'Suruga-ya', status: cfSurugaya, busy: cfBusy.surugaya },
                { platform: 'zenmarket' as CloudflarePlatform, label: 'ZenMarket', status: cfZenmarket, busy: cfBusy.zenmarket }
              ]).map(row => {
                const statusText = row.busy
                  ? t('cloudflare.stateVerifying')
                  : row.status.state === 'verified'
                    ? (row.status.expiresAt ? t('cloudflare.stateVerified', { expires: new Date(row.status.expiresAt).toLocaleString() }) : t('cloudflare.stateVerifiedShort'))
                    : row.status.state === 'expired'
                      ? t('cloudflare.stateExpired')
                      : row.status.state === 'unverified'
                        ? t('cloudflare.stateUnverified')
                        : row.status.state === 'starting'
                          ? t('cloudflare.stateStarting')
                          : t('cloudflare.stateNotStarted')
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
                        {row.busy ? t('cloudflare.verifying') : t('cloudflare.verify')}
                      </button>
                    </div>
                  </div>
                )
              })}
              <div className="st-cf-actions" style={{ marginTop: '14px' }}>
                <button type="button" className="st-btn-cancel" onClick={() => void handleCloseCloudflare()}>
                  {t('cloudflare.closeSession')}
                </button>
              </div>
              <div className="st-section-desc" style={{ marginTop: '12px' }}>
                {t('cloudflare.hint')}
              </div>
            </div>
          </div>
        )

      case 'appearance':
        return (
          <div className="st-section-content">
            <div className="st-section-desc">
              {t('appearance.desc')}
            </div>
            <div className="st-field-group">
              <div className="st-field-group-title">
                <span className="st-icon">◐</span> {t('appearance.theme')}
              </div>
              <div className="st-theme-options" role="radiogroup" aria-label={t('appearance.theme')}>
                {([
                  { value: 'light', label: t('theme.light'), hint: t('theme.lightHint') },
                  { value: 'dark', label: t('theme.dark'), hint: t('theme.darkHint') },
                  { value: 'system', label: t('theme.system'), hint: t('theme.systemHint') }
                ] as { value: ThemeMode; label: string; hint: string }[]).map(option => (
                  <label
                    key={option.value}
                    className={`st-theme-option ${theme === option.value ? 'checked' : ''}`}
                  >
                    <input
                      type="radio"
                      name="theme"
                      value={option.value}
                      checked={theme === option.value}
                      onChange={e => {
                        const next = e.target.value as ThemeMode
                        setTheme(next)
                        void saveTheme(next)
                      }}
                    />
                    <span className="st-theme-radio"></span>
                    <span className="st-theme-label">{option.label}</span>
                    <span className="st-theme-hint">{option.hint}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="st-field-group">
              <div className="st-field-group-title">
                <span className="st-icon">◐</span> {t('appearance.language')}
              </div>
              <div className="st-theme-options" role="radiogroup" aria-label={t('appearance.language')}>
                {([
                  { value: 'zh', label: '中文' },
                  { value: 'en', label: 'English' }
                ] as { value: Language; label: string }[]).map(option => (
                  <label
                    key={option.value}
                    className={`st-theme-option ${language === option.value ? 'checked' : ''}`}
                  >
                    <input
                      type="radio"
                      name="language"
                      value={option.value}
                      checked={language === option.value}
                      onChange={e => setLanguage(e.target.value as Language)}
                    />
                    <span className="st-theme-radio"></span>
                    <span className="st-theme-label">{option.label}</span>
                  </label>
                ))}
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
            <h2>{t('settings.title')}</h2>
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
              <span>✕</span> {t('settings.close')}
            </button>
          </div>
        </nav>

        {/* Main Content */}
        <div className="settings-main">
          <div className="settings-content-header">
            <h3>{navItems.find(i => i.key === activeSection)?.label}</h3>
            <span className="st-section-badge">{t('settings.badge')}</span>
          </div>
          <div className="settings-scroll">
            {renderContent()}
          </div>
          <footer className="settings-footer">
            <span className="st-footer-hint">{t('settings.footerHint')}</span>
            <div className="st-footer-actions">
              <button className="st-btn-cancel" onClick={onClose}>{t('settings.cancel')}</button>
              <button className="st-btn-save" onClick={handleSave} disabled={saving}>
                {saving ? t('settings.saving') : t('settings.save')}
              </button>
            </div>
          </footer>
        </div>

        {toast && <div className={`st-toast ${toast.kind === 'error' ? 'error' : ''}`}>{toast.text}</div>}
      </div>
    </div>
  )
}
