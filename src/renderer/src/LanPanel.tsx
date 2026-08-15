import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import type { LanCandidate, LanServerStatus } from './electron-api'
import { useI18n } from './i18n'
import './Settings.css'

interface LanPanelProps {
  isOpen: boolean
  onClose: () => void
}

export function LanPanel({ isOpen, onClose }: LanPanelProps) {
  const { t } = useI18n()
  const [lanEnabled, setLanEnabled] = useState(false)
  const [lanPort, setLanPort] = useState(8787)
  const [lanBindChoice, setLanBindChoice] = useState('auto')
  const [lanCustomHost, setLanCustomHost] = useState('')
  const [lanCandidates, setLanCandidates] = useState<LanCandidate[]>([])
  const [lanStatus, setLanStatus] = useState<LanServerStatus>({ state: 'disabled', enabled: false, host: '', port: 8787 })
  const [lanQr, setLanQr] = useState('')
  const [lanBusy, setLanBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const generateLanQr = useCallback(async (url?: string) => {
    if (!url) {
      setLanQr('')
      return
    }
    try {
      const dataUrl = await QRCode.toDataURL(url, {
        width: 264,
        margin: 1,
        color: { dark: '#2C2520', light: '#FEFEFE' }
      })
      setLanQr(dataUrl)
    } catch {
      setLanQr('')
    }
  }, [])

  const refreshLanStatus = useCallback(async () => {
    const [status, candidates] = await Promise.all([
      window.electronAPI.getLanStatus(),
      window.electronAPI.getLanCandidates()
    ])
    setLanStatus(status)
    setLanCandidates(candidates)
    await generateLanQr(status.state === 'running' ? status.url : undefined)
    return { status, candidates }
  }, [generateLanQr])

  const loadLanSettings = useCallback(async () => {
    const settings = await window.electronAPI.getSettings()
    setLanEnabled(settings.lanEnabled || false)
    setLanPort(settings.lanPort || 8787)

    const lan = await refreshLanStatus()
    const savedLanHost = settings.lanHost || ''
    if (!savedLanHost) {
      setLanBindChoice('auto')
      setLanCustomHost('')
    } else if (lan.candidates.some(candidate => candidate.address === savedLanHost)) {
      setLanBindChoice(savedLanHost)
      setLanCustomHost('')
    } else {
      setLanBindChoice('custom')
      setLanCustomHost(savedLanHost)
    }
  }, [refreshLanStatus])

  useEffect(() => {
    if (isOpen) {
      void loadLanSettings()
    }
  }, [isOpen, loadLanSettings])

  const lanStatusText = () => {
    switch (lanStatus.state) {
      case 'running':
        return t('lan.stateRunning', { host: lanStatus.host, port: lanStatus.port })
      case 'error':
        return t('lan.stateError', { error: lanStatus.error || t('lan.unknownError') })
      case 'no_network':
        return lanStatus.error || t('lan.stateNoNetwork')
      case 'stopped':
        return t('lan.stateStopped')
      default:
        return t('lan.stateDisabled')
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const lanHostToSave =
        lanBindChoice === 'auto'
          ? ''
          : lanBindChoice === 'custom'
            ? lanCustomHost.trim()
            : lanBindChoice
      await window.electronAPI.setSetting('lanEnabled', lanEnabled)
      await window.electronAPI.setSetting('lanHost', lanHostToSave)
      await window.electronAPI.setSetting('lanPort', lanPort)
      const lanStatusAfter = await window.electronAPI.applyLanServer()
      setLanStatus(lanStatusAfter)
      await generateLanQr(lanStatusAfter.state === 'running' ? lanStatusAfter.url : undefined)
      setToast({ kind: 'success', text: t('settings.saved') })
      setTimeout(() => setToast(null), 3000)
    } catch {
      setToast({ kind: 'error', text: t('settings.saveFailed') })
      setTimeout(() => setToast(null), 3000)
    } finally {
      setSaving(false)
    }
  }

  const handleRegenerateLanToken = async () => {
    setLanBusy(true)
    try {
      const status = await window.electronAPI.regenerateLanToken()
      setLanStatus(status)
      await generateLanQr(status.state === 'running' ? status.url : undefined)
      setToast({ kind: 'success', text: t('lan.tokenRegenerated') })
    } catch {
      setToast({ kind: 'error', text: t('lan.tokenRegenerateFailed') })
    } finally {
      setLanBusy(false)
    }
    setTimeout(() => setToast(null), 3000)
  }

  if (!isOpen) return null

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel lan-settings-panel" onClick={e => e.stopPropagation()}>
        <div className="settings-main">
          <div className="settings-content-header">
            <h3>{t('nav.lan')}</h3>
            <span className="st-section-badge">{t('settings.badge')}</span>
          </div>
          <div className="settings-scroll">
            <div className="st-section-content">
              <div className="st-section-desc">{t('lan.desc')}</div>
              <div className="st-toggle-row">
                <div className="st-toggle-info">
                  <span className="st-toggle-title">{t('lan.enable')}</span>
                  <span className="st-toggle-desc">{t('lan.enableDesc')}</span>
                </div>
                <label className="st-switch">
                  <input
                    type="checkbox"
                    checked={lanEnabled}
                    onChange={e => setLanEnabled(e.target.checked)}
                  />
                  <span className="st-slider"></span>
                </label>
              </div>
              <div className={lanEnabled ? '' : 'st-section-disabled'}>
                <div className="st-inline-fields">
                  <div className="st-field">
                    <div className="st-lan-label-row">
                      <label className="st-label">
                        <span className="st-label-icon">▣</span> {t('lan.bindAddress')}
                      </label>
                      <button
                        type="button"
                        className="st-btn-cancel st-lan-refresh"
                        onClick={() => void refreshLanStatus()}
                        disabled={!lanEnabled}
                      >
                        {t('lan.refresh')}
                      </button>
                    </div>
                    <select
                      className="st-input"
                      value={lanBindChoice}
                      onChange={e => {
                        setLanBindChoice(e.target.value)
                        if (e.target.value === 'auto') setLanCustomHost('')
                      }}
                      disabled={!lanEnabled}
                    >
                      <option value="auto">{t('lan.autoDetect')}</option>
                      {lanCandidates.map(candidate => (
                        <option key={candidate.address} value={candidate.address}>
                          {candidate.address} — {candidate.interfaceName}
                        </option>
                      ))}
                      <option value="custom">{t('lan.customAddress')}</option>
                    </select>
                  </div>
                  <div className="st-field">
                    <label className="st-label">
                      <span className="st-label-icon">▣</span> {t('lan.port')}
                    </label>
                    <input
                      type="number"
                      className="st-input"
                      value={lanPort}
                      onChange={e => setLanPort(parseInt(e.target.value, 10) || 8787)}
                      placeholder="8787"
                      disabled={!lanEnabled}
                    />
                  </div>
                </div>
                {lanBindChoice === 'custom' && (
                  <div className="st-field">
                    <label className="st-label">
                      <span className="st-label-icon">▣</span> {t('lan.customAddressLabel')}
                    </label>
                    <input
                      type="text"
                      className="st-input"
                      value={lanCustomHost}
                      onChange={e => setLanCustomHost(e.target.value.trim())}
                      placeholder="192.168.1.100"
                      disabled={!lanEnabled}
                    />
                  </div>
                )}
                <div className="st-field-hint">{t('lan.bindHint')}</div>
                <div className={`st-lan-status ${lanStatus.state === 'error' || lanStatus.state === 'no_network' ? 'error' : ''}`}>
                  {lanStatusText()}
                </div>
                {lanEnabled && lanStatus.state === 'running' && lanQr && (
                  <div className="st-lan-qr">
                    <img className="st-qr-image" src={lanQr} alt={t('lan.qrAlt')} />
                    <div className="st-lan-qr-hint">{t('lan.scanHint')}</div>
                    <div className="st-lan-url">http://{lanStatus.host}:{lanStatus.port}/</div>
                    <button
                      type="button"
                      className="st-btn-cancel"
                      onClick={() => void handleRegenerateLanToken()}
                      disabled={lanBusy}
                    >
                      {lanBusy ? t('lan.regenerating') : t('lan.regenerateToken')}
                    </button>
                  </div>
                )}
              </div>
            </div>
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
