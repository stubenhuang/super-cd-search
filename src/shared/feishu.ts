import type { CDDetails, FeishuSettings, QueryResult } from './types'

/**
 * Defaults for the Feishu Bitable sink. Syncing stays off until the user opts
 * in and fills in all five values, so a fresh install never makes a request.
 */
export const DEFAULT_FEISHU_SETTINGS: FeishuSettings = {
  enabled: false,
  appId: '',
  appSecret: '',
  appToken: '',
  tableId: ''
}

/** Business primary key column. Kept as a plain text field, not the index column. */
export const FEISHU_PRIMARY_FIELD = '编号'

/**
 * The twelve columns written for each catalog number. Missing columns are
 * created on first sync; all of them are multi-line text so URLs, JSON and
 * empty values never hit numeric/URL write validation.
 */
export const FEISHU_FIELDS = [
  '编号',
  'name',
  'artist',
  'coverUrl',
  'status',
  'error',
  'label',
  'format',
  'country',
  'released',
  'genre',
  'priceAll'
] as const

export type FeishuFieldName = (typeof FEISHU_FIELDS)[number]

/** Feishu Bitable field type 1 = multi-line text. */
export const FEISHU_FIELD_TYPE_TEXT = 1

/** One catalog number's worth of search data, sent from the renderer. */
export interface FeishuSyncRow {
  catalogNumber: string
  results: QueryResult[]
  /** Accumulated LLM-generated details, if any (fill-missing, never overwrite). */
  enrichedDetails?: CDDetails | null
}

export interface FeishuSyncPayload {
  rows: FeishuSyncRow[]
}

export interface FeishuSyncResult {
  status: 'skipped' | 'ok' | 'error'
  created: number
  updated: number
  failed: number
  message?: string
}

export interface FeishuTestResult {
  ok: boolean
  message: string
}

export function emptySyncResult(status: FeishuSyncResult['status'], message?: string): FeishuSyncResult {
  return { status, created: 0, updated: 0, failed: 0, ...(message ? { message } : {}) }
}
