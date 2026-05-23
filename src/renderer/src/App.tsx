import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import type { BatchQueryResult, BatchQueryProgressEvent, QueryResult, Platform } from './electron-api'
import { SettingsPanel } from './Settings'
import { HistoryView } from './History'
import { normalizeCatalogNumber } from '../../shared/utils'
import { QueryEvents } from '../../shared/events'
import './App.css'

const PLATFORM_LABELS: Record<Platform, string> = {
  discogs: 'Discogs',
  ebay: 'eBay',
  kojima: 'Kojima Rokuon',
  hmv: 'HMV Japan'
}

const PLATFORMS: Platform[] = ['discogs', 'ebay', 'kojima', 'hmv']

const DEFAULT_ENABLED_PLATFORMS: Platform[] = ['discogs', 'ebay', 'hmv']

function mergePlatformResults(existing: QueryResult[], incoming: QueryResult[]): QueryResult[] {
  const merged = [...existing]
  for (const newResult of incoming) {
    const idx = merged.findIndex(r => r.platform === newResult.platform)
    if (idx >= 0) {
      merged[idx] = newResult
    } else {
      merged.push(newResult)
    }
  }
  return merged
}

interface PlatformResultRowProps {
  result: QueryResult
  isLowestPrice: boolean
}

const PlatformResultRow = React.memo(function PlatformResultRow({ result, isLowestPrice }: PlatformResultRowProps) {
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageError, setImageError] = useState(false)

  const formatPrice = (min: number | null, max: number | null): string => {
    if (min === null && max === null) return '-'
    if (min === null || max === null) {
      const price = min ?? max
      return price !== null ? `$${price.toFixed(2)}` : '-'
    }
    if (min === max) return `$${min.toFixed(2)}`
    return `$${min.toFixed(2)} - $${max.toFixed(2)}`
  }

  const getPriceLabel = (min: number | null, max: number | null): string => {
    if (min === null && max === null) return ''
    if (min === null || max === null) return '固定价格'
    if (min === max) return '固定价格'
    return '价格范围'
  }

  const handleViewClick = (e: React.MouseEvent<HTMLAnchorElement>, url: string) => {
    e.preventDefault()
    window.electronAPI.openExternal(url).catch(err => console.error('openExternal error:', err))
  }

  const cardClass = `platform-card ${result.status}${isLowestPrice ? ' lowest' : ''}`

  return (
    <div className={cardClass} data-platform={result.platform}>
      {isLowestPrice ? (
        <div className="lowest-bar">★ 最低价</div>
      ) : (
        <div className="brand-bar" />
      )}
      <div className="platform-card-content">
        <div className="platform-card-name">{PLATFORM_LABELS[result.platform] || result.platform}</div>
        <div className="platform-card-body">
          <div className="platform-card-image">
            {result.coverUrl && !imageError ? (
              <>
                {!imageLoaded && <div className="image-placeholder" />}
                <img
                  src={result.coverUrl}
                  alt={result.name || 'Cover'}
                  className={`cover-thumbnail ${imageLoaded ? 'loaded' : ''}`}
                  onLoad={() => setImageLoaded(true)}
                  onError={() => setImageError(true)}
                />
              </>
            ) : (
              <div className="image-placeholder">无图</div>
            )}
          </div>
          <div className="platform-card-details">
            {result.status === 'found' ? (
              <>
                <div className="price">{formatPrice(result.priceMin, result.priceMax)}</div>
                <div className="price-label">{getPriceLabel(result.priceMin, result.priceMax)}</div>
                {result.link && (
                  <a className="link" href={result.link} onClick={(e) => handleViewClick(e, result.link!)}>
                    查看详情 →
                  </a>
                )}
              </>
            ) : result.status === 'error' ? (
              <>
                <div className="status-text">请求错误</div>
                <div className="error-hint" title={result.error || 'Unknown error'}>⚠ {result.error || 'Error'}</div>
              </>
            ) : (
              <div className="status-text">未找到</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
})

interface ResultCardProps {
  catalogNumber: string
  results: QueryResult[]
}

const ResultCard = React.memo(function ResultCard({ catalogNumber, results }: ResultCardProps) {
  const foundResult = results.find(r => r.status === 'found' && r.name)
  const displayName = foundResult?.name || catalogNumber
  const displayArtist = foundResult?.artist

  const lowestPrice = useMemo(() => {
    const prices = results
      .filter(r => r.status === 'found' && r.priceMin !== null)
      .map(r => r.priceMin as number)
    return prices.length > 0 ? Math.min(...prices) : null
  }, [results])

  return (
    <div className="result-card">
      <div className="result-header">
        <span className="result-catalog">{catalogNumber}</span>
        <span className="result-title">{displayName}</span>
        {displayArtist && <span className="result-artist">— {displayArtist}</span>}
      </div>
      <div className="platform-results">
        {results.map(r => (
          <PlatformResultRow
            key={r.platform}
            result={r}
            isLowestPrice={r.status === 'found' && r.priceMin !== null && r.priceMin === lowestPrice}
          />
        ))}
      </div>
    </div>
  )
})

function App() {
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [results, setResults] = useState<BatchQueryResult[]>([])
  const [progress, setProgress] = useState<BatchQueryProgressEvent[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const [activeTab, setActiveTab] = useState<'results' | 'history'>('results')
  const [toast, setToast] = useState<string | null>(null)
  const cancelledRef = useRef(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [kojimaEnabled, setKojimaEnabled] = useState(false)

  const enabledPlatforms = useMemo(() => {
    return kojimaEnabled ? PLATFORMS : DEFAULT_ENABLED_PLATFORMS
  }, [kojimaEnabled])

  const parseCatalogNumbers = useCallback((input: string): string[] => {
    const lines = input.split(/[\n,]+/).map(s => s.trim()).filter(s => s.length > 0)
    return lines.map(normalizeCatalogNumber)
  }, [])

  const handleSearch = useCallback(async () => {
    const catalogNumbers = parseCatalogNumbers(input)

    if (catalogNumbers.length === 0) {
      setError('Please enter at least one catalog number')
      return
    }

    if (catalogNumbers.length > 10) {
      setError('Maximum 10 catalog numbers allowed')
      return
    }

    setError(null)
    setIsLoading(true)
    setProgress([])
    setResults([])
    setIsCancelling(false)
    cancelledRef.current = false

    try {
      const batchResults = await window.electronAPI.executeBatchQuery(catalogNumbers, kojimaEnabled)
      setResults(prev => {
        const merged = [...prev]
        for (const batch of batchResults) {
          const existingIdx = merged.findIndex(r => r.catalogNumber === batch.catalogNumber)
          if (existingIdx >= 0) {
            merged[existingIdx] = {
              ...merged[existingIdx],
              results: mergePlatformResults(merged[existingIdx].results, batch.results)
            }
          } else {
            merged.push(batch)
          }
        }
        return merged
      })
    } catch (err) {
      if (!cancelledRef.current) {
        setError(err instanceof Error ? err.message : 'Query failed')
      }
    } finally {
      setIsLoading(false)
      setIsCancelling(false)
    }
  }, [input, parseCatalogNumbers, kojimaEnabled])

  const handleCancel = useCallback(async () => {
    cancelledRef.current = true
    setIsCancelling(true)
    await window.electronAPI.cancelBatchQuery()
  }, [])

  useEffect(() => {
    const handleProgress = (...args: unknown[]) => {
      const data = args[0] as BatchQueryProgressEvent
      setProgress(prev => [...prev, data])

      if (data.event === QueryEvents.RESULT && data.results) {
        const incomingResults = data.results
        setResults(prev => {
          const existingIdx = prev.findIndex(r => r.catalogNumber === data.catalogNumber)
          if (existingIdx >= 0) {
            const merged = [...prev]
            merged[existingIdx] = {
              ...merged[existingIdx],
              results: mergePlatformResults(merged[existingIdx].results, incomingResults)
            }
            return merged
          }
          return [...prev, { catalogNumber: data.catalogNumber, results: incomingResults }]
        })
      }

      if (data.event === QueryEvents.BATCH_CANCELLED) {
        setIsCancelling(false)
        setIsLoading(false)
      }
    }

    window.electronAPI.receive('query:progress', handleProgress)
  }, [])

  const completedCount = progress.filter(p => p.event === QueryEvents.COMPLETE).length
  const catalogNumbers = useMemo(() => parseCatalogNumbers(input), [input, parseCatalogNumbers])
  const totalCount = catalogNumbers.length || 0
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  const progressByCatalog = useMemo(() => {
    const map = new Map<string, Map<string, string>>()
    for (const p of progress) {
      if (!(enabledPlatforms as readonly string[]).includes(p.platform)) continue
      if (!map.has(p.catalogNumber)) {
        map.set(p.catalogNumber, new Map())
      }
      map.get(p.catalogNumber)!.set(p.platform, p.status)
    }
    return map
  }, [progress, enabledPlatforms])

  const handleLoadHistory = useCallback(async (queryId: number) => {
    const entry = await window.electronAPI.getHistoryEntry(queryId)
    if (entry) {
      setResults([{
        catalogNumber: entry.query.catalogNumber,
        results: entry.results
      }])
      setActiveTab('results')
    }
  }, [])

  const handleExport = useCallback(async () => {
    if (results.length === 0) return
    try {
      const filePath = await window.electronAPI.exportToExcel(results)
      if (filePath) {
        setToast(`Exported to ${filePath}`)
        setTimeout(() => setToast(null), 4000)
      }
    } catch (err) {
      setToast('Export failed')
      setTimeout(() => setToast(null), 4000)
    }
  }, [results])

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Super CD Search</h1>
        <button
          className="settings-button"
          onClick={() => setShowSettings(true)}
          title="Settings"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      </header>
      <main className="app-main">
        <aside className="left-panel">
          <div className="panel-header">
            <h2>Input</h2>
          </div>
          <div className="panel-content">
            <textarea
              className="catalog-input"
              placeholder="Enter catalog numbers (one per line or comma-separated)&#10;&#10;Example:&#10;TOCP-53001&#10;BVCP-21002&#10;SRCL-3101"
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={isLoading || isCancelling}
              rows={10}
            />
            {error && <div className="error-message">{error}</div>}
            <div className="kojima-toggle">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={kojimaEnabled}
                  onChange={e => setKojimaEnabled(e.target.checked)}
                  disabled={isLoading || isCancelling}
                />
                <span>包含 Kojima Rokuon</span>
                <span className="checkbox-hint">（其他渠道无结果时再勾选）</span>
              </label>
            </div>
            <div className="search-actions">
              <button
                className="search-button"
                onClick={handleSearch}
                disabled={isLoading || isCancelling}
              >
                {isCancelling ? 'Cancelling...' : isLoading ? 'Searching...' : 'Search'}
              </button>
              {isLoading && (
                <button
                  className="cancel-button-icon"
                  onClick={handleCancel}
                  disabled={isCancelling}
                  title="Cancel"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              )}
            </div>
            {(isLoading || progress.length > 0) && (
              <div className="run-progress">
                <div className="progress-summary">
                  <span className="progress-label">{completedCount}/{totalCount} 完成</span>
                  <span className="progress-percent">{progressPercent}%</span>
                </div>
                <div className="progress-bar-track">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <div className="progress-catalogs">
                  {catalogNumbers.map(cn => {
                    const platforms = progressByCatalog.get(cn)
                    const isComplete = platforms?.size === enabledPlatforms.length &&
                      enabledPlatforms.every(p => {
                        const s = platforms?.get(p)
                        return s === 'complete' || s === 'not_found' || s === 'error'
                      })
                    return (
                      <div key={cn} className={`progress-catalog-item ${isComplete ? 'complete' : ''}`}>
                        <span className="progress-catalog-name">{cn}</span>
                        <div className="progress-platforms">
                          {enabledPlatforms.map(p => {
                            const status = platforms?.get(p)
                            return (
                              <span
                                key={p}
                                className={`progress-platform-status ${status || 'pending'}`}
                              >
                                <span className="platform-status-icon">
                                  {status === 'loading' && '⏳'}
                                  {status === 'complete' && '✓'}
                                  {status === 'not_found' && '−'}
                                  {status === 'error' && '✗'}
                                  {!status && '○'}
                                </span>
                                <span className="platform-status-label">{PLATFORM_LABELS[p]}</span>
                              </span>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </aside>
        <section className="right-panel">
          <div className="panel-header">
            <div className="tabs">
              <button
                className={`tab ${activeTab === 'results' ? 'active' : ''}`}
                onClick={() => setActiveTab('results')}
              >
                Results
              </button>
              <button
                className={`tab ${activeTab === 'history' ? 'active' : ''}`}
                onClick={() => setActiveTab('history')}
              >
                History
              </button>
            </div>
            <div className="panel-actions">
              {activeTab === 'results' && results.length > 0 && (
                <button className="export-button" onClick={handleExport}>
                  Export to Excel
                </button>
              )}
            </div>
          </div>
          <div className="panel-content">
            {activeTab === 'results' && (
              <>
                {results.length === 0 && progress.length === 0 && (
                  <p className="placeholder-text">
                    Search results will appear here.
                  </p>
                )}
                {isCancelling && (
                  <div className="progress-area cancelling">
                    <div className="spinner" />
                    <p>正在取消...</p>
                  </div>
                )}
                {!isCancelling && progress.length > 0 && results.length === 0 && (
                  <div className="progress-area">
                    <div className="spinner" />
                    <p>Querying...</p>
                  </div>
                )}
                {results.length > 0 && (
                  <div className="results-area">
                    {results.map((result) => (
                      <ResultCard key={result.catalogNumber} {...result} />
                    ))}
                  </div>
                )}
              </>
            )}
            {activeTab === 'history' && (
              <HistoryView onLoadEntry={handleLoadHistory} />
            )}
          </div>
        </section>
      </main>
      <SettingsPanel isOpen={showSettings} onClose={() => setShowSettings(false)} />
      {toast && <div className="app-toast">{toast}</div>}
    </div>
  )
}

export default App
