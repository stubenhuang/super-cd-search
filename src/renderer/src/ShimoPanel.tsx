import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  SHIMO_PARTITION,
  SHIMO_WORKSPACE_URL,
  classifyGuestNavigation,
  normalizeShimoUrl,
  redactShimoUrl
} from '../../shared/shimo'
import { useI18n } from './i18n'
import './ShimoPanel.css'

/**
 * The 石墨文档 tab: embeds the real shimo.im web app (个人版没有开放 API，
 * 网页本身即接入面) in an Electron <webview>, so the user can log in and
 * manage their own documents — including private spreadsheets — inside the app.
 *
 * Navigation is locked to shimo.im: in-page links to other hosts are handed
 * to the system browser, everything non-navigable is blocked (see
 * `classifyGuestNavigation`). The login session lives in the dedicated
 * `persist:shimo` partition and is only cleared by 退出登录.
 */

/** A <webview> gains these members after the guest attaches. */
type ShimoWebview = HTMLWebViewElement & {
  loadURL(url: string): void
  getURL(): string
  reload(): void
  goBack(): void
  goForward(): void
  canGoBack(): boolean
  canGoForward(): boolean
}

type WebviewEvent = Event & { url?: string }

interface ShimoPanelProps {
  /** Opens the settings panel so the user can paste the spreadsheet link. */
  onOpenSettings: () => void
}

type LoadState = 'loading' | 'unconfigured' | 'invalid' | 'ready'

export function ShimoPanel({ onOpenSettings }: ShimoPanelProps) {
  const { t } = useI18n()
  const webviewRef = useRef<ShimoWebview | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [sheetUrl, setSheetUrl] = useState('')
  const [addressValue, setAddressValue] = useState('')
  const [addressError, setAddressError] = useState('')
  const [pageLoading, setPageLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const saved = await window.electronAPI.getSetting('shimoSheetUrl')
      if (cancelled) return
      const normalized = normalizeShimoUrl(saved)
      setSheetUrl(saved ?? '')
      if (!normalized) {
        setState(saved && saved.trim().length > 0 ? 'invalid' : 'unconfigured')
      } else {
        setAddressValue(normalized)
        setState('ready')
      }
    })().catch(() => {
      if (!cancelled) setState('unconfigured')
    })
    return () => {
      cancelled = true
    }
  }, [])

  const refreshNavState = useCallback(() => {
    const webview = webviewRef.current
    if (!webview) return
    setCanGoBack(webview.canGoBack())
    setCanGoForward(webview.canGoForward())
  }, [])

  /**
   * Single domain-lock chokepoint for every navigation the guest attempts:
   * shimo.im stays inside the webview, other http(s) targets move to the
   * system browser, non-navigable schemes are dropped.
   */
  const handleWillNavigate = useCallback((event: WebviewEvent) => {
    const target = event.url ?? ''
    const action = classifyGuestNavigation(target)
    if (action === 'allow') return
    event.preventDefault()
    if (action === 'external') {
      window.electronAPI.log('info', 'app.shimo', 'opening non-石墨 link in the system browser', {
        url: redactShimoUrl(target)
      })
      void window.electronAPI.openExternal(target)
    } else {
      window.electronAPI.log('warn', 'app.shimo', 'blocked non-navigable link inside the 石墨 webview', {
        url: redactShimoUrl(target)
      })
    }
  }, [])

  useEffect(() => {
    if (state !== 'ready') return
    const webview = webviewRef.current
    if (!webview) return

    const onStartLoading = () => {
      setPageLoading(true)
      setPageError('')
    }
    const onStopLoading = () => {
      setPageLoading(false)
      refreshNavState()
    }
    const onNavigate = (event: Event) => {
      const url = (event as WebviewEvent).url ?? ''
      if (url) setAddressValue(url)
      refreshNavState()
    }
    const onFailLoad = (event: Event) => {
      const details = event as WebviewEvent & { errorDescription?: string }
      setPageLoading(false)
      setPageError(details.errorDescription || t('shimo.loadFailed'))
    }

    webview.addEventListener('did-start-loading', onStartLoading)
    webview.addEventListener('did-stop-loading', onStopLoading)
    webview.addEventListener('did-navigate', onNavigate)
    webview.addEventListener('did-navigate-in-page', onNavigate)
    webview.addEventListener('did-fail-load', onFailLoad)
    webview.addEventListener('will-navigate', handleWillNavigate as EventListener)
    webview.addEventListener('new-window', handleWillNavigate as EventListener)
    return () => {
      webview.removeEventListener('did-start-loading', onStartLoading)
      webview.removeEventListener('did-stop-loading', onStopLoading)
      webview.removeEventListener('did-navigate', onNavigate)
      webview.removeEventListener('did-navigate-in-page', onNavigate)
      webview.removeEventListener('did-fail-load', onFailLoad)
      webview.removeEventListener('will-navigate', handleWillNavigate as EventListener)
      webview.removeEventListener('new-window', handleWillNavigate as EventListener)
    }
  }, [state, handleWillNavigate, refreshNavState, t])

  const loadInWebview = useCallback((url: string) => {
    const webview = webviewRef.current
    if (!webview) return
    setAddressError('')
    setAddressValue(url)
    setPageLoading(true)
    setPageError('')
    webview.loadURL(url)
  }, [])

  const handleAddressSubmit = useCallback((event: FormEvent) => {
    event.preventDefault()
    const normalized = normalizeShimoUrl(addressValue)
    if (!normalized) {
      setAddressError(t('shimo.addressInvalid'))
      return
    }
    loadInWebview(normalized)
  }, [addressValue, loadInWebview, t])

  const handleLogout = useCallback(async () => {
    if (!window.confirm(t('shimo.logoutConfirm'))) return
    setLoggingOut(true)
    try {
      const result = await window.electronAPI.shimoClearSession()
      if (!result.ok) {
        window.electronAPI.log('error', 'app.shimo', '退出登录失败', { message: result.message })
      }
    } finally {
      setLoggingOut(false)
      window.electronAPI.log('info', 'app.shimo', '石墨 webview session cleared')
      // Back to the configured page: the guest now shows 石墨's own login page.
      loadInWebview(normalizeShimoUrl(sheetUrl) ?? SHIMO_WORKSPACE_URL)
    }
  }, [loadInWebview, sheetUrl, t])

  if (state === 'loading') {
    return (
      <main className="app-main shimo-main">
        <p className="shimo-hint" role="status">{t('shimo.loading')}</p>
      </main>
    )
  }

  if (state === 'unconfigured' || state === 'invalid') {
    return (
      <main className="app-main shimo-main">
        <div className="shimo-guide" role="status">
          <h2 className="shimo-guide-title">{t('shimo.guideTitle')}</h2>
          <p className="shimo-guide-text">{t('shimo.guideText')}</p>
          {state === 'invalid' && <p className="shimo-guide-error">{t('shimo.guideInvalidUrl')}</p>}
          <button type="button" className="shimo-guide-action" onClick={onOpenSettings}>
            {t('shimo.openSettings')}
          </button>
        </div>
      </main>
    )
  }

  const currentUrl = addressValue || normalizeShimoUrl(sheetUrl) || SHIMO_WORKSPACE_URL

  return (
    <main className="app-main shimo-main">
      <div className="shimo-toolbar">
        <div className="shimo-toolbar-nav">
          <button
            type="button"
            className="shimo-tool-btn"
            title={t('shimo.back')}
            aria-label={t('shimo.back')}
            disabled={!canGoBack}
            onClick={() => webviewRef.current?.goBack()}
          >
            ‹
          </button>
          <button
            type="button"
            className="shimo-tool-btn"
            title={t('shimo.forward')}
            aria-label={t('shimo.forward')}
            disabled={!canGoForward}
            onClick={() => webviewRef.current?.goForward()}
          >
            ›
          </button>
          <button
            type="button"
            className="shimo-tool-btn"
            title={t('shimo.refresh')}
            aria-label={t('shimo.refresh')}
            onClick={() => webviewRef.current?.reload()}
          >
            ⟳
          </button>
          <button
            type="button"
            className="shimo-tool-btn"
            title={t('shimo.home')}
            aria-label={t('shimo.home')}
            onClick={() => loadInWebview(SHIMO_WORKSPACE_URL)}
          >
            ⌂
          </button>
        </div>
        <form className="shimo-address" onSubmit={handleAddressSubmit}>
          <input
            className="shimo-address-input"
            value={addressValue}
            onChange={event => setAddressValue(event.target.value)}
            placeholder="https://shimo.im/…"
            spellCheck={false}
            aria-label={t('shimo.address')}
          />
          {addressError && <span className="shimo-address-error">{addressError}</span>}
        </form>
        <div className="shimo-toolbar-actions">
          <button
            type="button"
            className="shimo-tool-btn"
            title={t('shimo.openExternal')}
            onClick={() => void window.electronAPI.openExternal(currentUrl)}
          >
            ↗
          </button>
          <button
            type="button"
            className="shimo-tool-btn shimo-tool-btn-text"
            title={t('shimo.logout')}
            disabled={loggingOut}
            onClick={() => void handleLogout()}
          >
            {t('shimo.logout')}
          </button>
        </div>
      </div>
      {pageLoading && <div className="shimo-progress" role="progressbar" aria-label={t('shimo.loading')} />}
      {pageError && (
        <div className="shimo-page-error" role="alert">
          <span>{pageError}</span>
          <div className="shimo-page-error-actions">
            <button type="button" className="shimo-guide-action" onClick={() => webviewRef.current?.reload()}>
              {t('shimo.retry')}
            </button>
            <button
              type="button"
              className="shimo-guide-action"
              onClick={() => void window.electronAPI.openExternal(currentUrl)}
            >
              {t('shimo.openExternal')}
            </button>
          </div>
        </div>
      )}
      <webview
        ref={node => {
          webviewRef.current = node as ShimoWebview | null
        }}
        className="shimo-webview"
        src={currentUrl}
        partition={SHIMO_PARTITION}
        allowpopups
      />
    </main>
  )
}
