import { memo, useMemo } from 'react'
import type { MouseEvent } from 'react'
import type { CDDetails, DisplayCurrency, QueryResult } from '../../shared/types'
import type { FeishuFieldName } from '../../shared/feishu'
import { errorMessage } from '../../shared/utils'
import { useCoverImage } from './hooks/useCoverImage'
import { useI18n } from './i18n'
import {
  SUMMARY_COLUMNS,
  SUMMARY_COLUMN_LABEL_KEYS,
  STATUS_LABEL_KEYS,
  buildSummaryCells,
  formatPrice
} from './summaryRow'

interface SummaryTableProps {
  catalogNumber: string
  results: QueryResult[]
  enrichedDetails?: CDDetails | null
  displayCurrency: DisplayCurrency
  usdToCnyRate: number | null
}

/** Hook-owning cover cell so useCoverImage is never called in a loop. */
const SummaryCoverCell = memo(function SummaryCoverCell({ url, fallback }: { url: string | null; fallback: string }) {
  const {
    containerRef,
    imageData,
    error,
    loaded,
    onLoad,
    onError
  } = useCoverImage(url, { size: 64, lazy: true })

  return (
    <div className="summary-cover-cell" ref={containerRef}>
      {url && !error ? (
        <>
          {!imageData && <div className="summary-cover-placeholder" />}
          <img
            src={imageData || ''}
            className={`summary-cover-thumb ${loaded ? 'loaded' : ''}`}
            onLoad={onLoad}
            onError={onError}
            style={{ display: imageData ? 'block' : 'none' }}
            alt=""
          />
        </>
      ) : (
        <span className="summary-cover-fallback">{fallback}</span>
      )}
    </div>
  )
})

/**
 * One catalog number = one fixed row whose columns mirror the Feishu 汇总表.
 * All platform prices live in the single priceAll cell, so adding platforms
 * never adds rows. The expandable per-platform panel is owned by ResultCard.
 */
export function SummaryTable({ catalogNumber, results, enrichedDetails, displayCurrency, usdToCnyRate }: SummaryTableProps) {
  const { t } = useI18n()
  const cells = useMemo(() => buildSummaryCells(results, enrichedDetails), [results, enrichedDetails])

  const handleLinkClick = (e: MouseEvent<HTMLAnchorElement>, url: string) => {
    e.preventDefault()
    window.electronAPI.openExternal(url).catch(err => {
      window.electronAPI.log('warn', 'summary.externalLink', 'failed to open external link', {
        error: errorMessage(err)
      })
    })
  }

  const dash = '—'
  const textCell = (col: FeishuFieldName, value: string | null, className?: string) => (
    <td key={col} className={className} title={value || undefined}>{value || dash}</td>
  )

  const renderCell = (col: FeishuFieldName) => {
    switch (col) {
      case '编号':
        return <td key={col}>{catalogNumber}</td>
      case 'name':
        return textCell(col, cells.name)
      case 'artist':
        return textCell(col, cells.artist)
      case 'coverUrl':
        return (
          <td key={col}>
            <SummaryCoverCell url={cells.coverUrl} fallback={t('result.noImage')} />
          </td>
        )
      case 'status':
        return (
          <td key={col} className="summary-cell-status">
            {cells.status ? t(STATUS_LABEL_KEYS[cells.status]) : dash}
          </td>
        )
      case 'error':
        return textCell(col, cells.error, 'summary-cell-error')
      case 'label':
      case 'format':
      case 'country':
      case 'released':
      case 'genre':
        return textCell(col, cells.details[col])
      case 'priceAll':
        return (
          <td key={col} className="summary-cell-price">
            <ul className="summary-price-list">
              {cells.priceEntries.map(entry => (
                <li key={entry.platform} className="summary-price-entry">
                  {entry.link ? (
                    <a
                      className="summary-price-link"
                      href={entry.link}
                      title={t('result.viewDetails')}
                      onClick={e => handleLinkClick(e, entry.link!)}
                    >
                      {entry.label}
                    </a>
                  ) : (
                    <span>{entry.label}</span>
                  )}
                  <span>: {formatPrice(entry.priceMin, entry.priceMax, displayCurrency, usdToCnyRate)}</span>
                  {entry.isLowest && <span className="summary-price-badge lowest">{t('result.lowest')}</span>}
                  {entry.isHighest && <span className="summary-price-badge highest">{t('result.highest')}</span>}
                </li>
              ))}
            </ul>
          </td>
        )
      case 'resultsJson':
        return (
          <td key={col} className="summary-cell-results">
            {t('result.resultsSummary', { total: cells.resultsTotal, found: cells.resultsFound })}
          </td>
        )
    }
  }

  return (
    <div className="summary-table-scroll">
      <table className="summary-table">
        <thead>
          <tr>
            {SUMMARY_COLUMNS.map(col => (
              <th key={col} scope="col">{t(SUMMARY_COLUMN_LABEL_KEYS[col])}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>{SUMMARY_COLUMNS.map(renderCell)}</tr>
        </tbody>
      </table>
    </div>
  )
}
