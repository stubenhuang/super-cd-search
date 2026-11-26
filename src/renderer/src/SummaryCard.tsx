import { Fragment, memo, useMemo } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import type { CDDetails, DisplayCurrency, QueryResult } from '../../shared/types'
import type { FeishuFieldName } from '../../shared/feishu'
import { errorMessage } from '../../shared/utils'
import { useCoverImage } from './hooks/useCoverImage'
import { useI18n } from './i18n'
import {
  SUMMARY_COLUMN_LABEL_KEYS,
  SUMMARY_FIELD_GROUPS,
  SUMMARY_GROUP_LABEL_KEYS,
  STATUS_LABEL_KEYS,
  WIDE_COLUMNS,
  buildSummaryCells,
  computePriceBounds,
  formatPrice
} from './summaryRow'

interface SummaryCardProps {
  catalogNumber: string
  results: QueryResult[]
  enrichedDetails?: CDDetails | null
  displayCurrency: DisplayCurrency
  usdToCnyRate: number | null
}

/**
 * Hook-owning cover cell so useCoverImage is never called in a loop. Both the
 * hero and the small 封面 field request the same 320px image, which the main
 * process dedupes by its `${size}:${url}` cache key into a single download.
 */
const SummaryCoverCell = memo(function SummaryCoverCell({
  url,
  fallback,
  variant
}: {
  url: string | null
  fallback: string
  variant: 'hero' | 'thumb'
}) {
  const {
    containerRef,
    imageData,
    error,
    loaded,
    onLoad,
    onError
  } = useCoverImage(url, { size: 320, lazy: true })

  return (
    <div className={`summary-cover-cell is-${variant}`} ref={containerRef}>
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
 * One catalog number = one record card whose 13 labelled fields mirror the
 * Feishu 汇总表. Content wraps by available width, so no horizontal scrollbar
 * is ever needed. The expandable per-platform panel is owned by ResultCard.
 */
export function SummaryCard({ catalogNumber, results, enrichedDetails, displayCurrency, usdToCnyRate }: SummaryCardProps) {
  const { t } = useI18n()
  const cells = useMemo(() => buildSummaryCells(results, enrichedDetails), [results, enrichedDetails])
  const lowestPrice = useMemo(() => computePriceBounds(results).lowestPrice, [results])
  const dash = '—'

  const handleLinkClick = (e: MouseEvent<HTMLAnchorElement>, url: string) => {
    e.preventDefault()
    window.electronAPI.openExternal(url).catch(err => {
      window.electronAPI.log('warn', 'summary.externalLink', 'failed to open external link', {
        error: errorMessage(err)
      })
    })
  }

  const textValue = (value: string | null, extraClass = ''): ReactNode => (
    <div className={`summary-field-value ${value ? extraClass : 'is-empty'}`}>{value || dash}</div>
  )

  const renderValue = (col: FeishuFieldName): ReactNode => {
    switch (col) {
      case '编号':
        return <div className="summary-field-value is-mono">{catalogNumber}</div>
      case 'name':
        return textValue(cells.name)
      case 'artist':
        return textValue(cells.artist)
      case 'coverUrl':
        return (
          <div className="summary-field-value">
            <SummaryCoverCell url={cells.coverUrl} fallback={dash} variant="thumb" />
          </div>
        )
      case 'status':
        return textValue(cells.status ? t(STATUS_LABEL_KEYS[cells.status]) : null)
      case 'error':
        return textValue(cells.error, 'is-error')
      case 'label':
      case 'format':
      case 'country':
      case 'released':
      case 'genre':
        return textValue(cells.details[col])
      case 'priceAll':
        return (
          <div className="summary-field-value">
            {cells.priceEntries.length === 0 ? (
              <span className="summary-price-empty">{dash}</span>
            ) : (
              <ul className="summary-price-pills">
                {cells.priceEntries.map(entry => (
                  <li key={entry.platform} className="summary-price-pill">
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
                    <span className="summary-price-pill-value">
                      : {formatPrice(entry.priceMin, entry.priceMax, displayCurrency, usdToCnyRate)}
                    </span>
                    {entry.isLowest && <span className="summary-price-badge lowest">{t('result.lowest')}</span>}
                    {entry.isHighest && <span className="summary-price-badge highest">{t('result.highest')}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      case 'resultsJson':
        return (
          <div className="summary-field-value">
            <span className="summary-results-count">
              {t('result.resultsSummary', { total: cells.resultsTotal, found: cells.resultsFound })}
            </span>
          </div>
        )
    }
  }

  return (
    <section className="summary-card">
      <div className="summary-hero">
        <SummaryCoverCell url={cells.coverUrl} fallback={t('result.noImage')} variant="hero" />
        <div className="summary-hero-body">
          <h3 className="summary-hero-title">{cells.name || catalogNumber}</h3>
          <p className="summary-hero-artist">{cells.artist || dash}</p>
          <span className={`summary-status-pill status-${cells.status ?? 'none'}`}>
            {cells.status ? t(STATUS_LABEL_KEYS[cells.status]) : dash}
          </span>
        </div>
        <div className="summary-hero-price">
          <span className="summary-hero-price-caption">{t('result.lowest')}</span>
          <span className="summary-hero-price-value">
            {lowestPrice === null ? dash : formatPrice(lowestPrice, lowestPrice, displayCurrency, usdToCnyRate)}
          </span>
        </div>
      </div>

      <div className="summary-fields">
        {SUMMARY_FIELD_GROUPS.map(group => (
          <Fragment key={group.id}>
            <div className="summary-group-title">{t(SUMMARY_GROUP_LABEL_KEYS[group.id])}</div>
            {group.columns.map(col => (
              <div key={col} className={`summary-field ${WIDE_COLUMNS.has(col) ? 'is-wide' : ''}`}>
                <span className="summary-field-label">{t(SUMMARY_COLUMN_LABEL_KEYS[col])}</span>
                {renderValue(col)}
              </div>
            ))}
          </Fragment>
        ))}
      </div>
    </section>
  )
}
