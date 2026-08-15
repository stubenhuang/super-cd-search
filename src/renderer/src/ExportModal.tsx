import React, { useEffect, useState } from 'react'
import { useI18n } from './i18n'

export interface ExportConfirmOptions {
  directory: string
  deepSearch: boolean
  smartGenerate: boolean
}

interface ExportModalProps {
  isOpen: boolean
  busy: boolean
  statusText: string | null
  error: string | null
  onClose: () => void
  onConfirm: (options: ExportConfirmOptions) => void
}

export function ExportModal({ isOpen, busy, statusText, error, onClose, onConfirm }: ExportModalProps) {
  const { t } = useI18n()
  const [directory, setDirectory] = useState('')
  const [deepSearch, setDeepSearch] = useState(false)
  const [smartGenerate, setSmartGenerate] = useState(false)
  const [pickingDirectory, setPickingDirectory] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setDirectory('')
      setDeepSearch(false)
      setSmartGenerate(false)
      setPickingDirectory(false)
    }
  }, [isOpen])

  const handlePickDirectory = async () => {
    if (pickingDirectory || busy) return
    setPickingDirectory(true)
    try {
      const result = await window.electronAPI.selectExportDirectory()
      if (result.status === 'selected' && result.path) {
        setDirectory(result.path)
        window.electronAPI.log('debug', 'exportModal', 'export directory selected', { path: result.path })
      }
    } finally {
      setPickingDirectory(false)
    }
  }

  if (!isOpen) return null

  const canConfirm = !!directory && !busy

  return (
    <div className="export-modal-overlay" onClick={() => !busy && onClose()}>
      <div className="export-modal" onClick={e => e.stopPropagation()}>
        <div className="export-modal-header">
          <div className="export-modal-title">{t('export.modalTitle')}</div>
          <button className="export-modal-close" onClick={onClose} disabled={busy} title={t('export.close')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="export-modal-body">
          <div className="export-modal-field">
            <label className="export-modal-label">{t('export.directory')}</label>
            <div className="export-modal-directory">
              <span className={`export-modal-directory-path ${directory ? '' : 'empty'}`}>
                {directory || t('export.directoryPlaceholder')}
              </span>
              <button
                type="button"
                className="export-modal-pick-btn"
                onClick={handlePickDirectory}
                disabled={pickingDirectory || busy}
              >
                {pickingDirectory ? t('export.picking') : t('export.pickDirectory')}
              </button>
            </div>
          </div>

          <div className="export-modal-options">
            <label className="export-modal-check">
              <input
                type="checkbox"
                checked={deepSearch}
                onChange={e => setDeepSearch(e.target.checked)}
                disabled={busy}
              />
              <span className="export-modal-checkbox" aria-hidden="true" />
              <span className="export-modal-option-text">
                <span className="export-modal-option-title">{t('export.deepSearch')}</span>
                <span className="export-modal-option-desc">{t('export.deepSearchDesc')}</span>
              </span>
            </label>

            <label className="export-modal-check">
              <input
                type="checkbox"
                checked={smartGenerate}
                onChange={e => setSmartGenerate(e.target.checked)}
                disabled={busy}
              />
              <span className="export-modal-checkbox" aria-hidden="true" />
              <span className="export-modal-option-text">
                <span className="export-modal-option-title">{t('export.smartGenerate')}</span>
                <span className="export-modal-option-desc">{t('export.smartGenerateDesc')}</span>
              </span>
            </label>

            {smartGenerate && (
              <div className="export-modal-warning">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                {t('export.smartGenerateWarning')}
              </div>
            )}
          </div>

          {busy && statusText && (
            <div className="export-modal-status">
              <span className="export-modal-spinner" aria-hidden="true" />
              <span>{statusText}</span>
            </div>
          )}
          {!busy && error && (
            <div className="export-modal-error">⚠ {error}</div>
          )}
        </div>

        <div className="export-modal-actions">
          <button className="export-modal-cancel-btn" onClick={onClose} disabled={busy}>
            {t('export.cancel')}
          </button>
          <button
            className="export-modal-confirm-btn"
            onClick={() => canConfirm && onConfirm({ directory, deepSearch, smartGenerate })}
            disabled={!canConfirm}
            title={!directory ? t('export.directoryPlaceholder') : undefined}
          >
            {t('export.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
