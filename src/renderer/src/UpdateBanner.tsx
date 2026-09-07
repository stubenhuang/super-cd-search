import { useEffect, useState } from 'react'
import type { UpdateState } from '../../shared/updater'
import { useI18n } from './i18n'
import './UpdateBanner.css'

interface UpdateBannerProps {
  state: UpdateState | null
  onInstall: () => void
}

/**
 * Bottom-right card that follows the background auto-update: it appears as
 * soon as a newer version is found, tracks the download and offers the
 * restart once the installer is ready.
 */
export function UpdateBanner({ state, onInstall }: UpdateBannerProps) {
  const { t } = useI18n()
  const [dismissed, setDismissed] = useState(false)

  const status = state?.status
  useEffect(() => {
    // Re-surface the banner on every status/version change (e.g. from
    // "downloading" to "ready to install").
    setDismissed(false)
  }, [status, state?.latestVersion])

  if (!state || dismissed) return null
  if (status !== 'available' && status !== 'downloading' && status !== 'downloaded') return null

  const version = state.latestVersion ?? ''
  const percent = state.progress ?? 0

  const message =
    status === 'downloaded'
      ? t('update.banner.downloaded', { version })
      : status === 'downloading'
        ? t('update.banner.downloading', { percent })
        : t('update.banner.available', { version })

  return (
    <div className="update-banner" role="status" aria-live="polite">
      <div className="update-banner-icon" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v12" />
          <polyline points="7 11 12 16 17 11" />
          <path d="M5 21h14" />
        </svg>
      </div>
      <div className="update-banner-body">
        <div className="update-banner-text">{message}</div>
        {status === 'downloading' && (
          <div className="update-banner-track" aria-hidden="true">
            <div className="update-banner-fill" style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
          </div>
        )}
        {status === 'downloaded' && (
          <div className="update-banner-actions">
            <button type="button" className="update-banner-install" onClick={onInstall}>
              {t('update.banner.install')}
            </button>
          </div>
        )}
      </div>
      <button type="button" className="update-banner-close" onClick={() => setDismissed(true)} title={t('update.banner.later')}>
        ✕
      </button>
    </div>
  )
}
