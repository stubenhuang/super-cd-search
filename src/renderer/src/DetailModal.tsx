import React, { useState, useCallback, useEffect, useMemo } from 'react'
import type { QueryResult, CDDetails } from './electron-api'
import { PLATFORM_LABELS } from '../../shared/platforms'
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

const DETAIL_KEYS: (keyof CDDetails)[] = ['label', 'format', 'country', 'released', 'genre']

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
}

export function DetailModal({ isOpen, onClose, catalogNumber, results }: DetailModalProps) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!isOpen) {
      setCopied(false)
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

  const primaryResult = useMemo(() => {
    return sortedResults.find(r => r.status === 'found' && r.name) || sortedResults.find(r => r.status === 'found') || sortedResults[0]
  }, [sortedResults])

  const mergedDetails = useMemo(() => {
    const merged: CDDetails = { label: null, format: null, country: null, released: null, genre: null }
    for (const result of sortedResults) {
      if (!result.details) continue
      for (const key of DETAIL_KEYS) {
        if (merged[key] === null && result.details[key]) {
          (merged[key] as string | null) = result.details[key]
        }
      }
    }
    return merged
  }, [sortedResults])

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
                  <span className="detail-modal-field-value">{value || '—'}</span>
                </div>
              )
            })}
          </div>
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
