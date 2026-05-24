import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'

let db: Database.Database | null = null

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return db
}

export function initDatabase(): Database.Database {
  const userDataPath = app.getPath('userData')
  const dbPath = join(userDataPath, 'super-cd-search.db')

  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  runMigrations(db)

  return db
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS queries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      catalog_number TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query_id INTEGER NOT NULL,
      platform TEXT NOT NULL,
      name TEXT,
      artist TEXT,
      price_min REAL,
      price_max REAL,
      cover_url TEXT,
      link TEXT,
      status TEXT NOT NULL DEFAULT 'not_found' CHECK(status IN ('found', 'not_found', 'error')),
      label TEXT,
      format TEXT,
      country TEXT,
      released TEXT,
      genre TEXT,
      FOREIGN KEY (query_id) REFERENCES queries(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_results_query_id ON results(query_id);
    CREATE INDEX IF NOT EXISTS idx_results_platform ON results(platform);
    CREATE INDEX IF NOT EXISTS idx_queries_catalog_number ON queries(catalog_number);
  `)
}
