import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CDLibraryRecord, CDLibraryRecordInput } from './electron-api'
import { normalizeCatalogNumber } from '../../shared/utils'
import { useI18n } from './i18n'
import './CDLibrary.css'

type PageSize = 20 | 50 | 100

const EMPTY_RECORD: CDLibraryRecordInput = {
  catalogNumber: '',
  imageUrl: '',
  details: '',
  lowestPriceUsd: null,
  highestPriceUsd: null,
  lowestPriceCny: null,
  highestPriceCny: null
}

interface RecordFormProps {
  record?: CDLibraryRecord | null
  onClose: () => void
  onSaved: () => void
}

function priceToInput(value: number | null): string {
  return value === null ? '' : String(value)
}

function RecordForm({ record, onClose, onSaved }: RecordFormProps) {
  const { t } = useI18n()
  const [catalogNumber, setCatalogNumber] = useState(record?.catalogNumber ?? '')
  const [imageUrl, setImageUrl] = useState(record?.imageUrl ?? '')
  const [details, setDetails] = useState(record?.details ?? '')
  const [removeEmbeddedImage, setRemoveEmbeddedImage] = useState(false)
  const [prices, setPrices] = useState({
    lowestPriceUsd: priceToInput(record?.lowestPriceUsd ?? null),
    highestPriceUsd: priceToInput(record?.highestPriceUsd ?? null),
    lowestPriceCny: priceToInput(record?.lowestPriceCny ?? null),
    highestPriceCny: priceToInput(record?.highestPriceCny ?? null)
  })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const parsePrice = (value: string): number | null => value.trim() === '' ? null : Number(value)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError(null)
    const input: CDLibraryRecordInput = {
      catalogNumber: normalizeCatalogNumber(record?.catalogNumber ?? catalogNumber),
      imageUrl: imageUrl.trim(),
      details,
      lowestPriceUsd: parsePrice(prices.lowestPriceUsd),
      highestPriceUsd: parsePrice(prices.highestPriceUsd),
      lowestPriceCny: parsePrice(prices.lowestPriceCny),
      highestPriceCny: parsePrice(prices.highestPriceCny),
      preserveEmbeddedImage: !!record?.hasEmbeddedImage && !removeEmbeddedImage && imageUrl === record.imageUrl
    }
    try {
      if (record) await window.electronAPI.updateLibraryRecord(record.catalogNumber, input)
      else await window.electronAPI.createLibraryRecord(input)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const priceFields = [
    ['lowestPriceUsd', t('library.priceMinUsd')],
    ['highestPriceUsd', t('library.priceMaxUsd')],
    ['lowestPriceCny', t('library.priceMinCny')],
    ['highestPriceCny', t('library.priceMaxCny')]
  ] as const

  return (
    <div className="library-modal-overlay" onClick={() => !saving && onClose()}>
      <form className="library-modal" onSubmit={handleSubmit} onClick={event => event.stopPropagation()}>
        <div className="library-modal-header">
          <h2>{record ? t('library.editTitle') : t('library.addTitle')}</h2>
          <button type="button" onClick={onClose} disabled={saving} aria-label={t('library.cancel')}>×</button>
        </div>
        <div className="library-modal-body">
          <label>
            <span>{t('export.catalogNumber')}</span>
            <input
              value={catalogNumber}
              onChange={event => setCatalogNumber(event.target.value)}
              readOnly={!!record}
              required
              autoFocus={!record}
            />
          </label>
          {record?.hasEmbeddedImage && (
            <label className="library-embedded-option">
              <span>{t('library.embeddedImage')}</span>
              <span className="library-inline-check">
                <input
                  type="checkbox"
                  checked={removeEmbeddedImage}
                  onChange={event => setRemoveEmbeddedImage(event.target.checked)}
                />
                {t('library.removeEmbeddedImage')}
              </span>
            </label>
          )}
          <label>
            <span>{t('library.imageUrl')}</span>
            <input
              type="url"
              value={imageUrl}
              onChange={event => setImageUrl(event.target.value)}
              placeholder="https://…"
            />
          </label>
          <label className="library-details-field">
            <span>{t('library.details')}</span>
            <textarea value={details} onChange={event => setDetails(event.target.value)} rows={8} />
          </label>
          <div className="library-price-grid">
            {priceFields.map(([key, label]) => (
              <label key={key}>
                <span>{label}</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={prices[key]}
                  onChange={event => setPrices(current => ({ ...current, [key]: event.target.value }))}
                />
              </label>
            ))}
          </div>
          {error && <div className="library-form-error">{error}</div>}
        </div>
        <div className="library-modal-actions">
          <button type="button" onClick={onClose} disabled={saving}>{t('library.cancel')}</button>
          <button type="submit" className="primary" disabled={saving}>{t('library.save')}</button>
        </div>
      </form>
    </div>
  )
}

function LibraryCover({ record }: { record: CDLibraryRecord }) {
  const { t } = useI18n()
  const [source, setSource] = useState<string>('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    setSource('')
    setFailed(false)
    const load = record.hasEmbeddedImage
      ? window.electronAPI.getLibraryImage(record.catalogNumber)
      : record.imageUrl
        ? window.electronAPI.fetchImage(record.imageUrl, 100)
        : Promise.resolve(null)
    void load.then(image => {
      if (!active) return
      if (!image) setFailed(true)
      else setSource(`data:${image.mimeType};base64,${image.base64}`)
    }).catch(() => active && setFailed(true))
    return () => { active = false }
  }, [record.catalogNumber, record.hasEmbeddedImage, record.imageUrl])

  if ((!record.hasEmbeddedImage && !record.imageUrl) || failed) {
    return <div className="library-cover-placeholder">{t('result.noImage')}</div>
  }
  return source
    ? <img className="library-cover" src={source} alt={record.catalogNumber} />
    : <div className="library-cover-placeholder loading" />
}

function formatPrice(value: number | null): string {
  return value === null ? '—' : value.toFixed(2)
}

interface CDLibraryProps {
  refreshVersion: number
}

export function CDLibrary({ refreshVersion }: CDLibraryProps) {
  const { t } = useI18n()
  const [records, setRecords] = useState<CDLibraryRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<PageSize>(20)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [editing, setEditing] = useState<CDLibraryRecord | null | undefined>(undefined)
  const headerCheckboxRef = useRef<HTMLInputElement>(null)

  const loadRecords = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI.listLibraryRecords({ catalogQuery: query, page, pageSize })
      setRecords(result.records)
      setTotal(result.total)
      if (result.page !== page) setPage(result.page)
    } catch (err) {
      setNotice({ kind: 'error', text: t('library.storageError', { error: err instanceof Error ? err.message : String(err) }) })
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, query, t])

  useEffect(() => { void loadRecords() }, [loadRecords, refreshVersion])

  const selectedSet = useMemo(() => new Set(selected), [selected])
  const selectedOnPage = records.filter(record => selectedSet.has(record.catalogNumber)).length
  const allOnPage = records.length > 0 && selectedOnPage === records.length

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = selectedOnPage > 0 && !allOnPage
    }
  }, [allOnPage, selectedOnPage])

  const handleQueryChange = (value: string) => {
    setQuery(value)
    setPage(1)
    setSelected([])
  }

  const handlePageSize = (value: PageSize) => {
    setPageSize(value)
    setPage(1)
    setSelected([])
  }

  const toggleRecord = (catalogNumber: string) => {
    setSelected(current => current.includes(catalogNumber)
      ? current.filter(item => item !== catalogNumber)
      : [...current, catalogNumber])
  }

  const togglePage = () => {
    const pageCatalogs = records.map(record => record.catalogNumber)
    setSelected(current => allOnPage
      ? current.filter(item => !pageCatalogs.includes(item))
      : [...current, ...pageCatalogs.filter(item => !current.includes(item))])
  }

  const deleteRecords = async (catalogNumbers: string[]) => {
    if (catalogNumbers.length === 0) return
    const message = catalogNumbers.length === 1
      ? t('library.deleteOneConfirm', { catalogNumber: catalogNumbers[0] })
      : t('library.deleteManyConfirm', { count: catalogNumbers.length })
    if (!window.confirm(message)) return
    setBusy(true)
    try {
      await window.electronAPI.deleteLibraryRecords(catalogNumbers)
      setSelected(current => current.filter(item => !catalogNumbers.includes(item)))
      await loadRecords()
    } catch (err) {
      setNotice({ kind: 'error', text: t('library.storageError', { error: err instanceof Error ? err.message : String(err) }) })
    } finally {
      setBusy(false)
    }
  }

  const handleImport = async () => {
    setBusy(true)
    setNotice(null)
    try {
      const result = await window.electronAPI.importLibraryExcel()
      if (result.status === 'imported') {
        let text = t('library.importDone', {
          added: result.added,
          updated: result.updated,
          skipped: result.skipped
        })
        if (result.errors.length > 0) {
          const summary = result.errors.slice(0, 5).map(item => `${item.row}: ${item.message}`).join('; ')
          text += ` ${t('library.importErrors', { errors: summary })}`
        }
        setNotice({ kind: result.errors.length > 0 ? 'error' : 'success', text })
        setPage(1)
        setSelected([])
        await loadRecords()
      } else if (result.status === 'error') {
        setNotice({ kind: 'error', text: t('library.storageError', { error: result.error || t('export.failed') }) })
      }
    } finally {
      setBusy(false)
    }
  }

  const handleExport = async () => {
    if (selected.length === 0) return
    setBusy(true)
    setNotice(null)
    const headers = [
      t('export.catalogNumber'), t('export.image'), t('export.details'),
      t('export.lowestPriceUsd'), t('export.highestPriceUsd'),
      t('export.lowestPriceCny'), t('export.highestPriceCny')
    ]
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
    try {
      const result = await window.electronAPI.exportLibraryExcel(selected, headers, `super-cd-library-${stamp}.xlsx`)
      if (result.status === 'saved') setNotice({ kind: 'success', text: t('library.exportDone') })
      else if (result.status === 'error') setNotice({ kind: 'error', text: t('library.storageError', { error: result.error || t('export.failed') }) })
    } finally {
      setBusy(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <section className="library-panel">
      <div className="library-toolbar">
        <input
          className="library-search"
          value={query}
          onChange={event => handleQueryChange(event.target.value)}
          placeholder={t('library.searchPlaceholder')}
        />
        <div className="library-toolbar-actions">
          {selected.length > 0 && <span className="library-selected-count">{t('library.selected', { count: selected.length })}</span>}
          <button onClick={() => setEditing(null)} disabled={busy}>{t('library.add')}</button>
          <button onClick={handleImport} disabled={busy}>{busy ? t('library.importing') : t('library.import')}</button>
          <button onClick={handleExport} disabled={busy || selected.length === 0}>{t('library.exportSelected')}</button>
          <button className="danger" onClick={() => deleteRecords(selected)} disabled={busy || selected.length === 0}>{t('library.deleteSelected')}</button>
        </div>
      </div>
      {notice && <div className={`library-notice ${notice.kind}`}>{notice.text}</div>}
      <div className="library-table-wrap">
        {loading ? (
          <div className="library-empty">{t('library.loading')}</div>
        ) : records.length === 0 ? (
          <div className="library-empty">{query ? t('library.noMatches') : t('library.empty')}</div>
        ) : (
          <table className="library-table">
            <colgroup>
              <col className="library-col-check" />
              <col className="library-col-catalog" />
              <col className="library-col-image" />
              <col className="library-col-details" />
              <col className="library-col-price" />
              <col className="library-col-price" />
              <col className="library-col-price" />
              <col className="library-col-price" />
              <col className="library-col-actions" />
            </colgroup>
            <thead>
              <tr>
                <th className="library-check-cell"><input ref={headerCheckboxRef} type="checkbox" checked={allOnPage} onChange={togglePage} /></th>
                <th>{t('export.catalogNumber')}</th>
                <th>{t('export.image')}</th>
                <th>{t('export.details')}</th>
                <th className="library-price-header">{t('export.lowestPriceUsd')}</th>
                <th className="library-price-header">{t('export.highestPriceUsd')}</th>
                <th className="library-price-header">{t('export.lowestPriceCny')}</th>
                <th className="library-price-header">{t('export.highestPriceCny')}</th>
                <th className="library-actions-header">{t('library.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {records.map(record => (
                <tr key={record.catalogNumber} className={selectedSet.has(record.catalogNumber) ? 'selected' : ''}>
                  <td className="library-check-cell"><input type="checkbox" checked={selectedSet.has(record.catalogNumber)} onChange={() => toggleRecord(record.catalogNumber)} /></td>
                  <td className="library-catalog-cell">{record.catalogNumber}</td>
                  <td className="library-image-cell"><LibraryCover record={record} /></td>
                  <td><div className="library-details-preview">{record.details || '—'}</div></td>
                  <td className="library-price-cell">{formatPrice(record.lowestPriceUsd)}</td>
                  <td className="library-price-cell">{formatPrice(record.highestPriceUsd)}</td>
                  <td className="library-price-cell">{formatPrice(record.lowestPriceCny)}</td>
                  <td className="library-price-cell">{formatPrice(record.highestPriceCny)}</td>
                  <td className="library-actions-cell">
                    <div className="library-row-actions">
                      <button onClick={() => setEditing(record)} disabled={busy}>{t('library.edit')}</button>
                      <button className="danger-link" onClick={() => deleteRecords([record.catalogNumber])} disabled={busy}>{t('library.delete')}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="library-pagination">
        <label>{t('library.pageSize')}
          <select value={pageSize} onChange={event => handlePageSize(Number(event.target.value) as PageSize)}>
            <option value={20}>20</option><option value={50}>50</option><option value={100}>100</option>
          </select>
        </label>
        <span>{t('library.page', { page, pages: totalPages, total })}</span>
        <div>
          <button onClick={() => setPage(value => Math.max(1, value - 1))} disabled={page <= 1 || loading}>{t('library.previous')}</button>
          <button onClick={() => setPage(value => Math.min(totalPages, value + 1))} disabled={page >= totalPages || loading}>{t('library.next')}</button>
        </div>
      </div>
      {editing !== undefined && (
        <RecordForm
          record={editing}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined)
            setPage(1)
            void loadRecords()
          }}
        />
      )}
    </section>
  )
}
