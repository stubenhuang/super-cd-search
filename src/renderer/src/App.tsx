import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import type { BatchQueryProgressEvent, QueryResult, Platform, Settings, DisplayCurrency } from './electron-api'
import { SettingsPanel } from './Settings'
import { DetailModal } from './DetailModal'
import { normalizeCatalogNumber } from '../../shared/utils'
import { PLATFORM_LABELS, DEFAULT_STANDARD_PLATFORMS, DEFAULT_DEEP_PLATFORMS } from '../../shared/platforms'
import { QueryEvents } from '../../shared/events'
import { useCoverImage } from './hooks/useCoverImage'
import './App.css'

type SearchMode = 'standard' | 'deep'

const SEARCH_MODE_LABELS: Record<SearchMode, string> = {
  standard: '标准搜索（Discogs + eBay）',
  deep: '深度搜索（全部平台）'
}

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
  displayCurrency: DisplayCurrency
  usdToCnyRate: number | null
}

const PlatformResultRow = React.memo(function PlatformResultRow({ result, isLowestPrice, displayCurrency, usdToCnyRate }: PlatformResultRowProps) {
  const {
    containerRef: imageContainerRef,
    imageData,
    error: imageError,
    loaded: imageLoaded,
    onLoad,
    onError
  } = useCoverImage(result.coverUrl, { size: 160, lazy: true })

  const formatPrice = (min: number | null, max: number | null): string => {
    if (min === null && max === null) return '-'

    const formatSingle = (usd: number): string => {
      if (displayCurrency === 'CNY' && usdToCnyRate !== null) {
        return `¥${(usd * usdToCnyRate).toFixed(2)}`
      }
      return `$${usd.toFixed(2)}`
    }

    if (min === null || max === null) {
      const price = min ?? max
      return price !== null ? formatSingle(price) : '-'
    }
    if (min === max) return formatSingle(min)
    return `${formatSingle(min)} - ${formatSingle(max)}`
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
          <div className="platform-card-image" ref={imageContainerRef}>
            {result.coverUrl && !imageError ? (
              <>
                {!imageLoaded && <div className="image-placeholder" />}
                <img
                  src={imageData || ''}
                  alt={result.name || 'Cover'}
                  className={`cover-thumbnail ${imageLoaded ? 'loaded' : ''}`}
                  onLoad={onLoad}
                  onError={onError}
                  style={{ display: imageData ? 'block' : 'none' }}
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
            ) : result.status === 'challenge' ? (
              <>
                <div className="status-text">待验证</div>
                <div className="error-hint" title={result.error || 'Cloudflare 验证未完成'}>⚠ {result.error || '请在设置中完成 Cloudflare 验证'}</div>
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
  onTitleClick: (catalogNumber: string) => void
  displayCurrency: DisplayCurrency
  usdToCnyRate: number | null
}

const ResultCard = React.memo(function ResultCard({ catalogNumber, results, onTitleClick, displayCurrency, usdToCnyRate }: ResultCardProps) {
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
        <span
          className="result-title"
          onClick={() => onTitleClick(catalogNumber)}
          title="点击查看详细信息"
        >
          {displayName}
        </span>
        {displayArtist && <span className="result-artist">— {displayArtist}</span>}
      </div>
      <div className="platform-results">
        {results.map(r => (
          <PlatformResultRow
            key={r.platform}
            result={r}
            isLowestPrice={r.status === 'found' && r.priceMin !== null && r.priceMin === lowestPrice}
            displayCurrency={displayCurrency}
            usdToCnyRate={usdToCnyRate}
          />
        ))}
      </div>
    </div>
  )
})

// Play completion sound using Web Audio API
function playCompletionSound(): void {
  try {
    const audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()

    // Create a pleasant completion chime
    const playTone = (frequency: number, startTime: number, duration: number, volume: number = 0.3) => {
      const oscillator = audioContext.createOscillator()
      const gainNode = audioContext.createGain()

      oscillator.connect(gainNode)
      gainNode.connect(audioContext.destination)

      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(frequency, startTime)

      gainNode.gain.setValueAtTime(0, startTime)
      gainNode.gain.linearRampToValueAtTime(volume, startTime + 0.01)
      gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration)

      oscillator.start(startTime)
      oscillator.stop(startTime + duration)
    }

    const now = audioContext.currentTime
    // Play a pleasant two-tone chime
    playTone(523.25, now, 0.15, 0.2)        // C5
    playTone(659.25, now + 0.15, 0.2, 0.25) // E5
    playTone(783.99, now + 0.35, 0.25, 0.3) // G5

  } catch {
    // Audio context may not be available in some environments
  }
}

function App() {
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [results, setResults] = useState<Map<string, QueryResult[]>>(new Map())
  const [catalogOrder, setCatalogOrder] = useState<string[]>([])
  const [progressStatus, setProgressStatus] = useState<Map<string, string>>(new Map())
  const [completedCatalogs, setCompletedCatalogs] = useState<Set<string>>(new Set())
  const [showSettings, setShowSettings] = useState(false)
  const cancelledRef = useRef(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [searchMode, setSearchMode] = useState<SearchMode>('standard')
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [selectedCatalog, setSelectedCatalog] = useState<string | null>(null)
  const prevIsLoadingRef = useRef(false)
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>('USD')
  const [usdToCnyRate, setUsdToCnyRate] = useState<number | null>(null)

  // Platforms queried by the currently running search. Resolved from the
  // latest settings each time a search starts (see handleSearch).
  const [activePlatforms, setActivePlatforms] = useState<Platform[]>(DEFAULT_STANDARD_PLATFORMS)

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

    // Resolve the platform list for this search mode from the latest settings,
    // so changes made in the settings panel apply on the next search.
    let settings: Settings | undefined
    try {
      settings = await window.electronAPI.getSettings()
    } catch {
      settings = undefined
    }
    const standardPlatforms = settings?.standardPlatforms ?? DEFAULT_STANDARD_PLATFORMS
    const deepPlatforms = settings?.deepPlatforms ?? DEFAULT_DEEP_PLATFORMS
    const platforms = searchMode === 'standard' ? standardPlatforms : deepPlatforms

    if (platforms.length === 0) {
      setError('当前搜索模式没有选择任何数据源，请在设置中配置')
      return
    }

    setError(null)
    setIsLoading(true)
    setProgressStatus(new Map())
    setCompletedCatalogs(new Set())
    setResults(new Map())
    setCatalogOrder(catalogNumbers)
    setIsCancelling(false)
    cancelledRef.current = false
    setActivePlatforms(platforms)

    try {
      const batchResults = await window.electronAPI.executeBatchQuery(catalogNumbers, platforms)
      setResults(prev => {
        const merged = new Map(prev)
        for (const batch of batchResults) {
          const existing = merged.get(batch.catalogNumber) || []
          merged.set(batch.catalogNumber, mergePlatformResults(existing, batch.results))
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
  }, [input, parseCatalogNumbers, searchMode])

  const handleCancel = useCallback(async () => {
    cancelledRef.current = true
    setIsCancelling(true)
    await window.electronAPI.cancelBatchQuery()
  }, [])

  useEffect(() => {
    const handleProgress = (...args: unknown[]) => {
      const data = args[0] as BatchQueryProgressEvent

      if (data.event === QueryEvents.RESULT && data.results) {
        const incomingResults = data.results
        setResults(prev => {
          const newMap = new Map(prev)
          const existing = newMap.get(data.catalogNumber) || []
          newMap.set(data.catalogNumber, mergePlatformResults(existing, incomingResults))
          return newMap
        })
      }

      if (data.event === QueryEvents.COMPLETE) {
        setCompletedCatalogs(prev => {
          const next = new Set(prev)
          next.add(data.catalogNumber)
          return next
        })
      } else if (data.event !== QueryEvents.START && data.platform !== 'all') {
        setProgressStatus(prev => {
          const next = new Map(prev)
          next.set(`${data.catalogNumber}:${data.platform}`, data.status)
          return next
        })
      }

      if (data.event === QueryEvents.BATCH_CANCELLED) {
        setIsCancelling(false)
        setIsLoading(false)
      }
    }

    window.electronAPI.receive('query:progress', handleProgress)
  }, [])

  // Play completion sound when search finishes
  useEffect(() => {
    if (prevIsLoadingRef.current && !isLoading && !cancelledRef.current && results.size > 0) {
      playCompletionSound()
    }
    prevIsLoadingRef.current = isLoading
  }, [isLoading, results.size])

  const completedCount = completedCatalogs.size
  const hasProgress = completedCatalogs.size > 0 || progressStatus.size > 0
  const catalogNumbers = useMemo(() => parseCatalogNumbers(input), [input, parseCatalogNumbers])
  // Use catalogOrder for progress calculation to keep progress at 100% after completion
  const totalCount = catalogOrder.length || catalogNumbers.length || 0
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  const progressByCatalog = useMemo(() => {
    const map = new Map<string, Map<string, string>>()
    for (const [key, status] of progressStatus) {
      const separator = key.indexOf(':')
      if (separator <= 0) continue
      const catalogNumber = key.slice(0, separator)
      const platform = key.slice(separator + 1)
      if (!activePlatforms.includes(platform as Platform)) continue
      if (!map.has(catalogNumber)) {
        map.set(catalogNumber, new Map())
      }
      map.get(catalogNumber)!.set(platform, status)
    }
    return map
  }, [progressStatus, activePlatforms])

  const handleTitleClick = useCallback((catalogNumber: string) => {
    setSelectedCatalog(catalogNumber)
    setShowDetailModal(true)
  }, [])

  const handleCurrencyChange = useCallback((currency: DisplayCurrency) => {
    setDisplayCurrency(currency)
    void window.electronAPI.setSetting('displayCurrency', currency).catch(() => {})
  }, [])

  // Load the saved display currency and pre-fetch the USD -> CNY rate once, so
  // toggling between currencies is instant afterwards.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const saved = await window.electronAPI.getSetting('displayCurrency')
      if (!cancelled) setDisplayCurrency(saved === 'CNY' ? 'CNY' : 'USD')
      const rate = await window.electronAPI.getUsdToDisplayRate('CNY')
      if (!cancelled) setUsdToCnyRate(rate)
    })().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Super CD Search</h1>
        <div className="app-header-actions">
          <div className="currency-toggle" role="group" aria-label="Currency">
            <button
              type="button"
              className={displayCurrency === 'USD' ? 'active' : ''}
              onClick={() => handleCurrencyChange('USD')}
              title="美元"
            >
              USD
            </button>
            <button
              type="button"
              className={displayCurrency === 'CNY' ? 'active' : ''}
              onClick={() => handleCurrencyChange('CNY')}
              title="人民币"
            >
              CNY
            </button>
          </div>
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
        </div>
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
            <div className="search-mode-selector">
              <label className="search-mode-label" htmlFor="search-mode">搜索模式</label>
              <div className="search-mode-field">
                <select
                  id="search-mode"
                  className="search-mode-select"
                  value={searchMode}
                  onChange={e => setSearchMode(e.target.value as SearchMode)}
                  disabled={isLoading || isCancelling}
                >
                  <option value="standard">{SEARCH_MODE_LABELS.standard}</option>
                  <option value="deep">{SEARCH_MODE_LABELS.deep}</option>
                </select>
                <svg className="search-mode-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>
              {searchMode === 'deep' && (
                <span className="search-mode-warning" role="img" aria-label="深度搜索速度较慢">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <span className="search-mode-warning-tooltip">深度搜索会查询全部平台（7 个数据源），速度较慢</span>
                </span>
              )}
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
            {(isLoading || hasProgress) && (
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
                    const isComplete = platforms?.size === activePlatforms.length &&
                      activePlatforms.every(p => {
                        const s = platforms?.get(p)
                        return s === 'complete' || s === 'not_found' || s === 'error' || s === 'challenge'
                      })
                    return (
                      <div key={cn} className={`progress-catalog-item ${isComplete ? 'complete' : ''}`}>
                        <span className="progress-catalog-name">{cn}</span>
                        <div className="progress-platforms">
                          {activePlatforms.map(p => {
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
                                  {status === 'challenge' && '⚠'}
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
            <h2>Results</h2>
          </div>
          <div className="panel-content">
            {results.size === 0 && !hasProgress && (
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
            {!isCancelling && hasProgress && results.size === 0 && (
              <div className="progress-area">
                <div className="spinner" />
                <p>Querying...</p>
              </div>
            )}
            {results.size > 0 && (
              <div className="results-area">
                {catalogOrder.map((catalogNumber) => {
                  const resultData = results.get(catalogNumber)
                  if (!resultData) return null
                  return (
                    <ResultCard
                      key={catalogNumber}
                      catalogNumber={catalogNumber}
                      results={resultData}
                      onTitleClick={handleTitleClick}
                      displayCurrency={displayCurrency}
                      usdToCnyRate={usdToCnyRate}
                    />
                  )
                })}
              </div>
            )}
          </div>
        </section>
      </main>
      <SettingsPanel isOpen={showSettings} onClose={() => setShowSettings(false)} />
      {showDetailModal && selectedCatalog && (
        <DetailModal
          isOpen={showDetailModal}
          onClose={() => setShowDetailModal(false)}
          catalogNumber={selectedCatalog}
          results={results.get(selectedCatalog) || []}
        />
      )}
    </div>
  )
}

export default App
