import { useState, useEffect } from 'react'
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
  const [cookiesMercari, setCookiesMercari] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      loadSettings()
    }
  }, [isOpen])

  const loadSettings = async () => {
    const settings = await window.electronAPI.getSettings() as Settings
    setDiscogsToken(settings.discogsToken || '')
    setEbayClientId(settings.ebayClientId || '')
    setEbayClientSecret(settings.ebayClientSecret || '')
    setCookiesDiscogs(settings.cookies?.discogs || '')
    setCookiesEbay(settings.cookies?.ebay || '')
    setCookiesKojima(settings.cookies?.kojima || '')
    setCookiesMercari(settings.cookies?.mercari || '')
  }

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
        mercari: cookiesMercari
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
            <div className="form-group">
              <label htmlFor="cookiesMercari">Mercari Cookies</label>
              <textarea
                id="cookiesMercari"
                value={cookiesMercari}
                onChange={e => setCookiesMercari(e.target.value)}
                placeholder="Paste cookies here..."
                rows={3}
              />
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
