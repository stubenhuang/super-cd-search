import React, { useState, useCallback, useEffect, useMemo } from 'react'
import type { QueryResult, CDDetails, DetailEnrichProgress } from './electron-api'
import { PLATFORM_LABELS } from '../../shared/platforms'
import { DETAIL_KEYS, aggregateDetails, missingDetailKeys, isValidDetailValue } from '../../shared/details'
import { useCoverImage } from './hooks/useCoverImage'
import { useI18n } from './i18n'

const PLATFORM_PRIORITY: Record<string, number> = {
  discogs: 0,
  hmv: 1,
  kojima: 2,
  yahoo: 3,
  ebay: 4,
  cdjapan: 5,
  tower: 6,
  surugaya: 7,
  zenmarket: 8
}

const DETAIL_LABEL_KEYS: Record<keyof CDDetails, 'detail.label' | 'detail.format' | 'detail.country' | 'detail.released' | 'detail.genre'> = {
  label: 'detail.label',
  format: 'detail.format',
  country: 'detail.country',
  released: 'detail.released',
  genre: 'detail.genre'
}

interface DetailModalProps {
  isOpen: boolean
  onClose: () => void
  catalogNumber: string
  results: QueryResult[]
  enrichedDetails?: CDDetails | null
  onDetailsEnriched: (catalogNumber: string, details: CDDetails) => void
}

export function DetailModal({ isOpen, onClose, catalogNumber, results, enrichedDetails, onDetailsEnriched }: DetailModalProps) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [genDone, setGenDone] = useState(false)
  const [genProgress, setGenProgress] = useState<DetailEnrichProgress | null>(null)

  useEffect(() => {
    if (!isOpen) {
      setCopied(false)
      setGenerating(false)
      setGenError(null)
      setGenDone(false)
      setGenProgress(null)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  const sortedResults = useMemo(() => {
    return [...results].sort((a, b) =>
      (PLATFORM_PRIORITY[a.platform] ?? 99) - (PLATFORM_PRIORITY[b.platform] ?? 99)
    )
  }, [results])

  // Aggregate every source. Sources with more valid detail fields win, and
  // poorer sources only fill the gaps the richer ones left behind.
  const aggregation = useMemo(() => aggregateDetails(sortedResults), [sortedResults])
  const bestDetailResult = useMemo(() => {
    if (!aggregation.best?.platform) return undefined
    return sortedResults.find(r => r.platform === aggregation.best?.platform)
  }, [aggregation.best, sortedResults])

  const primaryResult = useMemo(() => {
    const namedBest = bestDetailResult?.status === 'found' && bestDetailResult.name
      ? bestDetailResult
      : undefined
    return namedBest ||
      sortedResults.find(r => r.status === 'found' && r.name) ||
      sortedResults.find(r => r.status === 'found') ||
      sortedResults[0]
  }, [bestDetailResult, sortedResults])

  const mergedDetails = useMemo(() => {
    const merged: CDDetails = { ...aggregation.details }
    if (enrichedDetails) {
      for (const key of DETAIL_KEYS) {
        if (!isValidDetailValue(merged[key]) && isValidDetailValue(enrichedDetails[key])) {
          merged[key] = enrichedDetails[key]!.trim()
        }
      }
    }
    return merged
  }, [aggregation.details, enrichedDetails])

  const missingFields = useMemo(() => missingDetailKeys(mergedDetails), [mergedDetails])
  const hasDetails = DETAIL_KEYS.some(key => mergedDetails[key] !== null)

  const displayName = primaryResult?.name || catalogNumber
  const displayArtist = primaryResult?.artist
  const displayCover = primaryResult?.coverUrl

  const { imageData: coverData } = useCoverImage(displayCover, { size: 240 })

  const copyText = useMemo(() => {
    const lines: string[] = [`${t('detail.catalogNumber')}: ${catalogNumber}`]
    if (displayName && displayName !== catalogNumber) lines.push(`${t('detail.album')}: ${displayName}`)
    if (displayArtist) lines.push(`${t('detail.artist')}: ${displayArtist}`)
    for (const key of DETAIL_KEYS) {
      if (mergedDetails[key]) {
        lines.push(`${t(DETAIL_LABEL_KEYS[key])}: ${mergedDetails[key]}`)
      }
    }
    return lines.join('\n')
  }, [catalogNumber, displayName, displayArtist, mergedDetails, t])

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(copyText)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Fallback for older Electron
      const textarea = document.createElement('textarea')
      textarea.value = copyText
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }, [copyText])

  useEffect(() => {
    if (!isOpen) return
    let active = true
    const handleProgress = (...args: unknown[]) => {
      const progress = args[0] as DetailEnrichProgress
      if (active && progress?.catalogNumber === catalogNumber) {
        setGenProgress(progress)
      }
    }
    window.electronAPI.receive('detail:enrich-progress', handleProgress)
    return () => {
      active = false
    }
  }, [isOpen, catalogNumber])

  const handleSmartGenerate = useCallback(async () => {
    if (generating) return
    setGenError(null)
    setGenDone(false)
    setGenProgress(null)
    window.electronAPI.log('debug', 'detail.smartGenerate', 'smart generate clicked', { catalogNumber, missingFields })

    try {
      setGenerating(true)
      // The main process checks LLM configuration itself; it also serves
      // previously generated details from cache without needing the LLM.
      const result = await window.electronAPI.enrichDetails(catalogNumber, results, mergedDetails)
      window.electronAPI.log('debug', 'detail.smartGenerate', 'enrichment returned', {
        catalogNumber,
        status: result.status,
        usedCache: result.usedCache,
        analyzedPlatforms: result.analyzedPlatforms
      })

      // Cached/partial details are still useful even when the LLM is not
      // configured, so apply them before deciding which message to show.
      onDetailsEnriched(catalogNumber, result.details)

      if (result.status === 'complete') {
        setGenDone(true)
      } else if (!result.llmConfigured) {
        window.electronAPI.log('warn', 'detail.smartGenerate', 'LLM not configured and fields still missing', { catalogNumber })
        setGenError(t('detail.smartNoLlm'))
      } else {
        setGenError(t('detail.smartPartial', { count: result.analyzedPlatforms.length }))
      }
    } catch (err) {
      console.warn('smart generate failed:', err)
      window.electronAPI.log('warn', 'detail.smartGenerate', 'smart generate failed', { catalogNumber, error: err instanceof Error ? err.message : String(err) })
      setGenError(t('detail.smartFailed'))
    } finally {
      setGenerating(false)
    }
  }, [catalogNumber, generating, mergedDetails, onDetailsEnriched, results, t])

  const skipReasonText = useCallback((reason?: string): string => {
    switch (reason) {
      case 'platform_disabled': return t('detail.smartSkipDisabled')
      case 'not_found': return t('detail.smartSkipNotFound')
      case 'no_product_link': return t('detail.smartSkipNoLink')
      case 'cloudflare_challenge': return t('detail.smartSkipCloudflare')
      case 'fetch_failed': return t('detail.smartSkipFetch')
      case 'llm_failed': return t('detail.smartSkipLlm')
      default: return t('detail.smartSkipUnknown')
    }
  }, [t])

  const genStatusText = useMemo(() => {
    if (!genProgress) return null
    const platform = PLATFORM_LABELS[genProgress.platform] || genProgress.platform
    switch (genProgress.status) {
      case 'searching': return t('detail.smartSearching', { platform })
      case 'fetching': return t('detail.smartFetching', { platform })
      case 'analyzing': return t('detail.smartAnalyzing', { platform })
      case 'skipped': return t('detail.smartSkipped', { platform, reason: skipReasonText(genProgress.reason) })
      case 'complete': return t('detail.smartComplete')
      case 'error': return t('detail.smartFailed')
      default: return null
    }
  }, [genProgress, skipReasonText, t])

  if (!isOpen) return null

  return (
    <div className="detail-modal-overlay" onClick={onClose}>
      <div className="detail-modal" onClick={e => e.stopPropagation()}>
        <div className="detail-modal-header">
          <div className="detail-modal-catalog">{catalogNumber}</div>
          <button className="detail-modal-close" onClick={onClose} title={t('detail.close')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="detail-modal-body">
          <div className="detail-modal-top">
            {displayCover && (
              <div className="detail-modal-cover">
                {coverData ? (
                  <img src={coverData} alt={displayName} />
                ) : (
                  <div className="image-placeholder" />
                )}
              </div>
            )}
            <div className="detail-modal-identity">
              <h2 className="detail-modal-title">{displayName}</h2>
              {displayArtist && <p className="detail-modal-artist">{displayArtist}</p>}
              {primaryResult?.platform && (
                <span className="detail-modal-source">
                  {t('detail.source', { platform: PLATFORM_LABELS[primaryResult.platform] || primaryResult.platform })}
                </span>
              )}
            </div>
          </div>

          {hasDetails && (
            <div className="detail-modal-divider" />
          )}

          <div className="detail-modal-fields">
            {DETAIL_KEYS.map(key => {
              const value = mergedDetails[key]
              return (
                <div key={key} className="detail-modal-field">
                  <span className="detail-modal-field-label">{t(DETAIL_LABEL_KEYS[key])}</span>
                  <span className={`detail-modal-field-value ${value ? '' : 'missing'}`}>{value || '—'}</span>
                </div>
              )
            })}
          </div>

          {missingFields.length > 0 && (
            <div className="detail-modal-smart">
              <button
                type="button"
                className="detail-modal-smart-btn"
                onClick={handleSmartGenerate}
                disabled={generating}
                title={t('detail.smartGenerateTitle')}
              >
                <span className="detail-modal-smart-icon" aria-hidden="true">🧠</span>
                <span>{generating ? t('detail.smartGenerating') : t('detail.smartGenerate')}</span>
              </button>
              <span className="detail-modal-smart-missing">
                {t('detail.smartMissing', {
                  fields: missingFields.map(key => t(DETAIL_LABEL_KEYS[key])).join(' / ')
                })}
              </span>
            </div>
          )}

          {generating && genStatusText && (
            <div className="detail-modal-smart-status">
              <span className="detail-modal-smart-spinner" aria-hidden="true" />
              <span>{genStatusText}</span>
            </div>
          )}
          {!generating && genDone && (
            <div className="detail-modal-smart-done">✓ {t('detail.smartComplete')}</div>
          )}
          {!generating && genError && (
            <div className="detail-modal-smart-error">⚠ {genError}</div>
          )}
        </div>

        <div className="detail-modal-actions">
          <button className="detail-modal-copy-btn" onClick={handleCopy}>
            {copied ? (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {t('detail.copied')}
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                {t('detail.copy')}
              </>
            )}
          </button>
          <button className="detail-modal-close-btn" onClick={onClose}>
            {t('detail.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
