import { useState, useEffect, useCallback } from 'react'
import type { HistoryBatch } from './electron-api'
import './History.css'

interface HistoryViewProps {
  onLoadEntry: (queryId: number) => void
}

export function HistoryView({ onLoadEntry }: HistoryViewProps) {
  const [history, setHistory] = useState<HistoryBatch[]>([])

  const loadHistory = useCallback(async () => {
    const data = await window.electronAPI.getHistory()
    setHistory(data as HistoryBatch[])
  }, [])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    await window.electronAPI.deleteHistoryEntry(id)
    loadHistory()
  }

  const handleClearAll = async () => {
    await window.electronAPI.clearAllHistory()
    setHistory([])
  }

  if (history.length === 0) {
    return (
      <div className="history-empty">
        <p>No search history yet.</p>
      </div>
    )
  }

  return (
    <div className="history-view">
      <div className="history-header">
        <h2>History</h2>
        <button className="clear-all-button" onClick={handleClearAll}>
          Clear All
        </button>
      </div>
      <div className="history-list">
        {history.map(entry => (
          <div
            key={entry.id}
            className="history-entry"
            onClick={() => onLoadEntry(entry.id)}
          >
            <div className="history-info">
              <div className="history-catalog">{entry.catalogNumber}</div>
              <div className="history-date">{entry.createdAt}</div>
            </div>
            <button
              className="delete-button"
              onClick={(e) => handleDelete(entry.id, e)}
              title="Delete"
            >
              &times;
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
