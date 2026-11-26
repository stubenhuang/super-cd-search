import { memo, useState } from 'react'
import type { MouseEvent } from 'react'
import type { Platform, QueryResult, RawItem, RawItemValue } from '../../shared/types'
import { platformLabel } from '../../shared/platforms'
import { platformTableImageColumn } from '../../shared/feishu'
import { errorMessage } from '../../shared/utils'
import { useCoverImage } from './hooks/useCoverImage'
import { useI18n } from './i18n'
import {
  MAX_DETAIL_ROWS,
  capRows,
  formatRawValue,
  getPlatformTabs,
  isSafeLink,
  visibleColumns
} from './platformDetail'

interface PlatformDetailPanelProps {
  /** Id of the toggle button's `aria-controls` target. */
  id: string
  catalogNumber: string
  results: QueryResult[]
}

/** One cover cell: a hook-owning sub-component so hooks are never called in a loop. */
const CoverCell = memo(function CoverCell({ url, fallback }: { url: string | null; fallback: string }) {
  const {
    containerRef,
    imageData,
    error,
    loaded,
    onLoad,
    onError
  } = useCoverImage(url, { size: 64, lazy: true })

  return (
    <div className="detail-cover-cell" ref={containerRef}>
      {url && !error ? (
        <>
          {!imageData && <div className="detail-cover-placeholder" />}
          <img
            src={imageData || ''}
            className={`detail-cover-thumb ${loaded ? 'loaded' : ''}`}
            onLoad={onLoad}
            onError={onError}
            style={{ display: imageData ? 'block' : 'none' }}
            alt=""
          />
        </>
      ) : (
        <span className="detail-cover-fallback">{fallback}</span>
      )}
    </div>
  )
})

interface PlatformTableProps {
  platform: Platform
  items: readonly RawItem[]
  panelId: string
}

function PlatformTable({ platform, items, panelId }: PlatformTableProps) {
  const { t } = useI18n()
  const columns = visibleColumns(platform)
  const coverColumn = platformTableImageColumn(platform)
  const { shown, hidden } = capRows(items)

  const handleLinkClick = (e: MouseEvent<HTMLAnchorElement>, url: string) => {
    e.preventDefault()
    window.electronAPI.openExternal(url).catch(err => {
      window.electronAPI.log('warn', 'platformDetail.externalLink', 'failed to open external link', {
        error: errorMessage(err)
      })
    })
  }

  const renderValueCell = (col: string, value: RawItemValue | undefined) => {
    const text = formatRawValue(value)
    const link = isSafeLink(value) ? value : null
    return (
      <td key={col} title={text}>
        {link ? (
          <a className="detail-link" href={link} onClick={e => handleLinkClick(e, link)}>{text}</a>
        ) : (
          text
        )}
      </td>
    )
  }

  return (
    <div
      className="platform-detail-table-scroll"
      role="tabpanel"
      id={`${panelId}-panel`}
      aria-labelledby={`${panelId}-tab-${platform}`}
    >
      <table className="platform-detail-table">
        <thead>
          <tr>
            <th className="col-rank" scope="col">序号</th>
            {columns.map(col => <th key={col} scope="col">{col}</th>)}
          </tr>
        </thead>
        <tbody>
          {shown.map((item, index) => {
            const rank = index + 1
            return (
              <tr key={`${platform}-${rank}`}>
                <td className="col-rank">{rank}</td>
                {columns.map(col => {
                  const value = item[col]
                  if (col === coverColumn) {
                    const url = isSafeLink(value) ? value : null
                    return (
                      <td key={col}>
                        <CoverCell url={url} fallback={t('result.noImage')} />
                      </td>
                    )
                  }
                  return renderValueCell(col, value)
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
      {hidden > 0 && (
        <p className="detail-more-hint">{t('platformDetail.moreRows', { max: MAX_DETAIL_ROWS, count: hidden })}</p>
      )}
    </div>
  )
}

/**
 * Expandable per-platform detail view for one result row. Renders the same raw
 * rows that are written to that platform's Feishu detail table, entirely from
 * renderer-local `QueryResult.rawItems` (no IPC, offline).
 */
export function PlatformDetailPanel({ id, catalogNumber, results }: PlatformDetailPanelProps) {
  const { t } = useI18n()
  const tabs = getPlatformTabs(results)
  const [activePlatform, setActivePlatform] = useState<Platform | null>(null)
  // Derive every render so progress-driven tab-set changes can never leave a
  // stale or empty selection (no effect-based syncing).
  const effectivePlatform = activePlatform && tabs.includes(activePlatform) ? activePlatform : (tabs[0] ?? null)
  const activeItems = effectivePlatform
    ? results.find(r => r.platform === effectivePlatform && r.rawItems && r.rawItems.length > 0)?.rawItems ?? []
    : []

  return (
    <section id={id} role="region" aria-label={t('platformDetail.toggle')} className="platform-detail-panel">
      <div className="platform-detail-header">{t('platformDetail.catalog', { catalog: catalogNumber })}</div>
      {!effectivePlatform ? (
        <p className="platform-detail-empty">{t('platformDetail.empty')}</p>
      ) : (
        <>
          <div className="platform-detail-tabs" role="tablist" aria-label={t('platformDetail.toggle')}>
            {tabs.map(platform => {
              const selected = platform === effectivePlatform
              return (
                <button
                  key={platform}
                  type="button"
                  role="tab"
                  id={`${id}-tab-${platform}`}
                  aria-selected={selected}
                  aria-controls={`${id}-panel`}
                  tabIndex={0}
                  className={`platform-detail-tab ${selected ? 'active' : ''}`}
                  onClick={() => setActivePlatform(platform)}
                >
                  {platformLabel(platform)}
                </button>
              )
            })}
          </div>
          <PlatformTable key={effectivePlatform} platform={effectivePlatform} items={activeItems} panelId={id} />
        </>
      )}
    </section>
  )
}
