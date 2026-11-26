import { memo, useMemo } from 'react'
import type { MouseEvent } from 'react'
import type { CDDetails, DisplayCurrency, QueryResult } from '../../shared/types'
import { errorMessage } from '../../shared/utils'
import { useCoverImage } from './hooks/useCoverImage'
import { useI18n } from './i18n'
import {
  STATUS_LABEL_KEYS,
  buildSummaryCells,
  computePriceBounds,
  formatPrice
} from './summaryRow'

interface SummaryRowProps {
  catalogNumber: string
  results: QueryResult[]
  enrichedDetails?: CDDetails | null
  displayCurrency: DisplayCurrency
  usdToCnyRate: number | null
  onTitleClick: (catalogNumber: string) => void
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
    <div className="summary-cover-cell is-thumb" ref={containerRef}>
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

/** Shared header: identical column classes to every summary row. */
export function ResultsHead() {
  const { t } = useI18n()
  return (
    <div className="results-head">
      <div className="summary-col summary-col-cover">{t('summary.cover')}</div>
      <div className="summary-col summary-col-catalog">{t('detail.catalogNumber')}</div>
      <div className="summary-col summary-col-album">{t('detail.album')}</div>
      <div className="summary-col summary-col-status">{t('summary.status')}</div>
      <div className="summary-col summary-col-lowest">{t('summary.row.lowest')}</div>
      <div className="summary-col summary-col-prices">{t('summary.priceAll')}</div>
      <div className="summary-col summary-col-results">{t('summary.results')}</div>
      <div className="summary-col summary-col-toggle">{t('platformDetail.toggle')}</div>
    </div>
  )
}

/**
 * One catalog number = one compact line of core summary data. The 5 detail
 * fields and `error` live in DetailModal; the per-platform panel is owned by
 * ResultCard. Column classes must match ResultsHead exactly (alignment).
 */
export function SummaryRow({ catalogNumber, results, enrichedDetails, displayCurrency, usdToCnyRate, onTitleClick }: SummaryRowProps) {
  const { t } = useI18n()
  const cells = useMemo(() => buildSummaryCells(results, enrichedDetails), [results, enrichedDetails])
  const lowestPrice = useMemo(() => computePriceBounds(results).lowestPrice, [results])
  const displayName = cells.name || catalogNumber

  const handleLinkClick = (e: MouseEvent<HTMLAnchorElement>, url: string) => {
    e.preventDefault()
    window.electronAPI.openExternal(url).catch(err => {
      window.electronAPI.log('warn', 'summary.externalLink', 'failed to open external link', {
        error: errorMessage(err)
      })
    })
  }

  const MAX_PRICE_PILLS = 2
  const visiblePills = cells.priceEntries.slice(0, MAX_PRICE_PILLS)
  const overflowCount = Math.max(0, cells.priceEntries.length - MAX_PRICE_PILLS)

  return (
    <>
      <div className="summary-col summary-col-cover">
        <SummaryCoverCell url={cells.coverUrl} fallback="—" />
      </div>

      <div className="summary-col summary-col-catalog" title={catalogNumber}>{catalogNumber}</div>

      <div
        className="summary-col summary-col-album"
        title={`${displayName}${cells.artist ? ` — ${cells.artist}` : ''}`}
      >
        <span
          className="result-title"
          role="button"
          tabIndex={0}
          onClick={() => onTitleClick(catalogNumber)}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onTitleClick(catalogNumber)
            }
          }}
          title={t('result.titleClick')}
        >
          {displayName}
        </span>
        {cells.artist && <span className="summary-album-artist">— {cells.artist}</span>}
      </div>

      <div className="summary-col summary-col-status">
        <span className={`summary-status-pill status-${cells.status ?? 'none'}`}>
          {cells.status ? t(STATUS_LABEL_KEYS[cells.status]) : '—'}
        </span>
      </div>

      <div className="summary-col summary-col-lowest">
        <span className="summary-lowest-price">
          {lowestPrice === null ? '—' : formatPrice(lowestPrice, lowestPrice, displayCurrency, usdToCnyRate)}
        </span>
      </div>

      <div className="summary-col summary-col-prices">
        {cells.priceEntries.length === 0 ? (
          <span className="summary-price-empty">—</span>
        ) : (
          <ul className="summary-price-pills">
            {visiblePills.map((entry, index) => (
              <li key={entry.platform} className={`summary-price-pill ${index > 0 ? 'is-extra' : ''}`}>
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
                  <span className="summary-price-link">{entry.label}</span>
                )}
                <span className="summary-price-pill-value">
                  {formatPrice(entry.priceMin, entry.priceMax, displayCurrency, usdToCnyRate)}
                </span>
                {entry.isLowest && (
                  <span className="summary-price-badge lowest" title={t('result.lowest')}>★</span>
                )}
                {entry.isHighest && (
                  <span className="summary-price-badge highest" title={t('result.highest')}>▲</span>
                )}
              </li>
            ))}
            {overflowCount > 0 && (
              <li className="summary-more-platforms is-default">
                {t('summary.morePlatforms', { count: overflowCount })}
              </li>
            )}
            {cells.priceEntries.length > 1 && (
              <li className="summary-more-platforms is-narrow">
                {t('summary.morePlatforms', { count: cells.priceEntries.length - 1 })}
              </li>
            )}
          </ul>
        )}
      </div>

      <div
        className="summary-col summary-col-results"
        title={t('result.resultsSummary', { total: cells.resultsTotal, found: cells.resultsFound })}
      >
        <span className="summary-results-count">{cells.resultsFound}/{cells.resultsTotal}</span>
      </div>
    </>
  )
}
