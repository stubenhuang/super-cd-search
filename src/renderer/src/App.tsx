import { useState, useCallback, useEffect } from 'react'
import type { BatchQueryResult, BatchQueryProgress } from './electron-api'
import { SettingsPanel } from './Settings'
import './App.css'

function App() {
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [results, setResults] = useState<BatchQueryResult[]>([])
  const [progress, setProgress] = useState<BatchQueryProgress[]>([])
  const [showSettings, setShowSettings] = useState(false)

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
            <h2>Results</h2>
          </div>
          <div className="panel-content">
            {results.length === 0 && progress.length === 0 && (
              <p className="placeholder-text">
                Search results will appear here.
              </p>
            )}
            {progress.length > 0 && results.length === 0 && (
              <div className="progress-area">
                <p>Querying...</p>
              </div>
            )}
            {results.length > 0 && (
              <div className="results-area">
                {results.map((result, idx) => (
                  <div key={idx} className="result-card">
                    <div className="result-catalog">{result.catalogNumber}</div>
                    {result.results.map((r, rIdx) => (
                      <div key={rIdx} className="platform-result">
                        <span className="platform-name">{r.platform}</span>
                        <span className={`status status-${r.status}`}>{r.status}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>
      <SettingsPanel isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  )
}

export default App
