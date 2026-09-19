import { useState, useEffect, useCallback } from 'react'
import type { Settings, Platform, LoginPlatform, LoginSessionStatus, BarcodeProvider, SettingsTransferResult } from './electron-api'
import { SELECTABLE_PLATFORMS, CHANNEL_PLATFORMS, PLATFORM_LABELS, DEFAULT_STANDARD_PLATFORMS, DEFAULT_DEEP_PLATFORMS, BARCODE_PROVIDERS, BARCODE_PROVIDER_LABELS, DEFAULT_BARCODE_PROVIDERS } from '../../shared/platforms'
import { useI18n } from './i18n'
import { useUpdateState } from './hooks/useUpdateState'
import { PublishTargetsSection } from './Publish'
import { GITHUB_REPO_URL } from '../../shared/updater'
import './Settings.css'

interface SettingsPanelProps {
  isOpen: boolean
  onClose: () => void
}

type SectionKey = 'api' | 'proxy' | 'barcode' | 'sources' | 'publish' | 'llm' | 'login' | 'backup' | 'about'

export function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const { t } = useI18n()
  const [activeSection, setActiveSection] = useState<SectionKey>('api')
  const [discogsToken, setDiscogsToken] = useState('')
  const [ebayClientId, setEbayClientId] = useState('')
  const [ebayClientSecret, setEbayClientSecret] = useState('')
  const [proxyEnabled, setProxyEnabled] = useState(false)
  const [proxyHost, setProxyHost] = useState('')
  const [proxyPort, setProxyPort] = useState(1080)
  const [barcodeProviders, setBarcodeProviders] = useState<BarcodeProvider[]>(DEFAULT_BARCODE_PROVIDERS)
  const [llmEnabled, setLlmEnabled] = useState(false)
  const [llmApiBaseUrl, setLlmApiBaseUrl] = useState('https://api.openai.com/v1')
  const [llmApiKey, setLlmApiKey] = useState('')
  const [llmModel, setLlmModel] = useState('gpt-4o-mini')
  const [llmPlatformDiscogs, setLlmPlatformDiscogs] = useState(true)
  const [llmPlatformEbay, setLlmPlatformEbay] = useState(true)
  const [llmPlatformKojima, setLlmPlatformKojima] = useState(true)
  const [llmPlatformHmv, setLlmPlatformHmv] = useState(true)
  const [llmPlatformYahoo, setLlmPlatformYahoo] = useState(true)
  const [llmPlatformCdjapan, setLlmPlatformCdjapan] = useState(true)
  const [llmPlatformTower, setLlmPlatformTower] = useState(true)
  const [loginStatus, setLoginStatus] = useState<Record<LoginPlatform, LoginSessionStatus>>({
    xianyu: { state: 'not_started' },
    taobao: { state: 'not_started' }
  })
  const [loginBusy, setLoginBusy] = useState<Partial<Record<LoginPlatform, boolean>>>({})
  const [standardPlatforms, setStandardPlatforms] = useState<Platform[]>(DEFAULT_STANDARD_PLATFORMS)
  const [deepPlatforms, setDeepPlatforms] = useState<Platform[]>(DEFAULT_DEEP_PLATFORMS)
  const [fastMode, setFastMode] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [backupExportPassword, setBackupExportPassword] = useState('')
  const [backupExportConfirm, setBackupExportConfirm] = useState('')
  const [backupImportPassword, setBackupImportPassword] = useState('')
  const [backupBusy, setBackupBusy] = useState<'export' | 'import' | null>(null)
  const [backupImportError, setBackupImportError] = useState<string | null>(null)
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(true)
  const { state: updateState, check: checkForUpdates, download: downloadUpdate, install: installUpdate } = useUpdateState()

  useEffect(() => {
    if (isOpen) {
      loadSettings()
    }
  }, [isOpen])

  const refreshLoginStatus = useCallback(async () => {
    const [xianyu, taobao] = await Promise.all([
      window.electronAPI.getLoginStatus('xianyu'),
      window.electronAPI.getLoginStatus('taobao')
    ])
    setLoginStatus({ xianyu, taobao })
  }, [])

  const handleLogin = async (platform: LoginPlatform) => {
    setLoginBusy(prev => ({ ...prev, [platform]: true }))
    try {
      const result = await window.electronAPI.startLogin(platform)
      if (result.status === 'done') {
        setToast({ kind: 'success', text: t('channels.toastSuccess') })
      } else if (result.status === 'cancelled') {
        setToast({ kind: 'success', text: t('channels.toastCancelled') })
      } else {
        setToast({ kind: 'error', text: t('channels.toastFailed', { error: result.error || t('login.unknownError') }) })
      }
      setTimeout(() => setToast(null), 4000)
    } catch {
      setToast({ kind: 'error', text: t('login.toastFailedUnknown') })
      setTimeout(() => setToast(null), 4000)
    } finally {
      setLoginBusy(prev => ({ ...prev, [platform]: false }))
      void refreshLoginStatus()
    }
  }

  const handleCloseLogin = async () => {
    await window.electronAPI.closeLoginSession()
    void refreshLoginStatus()
  }

  const handleClearCache = async () => {
    try {
      await window.electronAPI.clearSearchCache()
      setToast({ kind: 'success', text: t('cache.cleared') })
    } catch {
      setToast({ kind: 'error', text: t('cache.clearFailed') })
    }
    setTimeout(() => setToast(null), 3000)
  }

  const loadSettings = useCallback(async () => {
    const settings = await window.electronAPI.getSettings() as Settings
    setDiscogsToken(settings.discogsToken || '')
    setEbayClientId(settings.ebayClientId || '')
    setEbayClientSecret(settings.ebayClientSecret || '')
    setProxyEnabled(settings.proxyEnabled || false)
    setProxyHost(settings.proxyHost || '')
    setProxyPort(settings.proxyPort || 1080)
    setBarcodeProviders(settings.barcodeProviders ?? DEFAULT_BARCODE_PROVIDERS)
    const llm = settings.llm
    setLlmEnabled(llm?.enabled || false)
    setLlmApiBaseUrl(llm?.apiBaseUrl || 'https://api.openai.com/v1')
    setLlmApiKey(llm?.apiKey || '')
    setLlmModel(llm?.model || 'gpt-4o-mini')
    setLlmPlatformDiscogs(llm?.platformEnabled?.discogs ?? true)
    setLlmPlatformEbay(llm?.platformEnabled?.ebay ?? true)
    setLlmPlatformKojima(llm?.platformEnabled?.kojima ?? true)
    setLlmPlatformHmv(llm?.platformEnabled?.hmv ?? true)
    setLlmPlatformYahoo(llm?.platformEnabled?.yahoo ?? true)
    setLlmPlatformCdjapan(llm?.platformEnabled?.cdjapan ?? true)
    setLlmPlatformTower(llm?.platformEnabled?.tower ?? true)
    void refreshLoginStatus()
    setStandardPlatforms(settings.standardPlatforms ?? DEFAULT_STANDARD_PLATFORMS)
    setDeepPlatforms(settings.deepPlatforms ?? DEFAULT_DEEP_PLATFORMS)
    setFastMode(settings.fastMode || false)
    setAutoUpdateEnabled(settings.autoUpdateEnabled !== false)
  }, [refreshLoginStatus])

  const backupErrorMessage = (result: SettingsTransferResult): string | null => {
    switch (result.errorCode) {
      case 'weak_password': return t('backup.error.weak')
      case 'bad_password': return t('backup.error.badPassword')
      case 'corrupt_file': return t('backup.error.corrupt')
      case 'unsupported_version': return t('backup.error.unsupported')
      case 'io_error': return t('backup.error.io')
      default: return null
    }
  }

  const handleExportBackup = async () => {
    setBackupBusy('export')
    try {
      const result = await window.electronAPI.exportSettingsBackup(backupExportPassword)
      if (result.status === 'ok') {
        setBackupExportPassword('')
        setBackupExportConfirm('')
        setToast({ kind: 'success', text: t('backup.exportDone') })
      } else if (result.status === 'error') {
        setToast({ kind: 'error', text: backupErrorMessage(result) ?? t('backup.error.io') })
      }
    } catch {
      setToast({ kind: 'error', text: t('backup.error.io') })
    } finally {
      setBackupBusy(null)
      setTimeout(() => setToast(null), 4000)
    }
  }

  const handleImportBackup = async () => {
    setBackupBusy('import')
    setBackupImportError(null)
    try {
      const result = await window.electronAPI.importSettingsBackup(backupImportPassword)
      if (result.status === 'ok') {
        setBackupImportPassword('')
        await loadSettings()
        setToast({ kind: 'success', text: t('backup.importDone') })
      } else if (result.status === 'error') {
        const message = backupErrorMessage(result) ?? t('backup.error.io')
        setToast({ kind: 'error', text: message })
        if (result.errorCode === 'bad_password') setBackupImportError(message)
      }
    } catch {
      setToast({ kind: 'error', text: t('backup.error.io') })
    } finally {
      setBackupBusy(null)
      setTimeout(() => setToast(null), 4000)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await window.electronAPI.updateSettings({
        discogsToken,
        ebayClientId,
        ebayClientSecret,
        proxyEnabled,
        proxyHost,
        proxyPort,
        barcodeProviders,
        standardPlatforms,
        deepPlatforms,
        fastMode,
        llm: {
          enabled: llmEnabled,
          apiBaseUrl: llmApiBaseUrl,
          apiKey: llmApiKey,
          model: llmModel,
          platformEnabled: {
            discogs: llmPlatformDiscogs,
            ebay: llmPlatformEbay,
            kojima: llmPlatformKojima,
            hmv: llmPlatformHmv,
            yahoo: llmPlatformYahoo,
            cdjapan: llmPlatformCdjapan,
            tower: llmPlatformTower
          }
        }
      })
      window.electronAPI.log('debug', 'settings', 'settings saved', { llmEnabled, llmModel, llmApiBaseUrl })
      setToast({ kind: 'success', text: t('settings.saved') })
      setTimeout(() => setToast(null), 3000)
    } catch {
      window.electronAPI.log('warn', 'settings', 'settings save failed')
      setToast({ kind: 'error', text: t('settings.saveFailed') })
      setTimeout(() => setToast(null), 3000)
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    onClose()
  }

  const toggleBarcodeProvider = (provider: BarcodeProvider) => {
    setBarcodeProviders(prev => {
      if (prev.includes(provider)) return prev.filter(p => p !== provider)
      // Re-enable in the canonical provider order at the end of the list.
      return BARCODE_PROVIDERS.filter(p => prev.includes(p) || p === provider)
    })
  }

  const moveBarcodeProvider = (provider: BarcodeProvider, direction: -1 | 1) => {
    setBarcodeProviders(prev => {
      const index = prev.indexOf(provider)
      const target = index + direction
      if (index < 0 || target < 0 || target >= prev.length) return prev
      const next = [...prev]
      const [item] = next.splice(index, 1)
      next.splice(target, 0, item)
      return next
    })
  }

  const togglePlatform = (list: Platform[], platform: Platform): Platform[] => {
    if (list.includes(platform)) {
      return list.filter(p => p !== platform)
    }
    // Keep the canonical platform order when adding a platform back.
    return SELECTABLE_PLATFORMS.filter(p => list.includes(p) || p === platform)
  }

  // One checkbox cell for the standard/deep platform grids. Marketplace
  // channels additionally show their QR-login state; clicking the badge opens
  // the login section instead of toggling the checkbox.
  const platformCheckItem = (p: Platform, checked: boolean, onToggle: () => void) => {
    const isChannel = CHANNEL_PLATFORMS.includes(p)
    const label = p === 'xianyu'
      ? t('sources.channelXianyu')
      : p === 'taobao'
        ? t('sources.channelTaobao')
        : PLATFORM_LABELS[p]
    const verified = isChannel && loginStatus[p as LoginPlatform]?.state === 'verified'
    return (
      <label key={p} className={`st-check-item ${checked ? 'checked' : ''}`}>
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
        />
        <span className="st-check-box"></span>
        <span className="st-check-name">{label}</span>
        {isChannel && (
          <span
            className={`st-check-badge ${verified ? 'st-check-badge-ok' : ''}`}
            role="button"
            title={verified ? t('sources.channelVerified') : t('sources.channelNotVerified')}
            onClick={e => {
              e.preventDefault()
              setActiveSection('login')
            }}
          >
            {verified ? t('sources.channelVerified') : t('sources.channelNotVerified')}
          </span>
        )}
      </label>
    )
  }

  if (!isOpen) return null

  const navItems: { key: SectionKey; icon: string; label: string }[] = [
    { key: 'api', icon: '◆', label: t('nav.api') },
    { key: 'proxy', icon: '◉', label: t('nav.proxy') },
    { key: 'barcode', icon: '▣', label: t('nav.barcodeProviders') },
    { key: 'sources', icon: '◎', label: t('nav.sources') },
    { key: 'publish', icon: '⚑', label: t('nav.publish') },
    { key: 'llm', icon: '◇', label: t('nav.llm') },
    { key: 'login', icon: '◈', label: t('nav.login') },
    { key: 'backup', icon: '⇅', label: t('nav.backup') },
    { key: 'about', icon: '⟳', label: t('nav.about') }
  ]

  const showToast = (text: string, kind: 'success' | 'error' = 'success') => {
    setToast({ kind, text })
    setTimeout(() => setToast(null), 4000)
  }

  const handleToggleAutoUpdate = (enabled: boolean) => {
    setAutoUpdateEnabled(enabled)
    void window.electronAPI.setSetting('autoUpdateEnabled', enabled).catch(() => {})
  }

  const handleCheckForUpdates = async () => {
    try {
      const next = await checkForUpdates()
      if (next.status === 'error') {
        showToast(t('about.checkFailed', { error: next.error || t('lan.unknownError') }), 'error')
      } else if (next.status === 'not-available') {
        showToast(t('about.upToDate'))
      }
    } catch {
      showToast(t('about.checkFailed', { error: t('lan.unknownError') }), 'error')
    }
  }

  const handleDownloadUpdate = async () => {
    try {
      const next = await downloadUpdate()
      if (next.status === 'error') {
        showToast(t('about.checkFailed', { error: next.error || t('lan.unknownError') }), 'error')
      }
    } catch {
      showToast(t('about.checkFailed', { error: t('lan.unknownError') }), 'error')
    }
  }

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

      case 'barcode':
        return (
          <div className="st-section-content">
            <div className="st-section-desc">
              {t('lan.providersDesc')}
            </div>
            <div className="st-field-group">
              <div className="st-field-group-title">
                <span className="st-icon">▣</span> {t('lan.providers')}
              </div>
              <div className="st-provider-list">
                {barcodeProviders.map((provider, index) => (
                  <div key={provider} className="st-provider-row">
                    <span className="st-provider-order">{index + 1}</span>
                    <div className="st-provider-info">
                      <span className="st-provider-name">{BARCODE_PROVIDER_LABELS[provider]}</span>
                    </div>
                    <div className="st-provider-actions">
                      <button
                        type="button"
                        className="st-btn-cancel st-provider-move"
                        onClick={() => moveBarcodeProvider(provider, -1)}
                        disabled={index === 0}
                        title={t('lan.moveUp')}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="st-btn-cancel st-provider-move"
                        onClick={() => moveBarcodeProvider(provider, 1)}
                        disabled={index === barcodeProviders.length - 1}
                        title={t('lan.moveDown')}
                      >
                        ↓
                      </button>
                      <label className="st-switch st-provider-switch" title={t('lan.disableProvider')}>
                        <input
                          type="checkbox"
                          checked
                          onChange={() => toggleBarcodeProvider(provider)}
                        />
                        <span className="st-slider"></span>
                      </label>
                    </div>
                  </div>
                ))}
              </div>
              {BARCODE_PROVIDERS.filter(provider => !barcodeProviders.includes(provider)).length > 0 && (
                <div className="st-provider-disabled">
                  <div className="st-section-desc">{t('lan.disabledProviders')}</div>
                  <div className="st-provider-disabled-list">
                    {BARCODE_PROVIDERS.filter(provider => !barcodeProviders.includes(provider)).map(provider => (
                      <button
                        key={provider}
                        type="button"
                        className="st-btn-cancel"
                        onClick={() => toggleBarcodeProvider(provider)}
                      >
                        + {BARCODE_PROVIDER_LABELS[provider]}
                      </button>
                    ))}
                  </div>
                </div>
              )}
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
                {SELECTABLE_PLATFORMS.map(p => platformCheckItem(
                  p,
                  standardPlatforms.includes(p),
                  () => setStandardPlatforms(togglePlatform(standardPlatforms, p))
                ))}
              </div>
            </div>
            <div className="st-field-group">
              <div className="st-field-group-title">
                <span className="st-icon">◆</span> {t('sources.deep')}
              </div>
              <div className="st-platform-grid">
                {SELECTABLE_PLATFORMS.map(p => platformCheckItem(
                  p,
                  deepPlatforms.includes(p),
                  () => setDeepPlatforms(togglePlatform(deepPlatforms, p))
                ))}
              </div>
            </div>
            <div className="st-field-group">
              <div className="st-field-group-title">
                <span className="st-icon">◈</span> {t('cache.label')}
              </div>
              <div className="st-section-desc">{t('cache.desc')}</div>
              <div className="st-cf-actions">
                <button type="button" className="st-btn-cancel" onClick={() => void handleClearCache()}>
                  {t('cache.clear')}
                </button>
              </div>
            </div>
          </div>
        )

      case 'publish':
        // Target list changes are persisted immediately inside the section, so
        // the panel-level 保存 button has nothing to stage for it.
        return <PublishTargetsSection onToast={showToast} />

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
                <div className="st-field-hint">{t('llm.apiBaseUrlHint')}</div>
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
              <div className="st-deco-divider">
                <div className="st-deco-line"></div>
                <div className="st-deco-diamond"></div>
                <div className="st-deco-line"></div>
              </div>
              <label className="st-label" style={{ marginBottom: '12px' }}>
                <span className="st-label-icon">◈</span> {t('llm.platformSelection')}
              </label>
              <div className="st-section-desc" style={{ marginBottom: '12px' }}>
                {t('llm.smartSourcesHint')}
              </div>
              <div className="st-platform-grid">
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

      case 'login':
        return (
          <div className="st-section-content">
            <div className="st-section-desc">
              {t('login.desc')}
            </div>
            <div className="st-field-group">
              <div className="st-field-group-title">
                <span className="st-icon">◈</span> {t('login.status')}
              </div>
              {([
                { platform: 'xianyu' as const, label: t('channels.xianyu') },
                { platform: 'taobao' as const, label: t('channels.taobao') }
              ] as const).map(row => {
                const busy = !!loginBusy[row.platform]
                const status = loginStatus[row.platform]
                const statusText = busy
                  ? t('channels.loggingIn')
                  : status.state === 'verified'
                    ? (status.expiresAt ? t('login.stateVerified', { expires: new Date(status.expiresAt).toLocaleString() }) : t('login.stateVerifiedShort'))
                    : status.state === 'expired'
                      ? t('login.stateExpired')
                      : status.state === 'unverified'
                        ? t('login.stateUnverified')
                        : status.state === 'starting'
                          ? t('login.stateStarting')
                          : t('login.stateNotStarted')
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
                        onClick={() => void handleLogin(row.platform)}
                        disabled={busy}
                      >
                        {busy ? t('channels.loggingIn') : t('channels.login')}
                      </button>
                    </div>
                  </div>
                )
              })}
              <div className="st-cf-actions" style={{ marginTop: '14px' }}>
                <button type="button" className="st-btn-cancel" onClick={() => void handleCloseLogin()}>
                  {t('login.closeSession')}
                </button>
              </div>
              <div className="st-section-desc" style={{ marginTop: '12px' }}>
                {t('login.hint')}
              </div>
            </div>
          </div>
        )

      case 'backup':
        return (
          <div className="st-section-content">
            <div className="st-section-desc st-backup-desc">
              {t('backup.desc')}
            </div>
            <div className="st-field-group">
              <div className="st-field-group-title">
                <span className="st-icon">⇅</span> {t('backup.export')}
              </div>
              <div className="st-field">
                <label className="st-label">
                  <span className="st-label-icon">⇅</span> {t('backup.password')}
                </label>
                <input
                  type="password"
                  className="st-input"
                  value={backupExportPassword}
                  onChange={e => setBackupExportPassword(e.target.value)}
                  placeholder={t('backup.passwordHint')}
                  disabled={backupBusy !== null}
                />
              </div>
              <div className="st-field">
                <label className="st-label">
                  <span className="st-label-icon">⇅</span> {t('backup.confirmPassword')}
                </label>
                <input
                  type="password"
                  className="st-input"
                  value={backupExportConfirm}
                  onChange={e => setBackupExportConfirm(e.target.value)}
                  placeholder={t('backup.confirmPassword')}
                  disabled={backupBusy !== null}
                />
              </div>
              {backupExportPassword.length > 0 && backupExportPassword.length < 8 && (
                <div className="st-field-error">{t('backup.error.weak')}</div>
              )}
              {backupExportConfirm.length > 0 && backupExportPassword !== backupExportConfirm && (
                <div className="st-field-error">{t('backup.error.mismatch')}</div>
              )}
              <div className="st-cf-actions">
                <button
                  type="button"
                  className="st-btn-save"
                  onClick={() => void handleExportBackup()}
                  disabled={backupBusy !== null || backupExportPassword.length < 8 || backupExportPassword !== backupExportConfirm}
                >
                  {backupBusy === 'export' ? t('backup.exporting') : t('backup.export')}
                </button>
              </div>
            </div>
            <div className="st-field-group">
              <div className="st-field-group-title">
                <span className="st-icon">⇅</span> {t('backup.import')}
              </div>
              <div className="st-field">
                <label className="st-label">
                  <span className="st-label-icon">⇅</span> {t('backup.importPassword')}
                </label>
                <input
                  type="password"
                  className="st-input"
                  value={backupImportPassword}
                  onChange={e => {
                    setBackupImportPassword(e.target.value)
                    setBackupImportError(null)
                  }}
                  placeholder={t('backup.importPassword')}
                  disabled={backupBusy !== null}
                />
              </div>
              {backupImportError && <div className="st-field-error">{backupImportError}</div>}
              <div className="st-cf-actions">
                <button
                  type="button"
                  className="st-btn-cancel"
                  onClick={() => void handleImportBackup()}
                  disabled={backupBusy !== null || backupImportPassword.length === 0}
                >
                  {backupBusy === 'import' ? t('backup.importing') : t('backup.import')}
                </button>
              </div>
              <div className="st-field-hint" style={{ marginTop: '10px' }}>
                {t('backup.importHint')}
              </div>
            </div>
          </div>
        )

      case 'about': {
        const status = updateState?.status ?? 'idle'
        const latestVersion = updateState?.latestVersion ?? ''
        const percent = Math.max(0, Math.min(100, updateState?.progress ?? 0))
        const statusText =
          status === 'checking' ? t('about.checking')
            : status === 'not-available' ? t('about.upToDate')
              : status === 'available' ? t('about.available', { version: latestVersion })
                : status === 'downloading' ? t('about.downloading', { percent })
                  : status === 'downloaded' ? t('about.downloaded', { version: latestVersion })
                    : status === 'error' ? t('about.checkFailed', { error: updateState?.error || t('lan.unknownError') })
                      : status === 'unsupported' ? t('about.unsupported')
                        : t('about.idle')
        return (
          <div className="st-section-content">
            <div className="st-section-desc">
              {t('about.desc')}
            </div>
            <div className="st-field-group">
              <div className="st-field-group-title">
                <span className="st-icon">⟳</span> {t('about.currentVersion')}
              </div>
              <div className="st-cf-status">{updateState?.currentVersion || '—'}</div>
              <div className="st-cf-status" style={{ marginTop: '8px' }}>{statusText}</div>
              {status === 'downloading' && (
                <div className="update-banner-track" style={{ marginTop: '12px' }} aria-hidden="true">
                  <div className="update-banner-fill" style={{ width: `${percent}%` }} />
                </div>
              )}
              {updateState?.releaseNotes && (
                <div className="st-field" style={{ marginTop: '14px' }}>
                  <label className="st-label">
                    <span className="st-label-icon">⟳</span> {t('about.releaseNotes')}
                  </label>
                  <div className="st-cf-status st-update-notes">{updateState.releaseNotes}</div>
                </div>
              )}
              <div className="st-cf-actions">
                <button
                  type="button"
                  className="st-btn-save"
                  onClick={() => void handleCheckForUpdates()}
                  disabled={status === 'checking' || status === 'downloading' || status === 'downloaded'}
                >
                  {status === 'checking' ? t('about.checking') : t('about.checkNow')}
                </button>
                {(status === 'available' || status === 'error') && (
                  <button type="button" className="st-btn-cancel" onClick={() => void handleDownloadUpdate()}>
                    {t('about.download')}
                  </button>
                )}
                {status === 'downloaded' && (
                  <button type="button" className="st-btn-save" onClick={() => void installUpdate()}>
                    {t('about.install')}
                  </button>
                )}
                <button
                  type="button"
                  className="st-btn-cancel"
                  onClick={() => void window.electronAPI.openExternal(updateState?.releaseUrl || `${GITHUB_REPO_URL}/releases/latest`).catch(() => {})}
                >
                  {t('about.viewOnGithub')}
                </button>
              </div>
            </div>
            <div className="st-toggle-row">
              <div className="st-toggle-info">
                <span className="st-toggle-title">{t('about.autoUpdate')}</span>
                <span className="st-toggle-desc">{t('about.autoUpdateDesc')}</span>
              </div>
              <label className="st-switch">
                <input
                  type="checkbox"
                  checked={autoUpdateEnabled}
                  onChange={e => handleToggleAutoUpdate(e.target.checked)}
                />
                <span className="st-slider"></span>
              </label>
            </div>
          </div>
        )
      }
    }
  }

  return (
    <div className="settings-overlay" onClick={handleCancel}>
      <div className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={e => e.stopPropagation()}>
        {/* Sidebar */}
        <nav className="settings-sidebar">
          <div className="settings-sidebar-header">
            <h2 id="settings-title">{t('settings.title')}</h2>
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
                aria-current={activeSection === item.key ? 'page' : undefined}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>
          <div className="settings-sidebar-footer">
            <button className="st-close-button" onClick={handleCancel}>
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
              <button className="st-btn-cancel" onClick={handleCancel}>{t('settings.cancel')}</button>
              <button className="st-btn-save" onClick={handleSave} disabled={saving}>
                {saving ? t('settings.saving') : t('settings.save')}
              </button>
            </div>
          </footer>
        </div>

        {toast && <div role="status" aria-live="polite" className={`st-toast ${toast.kind === 'error' ? 'error' : ''}`}>{toast.text}</div>}
      </div>
    </div>
  )
}
