import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  CDLibraryRecord,
  CDLibraryRecordInput,
  LibraryPublishStatusFilter,
  PublishItem,
  PublishPlatform,
  PublishSnapshot
} from './electron-api'
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

type CoverRecord = Pick<CDLibraryRecord, 'catalogNumber' | 'imageUrl' | 'hasEmbeddedImage'>

function LibraryCover({ record }: { record: CoverRecord }) {
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

const PLATFORM_LABEL_KEYS: Record<PublishPlatform, 'library.platformTaobao' | 'library.platformXianyu' | 'library.platformDiscogs'> = {
  taobao: 'library.platformTaobao',
  xianyu: 'library.platformXianyu',
  discogs: 'library.platformDiscogs'
}

const PLATFORM_ORDER: PublishPlatform[] = ['taobao', 'xianyu', 'discogs']

/** "发布状态" cell: persistent toggle for the record. */
function PublishStatusCell({
  record,
  busy,
  onToggle
}: {
  record: CDLibraryRecord
  busy: boolean
  onToggle: (record: CDLibraryRecord) => void
}) {
  const { t } = useI18n()
  return (
    <button
      type="button"
      className={`library-status-toggle${record.published ? ' on' : ''}`}
      onClick={() => onToggle(record)}
      disabled={busy}
    >
      {record.published ? t('library.publishedYes') : t('library.publishedNo')}
    </button>
  )
}

/** "发布平台" cell: per-platform checkmarks, editable once the record is published. */
function PublishPlatformsCell({
  record,
  busy,
  onTogglePlatform
}: {
  record: CDLibraryRecord
  busy: boolean
  onTogglePlatform: (record: CDLibraryRecord, platform: PublishPlatform) => void
}) {
  const { t } = useI18n()
  return (
    <div className="library-platforms-cell">
      {PLATFORM_ORDER.map(platform => {
        const on = (record.platforms ?? []).includes(platform)
        return (
          <button
            key={platform}
            type="button"
            className={`library-platform-toggle${on ? ' on' : ''}`}
            onClick={() => onTogglePlatform(record, platform)}
            disabled={busy || !record.published}
          >
            {t(PLATFORM_LABEL_KEYS[platform])}
          </button>
        )
      })}
    </div>
  )
}

const PRICE_FIELD_KEYS = [
  ['lowestPriceUsd', 'export.lowestPriceUsd'],
  ['highestPriceUsd', 'export.highestPriceUsd'],
  ['lowestPriceCny', 'export.lowestPriceCny'],
  ['highestPriceCny', 'export.highestPriceCny']
] as const

interface PublishModalProps {
  onClose: () => void
  /** Refresh the library table so its publish columns stay in sync. */
  onChanged: () => void
}

/**
 * Desktop publish manager: full parity with the phone "发布" tab — per-field
 * copy, published-state toggle and platform checkmarks, kept live against
 * phone-side edits via the publish-updated event.
 */
function PublishModal({ onClose, onChanged }: PublishModalProps) {
  const { t } = useI18n()
  const [snapshot, setSnapshot] = useState<PublishSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      setSnapshot(await window.electronAPI.getPublishSnapshot())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
    return window.electronAPI.receive('library:publish-updated', () => { void reload() })
  }, [reload])

  const copy = async (key: string, text: string | number | null) => {
    if (text === null || text === '') return
    try {
      await navigator.clipboard.writeText(String(text))
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(current => (current === key ? null : current)), 1200)
    } catch {
      setError(t('library.copyFailed'))
    }
  }

  const mutate = async (fn: () => Promise<void>, apply: (items: PublishItem[]) => PublishItem[]) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await fn()
      setSnapshot(current => (current ? { ...current, items: apply(current.items) } : current))
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const togglePublished = (item: PublishItem) => {
    const next = !item.published
    return mutate(
      () => window.electronAPI.setPublishState(item.catalogNumber, next),
      items => items.map(row => (row.catalogNumber === item.catalogNumber ? { ...row, published: next } : row))
    )
  }

  const togglePlatform = (item: PublishItem, platform: PublishPlatform) => {
    const next = (item.platforms ?? []).includes(platform)
      ? item.platforms.filter(entry => entry !== platform)
      : [...(item.platforms ?? []), platform]
    return mutate(
      () => window.electronAPI.setPublishPlatforms(item.catalogNumber, next),
      items => items.map(row => (row.catalogNumber === item.catalogNumber ? { ...row, platforms: next } : row))
    )
  }

  /** Closing the page ends the in-memory round; phones get the finished event. */
  const requestClose = async () => {
    if (busy || loading) return
    if (items.length > 0) {
      if (!window.confirm(t('library.closeRoundConfirm'))) return
      setBusy(true)
      setError(null)
      try {
        const result = await window.electronAPI.finishPublishBatch()
        if (result.status !== 'finished') {
          setError(result.error || t('export.failed'))
          return
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        return
      } finally {
        setBusy(false)
      }
      onChanged()
    }
    onClose()
  }

  const items = snapshot?.items ?? []
  const publishedCount = items.filter(item => item.published).length
  const platformCount = items.filter(item => (item.platforms ?? []).length > 0).length

  return (
    <div className="library-modal-overlay" onClick={() => requestClose()}>
      <div className="library-modal publish-modal" onClick={event => event.stopPropagation()}>
        <div className="library-modal-header">
          <h2>{t('library.publishBatchTitle')}</h2>
          <button type="button" onClick={() => requestClose()} aria-label={t('library.close')}>×</button>
        </div>
        <div className="library-modal-body publish-modal-body">
          {error && <div className="library-form-error">{error}</div>}
          {loading ? (
            <div className="publish-modal-empty">{t('library.loading')}</div>
          ) : items.length === 0 ? (
            <div className="publish-modal-empty">{t('library.publishEmpty')}</div>
          ) : (
            <>
              <div className="publish-modal-stats">
                <span>{t('library.publishStats', { total: items.length, published: publishedCount, platforms: platformCount })}</span>
                {snapshot?.publishedAt ? (
                  <span className="publish-modal-time">{new Date(snapshot.publishedAt).toLocaleString()}</span>
                ) : null}
              </div>
              <div className="publish-modal-list">
                {items.map(item => (
                  <article key={item.catalogNumber} className="publish-modal-item">
                    <div className="publish-modal-cover"><LibraryCover record={item} /></div>
                    <div className="publish-modal-item-main">
                      <div className="publish-modal-cat">
                        <span className="publish-modal-catno">{item.catalogNumber}</span>
                        <button
                          type="button"
                          className="publish-copy-btn"
                          disabled={busy}
                          onClick={() => copy(`cat:${item.catalogNumber}`, item.catalogNumber)}
                        >
                          {copiedKey === `cat:${item.catalogNumber}` ? t('library.copied') : t('library.copy')}
                        </button>
                      </div>
                      <details className="publish-modal-details">
                        <summary>{item.details || t('library.noDetails')}</summary>
                        <div className="publish-modal-details-text">{item.details}</div>
                        <button
                          type="button"
                          className="publish-copy-btn"
                          disabled={busy || !item.details}
                          onClick={() => copy(`details:${item.catalogNumber}`, item.details || null)}
                        >
                          {copiedKey === `details:${item.catalogNumber}` ? t('library.copied') : t('library.copyDetails')}
                        </button>
                      </details>
                      <div className="publish-modal-prices">
                        {PRICE_FIELD_KEYS.map(([field, labelKey]) => {
                          const value = item[field]
                          const copyKey = `${field}:${item.catalogNumber}`
                          return (
                            <button
                              key={field}
                              type="button"
                              className="publish-price-cell"
                              disabled={busy || value === null}
                              onClick={() => copy(copyKey, value)}
                            >
                              <span className="publish-price-label">{t(labelKey)}</span>
                              <span className="publish-price-value">{formatPrice(value)}</span>
                              <span className="publish-price-hint">{copiedKey === copyKey ? t('library.copied') : '⧉'}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                    <div className="publish-modal-item-side">
                      <button
                        type="button"
                        className={`library-status-toggle${item.published ? ' on' : ''}`}
                        disabled={busy}
                        onClick={() => togglePublished(item)}
                      >
                        {item.published ? t('library.publishedYes') : t('library.publishedNo')}
                      </button>
                      <div className="library-platforms-cell">
                        {PLATFORM_ORDER.map(platform => {
                          const on = (item.platforms ?? []).includes(platform)
                          return (
                            <button
                              key={platform}
                              type="button"
                              className={`library-platform-toggle${on ? ' on' : ''}`}
                              disabled={busy || !item.published}
                              onClick={() => togglePlatform(item, platform)}
                            >
                              {t(PLATFORM_LABEL_KEYS[platform])}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="library-modal-actions">
          <button type="button" className="primary" onClick={() => requestClose()} disabled={busy || loading}>
            {t('library.finishPublish')}
          </button>
        </div>
      </div>
    </div>
  )
}

interface CDLibraryProps {
  refreshVersion: number
  /** Catalog numbers upserted since the library was last viewed (drive the "new" badges). */
  newCatalogs: Set<string>
  /** Called once when the library page is entered; clears the badge source. */
  onNewCatalogsViewed: () => void
}

export function CDLibrary({ refreshVersion, newCatalogs, onNewCatalogsViewed }: CDLibraryProps) {
  const { t } = useI18n()
  const [records, setRecords] = useState<CDLibraryRecord[]>([])
  // Snapshot of the badge set at mount: stays stable for this visit even after
  // the source set in App is cleared, so badges never flash away mid-render.
  const [viewedNewCatalogs] = useState(() => new Set(newCatalogs))

  useEffect(() => {
    onNewCatalogsViewed()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<PageSize>(20)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [publishStatus, setPublishStatus] = useState<LibraryPublishStatusFilter>('all')
  const [publishPlatform, setPublishPlatform] = useState<PublishPlatform | 'all'>('all')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const activeFilterCount = (publishStatus !== 'all' ? 1 : 0) + (publishPlatform !== 'all' ? 1 : 0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [editing, setEditing] = useState<CDLibraryRecord | null | undefined>(undefined)
  const [publishModalOpen, setPublishModalOpen] = useState(false)
  const headerCheckboxRef = useRef<HTMLInputElement>(null)

  const loadRecords = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI.listLibraryRecords({
        catalogQuery: query,
        page,
        pageSize,
        publishStatus,
        publishPlatform
      })
      setRecords(result.records)
      setTotal(result.total)
      if (result.page !== page) setPage(result.page)
    } catch (err) {
      setNotice({ kind: 'error', text: t('library.storageError', { error: err instanceof Error ? err.message : String(err) }) })
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, query, publishStatus, publishPlatform, t])

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

  const handlePublishStatusFilter = (value: LibraryPublishStatusFilter) => {
    setPublishStatus(value)
    setPage(1)
  }

  const handlePublishPlatformFilter = (value: PublishPlatform | 'all') => {
    setPublishPlatform(value)
    setPage(1)
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
    if (selected.length === 0) {
      setNotice({ kind: 'error', text: t('library.needSelection') })
      return
    }
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

  const handlePublish = async () => {
    if (selected.length === 0) {
      setNotice({ kind: 'error', text: t('library.needSelection') })
      return
    }
    if (!window.confirm(t('library.publishConfirm', { count: selected.length }))) return
    setBusy(true)
    setNotice(null)
    try {
      const result = await window.electronAPI.publishLibraryRecords(selected)
      if (result.status === 'published') {
        // The publish page opens right away, so no success notice is needed;
        // only warn when the phone cannot actually see the round.
        try {
          const lan = await window.electronAPI.getLanStatus()
          if (lan.state !== 'running') {
            setNotice({ kind: 'error', text: t('library.lanOffHint') })
          }
        } catch {
          // LAN status is informational only; ignore lookup failures here.
        }
        await loadRecords()
        setPublishModalOpen(true)
      } else {
        setNotice({ kind: 'error', text: t('library.storageError', { error: result.error || t('export.failed') }) })
      }
    } finally {
      setBusy(false)
    }
  }

  const togglePublishState = async (record: CDLibraryRecord) => {
    if (busy || record.published === undefined) return
    setBusy(true)
    setNotice(null)
    try {
      await window.electronAPI.setPublishState(record.catalogNumber, !record.published)
      await loadRecords()
    } catch (err) {
      setNotice({ kind: 'error', text: t('library.storageError', { error: err instanceof Error ? err.message : String(err) }) })
    } finally {
      setBusy(false)
    }
  }

  const togglePublishPlatform = async (record: CDLibraryRecord, platform: PublishPlatform) => {
    if (busy || record.published !== true) return
    const current = record.platforms ?? []
    const next = current.includes(platform)
      ? current.filter(item => item !== platform)
      : [...current, platform]
    setBusy(true)
    setNotice(null)
    try {
      await window.electronAPI.setPublishPlatforms(record.catalogNumber, next)
      await loadRecords()
    } catch (err) {
      setNotice({ kind: 'error', text: t('library.storageError', { error: err instanceof Error ? err.message : String(err) }) })
    } finally {
      setBusy(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <section className="library-panel">
      <div className="library-toolbar-block">
        <div className="library-toolbar">
          <input
            className="library-search"
            value={query}
            onChange={event => handleQueryChange(event.target.value)}
            placeholder={t('library.searchPlaceholder')}
          />
          <button
            type="button"
            className={`library-filter-toggle${filtersOpen ? ' active' : ''}`}
            onClick={() => setFiltersOpen(value => !value)}
          >
            {t('library.filter')}{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ''}
          </button>
          <div className="library-toolbar-actions">
            {selected.length > 0 && <span className="library-selected-count">{t('library.selected', { count: selected.length })}</span>}
            <button onClick={() => setEditing(null)} disabled={busy}>{t('library.add')}</button>
            <button onClick={handleImport} disabled={busy}>{busy ? t('library.importing') : t('library.import')}</button>
            <button onClick={handleExport} disabled={busy}>{t('library.exportSelected')}</button>
            <button onClick={handlePublish} disabled={busy}>{t('library.publishSelected')}</button>
            <button className="danger" onClick={() => deleteRecords(selected)} disabled={busy || selected.length === 0}>{t('library.deleteSelected')}</button>
          </div>
        </div>
        {filtersOpen && (
          <div className="library-filter-panel">
            <select
              className="library-filter"
              value={publishStatus}
              onChange={event => handlePublishStatusFilter(event.target.value as LibraryPublishStatusFilter)}
            >
              <option value="all">{t('library.publishStateColumn')} · {t('library.filterAll')}</option>
              <option value="unpublished">{t('library.publishStateColumn')} · {t('library.publishedNo')}</option>
              <option value="published">{t('library.publishStateColumn')} · {t('library.publishedYes')}</option>
            </select>
            <select
              className="library-filter"
              value={publishPlatform}
              onChange={event => handlePublishPlatformFilter(event.target.value as PublishPlatform | 'all')}
            >
              <option value="all">{t('library.publishPlatformColumn')} · {t('library.filterAll')}</option>
              <option value="taobao">{t('library.publishPlatformColumn')} · {t('library.platformTaobao')}</option>
              <option value="xianyu">{t('library.publishPlatformColumn')} · {t('library.platformXianyu')}</option>
              <option value="discogs">{t('library.publishPlatformColumn')} · {t('library.platformDiscogs')}</option>
            </select>
            <button
              type="button"
              className="library-filter-reset"
              onClick={() => { setPublishStatus('all'); setPublishPlatform('all'); setPage(1) }}
              disabled={activeFilterCount === 0}
            >
              {t('library.resetFilter')}
            </button>
          </div>
        )}
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
              <col className="library-col-publish-state" />
              <col className="library-col-publish-platforms" />
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
                <th className="library-publish-header">{t('library.publishStateColumn')}</th>
                <th className="library-publish-header">{t('library.publishPlatformColumn')}</th>
                <th className="library-actions-header">{t('library.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {records.map(record => (
                <tr key={record.catalogNumber} className={selectedSet.has(record.catalogNumber) ? 'selected' : ''}>
                  <td className="library-check-cell"><input type="checkbox" checked={selectedSet.has(record.catalogNumber)} onChange={() => toggleRecord(record.catalogNumber)} /></td>
                  <td className="library-catalog-cell">
                    {viewedNewCatalogs.has(record.catalogNumber) && (
                      <span className="library-new-badge">{t('library.newBadge')}</span>
                    )}
                    {record.catalogNumber}
                  </td>
                  <td className="library-image-cell"><LibraryCover record={record} /></td>
                  <td><div className="library-details-preview">{record.details || '—'}</div></td>
                  <td className="library-price-cell">{formatPrice(record.lowestPriceUsd)}</td>
                  <td className="library-price-cell">{formatPrice(record.highestPriceUsd)}</td>
                  <td className="library-price-cell">{formatPrice(record.lowestPriceCny)}</td>
                  <td className="library-price-cell">{formatPrice(record.highestPriceCny)}</td>
                  <td className="library-publish-cell">
                    <PublishStatusCell record={record} busy={busy} onToggle={togglePublishState} />
                  </td>
                  <td className="library-publish-cell">
                    <PublishPlatformsCell record={record} busy={busy} onTogglePlatform={togglePublishPlatform} />
                  </td>
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
      {publishModalOpen && (
        <PublishModal
          onClose={() => setPublishModalOpen(false)}
          onChanged={() => { void loadRecords() }}
        />
      )}
    </section>
  )
}
