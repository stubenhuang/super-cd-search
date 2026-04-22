import { useState, useCallback, useEffect, useMemo } from 'react'
import type { BatchQueryResult, BatchQueryProgress, QueryResult } from './electron-api'
import { SettingsPanel } from './Settings'
import { HistoryView } from './History'
import './App.css'

const PLATFORM_LABELS: Record<string, string> = {
  discogs: 'Discogs',
  ebay: 'eBay',
  kojima: 'Kojima Rokuon',
  mercari: 'Mercari'
}

function PlatformResultRow({ result, isLowestPrice }: { result: QueryResult; isLowestPrice: boolean }) {
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageError, setImageError] = useState(false)

  const formatPrice = (min: number | null, max: number | null): string => {
    if (min === null && max === null) return '-'
    if (min === null || max === null) {
      const price = min ?? max
      return price !== null ? `¥${price.toLocaleString()}` : '-'
    }
    if (min === max) return `¥${min.toLocaleString()}`
    return `¥${min.toLocaleString()} - ¥${max.toLocaleString()}`
  }

  return (
    <div className={`platform-result-row ${result.status}`}>
      <div className="platform-info">
        <span className="platform-icon">
          {result.platform === 'discogs' && '唱片'}
          {result.platform === 'ebay' && 'EB'}
          {result.platform === 'kojima' && '小島'}
          {result.platform === 'mercari' && 'メ'}
        </span>
        <span className="platform-label">{PLATFORM_LABELS[result.platform] || result.platform}</span>
      </div>
      <div className="platform-image">
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
          <div className="image-placeholder">No image</div>
        )}
      </div>
      <div className="platform-details">
        {result.status === 'found' ? (
          <>
            <div className="name">{result.name || '-'}</div>
            <div className="artist">{result.artist || '-'}</div>
            <div className={`price ${isLowestPrice ? 'lowest-price' : ''}`}>
              {formatPrice(result.priceMin, result.priceMax)}
              {isLowestPrice && <span className="lowest-badge">Best</span>}
            </div>
          </>
        ) : result.status === 'error' ? (
          <div className="error-container">
            <span className="error-badge">Error</span>
            <span className="error-tooltip" title={result.error || 'Unknown error'}>⚠</span>
          </div>
        ) : (
          <div className="not-found-container">
            <span className="not-found-badge">Not Found</span>
          </div>
        )}
      </div>
      <div className="platform-link">
        {result.link && result.status === 'found' && (
          <a href={result.link} target="_blank" rel="noopener noreferrer">
            View
          </a>
        )}
      </div>
    </div>
  )
}

function ResultCard({ catalogNumber, results }: BatchQueryResult) {
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
        <div className="result-catalog">{catalogNumber}</div>
        {displayArtist && <div className="result-artist">{displayArtist}</div>}
      </div>
      <div className="result-title">{displayName}</div>
      <div className="platform-results">
        {results.map((r, idx) => (
          <PlatformResultRow
            key={idx}
            result={r}
            isLowestPrice={r.status === 'found' && r.priceMin !== null && r.priceMin === lowestPrice}
          />
        ))}
      </div>
    </div>
  )
}

function App() {
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [results, setResults] = useState<BatchQueryResult[]>([])
  const [progress, setProgress] = useState<BatchQueryProgress[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const [activeTab, setActiveTab] = useState<'results' | 'history'>('results')

  const parseCatalogNumbers = useCallback((input: string): string[] => {
    const lines = input.split(/[\n,]+/).map(s => s.trim()).filter(s => s.length > 0)
    return lines
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

    try {
      const batchResults = await window.electronAPI.executeBatchQuery(catalogNumbers)
      setResults(batchResults)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Query failed')
    } finally {
      setIsLoading(false)
    }
  }, [input, parseCatalogNumbers])

  useEffect(() => {
    const handleProgress = (...args: unknown[]) => {
      const data = args[0] as BatchQueryProgress
      setProgress(prev => [...prev, data])
    }

    window.electronAPI.receive('query:progress', handleProgress)
  }, [])

  const completedCount = progress.filter(p => p.event === 'query:complete').length
  const totalCount = parseCatalogNumbers(input).length || 0
  const progressText = totalCount > 0 ? `${completedCount}/${totalCount} CDs queried` : ''

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
              disabled={isLoading}
              rows={10}
            />
            {error && <div className="error-message">{error}</div>}
            <button
              className="search-button"
              onClick={handleSearch}
              disabled={isLoading}
            >
              {isLoading ? 'Searching...' : 'Search'}
            </button>
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
            {activeTab === 'results' && progressText && (
              <span className="progress-text">{progressText}</span>
            )}
          </div>
          <div className="panel-content">
            {activeTab === 'results' && (
              <>
                {results.length === 0 && progress.length === 0 && (
                  <p className="placeholder-text">
                    Search results will appear here.
                  </p>
                )}
                {progress.length > 0 && results.length === 0 && (
                  <div className="progress-area">
                    <div className="spinner" />
                    <p>Querying...</p>
                  </div>
                )}
                {results.length > 0 && (
                  <div className="results-area">
                    {results.map((result, idx) => (
                      <ResultCard key={idx} {...result} />
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
    </div>
  )
}

export default App
