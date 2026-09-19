import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  PublishCurrency,
  PublishDraft,
  PublishField,
  PublishMediaCondition,
  PublishOutcome,
  PublishPlatform,
  PublishProgress,
  PublishSleeveCondition,
  PublishTarget,
  PublishTargetStatus
} from '../../shared/publish'
import {
  PUBLISH_CURRENCIES,
  PUBLISH_MEDIA_CONDITIONS,
  PUBLISH_PLATFORMS,
  PUBLISH_SLEEVE_CONDITIONS,
  XIANYU_CONDITIONS
} from '../../shared/publish'
import { useCoverImage } from './hooks/useCoverImage'
import { useI18n } from './i18n'
import type { TranslationKey } from './i18n'
import './Publish.css'

const PLATFORM_LABEL_KEYS: Record<PublishPlatform, TranslationKey> = {
  xianyu: 'publish.platform.xianyu',
  discogs: 'publish.platform.discogs'
}

/** Small colored platform pill shared by the settings list and the dropdown. */
function PlatformBadge({ platform }: { platform: PublishPlatform }) {
  const { t } = useI18n()
  return (
    <span className={`publish-platform-badge ${platform}`}>{t(PLATFORM_LABEL_KEYS[platform])}</span>
  )
}

/* ============================================================
   Settings section — 发布目标
   ============================================================ */

interface PublishTargetsSectionProps {
  /** Reuse the settings panel toast so the styling stays identical. */
  onToast: (text: string, kind?: 'success' | 'error') => void
  /**
   * Jump to the settings「特殊渠道（扫码登录）」section. Kept for the caller's API
   * compatibility: a 闲鱼 publish target now logs in from its own row with its
   * own browser profile, so the search-channel login is no longer part of this
   * flow and the link is intentionally unused.
   */
  onGoLogin?: () => void
}

/** Login probe result for one target row; absent until the first probe. */
interface TargetStatusView {
  loading: boolean
  status?: PublishTargetStatus
}

/**
 * Colored login badge for a 闲鱼 target. The localized `message` from the main
 * process is surfaced as the tooltip, so the badge itself stays short.
 */
function LoginStatusBadge({ view }: { view: TargetStatusView }) {
  const { t } = useI18n()
  if (view.loading) {
    return <span className="publish-status-badge muted">{t('settings.publishStatusChecking')}</span>
  }
  const status = view.status
  if (!status) {
    return <span className="publish-status-badge muted">{t('settings.publishStatusUnknown')}</span>
  }
  const title = status.message || undefined
  if (status.state === 'logged_in') {
    const account = status.account?.trim()
    return (
      <span className="publish-status-badge success" title={title}>
        {account
          ? t('settings.publishStatusLoggedInAccount', { account })
          : t('settings.publishStatusLoggedIn')}
      </span>
    )
  }
  if (status.state === 'logged_out') {
    return (
      <span className="publish-status-badge warning" title={title}>
        {t('settings.publishStatusLoggedOut')}
      </span>
    )
  }
  return (
    <span className="publish-status-badge muted" title={title}>
      {t('settings.publishStatusNotStarted')}
    </span>
  )
}

/** A brand-new target with sensible defaults for its platform. */
function createTarget(platform: PublishPlatform): PublishTarget {
  return {
    id: crypto.randomUUID(),
    platform,
    name: '',
    account: '',
    enabled: true,
    createdAt: Date.now(),
    currency: 'USD',
    condition: 'Very Good Plus (VG+)',
    sleeveCondition: '',
    status: 'For Sale',
    allowOffers: true,
    location: '',
    weight: null,
    formatQuantity: null,
    token: '',
    xianyuCondition: XIANYU_CONDITIONS[1] ?? XIANYU_CONDITIONS[0],
    uploadCover: true
  }
}

export function PublishTargetsSection({ onToast }: PublishTargetsSectionProps) {
  const { t } = useI18n()
  const [targets, setTargets] = useState<PublishTarget[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<PublishTarget | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [editorError, setEditorError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  /** Target whose own Chrome window is currently waiting for a QR scan. */
  const [loginId, setLoginId] = useState<string | null>(null)
  /** Target whose own login data is currently being cleared. */
  const [logoutId, setLogoutId] = useState<string | null>(null)
  const [statusViews, setStatusViews] = useState<Partial<Record<string, TargetStatusView>>>({})
  const [saving, setSaving] = useState(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  /**
   * Read one target's own login state. Read-only on the main-process side (it
   * never starts Chrome), so it is safe to call per row.
   */
  const fetchStatus = useCallback(async (targetId: string) => {
    setStatusViews(prev => ({ ...prev, [targetId]: { loading: true } }))
    try {
      const status = await window.electronAPI.publishTargetStatus(targetId)
      if (mountedRef.current) {
        setStatusViews(prev => ({ ...prev, [targetId]: { loading: false, status } }))
      }
    } catch (err) {
      window.electronAPI.log('warn', 'publish.targets', 'failed to read publish target status', {
        targetId,
        error: err instanceof Error ? err.message : String(err)
      })
      // Show the neutral「状态未知」badge instead of guessing a login state.
      if (mountedRef.current) setStatusViews(prev => ({ ...prev, [targetId]: { loading: false } }))
    }
  }, [])

  /**
   * Re-read the target list; the main process writes the auto-detected
   * `account` (and `xianyuLoginAt`) after a successful scan, logout or a
   * successful「测试连接」.
   */
  const reloadTargets = useCallback(async () => {
    try {
      const settings = await window.electronAPI.getSettings()
      if (mountedRef.current) setTargets(settings.publishTargets ?? [])
    } catch (err) {
      window.electronAPI.log('warn', 'publish.targets', 'failed to reload publish targets', {
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        // The settings list must show every target, disabled ones included:
        // `listPublishTargets()` only returns the enabled subset (it feeds the
        // result-card dropdown), so using it here would make a disabled target
        // disappear from the list and impossible to re-enable.
        const settings = await window.electronAPI.getSettings()
        const loaded = settings.publishTargets ?? []
        if (!mountedRef.current) return
        setTargets(loaded)
        setLoading(false)
        // Probe the 闲鱼 targets strictly one after another: every call may talk
        // to that target's own Chrome profile, so a Promise.all would race them.
        // Discogs targets need no probe —「测试连接」covers them.
        for (const target of loaded) {
          if (!mountedRef.current) return
          if (target.platform !== 'xianyu') continue
          await fetchStatus(target.id)
        }
      } catch (err) {
        window.electronAPI.log('warn', 'publish.targets', 'failed to load publish targets', {
          error: err instanceof Error ? err.message : String(err)
        })
      } finally {
        if (mountedRef.current) setLoading(false)
      }
    })()
  }, [fetchStatus])

  // List mutations are written straight to disk; the panel-level 保存 button
  // only persists the unrelated sections, so there is nothing to stage here.
  const persist = useCallback(async (next: PublishTarget[]): Promise<boolean> => {
    setSaving(true)
    try {
      await window.electronAPI.updateSettings({ publishTargets: next })
      if (mountedRef.current) setTargets(next)
      return true
    } catch (err) {
      window.electronAPI.log('warn', 'publish.targets', 'failed to save publish targets', {
        error: err instanceof Error ? err.message : String(err)
      })
      onToast(t('settings.publishSaveFailed'), 'error')
      return false
    } finally {
      if (mountedRef.current) setSaving(false)
    }
  }, [onToast, t])

  const startCreate = () => {
    setEditing(createTarget('discogs'))
    setIsNew(true)
    setEditorError(null)
  }

  const startEdit = (target: PublishTarget) => {
    setEditing({ ...target })
    setIsNew(false)
    setEditorError(null)
  }

  const patchEditing = (patch: Partial<PublishTarget>) => {
    setEditing(prev => (prev ? { ...prev, ...patch } : prev))
  }

  const handleSaveEditor = async () => {
    if (!editing) return
    const name = editing.name.trim()
    if (!name) {
      setEditorError(t('settings.publishNameRequired'))
      return
    }
    const target: PublishTarget = { ...editing, name, account: editing.account.trim() }
    const next = isNew
      ? [...targets, target]
      : targets.map(item => (item.id === target.id ? target : item))
    const ok = await persist(next)
    if (!ok) return
    setEditing(null)
    setIsNew(false)
    onToast(t('settings.publishSaved'))
    // A target saved as 闲鱼 has no probed badge yet; fetch it so the row is
    // immediately actionable. Fire-and-forget: the editor must close at once.
    if (target.platform === 'xianyu') void fetchStatus(target.id)
  }

  const handleDelete = async (target: PublishTarget) => {
    const confirmKey: TranslationKey = target.platform === 'xianyu'
      ? 'settings.publishDeleteConfirmXianyu'
      : 'settings.publishDeleteConfirm'
    if (!window.confirm(t(confirmKey, { name: target.name }))) return
    if (target.platform === 'xianyu') {
      // Best effort: releasing the target's own Chrome profile (and its login
      // data) must never block removing the target itself.
      try {
        await window.electronAPI.forgetPublishTarget(target.id)
      } catch (err) {
        window.electronAPI.log('warn', 'publish.targets', 'failed to forget publish target before delete', {
          targetId: target.id,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    }
    const ok = await persist(targets.filter(item => item.id !== target.id))
    if (!ok) return
    setStatusViews(prev => {
      const next = { ...prev }
      delete next[target.id]
      return next
    })
    onToast(t('settings.publishDeleted'))
  }

  /** Start this target's own Chrome and wait for the user's QR scan. */
  const handleLogin = async (target: PublishTarget) => {
    setLoginId(target.id)
    try {
      // Can block for tens of seconds while the user scans; only this row's
      // login/logout buttons are disabled, the rest of the panel stays usable.
      const result = await window.electronAPI.loginPublishTarget(target.id)
      if (!mountedRef.current) return
      if (!result.ok) {
        onToast(result.message || t('settings.publishLoginFailed'), 'error')
        return
      }
      // The main process persisted the auto-detected account / xianyuLoginAt:
      // re-read the list so the row (and the editor) shows the detected account.
      await reloadTargets()
      if (!mountedRef.current) return
      await fetchStatus(target.id)
      if (!mountedRef.current) return
      onToast(
        result.message
          || (result.account
            ? t('settings.publishLoginSuccessAccount', { account: result.account })
            : t('settings.publishLoginSuccess')),
        'success'
      )
    } catch (err) {
      window.electronAPI.log('warn', 'publish.targets', 'login publish target failed', {
        targetId: target.id,
        error: err instanceof Error ? err.message : String(err)
      })
      if (mountedRef.current) onToast(t('settings.publishLoginFailed'), 'error')
    } finally {
      if (mountedRef.current) setLoginId(null)
    }
  }

  /** Close this target's own session and delete its login data. */
  const handleLogout = async (target: PublishTarget) => {
    setLogoutId(target.id)
    try {
      const result = await window.electronAPI.forgetPublishTarget(target.id)
      if (!mountedRef.current) return
      if (!result.ok) {
        onToast(result.message || t('settings.publishLogoutFailed'), 'error')
        return
      }
      // Logging out clears the detected account in settings, so refresh too.
      await reloadTargets()
      if (!mountedRef.current) return
      await fetchStatus(target.id)
      if (!mountedRef.current) return
      onToast(result.message || t('settings.publishLogoutSuccess'), 'success')
    } catch (err) {
      window.electronAPI.log('warn', 'publish.targets', 'forget publish target failed', {
        targetId: target.id,
        error: err instanceof Error ? err.message : String(err)
      })
      if (mountedRef.current) onToast(t('settings.publishLogoutFailed'), 'error')
    } finally {
      if (mountedRef.current) setLogoutId(null)
    }
  }

  const handleToggle = (target: PublishTarget, enabled: boolean) => {
    void persist(targets.map(item => (item.id === target.id ? { ...item, enabled } : item)))
  }

  const handleTest = async (target: PublishTarget) => {
    setBusyId(target.id)
    try {
      const result = await window.electronAPI.testPublishTarget(target.id)
      if (!mountedRef.current) return
      onToast(result.message, result.ok ? 'success' : 'error')
      if (result.ok) {
        // A successful probe auto-detects the account (Discogs: resolved from
        // the token via /oauth/identity; 闲鱼: read from the logged-in session)
        // and the main process persists it, so re-read the list to show it at
        // once, exactly like a successful「扫码登录」.
        await reloadTargets()
        if (!mountedRef.current) return
        if (target.platform === 'xianyu') await fetchStatus(target.id)
      }
    } catch (err) {
      onToast(t('settings.publishSaveFailed'), 'error')
      window.electronAPI.log('warn', 'publish.targets', 'test publish target failed', {
        targetId: target.id,
        error: err instanceof Error ? err.message : String(err)
      })
    } finally {
      if (mountedRef.current) setBusyId(null)
    }
  }

  const renderEditor = (target: PublishTarget) => (
    <div className="publish-editor">
      <div className="publish-editor-title">
        {isNew ? t('settings.publishNewTitle') : t('settings.publishEditTitle')}
      </div>

      <div className="publish-editor-grid">
        <div className="st-field">
          <label className="st-label" htmlFor="publish-target-platform">
            <span className="st-label-icon">⚑</span> {t('settings.publishPlatform')}
          </label>
          <select
            id="publish-target-platform"
            className="st-input publish-editor-select"
            value={target.platform}
            onChange={e => patchEditing({ platform: e.target.value as PublishPlatform })}
          >
            {PUBLISH_PLATFORMS.map(platform => (
              <option key={platform} value={platform}>{t(PLATFORM_LABEL_KEYS[platform])}</option>
            ))}
          </select>
        </div>

        <div className="st-field">
          <label className="st-label" htmlFor="publish-target-name">
            <span className="st-label-icon">⚑</span> {t('settings.publishName')} *
          </label>
          <input
            id="publish-target-name"
            type="text"
            className="st-input"
            value={target.name}
            onChange={e => {
              patchEditing({ name: e.target.value })
              setEditorError(null)
            }}
            placeholder={t('settings.publishNamePlaceholder')}
          />
          {editorError && <div className="st-field-error publish-editor-error">{editorError}</div>}
        </div>
      </div>

      {/* The account is never typed by the user: it is detected by the app
          (闲鱼 after「扫码登录」, Discogs after「测试连接」) and persisted by the
          main process. This block only explains that and shows the value. */}
      <div className="publish-editor-account">
        <div className="publish-editor-account-note">
          <span className="publish-editor-account-note-icon">◈</span>
          <span>{t('settings.publishAccountAutoNote')}</span>
        </div>
        {target.account && (
          <div className="publish-editor-account-row">
            <span className="publish-editor-account-label">
              {t('settings.publishCurrentAccount')}
            </span>
            <span className="publish-editor-account-value">{target.account}</span>
            <span className="publish-editor-account-detect">
              {target.platform === 'discogs'
                ? t('settings.publishAccountDetectDiscogs')
                : t('settings.publishAccountDetectXianyu')}
            </span>
          </div>
        )}
      </div>

      {target.platform === 'discogs' ? (
        <div className="st-field-group publish-editor-group">
          <div className="st-field-group-title">
            <span className="st-icon">◆</span> {t('settings.publishGroupDiscogs')}
          </div>
          <div className="publish-editor-grid">
            <div className="st-field">
              <label className="st-label" htmlFor="publish-target-currency">
                <span className="st-label-icon">◈</span> {t('publish.field.currency')}
              </label>
              <select
                id="publish-target-currency"
                className="st-input publish-editor-select"
                value={target.currency ?? 'USD'}
                onChange={e => patchEditing({ currency: e.target.value as PublishCurrency })}
              >
                {PUBLISH_CURRENCIES.map(currency => (
                  <option key={currency} value={currency}>{currency}</option>
                ))}
              </select>
            </div>

            <div className="st-field">
              <label className="st-label" htmlFor="publish-target-condition">
                <span className="st-label-icon">◈</span> {t('publish.field.condition')}
              </label>
              <select
                id="publish-target-condition"
                className="st-input publish-editor-select"
                value={target.condition ?? 'Very Good Plus (VG+)'}
                onChange={e => patchEditing({ condition: e.target.value as PublishMediaCondition })}
              >
                {PUBLISH_MEDIA_CONDITIONS.map(condition => (
                  <option key={condition} value={condition}>{condition}</option>
                ))}
              </select>
            </div>

            <div className="st-field">
              <label className="st-label" htmlFor="publish-target-sleeve">
                <span className="st-label-icon">◈</span> {t('publish.field.sleeveCondition')}
              </label>
              <select
                id="publish-target-sleeve"
                className="st-input publish-editor-select"
                value={target.sleeveCondition ?? ''}
                onChange={e => patchEditing({ sleeveCondition: e.target.value as PublishSleeveCondition | '' })}
              >
                <option value="">{t('settings.publishSleeveNone')}</option>
                {PUBLISH_SLEEVE_CONDITIONS.map(condition => (
                  <option key={condition} value={condition}>{condition}</option>
                ))}
              </select>
            </div>

            <div className="st-field">
              <label className="st-label" htmlFor="publish-target-status">
                <span className="st-label-icon">◈</span> {t('publish.field.status')}
              </label>
              <select
                id="publish-target-status"
                className="st-input publish-editor-select"
                value={target.status ?? 'For Sale'}
                onChange={e => patchEditing({ status: e.target.value === 'Draft' ? 'Draft' : 'For Sale' })}
              >
                <option value="For Sale">For Sale</option>
                <option value="Draft">Draft</option>
              </select>
            </div>

            <div className="st-field">
              <label className="st-label" htmlFor="publish-target-location">
                <span className="st-label-icon">◈</span> {t('publish.field.location')}
              </label>
              <input
                id="publish-target-location"
                type="text"
                className="st-input"
                value={target.location ?? ''}
                onChange={e => patchEditing({ location: e.target.value })}
              />
            </div>

            <div className="st-field">
              <label className="st-label" htmlFor="publish-target-weight">
                <span className="st-label-icon">◈</span> {t('publish.field.weight')}
              </label>
              <input
                id="publish-target-weight"
                type="number"
                className="st-input"
                value={target.weight ?? ''}
                onChange={e => patchEditing({ weight: e.target.value === '' ? null : Number(e.target.value) })}
              />
            </div>

            <div className="st-field">
              <label className="st-label" htmlFor="publish-target-quantity">
                <span className="st-label-icon">◈</span> {t('publish.field.formatQuantity')}
              </label>
              <input
                id="publish-target-quantity"
                type="number"
                className="st-input"
                value={target.formatQuantity ?? ''}
                onChange={e => patchEditing({ formatQuantity: e.target.value === '' ? null : Number(e.target.value) })}
              />
            </div>

            <div className="st-field">
              <label className="st-label" htmlFor="publish-target-token">
                <span className="st-label-icon">◆</span> {t('settings.publishToken')}
              </label>
              <input
                id="publish-target-token"
                type="password"
                className="st-input"
                value={target.token ?? ''}
                onChange={e => patchEditing({ token: e.target.value })}
                placeholder={t('settings.publishTokenPlaceholder')}
              />
            </div>
          </div>

          <div className="st-toggle-row publish-editor-toggle">
            <div className="st-toggle-info">
              <span className="st-toggle-title">{t('publish.field.allowOffers')}</span>
            </div>
            <label className="st-switch">
              <input
                type="checkbox"
                checked={target.allowOffers ?? false}
                onChange={e => patchEditing({ allowOffers: e.target.checked })}
              />
              <span className="st-slider"></span>
            </label>
          </div>
        </div>
      ) : (
        <div className="st-field-group publish-editor-group">
          <div className="st-field-group-title">
            <span className="st-icon">◆</span> {t('settings.publishGroupXianyu')}
          </div>
          <div className="publish-editor-note">{t('settings.publishXianyuIndependentNote')}</div>
          <div className="st-field">
            <label className="st-label" htmlFor="publish-target-xianyu-condition">
              <span className="st-label-icon">◈</span> {t('publish.field.xianyuCondition')}
            </label>
            <select
              id="publish-target-xianyu-condition"
              className="st-input publish-editor-select"
              value={target.xianyuCondition ?? XIANYU_CONDITIONS[0]}
              onChange={e => patchEditing({ xianyuCondition: e.target.value })}
            >
              {XIANYU_CONDITIONS.map(condition => (
                <option key={condition} value={condition}>{condition}</option>
              ))}
            </select>
          </div>
          <div className="st-toggle-row publish-editor-toggle">
            <div className="st-toggle-info">
              <span className="st-toggle-title">{t('settings.publishUploadCover')}</span>
            </div>
            <label className="st-switch">
              <input
                type="checkbox"
                checked={target.uploadCover ?? true}
                onChange={e => patchEditing({ uploadCover: e.target.checked })}
              />
              <span className="st-slider"></span>
            </label>
          </div>
        </div>
      )}

      <div className="st-cf-actions publish-editor-actions">
        <button
          type="button"
          className="st-btn-cancel"
          onClick={() => {
            setEditing(null)
            setIsNew(false)
            setEditorError(null)
          }}
        >
          {t('publish.cancel')}
        </button>
        <button
          type="button"
          className="st-btn-save"
          onClick={() => void handleSaveEditor()}
          disabled={saving}
        >
          {t('settings.save')}
        </button>
      </div>
    </div>
  )

  return (
    <div className="st-section-content">
      <div className="st-section-desc">{t('settings.publishDesc')}</div>

      <div className="publish-target-list">
        {loading && <div className="publish-empty">{t('settings.publishLoading')}</div>}
        {!loading && targets.length === 0 && (
          <div className="publish-empty">{t('settings.publishEmpty')}</div>
        )}
        {!loading && targets.map(target => {
          const isXianyu = target.platform === 'xianyu'
          const statusView = statusViews[target.id]
          const loginPending = loginId === target.id
          const logoutPending = logoutId === target.id
          return (
            <div key={target.id} className="publish-target-row">
              <div className="publish-target-head">
                <div className="publish-target-main">
                  <PlatformBadge platform={target.platform} />
                  <div className="publish-target-text">
                    <div className="publish-target-name-row">
                      <span className="publish-target-name">{target.name}</span>
                    </div>
                    {/* Secondary read-only line: 闲鱼 shows its login state, Discogs
                        its resolved account. Keeping the name row free of the
                        badge is what stops the action buttons from wrapping. */}
                    {isXianyu
                      ? (statusView && <LoginStatusBadge view={statusView} />)
                      : (target.account && (
                        <span className="publish-target-account">
                          {t('settings.publishAccountValue', { account: target.account })}
                        </span>
                      ))}
                  </div>
                </div>
                {/* Actions keep their own wrapping context so a crowded row
                    wraps inside this container instead of pushing the badge down.
                    Only the buttons both platforms share live here: 闲鱼's own
                    login controls moved below the separator, which is what keeps
                    the two rows' action columns aligned. */}
                <div className="publish-target-actions">
                  <button
                    type="button"
                    className="st-btn-cancel"
                    onClick={() => void handleTest(target)}
                    disabled={busyId === target.id}
                  >
                    {busyId === target.id ? t('settings.publishTesting') : t('settings.publishTest')}
                  </button>
                  <button type="button" className="st-btn-cancel" onClick={() => startEdit(target)}>
                    {t('settings.publishEdit')}
                  </button>
                  <button
                    type="button"
                    className="st-btn-cancel publish-btn-danger"
                    onClick={() => void handleDelete(target)}
                  >
                    {t('settings.publishDelete')}
                  </button>
                  {/* The enable switch sits last, at the far right of the row. */}
                  <label className="st-switch" title={t('settings.publishEnabled')}>
                    <input
                      type="checkbox"
                      checked={target.enabled}
                      onChange={e => handleToggle(target, e.target.checked)}
                    />
                    <span className="st-slider"></span>
                  </label>
                </div>
              </div>
              {isXianyu && (
                <div className="publish-target-foot">
                  <span className="publish-target-hint">
                    {statusView?.status?.state === 'logged_in'
                      ? (statusView.status.message || t('settings.publishXianyuLoginReady'))
                      : t('settings.publishXianyuLoginGuide')}
                  </span>
                  <div className="publish-target-actions publish-target-actions-login">
                    <button
                      type="button"
                      className="st-btn-cancel publish-btn-login"
                      onClick={() => void handleLogin(target)}
                      disabled={loginPending || logoutPending}
                      title={statusView?.status?.message || undefined}
                    >
                      {loginPending ? t('settings.publishLoggingIn') : t('settings.publishLoginScan')}
                    </button>
                    <button
                      type="button"
                      className="st-btn-cancel"
                      onClick={() => void handleLogout(target)}
                      disabled={loginPending || logoutPending}
                    >
                      {logoutPending ? t('settings.publishLoggingOut') : t('settings.publishLogout')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {editing
        ? renderEditor(editing)
        : (
          <div className="st-cf-actions publish-add-row">
            <button type="button" className="st-btn-save" onClick={startCreate}>
              + {t('settings.publishAdd')}
            </button>
          </div>
        )}
    </div>
  )
}

/* ============================================================
   Result-card dropdown — 发布 ▾
   ============================================================ */

interface PublishMenuProps {
  catalogNumber: string
  targets: PublishTarget[]
  onSelect: (catalogNumber: string, targetId: string) => void
}

/**
 * Compact 「发布 ▾」 menu rendered in the result header. Renders nothing while
 * no enabled target exists, so cards stay clean until publishing is configured.
 */
export function PublishMenu({ catalogNumber, targets, onSelect }: PublishMenuProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const enabledTargets = useMemo(() => targets.filter(target => target.enabled), [targets])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  if (enabledTargets.length === 0) return null

  const groups = PUBLISH_PLATFORMS
    .map(platform => ({ platform, items: enabledTargets.filter(target => target.platform === platform) }))
    .filter(group => group.items.length > 0)

  return (
    <div className="publish-menu" ref={containerRef}>
      <button
        type="button"
        className="publish-menu-button"
        onClick={() => setOpen(prev => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('publish.menuTitle')}
      >
        {t('publish.menu')}
      </button>
      {open && (
        <div className="publish-menu-dropdown" role="menu">
          {groups.map(group => (
            <div key={group.platform} className="publish-menu-group">
              <div className="publish-menu-group-title">
                <PlatformBadge platform={group.platform} />
              </div>
              {group.items.map(target => (
                <button
                  key={target.id}
                  type="button"
                  role="menuitem"
                  className="publish-menu-item"
                  onClick={() => {
                    setOpen(false)
                    onSelect(catalogNumber, target.id)
                  }}
                >
                  {target.name}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ============================================================
   Publish dialog — preview form / progress / result
   ============================================================ */

/** Everything the dialog needs for one publish session. */
export interface PublishDialogRequest {
  targetId: string
  targetName: string
  catalogNumber: string
  /** Undefined while `preparePublish` is still running. */
  draft?: PublishDraft
  /** Set when `preparePublish` rejected; shown instead of the form. */
  prepareError?: string
}

interface PublishDialogProps {
  request: PublishDialogRequest
  onClose: () => void
  onRetryPrepare: () => void
  /** Switch the app to the 石墨文档 tab after a successful publish. */
  onOpenShimo: () => void
  /** Lets App disable the search controls while a run is in flight. */
  onPublishingChange: (publishing: boolean) => void
}

/** Number/bool -> input value without losing `null` semantics. */
function toInputValue(value: PublishField['value']): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

/** Image preview routed through the main-process image service (CSP-safe). */
function PublishImagePreview({ url }: { url: string }) {
  const isInline = url.startsWith('data:')
  const { imageData } = useCoverImage(isInline ? null : url, { size: 240 })
  const source = isInline ? url : imageData

  return (
    <div className="publish-image">
      <div className="publish-image-preview">
        {source
          ? <img src={source} alt="" />
          : <span className="publish-image-placeholder">♪</span>}
      </div>
      <div className="publish-image-url">{url}</div>
    </div>
  )
}

export function PublishDialog({
  request,
  onClose,
  onRetryPrepare,
  onOpenShimo,
  onPublishingChange
}: PublishDialogProps) {
  const { t } = useI18n()
  const [fields, setFields] = useState<PublishField[] | null>(null)
  const [view, setView] = useState<'form' | 'progress' | 'result'>('form')
  const [progress, setProgress] = useState<PublishProgress | null>(null)
  const [outcome, setOutcome] = useState<PublishOutcome | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const mountedRef = useRef(true)
  const requestKey = `${request.targetId}::${request.catalogNumber}`
  const requestKeyRef = useRef(requestKey)

  useEffect(() => {
    // StrictMode mounts effects twice; re-arm on every mount.
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Reopening the dialog for another catalog/target starts from a clean slate.
  useEffect(() => {
    if (requestKeyRef.current === requestKey) return
    requestKeyRef.current = requestKey
    setFields(null)
    setProgress(null)
    setOutcome(null)
    setCancelling(false)
    setView('form')
  }, [requestKey])

  // The draft is the source of the editable form; a retry replaces it wholesale.
  useEffect(() => {
    if (!request.draft) {
      setFields(null)
      return
    }
    setFields(request.draft.fields.map(field => ({ ...field })))
    setProgress(null)
    setOutcome(null)
    setCancelling(false)
    setView('form')
  }, [request.draft])

  // Progress is informational only: the resolved runPublish outcome is the
  // authoritative result, so a lost event can never strand the dialog.
  useEffect(() => {
    return window.electronAPI.receive('publish:progress', (...args: unknown[]) => {
      const next = args[0] as PublishProgress | undefined
      if (!next || !mountedRef.current) return
      if (`${next.targetId}::${next.catalogNumber}` !== requestKeyRef.current) return
      setProgress(next)
    })
  }, [])

  const updateField = useCallback((key: string, value: PublishField['value']) => {
    setFields(prev => (prev ? prev.map(field => (field.key === key ? { ...field, value } : field)) : prev))
  }, [])

  const safeCancelPublish = useCallback(() => {
    try {
      void window.electronAPI.cancelPublish().catch(() => {})
    } catch {
      // Preload not ready: nothing to cancel.
    }
  }, [])

  const handleFormCancel = () => {
    // Bottom-line cleanup in case a previous run is somehow still alive.
    safeCancelPublish()
    onClose()
  }

  const handleConfirm = async () => {
    if (!fields || !request.draft || request.draft.blockers.length > 0) return
    setView('progress')
    setProgress(null)
    setOutcome(null)
    setCancelling(false)
    onPublishingChange(true)
    try {
      const result = await window.electronAPI.runPublish({
        targetId: request.targetId,
        catalogNumber: request.catalogNumber,
        // Preserve everything the backend sent; only `value` is user-edited.
        fields: fields.map(field => ({
          key: field.key,
          labelKey: field.labelKey,
          kind: field.kind,
          value: field.value,
          options: field.options,
          required: field.required,
          maxLength: field.maxLength,
          hintKey: field.hintKey
        }))
      })
      if (!mountedRef.current) return
      setOutcome(result)
      setView('result')
    } catch (err) {
      window.electronAPI.log('warn', 'publish.run', 'publish run failed', {
        catalogNumber: request.catalogNumber,
        targetId: request.targetId,
        error: err instanceof Error ? err.message : String(err)
      })
      if (!mountedRef.current) return
      setOutcome({
        status: 'error',
        platform: request.draft.platform,
        targetName: request.draft.targetName,
        catalogNumber: request.catalogNumber,
        error: err instanceof Error ? err.message : String(err)
      })
      setView('result')
    } finally {
      // App state must be released even if the dialog unmounted mid-run.
      onPublishingChange(false)
    }
  }

  const handleCancelRun = () => {
    setCancelling(true)
    safeCancelPublish()
  }

  const handleOpenListing = (url: string) => {
    void window.electronAPI.openExternal(url).catch(err => {
      window.electronAPI.log('warn', 'publish.run', 'failed to open listing url', {
        error: err instanceof Error ? err.message : String(err)
      })
    })
  }

  // Closing is only offered when no run is in flight; Escape follows suit.
  const canDismiss = view !== 'progress'
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && canDismiss) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [canDismiss, onClose])

  const draft = request.draft
  const blockers = draft?.blockers ?? []
  const warnings = draft?.warnings ?? []
  // Captured once so the async handlers keep the narrowed string type.
  const listingUrl = outcome?.status === 'published' ? outcome.listingUrl : undefined

  const renderField = (field: PublishField) => {
    const inputId = `publish-field-${field.key}`
    // `controlId` stays undefined for label-less kinds (readonly/image) so no
    // dangling `for` attribute is emitted.
    const fieldLabel = (controlId?: string) => (
      <label className="publish-label" htmlFor={controlId}>
        {t(field.labelKey as TranslationKey)}
        {field.required && <span className="publish-required"> *</span>}
      </label>
    )
    const hint = field.hintKey && (
      <div className="publish-hint">{t(field.hintKey as TranslationKey)}</div>
    )

    switch (field.kind) {
      case 'readonly':
        return (
          <div key={field.key} className="publish-field">
            {fieldLabel()}
            <div className="publish-readonly">{toInputValue(field.value) || '—'}</div>
            {hint}
          </div>
        )

      case 'checkbox':
        return (
          <div key={field.key} className="publish-field publish-field-inline">
            <div className="publish-checkbox-text">
              <label className="publish-label publish-label-inline" htmlFor={inputId}>
                {t(field.labelKey as TranslationKey)}
                {field.required && <span className="publish-required"> *</span>}
              </label>
              {hint}
            </div>
            <label className="publish-switch">
              <input
                id={inputId}
                type="checkbox"
                checked={field.value === true}
                onChange={e => updateField(field.key, e.target.checked)}
              />
              <span className="publish-switch-slider"></span>
            </label>
          </div>
        )

      case 'image': {
        const url = toInputValue(field.value)
        return (
          <div key={field.key} className="publish-field">
            {fieldLabel()}
            {url ? <PublishImagePreview url={url} /> : <div className="publish-readonly">—</div>}
            {hint}
          </div>
        )
      }

      case 'textarea':
        return (
          <div key={field.key} className="publish-field">
            {fieldLabel(inputId)}
            <textarea
              id={inputId}
              className="publish-textarea"
              rows={6}
              value={toInputValue(field.value)}
              maxLength={field.maxLength}
              onChange={e => updateField(field.key, e.target.value)}
            />
            {hint}
          </div>
        )

      case 'select': {
        const value = toInputValue(field.value)
        const options = field.options ?? []
        const hasCurrent = options.some(option => option.value === value)
        return (
          <div key={field.key} className="publish-field">
            {fieldLabel(inputId)}
            <select
              id={inputId}
              className="publish-select"
              value={hasCurrent ? value : ''}
              onChange={e => updateField(field.key, e.target.value)}
            >
              {!hasCurrent && <option value="">—</option>}
              {options.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            {hint}
          </div>
        )
      }

      case 'number':
        return (
          <div key={field.key} className="publish-field">
            {fieldLabel(inputId)}
            <input
              id={inputId}
              type="number"
              className="publish-input"
              value={toInputValue(field.value)}
              onChange={e => {
                const raw = e.target.value
                if (raw.trim() === '') {
                  updateField(field.key, null)
                  return
                }
                const parsed = Number(raw)
                if (Number.isFinite(parsed)) updateField(field.key, parsed)
              }}
            />
            {hint}
          </div>
        )

      default:
        return (
          <div key={field.key} className="publish-field">
            {fieldLabel(inputId)}
            <input
              id={inputId}
              type="text"
              className="publish-input"
              value={toInputValue(field.value)}
              maxLength={field.maxLength}
              onChange={e => updateField(field.key, e.target.value)}
            />
            {hint}
          </div>
        )
    }
  }

  const renderBody = () => {
    if (view === 'progress') {
      const total = progress?.totalSteps ?? 0
      const step = progress?.step ?? 0
      const percent = total > 0 ? Math.min(100, Math.round((step / total) * 100)) : 0
      const needsUser = progress?.stage === 'awaiting-user' || progress?.needsUserAction === true
      return (
        <div className="publish-progress">
          <div className="publish-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <div className="publish-progress-fill" style={{ width: `${percent}%` }} />
          </div>
          <div className="publish-progress-meta">
            <span className="publish-progress-step">
              {t('publish.stepProgress', { step, total: total || '—' })}
            </span>
            <span className="publish-progress-percent">{percent}%</span>
          </div>
          <div className="publish-progress-message" role="status" aria-live="polite">
            {progress?.message || t('publish.publishing')}
          </div>
          {needsUser && (
            <div className="publish-awaiting">
              <span className="publish-awaiting-icon" aria-hidden="true">☝</span>
              <span>{t('publish.awaitingUser')}</span>
            </div>
          )}
          {progress?.error && <div className="publish-block error">{progress.error}</div>}
          {progress?.artifacts && progress.artifacts.length > 0 && (
            <ul className="publish-artifacts-list">
              {progress.artifacts.map((path, index) => <li key={`${index}-${path}`}>{path}</li>)}
            </ul>
          )}
        </div>
      )
    }

    if (view === 'result' && outcome) {
      return (
        <div className={`publish-result ${outcome.status}`}>
          <div className="publish-result-icon" aria-hidden="true">
            {outcome.status === 'published' ? '✓' : outcome.status === 'cancelled' ? '—' : '✕'}
          </div>
          <div className="publish-result-title">
            {outcome.status === 'published'
              ? t('publish.resultSuccess')
              : outcome.status === 'cancelled'
                ? t('publish.resultCancelled')
                : t('publish.resultError')}
          </div>
          <div className="publish-result-subtitle">{outcome.catalogNumber} · {outcome.targetName}</div>

          {outcome.status === 'published' && listingUrl && (
            <div className="publish-result-url">{listingUrl}</div>
          )}

          {outcome.status === 'error' && outcome.error && (
            <div className="publish-block error">{outcome.error}</div>
          )}

          {outcome.status === 'error' && outcome.artifacts && outcome.artifacts.length > 0 && (
            <div className="publish-artifacts">
              <div className="publish-artifacts-title">{t('publish.artifacts')}</div>
              <ul className="publish-artifacts-list">
                {outcome.artifacts.map((path, index) => <li key={`${index}-${path}`}>{path}</li>)}
              </ul>
            </div>
          )}

          {outcome.status === 'published' && (
            <div className="publish-shimo">
              <div className="publish-shimo-text">{t('publish.shimoReminder')}</div>
              <button type="button" className="publish-btn publish-btn-primary" onClick={onOpenShimo}>
                {t('publish.shimoOpen')}
              </button>
            </div>
          )}
        </div>
      )
    }

    if (request.prepareError) {
      return (
        <div className="publish-error-state">
          <div className="publish-block error">
            {t('publish.prepareFailed', { error: request.prepareError })}
          </div>
          <div className="publish-dialog-actions">
            <button type="button" className="publish-btn publish-btn-ghost" onClick={onClose}>
              {t('publish.close')}
            </button>
            <button type="button" className="publish-btn publish-btn-primary" onClick={onRetryPrepare}>
              {t('publish.retry')}
            </button>
          </div>
        </div>
      )
    }

    if (!fields || !draft) {
      return (
        <div className="publish-loading" role="status" aria-live="polite">
          <span className="publish-spinner" aria-hidden="true" />
          <span>{t('publish.preparing')}</span>
        </div>
      )
    }

    return (
      <>
        {blockers.length > 0 && (
          <div className="publish-block error">
            <div className="publish-block-title">{t('publish.blockers')}</div>
            <ul className="publish-block-list">
              {blockers.map((blocker, index) => <li key={`${index}-${blocker}`}>{blocker}</li>)}
            </ul>
          </div>
        )}
        {warnings.length > 0 && (
          <div className="publish-block warning">
            <div className="publish-block-title">{t('publish.warnings')}</div>
            <ul className="publish-block-list">
              {warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}
            </ul>
          </div>
        )}

        <div className="publish-fields">
          {fields.map(renderField)}
        </div>

        <div className="publish-dialog-actions">
          <button type="button" className="publish-btn publish-btn-ghost" onClick={handleFormCancel}>
            {t('publish.cancel')}
          </button>
          <button
            type="button"
            className="publish-btn publish-btn-primary"
            onClick={() => void handleConfirm()}
            disabled={blockers.length > 0}
          >
            {t('publish.confirm')}
          </button>
        </div>
      </>
    )
  }

  const showCloseButton = view !== 'progress'

  return (
    <div className="publish-overlay" onClick={() => { if (canDismiss) onClose() }}>
      <div
        className="publish-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-dialog-title"
        onClick={e => e.stopPropagation()}
      >
        <div className="publish-dialog-header">
          <div className="publish-dialog-heading">
            <div className="publish-dialog-title" id="publish-dialog-title">
              {view === 'progress' ? t('publish.publishing') : t('publish.title')}
            </div>
            <div className="publish-dialog-subtitle">
              {request.catalogNumber} · {t('publish.targetLabel', { name: draft?.targetName ?? request.targetName })}
            </div>
          </div>
          {showCloseButton && (
            <button className="publish-dialog-close" onClick={onClose} title={t('publish.close')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        <div className="publish-dialog-body">{renderBody()}</div>

        {view === 'progress' && (
          <div className="publish-dialog-actions publish-dialog-actions-progress">
            <button
              type="button"
              className="publish-btn publish-btn-ghost"
              onClick={handleCancelRun}
            >
              {cancelling ? t('publish.cancelling') : t('publish.cancelRun')}
            </button>
          </div>
        )}

        {view === 'result' && (
          <div className="publish-dialog-actions publish-dialog-actions-result">
            {listingUrl && (
              <button
                type="button"
                className="publish-btn publish-btn-ghost"
                onClick={() => handleOpenListing(listingUrl)}
              >
                {t('publish.openListing')}
              </button>
            )}
            <button type="button" className="publish-btn publish-btn-primary" onClick={onClose}>
              {t('publish.close')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
