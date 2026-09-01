import React, { useEffect } from 'react'
import type { DetailEnrichProgressStatus, Platform } from './electron-api'
import { PLATFORM_LABELS, summarizePlatformNames } from '../../shared/platforms'
import { useI18n } from './i18n'
import type { TranslationKey } from './i18n'

/**
 * Post-search auto flow: prompts that guide the user through deep dig and
 * smart generation once a search run has finished.
 */
export type AutoFlowState =
  | { kind: 'deep-dig-prompt'; catalogs: string[]; platforms: Platform[] }
  | { kind: 'smart-prompt'; catalogs: string[] }
  | {
      kind: 'smart-running'
      current: number
      total: number
      catalogNumber: string
      phase: DetailEnrichProgressStatus | null
      platform: Platform | null
      cancelling: boolean
    }
  | { kind: 'smart-cancelled'; completed: number; total: number }
  | { kind: 'smart-done'; failed: number }
  | null

interface FlowDialogProps {
  flow: AutoFlowState
  onDeepDigConfirm: () => void
  onDeepDigSkip: () => void
  onSmartConfirm: () => void
  onSmartSkip: () => void
  onSmartCancel: () => void
  onClose: () => void
}

/** Human-readable phase label for the currently running smart generation. */
function smartPhaseText(
  phase: DetailEnrichProgressStatus | null,
  platform: Platform | null,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
): string {
  if (!phase || !platform) return t('autoFlow.smartPhase.preparing')
  if (phase === 'searching') return t('autoFlow.smartPhase.searching', { platform: PLATFORM_LABELS[platform] })
  if (phase === 'fetching') return t('autoFlow.smartPhase.fetching', { platform: PLATFORM_LABELS[platform] })
  if (phase === 'analyzing') return t('autoFlow.smartPhase.analyzing', { platform: PLATFORM_LABELS[platform] })
  return t('autoFlow.smartPhase.preparing')
}

export function FlowDialog({
  flow,
  onDeepDigConfirm,
  onDeepDigSkip,
  onSmartConfirm,
  onSmartSkip,
  onSmartCancel,
  onClose
}: FlowDialogProps) {
  const { t } = useI18n()
  const busy = flow?.kind === 'smart-running'

  // Dismissing (overlay click / Escape) follows the same path as the
  // secondary button of the current step; it never interrupts a running job.
  const dismiss = () => {
    if (!flow || busy) return
    if (flow.kind === 'deep-dig-prompt') onDeepDigSkip()
    else if (flow.kind === 'smart-prompt') onSmartSkip()
    else onClose()
  }

  useEffect(() => {
    if (!flow) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow, busy])

  if (!flow) return null

  let title: string
  let body: React.ReactNode
  let actions: React.ReactNode = null

  if (flow.kind === 'deep-dig-prompt') {
    const { shown, rest } = summarizePlatformNames(flow.platforms, PLATFORM_LABELS)
    const platformNames = rest > 0 ? `${shown} ${t('autoFlow.platformsMore', { count: rest })}` : shown
    title = t('autoFlow.deepDigTitle')
    body = (
      <p className="flow-modal-text">
        {t('autoFlow.deepDigBody', { count: flow.catalogs.length, platforms: platformNames })}
      </p>
    )
    actions = (
      <>
        <button type="button" className="flow-modal-secondary-btn" onClick={onDeepDigSkip}>
          {t('autoFlow.skip')}
        </button>
        <button type="button" className="flow-modal-primary-btn" onClick={onDeepDigConfirm}>
          {t('autoFlow.deepDigRun')}
        </button>
      </>
    )
  } else if (flow.kind === 'smart-prompt') {
    title = t('autoFlow.smartTitle')
    body = (
      <p className="flow-modal-text">{t('autoFlow.smartBody', { count: flow.catalogs.length })}</p>
    )
    actions = (
      <>
        <button type="button" className="flow-modal-secondary-btn" onClick={onSmartSkip}>
          {t('autoFlow.skip')}
        </button>
        <button type="button" className="flow-modal-primary-btn" onClick={onSmartConfirm}>
          {t('autoFlow.smartRun')}
        </button>
      </>
    )
  } else if (flow.kind === 'smart-running') {
    title = t('autoFlow.smartTitle')
    body = (
      <>
        <div className="flow-modal-status" role="status" aria-live="polite">
          <span className="flow-modal-spinner" aria-hidden="true" />
          <span>{t('autoFlow.smartProgress', { current: flow.current, total: flow.total, catalogNumber: flow.catalogNumber })}</span>
        </div>
        <div className="flow-modal-phase">
          <span className="flow-modal-phase-dot" aria-hidden="true" />
          <span>{smartPhaseText(flow.phase, flow.platform, t)}</span>
        </div>
      </>
    )
    actions = (
      <button
        type="button"
        className={`flow-modal-secondary-btn flow-modal-cancel-btn${flow.cancelling ? ' is-cancelling' : ''}`}
        onClick={onSmartCancel}
        disabled={flow.cancelling}
      >
        {flow.cancelling ? t('autoFlow.cancelling') : t('autoFlow.cancel')}
      </button>
    )
  } else if (flow.kind === 'smart-cancelled') {
    title = t('autoFlow.smartTitle')
    body = (
      <p className="flow-modal-text">
        {t('autoFlow.smartCancelled', { completed: flow.completed, total: flow.total })}
      </p>
    )
    actions = (
      <button type="button" className="flow-modal-primary-btn" onClick={onClose}>
        {t('autoFlow.close')}
      </button>
    )
  } else {
    title = t('autoFlow.smartTitle')
    body = (
      <>
        <p className="flow-modal-text">✓ {t('autoFlow.smartDone')}</p>
        {flow.failed > 0 && (
          <p className="flow-modal-hint">{t('autoFlow.smartDoneFailed', { failed: flow.failed })}</p>
        )}
      </>
    )
    actions = (
      <button type="button" className="flow-modal-primary-btn" onClick={onClose}>
        {t('autoFlow.close')}
      </button>
    )
  }

  return (
    <div className="flow-modal-overlay" onClick={dismiss}>
      <div
        className="flow-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="flow-modal-title"
        onClick={e => e.stopPropagation()}
      >
        <div className="flow-modal-header">
          <div className="flow-modal-title" id="flow-modal-title">{title}</div>
        </div>
        <div className="flow-modal-body">{body}</div>
        {actions && <div className="flow-modal-actions">{actions}</div>}
      </div>
    </div>
  )
}
