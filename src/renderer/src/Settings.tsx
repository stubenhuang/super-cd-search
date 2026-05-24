import { useState, useEffect, useCallback } from 'react'
import type { Settings } from './electron-api'
import './Settings.css'

interface SettingsPanelProps {
  isOpen: boolean
  onClose: () => void
}

export function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const [discogsToken, setDiscogsToken] = useState('')
  const [ebayClientId, setEbayClientId] = useState('')
  const [ebayClientSecret, setEbayClientSecret] = useState('')
  const [cookiesDiscogs, setCookiesDiscogs] = useState('')
  const [cookiesEbay, setCookiesEbay] = useState('')
  const [cookiesKojima, setCookiesKojima] = useState('')
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
        kojima: cookiesKojima
      })
      await window.electronAPI.setSetting('proxyEnabled', proxyEnabled)
      await window.electronAPI.setSetting('proxyHost', proxyHost)
      await window.electronAPI.setSetting('proxyPort', proxyPort)
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
          yahoo: llmPlatformYahoo
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

  if (!isOpen) return null

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={e => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="close-button" onClick={onClose}>&times;</button>
        </div>
        <div className="settings-content">
          <section className="settings-section">
            <h3>API Tokens</h3>
            <div className="form-group">
              <label htmlFor="discogsToken">Discogs API Token</label>
              <input
                id="discogsToken"
                type="password"
                value={discogsToken}
                onChange={e => setDiscogsToken(e.target.value)}
                placeholder="Your Discogs API token"
              />
            </div>
            <div className="form-group">
              <label htmlFor="ebayClientId">eBay Client ID</label>
              <input
                id="ebayClientId"
                type="text"
                value={ebayClientId}
                onChange={e => setEbayClientId(e.target.value)}
                placeholder="Your eBay Client ID"
              />
            </div>
            <div className="form-group">
              <label htmlFor="ebayClientSecret">eBay Client Secret</label>
              <input
                id="ebayClientSecret"
                type="password"
                value={ebayClientSecret}
                onChange={e => setEbayClientSecret(e.target.value)}
                placeholder="Your eBay Client Secret"
              />
            </div>
          </section>

          <section className="settings-section">
            <h3>Cookies</h3>
            <p className="section-help">Paste cookies for authenticated scraping (optional)</p>
            <div className="form-group">
              <label htmlFor="cookiesDiscogs">Discogs Cookies</label>
              <textarea
                id="cookiesDiscogs"
                value={cookiesDiscogs}
                onChange={e => setCookiesDiscogs(e.target.value)}
                placeholder="Paste cookies here..."
                rows={3}
              />
            </div>
            <div className="form-group">
              <label htmlFor="cookiesEbay">eBay Cookies</label>
              <textarea
                id="cookiesEbay"
                value={cookiesEbay}
                onChange={e => setCookiesEbay(e.target.value)}
                placeholder="Paste cookies here..."
                rows={3}
              />
            </div>
            <div className="form-group">
              <label htmlFor="cookiesKojima">Kojima Rokuon Cookies</label>
              <textarea
                id="cookiesKojima"
                value={cookiesKojima}
                onChange={e => setCookiesKojima(e.target.value)}
                placeholder="Paste cookies here..."
                rows={3}
              />
            </div>
          </section>

          <section className="settings-section">
            <h3>SOCKS5 Proxy</h3>
            <p className="section-help">Route all network traffic through a SOCKS5 proxy (optional)</p>
            <div className="form-group">
              <div className="toggle-container">
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={proxyEnabled}
                    onChange={e => setProxyEnabled(e.target.checked)}
                    aria-label="Enable SOCKS5 proxy"
                  />
                  <span className="toggle-slider" role="switch" aria-checked={proxyEnabled}></span>
                </label>
                <span className="toggle-label">Enable Proxy</span>
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="proxyHost">Proxy Host</label>
              <input
                id="proxyHost"
                type="text"
                value={proxyHost}
                onChange={e => setProxyHost(e.target.value)}
                placeholder="e.g. 127.0.0.1"
                disabled={!proxyEnabled}
              />
            </div>
            <div className="form-group">
              <label htmlFor="proxyPort">Proxy Port</label>
              <input
                id="proxyPort"
                type="number"
                value={proxyPort}
                onChange={e => setProxyPort(parseInt(e.target.value, 10) || 1080)}
                placeholder="e.g. 1080"
                disabled={!proxyEnabled}
              />
            </div>
          </section>

          <section className="settings-section">
            <h3>LLM Configuration</h3>
            <p className="section-help">
              Configure an OpenAI-compatible API for intelligent content parsing
            </p>

            <div className="form-group">
              <div className="toggle-container">
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={llmEnabled}
                    onChange={e => setLlmEnabled(e.target.checked)}
                    aria-label="Enable LLM parsing"
                  />
                  <span className="toggle-slider" role="switch" aria-checked={llmEnabled}></span>
                </label>
                <span className="toggle-label">Enable LLM Parsing</span>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="llmApiBaseUrl">API Base URL</label>
              <input
                id="llmApiBaseUrl"
                type="text"
                value={llmApiBaseUrl}
                onChange={e => setLlmApiBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1"
                disabled={!llmEnabled}
              />
            </div>

            <div className="form-group">
              <label htmlFor="llmApiKey">API Key</label>
              <input
                id="llmApiKey"
                type="password"
                value={llmApiKey}
                onChange={e => setLlmApiKey(e.target.value)}
                placeholder="sk-..."
                disabled={!llmEnabled}
              />
            </div>

            <div className="form-group">
              <label htmlFor="llmModel">Model</label>
              <input
                id="llmModel"
                type="text"
                value={llmModel}
                onChange={e => setLlmModel(e.target.value)}
                placeholder="gpt-4o-mini"
                disabled={!llmEnabled}
              />
            </div>

            <div className="form-group">
              <label htmlFor="llmTemperature">Temperature ({llmTemperature.toFixed(1)})</label>
              <input
                id="llmTemperature"
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={llmTemperature}
                onChange={e => setLlmTemperature(parseFloat(e.target.value))}
                disabled={!llmEnabled}
              />
            </div>

            <div className="form-group">
              <label>Platform Selection</label>
              <p className="section-help" style={{ marginTop: '4px', marginBottom: '12px' }}>
                Choose which platforms use LLM for parsing
              </p>
              <div className="platform-checkboxes">
                <label className="checkbox-item">
                  <input
                    type="checkbox"
                    checked={llmPlatformDiscogs}
                    onChange={e => setLlmPlatformDiscogs(e.target.checked)}
                    disabled={!llmEnabled}
                  />
                  <span className="checkbox-box"></span>
                  <span className="checkbox-label">Discogs</span>
                </label>
                <label className="checkbox-item">
                  <input
                    type="checkbox"
                    checked={llmPlatformEbay}
                    onChange={e => setLlmPlatformEbay(e.target.checked)}
                    disabled={!llmEnabled}
                  />
                  <span className="checkbox-box"></span>
                  <span className="checkbox-label">eBay</span>
                </label>
                <label className="checkbox-item">
                  <input
                    type="checkbox"
                    checked={llmPlatformKojima}
                    onChange={e => setLlmPlatformKojima(e.target.checked)}
                    disabled={!llmEnabled}
                  />
                  <span className="checkbox-box"></span>
                  <span className="checkbox-label">Kojima</span>
                </label>
                <label className="checkbox-item">
                  <input
                    type="checkbox"
                    checked={llmPlatformHmv}
                    onChange={e => setLlmPlatformHmv(e.target.checked)}
                    disabled={!llmEnabled}
                  />
                  <span className="checkbox-box"></span>
                  <span className="checkbox-label">HMV</span>
                </label>
                <label className="checkbox-item">
                  <input
                    type="checkbox"
                    checked={llmPlatformYahoo}
                    onChange={e => setLlmPlatformYahoo(e.target.checked)}
                    disabled={!llmEnabled}
                  />
                  <span className="checkbox-box"></span>
                  <span className="checkbox-label">Yahoo</span>
                </label>
              </div>
            </div>
          </section>
        </div>
        <div className="settings-footer">
          <button className="cancel-button" onClick={onClose}>Cancel</button>
          <button className="save-button" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
        {toast && <div className="toast">{toast}</div>}
      </div>
    </div>
  )
}
