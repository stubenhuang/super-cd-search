import { getDatabase } from './index'
import type { HistoryBatch, HistoryEntry, QueryResult } from '../../shared/types'

export type { HistoryBatch, HistoryEntry }

export function getHistory(): HistoryBatch[] {
  const db = getDatabase()
  const rows = db.prepare(`
    SELECT id, catalog_number, created_at
    FROM queries
    ORDER BY created_at DESC
    LIMIT 100
  `).all() as Array<{ id: number; catalog_number: string; created_at: string }>

  return rows.map(row => ({
    id: row.id,
    catalogNumber: row.catalog_number,
    createdAt: row.created_at
  }))
}

export function getHistoryEntry(queryId: number): HistoryEntry | null {
  const db = getDatabase()
  const query = db.prepare('SELECT id, catalog_number, created_at FROM queries WHERE id = ?').get(queryId) as
    { id: number; catalog_number: string; created_at: string } | undefined

  if (!query) return null

  const results = db.prepare(`
    SELECT platform, name, artist, price_min, price_max, cover_url, link, status
    FROM results WHERE query_id = ?
  `).all(queryId) as Array<{
    platform: string
    name: string | null
    artist: string | null
    price_min: number | null
    price_max: number | null
    cover_url: string | null
    link: string | null
    status: string
  }>

  return {
    query: {
      id: query.id,
      catalogNumber: query.catalog_number,
      createdAt: query.created_at
    },
    results: results.map(r => ({
      platform: r.platform as QueryResult['platform'],
      name: r.name,
      artist: r.artist,
      priceMin: r.price_min,
      priceMax: r.price_max,
      coverUrl: r.cover_url,
      link: r.link,
      status: r.status as QueryResult['status']
    }))
  }
}

export function deleteHistoryEntry(queryId: number): void {
  const db = getDatabase()
  db.prepare('DELETE FROM results WHERE query_id = ?').run(queryId)
  db.prepare('DELETE FROM queries WHERE id = ?').run(queryId)
}

export function clearAllHistory(): void {
  const db = getDatabase()
  db.prepare('DELETE FROM results').run()
  db.prepare('DELETE FROM queries').run()
}
