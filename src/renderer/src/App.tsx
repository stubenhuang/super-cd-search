import { useState, useCallback, useEffect } from 'react'
import type { BatchQueryResult, BatchQueryProgress } from './electron-api'
import './App.css'

function App() {
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [results, setResults] = useState<BatchQueryResult[]>([])
  const [progress, setProgress] = useState<BatchQueryProgress[]>([])

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
    </div>
  )
}

export default App
