import React, { useState, useCallback, useEffect, useMemo } from 'react'
import type { QueryResult, CDDetails } from './electron-api'

const PLATFORM_PRIORITY: Record<string, number> = {
  discogs: 0,
  hmv: 1,
  kojima: 2,
  yahoo: 3,
  ebay: 4
}

const DETAIL_LABELS: Record<keyof CDDetails, string> = {
  label: '厂牌',
  format: '格式',
  country: '国家',
  released: '发行',
  genre: '类型'
}

const DETAIL_KEYS: (keyof CDDetails)[] = ['label', 'format', 'country', 'released', 'genre']

interface DetailModalProps {
  isOpen: boolean
  onClose: () => void
  catalogNumber: string
  results: QueryResult[]
}

export function DetailModal({ isOpen, onClose, catalogNumber, results }: DetailModalProps) {
  const [copied, setCopied] = useState(false)
  const [coverData, setCoverData] = useState<string | null>(null)

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

  useEffect(() => {
    if (!displayCover) {
      setCoverData(null)
      return
    }

    let cancelled = false
    window.electronAPI.fetchImage(displayCover, 240)
      .then(data => {
        if (cancelled) return
        setCoverData(data ? `data:${data.mimeType};base64,${data.base64}` : null)
      })
      .catch(() => {
        if (!cancelled) setCoverData(null)
      })

    return () => { cancelled = true }
  }, [displayCover])

  const copyText = useMemo(() => {
    const lines: string[] = [`目录号: ${catalogNumber}`]
    if (displayName && displayName !== catalogNumber) lines.push(`专辑: ${displayName}`)
    if (displayArtist) lines.push(`艺术家: ${displayArtist}`)
    for (const key of DETAIL_KEYS) {
      if (mergedDetails[key]) {
        lines.push(`${DETAIL_LABELS[key]}: ${mergedDetails[key]}`)
      }
    }
    return lines.join('\n')
  }, [catalogNumber, displayName, displayArtist, mergedDetails])

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
          <button className="detail-modal-close" onClick={onClose} title="关闭">
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
                  来源: {primaryResult.platform === 'discogs' ? 'Discogs' :
                         primaryResult.platform === 'ebay' ? 'eBay' :
                         primaryResult.platform === 'hmv' ? 'HMV Japan' :
                         primaryResult.platform === 'yahoo' ? 'Yahoo Shopping' :
                         'Kojima Rokuon'}
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
                  <span className="detail-modal-field-label">{DETAIL_LABELS[key]}</span>
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
                已复制
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                复制信息
              </>
            )}
          </button>
          <button className="detail-modal-close-btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
