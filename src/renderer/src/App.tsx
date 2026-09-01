import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import type { BatchQueryProgressEvent, QueryResult, Platform, Settings, DisplayCurrency, CDDetails, BatchQueryResult, LanCatalogAddedEvent, CDLibraryRecordInput, LanSearchState, LanSearchPhase, LoginPlatform, DetailEnrichProgress } from './electron-api'
import { SettingsPanel } from './Settings'
import { LanPanel } from './LanPanel'
import { DetailModal } from './DetailModal'
import { FlowDialog, type AutoFlowState } from './FlowDialog'
import { aggregateDetails, missingDetailKeys } from '../../shared/details'
import { isLlmConfigured } from '../../shared/llm'
import { normalizeCatalogNumber } from '../../shared/utils'
import { PLATFORM_LABELS, DEFAULT_STANDARD_PLATFORMS, DEFAULT_DEEP_PLATFORMS, CHANNEL_PLATFORMS, resolveDeepDigPlatforms } from '../../shared/platforms'
import { makeProgressKey, buildProgressByCatalog, clearProgressEntries, countCompletedCatalogs } from '../../shared/progress'
import { QueryEvents } from '../../shared/events'
import { useCoverImage } from './hooks/useCoverImage'
import { useI18n } from './i18n'
import { buildExportRows } from './exportData'
import { CDLibrary } from './CDLibrary'
import './App.css'

type SearchMode = 'standard' | 'deep'

function mergePlatformResults(existing: QueryResult[], incoming: QueryResult[]): QueryResult[] {
  const merged = [...existing]
  for (const newResult of incoming) {
    const idx = merged.findIndex(r => r.platform === newResult.platform)
    if (idx >= 0) {
      merged[idx] = newResult
    } else {
      merged.push(newResult)
    }
  }
  return merged
}

function applyBatchResults(existing: Map<string, QueryResult[]>, batches: BatchQueryResult[]): Map<string, QueryResult[]> {
  const merged = new Map(existing)
  for (const batch of batches) {
    const previous = merged.get(batch.catalogNumber) || []
    merged.set(batch.catalogNumber, mergePlatformResults(previous, batch.results))
  }
  return merged
}

function hasCompleteDetails(results: QueryResult[], enrichedDetails?: CDDetails): boolean {
  const merged = { ...aggregateDetails(results).details }
  if (enrichedDetails) {
    for (const key of Object.keys(merged) as (keyof CDDetails)[]) {
      if (!merged[key] && enrichedDetails[key]) {
        merged[key] = enrichedDetails[key]
      }
    }
  }
  return missingDetailKeys(merged).length === 0
}

/**
 * A marketplace channel only joins a search while its QR login is verified;
 * unverified channels are skipped silently. Text platforms pass through
 * unchanged and verified channels keep their position at the end of the list.
 */
async function filterVerifiedChannels(platforms: Platform[]): Promise<Platform[]> {
  const channels = platforms.filter((p): p is LoginPlatform => CHANNEL_PLATFORMS.includes(p))
  if (channels.length === 0) return platforms
  const statuses = await Promise.all(
    channels.map(p => window.electronAPI.getCloudflareStatus(p).catch(() => null))
  )
  const verified = channels.filter((_, i) => statuses[i]?.state === 'verified')
  const skipped = channels.filter((_, i) => statuses[i]?.state !== 'verified')
  if (skipped.length > 0) {
    window.electronAPI.log('debug', 'app.channels', 'channels skipped: login not verified', { skipped })
  }
  return [...platforms.filter(p => !CHANNEL_PLATFORMS.includes(p)), ...verified]
}

interface PlatformResultRowProps {
  result: QueryResult
  isLowestPrice: boolean
  isHighestPrice: boolean
  displayCurrency: DisplayCurrency
  usdToCnyRate: number | null
}

const PlatformResultRow = React.memo(function PlatformResultRow({ result, isLowestPrice, isHighestPrice, displayCurrency, usdToCnyRate }: PlatformResultRowProps) {
  const { t } = useI18n()
  const {
    containerRef: imageContainerRef,
    imageData,
    error: imageError,
    loaded: imageLoaded,
    onLoad,
    onError
  } = useCoverImage(result.coverUrl, { size: 160, lazy: true })

  const formatPrice = (min: number | null, max: number | null): string => {
    if (min === null && max === null) return '-'

    const formatSingle = (usd: number): string => {
      if (displayCurrency === 'CNY' && usdToCnyRate !== null) {
        return `¥${(usd * usdToCnyRate).toFixed(2)}`
      }
      return `$${usd.toFixed(2)}`
    }

    if (min === null || max === null) {
      const price = min ?? max
      return price !== null ? formatSingle(price) : '-'
    }
    if (min === max) return formatSingle(min)
    return `${formatSingle(min)} - ${formatSingle(max)}`
  }

  const getPriceLabel = (min: number | null, max: number | null): string => {
    if (min === null && max === null) return ''
    if (min === null || max === null) return t('result.fixedPrice')
    if (min === max) return t('result.fixedPrice')
    return t('result.priceRange')
  }

  const handleViewClick = (e: React.MouseEvent<HTMLAnchorElement>, url: string) => {
    e.preventDefault()
    window.electronAPI.openExternal(url).catch(err => {
      window.electronAPI.log('warn', 'result.externalLink', 'failed to open external link', {
        error: err instanceof Error ? err.message : String(err)
      })
    })
  }

  const cardClass = `platform-card ${result.status}`

  return (
    <div className={cardClass} data-platform={result.platform}>
      <div className="brand-bar" />
      {isLowestPrice && <span className="price-badge lowest">{t('result.lowest')}</span>}
      {isHighestPrice && <span className="price-badge highest">{t('result.highest')}</span>}
      <div className="platform-card-content">
        <div className="platform-card-name">{PLATFORM_LABELS[result.platform] || result.platform}</div>
        <div className="platform-card-body">
          <div className="platform-card-image" ref={imageContainerRef}>
            {result.coverUrl && !imageError ? (
              <>
                {!imageLoaded && <div className="image-placeholder" />}
                <img
                  src={imageData || ''}
                  alt={result.name || 'Cover'}
                  className={`cover-thumbnail ${imageLoaded ? 'loaded' : ''}`}
                  onLoad={onLoad}
                  onError={onError}
                  style={{ display: imageData ? 'block' : 'none' }}
                />
              </>
            ) : (
              <div className="image-placeholder">{t('result.noImage')}</div>
            )}
          </div>
          <div className="platform-card-details">
            {result.status === 'found' ? (
              <>
                <div className="price">{formatPrice(result.priceMin, result.priceMax)}</div>
                <div className="price-label">{getPriceLabel(result.priceMin, result.priceMax)}</div>
                {result.link && (
                  <a className="link" href={result.link} onClick={(e) => handleViewClick(e, result.link!)}>
                    {t('result.viewDetails')}
                  </a>
                )}
              </>
            ) : result.status === 'challenge' ? (
              <>
                <div className="status-text">{t('result.statusChallenge')}</div>
                <div className="error-hint" title={result.error || t('result.statusChallengeTitle')}>⚠ {result.error || t('result.statusChallengeHint')}</div>
              </>
            ) : result.status === 'error' ? (
              <>
                <div className="status-text">{t('result.statusError')}</div>
                <div className="error-hint" title={result.error || t('result.statusErrorDefault')}>⚠ {result.error || t('result.statusErrorDefault')}</div>
              </>
            ) : (
              <div className="status-text">{t('result.statusNotFound')}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
})

interface ResultCardProps {
  catalogNumber: string
  results: QueryResult[]
  onTitleClick: (catalogNumber: string) => void
  displayCurrency: DisplayCurrency
  usdToCnyRate: number | null
}

const ResultCard = React.memo(function ResultCard({ catalogNumber, results, onTitleClick, displayCurrency, usdToCnyRate }: ResultCardProps) {
  const { t } = useI18n()
  const foundResult = results.find(r => r.status === 'found' && r.name)
  const displayName = foundResult?.name || catalogNumber
  const displayArtist = foundResult?.artist

  const priceBounds = useMemo(() => {
    const candidates = results
      .filter(r => r.status === 'found' && (r.priceMin !== null || r.priceMax !== null))
      .map(r => ({
        min: r.priceMin ?? r.priceMax as number,
        max: r.priceMax ?? r.priceMin as number
      }))
    return {
      lowestPrice: candidates.length > 0 ? Math.min(...candidates.map(c => c.min)) : null,
      highestPrice: candidates.length > 0 ? Math.max(...candidates.map(c => c.max)) : null
    }
  }, [results])

  return (
    <div className="result-card">
      <div className="result-header">
        <span className="result-catalog">{catalogNumber}</span>
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
        {displayArtist && <span className="result-artist">— {displayArtist}</span>}
      </div>
      <div className="platform-results">
        {results.map(r => {
          const effectiveMin = r.priceMin ?? r.priceMax
          const effectiveMax = r.priceMax ?? r.priceMin
          return (
            <PlatformResultRow
              key={r.platform}
              result={r}
              isLowestPrice={r.status === 'found' && effectiveMin !== null && effectiveMin === priceBounds.lowestPrice}
              isHighestPrice={priceBounds.lowestPrice !== priceBounds.highestPrice && r.status === 'found' && effectiveMax !== null && effectiveMax === priceBounds.highestPrice}
              displayCurrency={displayCurrency}
              usdToCnyRate={usdToCnyRate}
            />
          )
        })}
      </div>
    </div>
  )
})

// Play completion sound using Web Audio API
function playCompletionSound(): void {
  try {
    const audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()

    // Create a pleasant completion chime
    const playTone = (frequency: number, startTime: number, duration: number, volume: number = 0.3) => {
      const oscillator = audioContext.createOscillator()
      const gainNode = audioContext.createGain()

      oscillator.connect(gainNode)
      gainNode.connect(audioContext.destination)

      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(frequency, startTime)

      gainNode.gain.setValueAtTime(0, startTime)
      gainNode.gain.linearRampToValueAtTime(volume, startTime + 0.01)
      gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration)

      oscillator.start(startTime)
      oscillator.stop(startTime + duration)
    }

    const now = audioContext.currentTime
    // Play a pleasant two-tone chime
    playTone(523.25, now, 0.15, 0.2)        // C5
    playTone(659.25, now + 0.15, 0.2, 0.25) // E5
    playTone(783.99, now + 0.35, 0.25, 0.3) // G5

  } catch {
    // Audio context may not be available in some environments
  }
}

function App() {
  const { t } = useI18n()
  const [activeTab, setActiveTab] = useState<'search' | 'library'>('search')
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [mobileNotice, setMobileNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const mobileNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [results, setResults] = useState<Map<string, QueryResult[]>>(new Map())
  const [enrichedDetails, setEnrichedDetails] = useState<Map<string, CDDetails>>(new Map())
  const [catalogOrder, setCatalogOrder] = useState<string[]>([])
  const [progressStatus, setProgressStatus] = useState<Map<string, string>>(new Map())
  const [completedCatalogs, setCompletedCatalogs] = useState<Set<string>>(new Set())
  const [showSettings, setShowSettings] = useState(false)
  const [showLanPanel, setShowLanPanel] = useState(false)
  const cancelledRef = useRef(false)
  const smartCancelRef = useRef(false)
  const smartCurrentCatalogRef = useRef<string | null>(null)
  const [isCancelling, setIsCancelling] = useState(false)
  const [searchMode, setSearchMode] = useState<SearchMode>('standard')
  const [isDeepSearching, setIsDeepSearching] = useState(false)
  const [deepSearchTargets, setDeepSearchTargets] = useState<string[]>([])
  const [deepSearchPlatforms, setDeepSearchPlatforms] = useState<Platform[]>([])
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [selectedCatalog, setSelectedCatalog] = useState<string | null>(null)
  const prevIsLoadingRef = useRef(false)
  const prevIsDeepSearchingRef = useRef(false)
  const deepSearchSucceededRef = useRef(false)
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>('USD')
  const [usdToCnyRate, setUsdToCnyRate] = useState<number | null>(null)
  const [autoFlow, setAutoFlow] = useState<AutoFlowState>(null)
  const [libraryRefreshVersion, setLibraryRefreshVersion] = useState(0)
  const [librarySyncError, setLibrarySyncError] = useState<string | null>(null)
  // Upsert outcome of the current search pipeline, accumulated across the
  // standard search / deep dig / smart generation stages.
  const pipelineUpsertRef = useRef({ inserted: new Set<string>(), updated: new Set<string>() })
  const [libraryNewCatalogs, setLibraryNewCatalogs] = useState<Set<string>>(new Set())
  const [libraryToast, setLibraryToast] = useState<string | null>(null)
  const libraryToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Copy of the pipeline upsert counts that triggers re-renders (the ref does
  // not), so the LAN search-state snapshot can report them to the phone.
  const [lanUpsertCounts, setLanUpsertCounts] = useState({ inserted: 0, updated: 0 })

  // Platforms queried by the currently running search. Resolved from the
  // latest settings each time a search starts (see handleSearch).
  const [activePlatforms, setActivePlatforms] = useState<Platform[]>(DEFAULT_STANDARD_PLATFORMS)

  const parseCatalogNumbers = useCallback((input: string): string[] => {
    const lines = input.split(/[\n,]+/).map(s => s.trim()).filter(s => s.length > 0)
    return lines.map(normalizeCatalogNumber)
  }, [])

  const MAX_SEARCH_INPUT_CATALOGS = 10

  const persistCatalogsToLibrary = useCallback(async (
    targets: string[],
    workingResults: Map<string, QueryResult[]>,
    workingEnriched: Map<string, CDDetails>
  ) => {
    const foundTargets = targets.filter(catalogNumber =>
      (workingResults.get(catalogNumber) || []).some(result => result.status === 'found')
    )
    if (foundTargets.length === 0) return
    try {
      const rate = usdToCnyRate ?? await window.electronAPI.getUsdToDisplayRate('CNY')
      const rows = buildExportRows({
        catalogNumbers: foundTargets,
        resultsByCatalog: workingResults,
        enrichedDetailsByCatalog: workingEnriched,
        usdToCnyRate: rate,
        t: t as (key: string) => string
      })
      const records: CDLibraryRecordInput[] = rows.map(row => ({ ...row }))
      const upsert = await window.electronAPI.upsertLibraryRecords(records)
      for (const cn of upsert.inserted) pipelineUpsertRef.current.inserted.add(cn)
      for (const cn of upsert.updated) pipelineUpsertRef.current.updated.add(cn)
      // Mirror the accumulated totals into state so the LAN snapshot reports
      // them to the phone ("新增 X 条、更新 Y 条已保存到 CD 库").
      setLanUpsertCounts({
        inserted: pipelineUpsertRef.current.inserted.size,
        updated: pipelineUpsertRef.current.updated.size
      })
      if (upsert.inserted.length > 0 || upsert.updated.length > 0) {
        setLibraryNewCatalogs(prev => {
          const next = new Set(prev)
          for (const cn of upsert.inserted) next.add(cn)
          for (const cn of upsert.updated) next.add(cn)
          return next
        })
      }
      setLibrarySyncError(null)
      setLibraryRefreshVersion(version => version + 1)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      window.electronAPI.log('warn', 'app.library', 'failed to persist search results', { error: message })
      setLibrarySyncError(t('library.storageError', { error: message }))
    }
  }, [t, usdToCnyRate])

  // Summarize the pipeline's library upserts as a 3-second toast. Called at
  // every terminal point of the search flow (immediately, or after the last
  // auto-flow dialog closes).
  const showLibraryToast = useCallback(() => {
    const { inserted, updated } = pipelineUpsertRef.current
    if (inserted.size === 0 && updated.size === 0) return
    setLibraryToast(t('library.searchUpsertToast', { inserted: inserted.size, updated: updated.size }))
    if (libraryToastTimerRef.current) clearTimeout(libraryToastTimerRef.current)
    libraryToastTimerRef.current = setTimeout(() => setLibraryToast(null), 3000)
  }, [t])

  // After the search pipeline settles, offer LLM smart generation for any
  // catalog whose detail fields are still incomplete. Stays silent when the
  // LLM is not configured — there is nothing to ask for in that case.
  // Returns whether the smart-generate dialog was opened.
  const maybePromptSmartGenerate = useCallback(async (
    targets: string[],
    workingResults: Map<string, QueryResult[]>,
    workingEnriched: Map<string, CDDetails>
  ): Promise<boolean> => {
    const incompleteCatalogs = targets.filter(catalogNumber =>
      !hasCompleteDetails(workingResults.get(catalogNumber) || [], workingEnriched.get(catalogNumber))
    )
    if (incompleteCatalogs.length === 0) return false
    try {
      const llm = await window.electronAPI.getSetting('llm')
      if (!isLlmConfigured(llm)) return false
    } catch {
      return false
    }
    setAutoFlow({ kind: 'smart-prompt', catalogs: incompleteCatalogs })
    return true
  }, [])

  const handleInputChange = useCallback((nextInput: string) => {
    const nextCount = parseCatalogNumbers(nextInput).length
    if (nextCount > MAX_SEARCH_INPUT_CATALOGS) {
      setError(t('error.maxCatalog'))
      return
    }
    setInput(nextInput)
    if (error === t('error.maxCatalog')) setError(null)
  }, [error, parseCatalogNumbers, t])

  const handleSearch = useCallback(async () => {
    const catalogNumbers = parseCatalogNumbers(input)

    if (catalogNumbers.length === 0) {
      setError(t('error.noCatalog'))
      return
    }

    if (catalogNumbers.length > 10) {
      setError(t('error.maxCatalog'))
      return
    }

    // Resolve the platform list for this search mode from the latest settings,
    // so changes made in the settings panel apply on the next search.
    let settings: Settings | undefined
    try {
      settings = await window.electronAPI.getSettings()
    } catch {
      settings = undefined
    }
    const modePlatforms = searchMode === 'standard'
      ? (settings?.standardPlatforms ?? DEFAULT_STANDARD_PLATFORMS)
      : (settings?.deepPlatforms ?? DEFAULT_DEEP_PLATFORMS)
    // Checked marketplace channels only join the search while their QR login
    // is verified; unverified ones are skipped silently (both modes).
    const platforms = await filterVerifiedChannels(modePlatforms)

    if (platforms.length === 0) {
      setError(t('error.noPlatforms'))
      return
    }

    setError(null)
    void window.electronAPI.setLanSearchAvailability(false).catch(() => {})
    setAutoFlow(null)
    pipelineUpsertRef.current = { inserted: new Set(), updated: new Set() }
    setLanUpsertCounts({ inserted: 0, updated: 0 })
    setIsLoading(true)
    setProgressStatus(new Map())
    setCompletedCatalogs(new Set())
    setResults(new Map())
    setEnrichedDetails(new Map())
    setCatalogOrder(catalogNumbers)
    setIsCancelling(false)
    cancelledRef.current = false
    setActivePlatforms(platforms)
    window.electronAPI.log('debug', 'app.search', 'search started', { catalogNumbers, platforms, mode: searchMode })

    try {
      const batchResults = await window.electronAPI.executeBatchQuery(catalogNumbers, platforms)
      window.electronAPI.log('debug', 'app.search', 'search finished', { resultCount: batchResults.length })
      const completedResults = applyBatchResults(new Map(), batchResults)
      setResults(prev => applyBatchResults(prev, batchResults))
      await persistCatalogsToLibrary(
        batchResults.map(batch => batch.catalogNumber),
        completedResults,
        new Map()
      )
      // Standard-search runs that left numbers unfound are offered a deep dig
      // pass (deep mode already queries every platform). Otherwise go straight
      // to the completeness check for smart generation.
      if (!cancelledRef.current) {
        const digPlatforms = searchMode === 'standard' ? await filterVerifiedChannels(resolveDeepDigPlatforms(settings)) : []
        const emptyTargets = digPlatforms.length > 0
          ? catalogNumbers.filter(cn => {
              const rs = completedResults.get(cn)
              return !rs || rs.length === 0 || !rs.some(r => r.status === 'found')
            })
          : []
        if (emptyTargets.length > 0) {
          setAutoFlow({ kind: 'deep-dig-prompt', catalogs: emptyTargets, platforms: digPlatforms })
        } else {
          const prompted = await maybePromptSmartGenerate(catalogNumbers, completedResults, new Map())
          if (!prompted) showLibraryToast()
        }
      }
    } catch (err) {
      if (!cancelledRef.current) {
        window.electronAPI.log('warn', 'app.search', 'search failed', { error: err instanceof Error ? err.message : String(err) })
        setError(err instanceof Error ? err.message : t('error.queryFailed'))
      }
    } finally {
      setIsLoading(false)
      setIsCancelling(false)
    }
  }, [input, maybePromptSmartGenerate, parseCatalogNumbers, persistCatalogsToLibrary, searchMode, showLibraryToast, t])

  const handleCancel = useCallback(async () => {
    window.electronAPI.log('debug', 'app.search', 'cancel requested')
    cancelledRef.current = true
    setIsCancelling(true)
    await window.electronAPI.cancelBatchQuery()
  }, [])

  useEffect(() => {
    return () => {
      if (mobileNoticeTimerRef.current) clearTimeout(mobileNoticeTimerRef.current)
      if (libraryToastTimerRef.current) clearTimeout(libraryToastTimerRef.current)
    }
  }, [])

  // Report whether the desktop search controls are idle to the LAN server.
  // Phone barcode submissions are rejected while any search or smart
  // generation work is in progress (checked again in the main process right
  // before writing).
  useEffect(() => {
    const available = !isLoading && !isCancelling && !isDeepSearching && autoFlow?.kind !== 'smart-running'
    void window.electronAPI.setLanSearchAvailability(available).catch(() => {})
    return () => {
      void window.electronAPI.setLanSearchAvailability(false).catch(() => {})
    }
  }, [isLoading, isCancelling, isDeepSearching, autoFlow])

  // Numbers added from the phone are appended to the search box (deduplicated).
  useEffect(() => {
    const handleCatalogAdded = (...args: unknown[]) => {
      const data = args[0] as LanCatalogAddedEvent
      const catalogNumber = normalizeCatalogNumber(data?.catalogNumber || '')
      if (!catalogNumber) return

      setInput(prev => {
        const existing = parseCatalogNumbers(prev)
        if (existing.includes(catalogNumber)) return prev
        if (existing.length >= MAX_SEARCH_INPUT_CATALOGS) return prev
        const base = prev.trimEnd()
        return base ? `${base}\n${catalogNumber}` : catalogNumber
      })
      setMobileNotice({ kind: 'success', text: t('mobile.addedToast', { catalogNumber }) })
      if (mobileNoticeTimerRef.current) clearTimeout(mobileNoticeTimerRef.current)
      mobileNoticeTimerRef.current = setTimeout(() => setMobileNotice(null), 4000)
    }

    return window.electronAPI.receive('lan:catalog-added', handleCatalogAdded)
  }, [parseCatalogNumbers, t])

  // Phone edits to the search box replace the desktop input. The desktop keeps
  // owning validation (10-catalog limit, error text); the outcome is reflected
  // back to the phone through the search state snapshot.
  useEffect(() => {
    return window.electronAPI.receive('lan:input-changed', (...args: unknown[]) => {
      const text = typeof args[0] === 'string' ? args[0] : ''
      handleInputChange(text)
    })
  }, [handleInputChange])

  // Phone-triggered remote search runs the exact same pipeline as the desktop
  // search button (state machine, progress, CD 库 auto-save included).
  useEffect(() => {
    return window.electronAPI.receive('lan:search-requested', () => {
      void handleSearch()
    })
  }, [handleSearch])

  // Phone-driven search mode switch (标准 / 深度), mirroring the desktop
  // selector. The snapshot echoes the mode back to the phone.
  useEffect(() => {
    return window.electronAPI.receive('lan:mode-changed', (...args: unknown[]) => {
      const mode = typeof args[0] === 'string' ? args[0] : 'standard'
      setSearchMode(mode === 'deep' ? 'deep' : 'standard')
    })
  }, [])

  useEffect(() => {
    // Phone-side publish state changes (published flag, platform checkmarks)
    // should be reflected in the CD library table's publish columns.
    return window.electronAPI.receive('library:publish-updated', () => {
      setLibraryRefreshVersion(version => version + 1)
    })
  }, [])

  useEffect(() => {
    const handleProgress = (...args: unknown[]) => {
      const data = args[0] as BatchQueryProgressEvent

      if (data.event === QueryEvents.RESULT && data.results) {
        const incomingResults = data.results
        setResults(prev => {
          const newMap = new Map(prev)
          const existing = newMap.get(data.catalogNumber) || []
          newMap.set(data.catalogNumber, mergePlatformResults(existing, incomingResults))
          return newMap
        })
      }

      if (data.event === QueryEvents.COMPLETE) {
        setCompletedCatalogs(prev => {
          const next = new Set(prev)
          next.add(data.catalogNumber)
          return next
        })
      } else if (data.event !== QueryEvents.START && data.platform !== 'all') {
        setProgressStatus(prev => {
          const next = new Map(prev)
          next.set(makeProgressKey(data.catalogNumber, data.platform), data.status)
          return next
        })
      }

      if (data.event === QueryEvents.BATCH_CANCELLED) {
        setIsCancelling(false)
        setIsLoading(false)
      }
    }

    return window.electronAPI.receive('query:progress', handleProgress)
  }, [])

  // Play completion sound when search finishes
  useEffect(() => {
    if (prevIsLoadingRef.current && !isLoading && !cancelledRef.current && results.size > 0) {
      playCompletionSound()
    }
    prevIsLoadingRef.current = isLoading
  }, [isLoading, results.size])

  // Deep-search runs use `isDeepSearching` rather than `isLoading`, so it needs
  // its own completion edge detector.
  useEffect(() => {
    if (
      prevIsDeepSearchingRef.current &&
      !isDeepSearching &&
      !cancelledRef.current &&
      deepSearchSucceededRef.current
    ) {
      playCompletionSound()
    }
    prevIsDeepSearchingRef.current = isDeepSearching
  }, [isDeepSearching])

  const hasProgress = completedCatalogs.size > 0 || progressStatus.size > 0
  const catalogNumbers = useMemo(() => parseCatalogNumbers(input), [input, parseCatalogNumbers])

  // Keep the LAN barcode service aware of how many numbers are already in the
  // input so phone scans are rejected when the 10-number limit is reached.
  useEffect(() => {
    void window.electronAPI.setLanSearchCatalogCount(catalogNumbers.length).catch(() => {})
  }, [catalogNumbers.length])

  // During a deep-search pass, the progress panel switches to show the deep
  // targets and their deep platform set instead of the main search context.
  const isDeepProgress = isDeepSearching && deepSearchTargets.length > 0
  const progressPlatforms = isDeepProgress ? deepSearchPlatforms : activePlatforms
  const progressCatalogs = isDeepProgress ? deepSearchTargets : catalogNumbers
  const totalCount = isDeepProgress
    ? deepSearchTargets.length
    : (catalogOrder.length || catalogNumbers.length || 0)

  const progressByCatalog = useMemo(() => {
    return buildProgressByCatalog(progressStatus, progressPlatforms)
  }, [progressStatus, progressPlatforms])

  const completedCount = useMemo(() => {
    if (isDeepProgress) {
      return countCompletedCatalogs(progressByCatalog, deepSearchTargets, progressPlatforms)
    }
    return completedCatalogs.size
  }, [isDeepProgress, deepSearchTargets, progressByCatalog, progressPlatforms, completedCatalogs])

  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  // Snapshot of the desktop search state machine, pushed to the LAN server so
  // the phone can mirror the search box and follow a remotely triggered run.
  const lanSearchState = useMemo<LanSearchState>(() => {
    let phase: LanSearchPhase = 'idle'
    if (autoFlow?.kind === 'deep-dig-prompt') phase = 'deep-dig-prompt'
    else if (isDeepSearching) phase = 'deep-search'
    else if (autoFlow?.kind === 'smart-prompt') phase = 'smart-prompt'
    else if (autoFlow?.kind === 'smart-running') phase = 'smart-running'
    else if (autoFlow?.kind === 'smart-cancelled') phase = 'smart-cancelled'
    else if (autoFlow?.kind === 'smart-done') phase = 'smart-done'
    else if (isLoading || isCancelling) phase = 'searching'
    else if (results.size > 0) phase = 'done'

    const progress = progressCatalogs.map(catalogNumber => ({
      catalogNumber,
      platforms: progressPlatforms.map(platform => ({
        platform,
        status: progressByCatalog.get(catalogNumber)?.get(platform) ?? 'pending'
      }))
    }))

    return {
      phase,
      input,
      busy: isLoading || isCancelling || isDeepSearching,
      searchMode,
      catalogs: progressCatalogs,
      platforms: progressPlatforms,
      total: totalCount,
      completed: completedCount,
      percent: progressPercent,
      progress,
      inserted: lanUpsertCounts.inserted,
      updated: lanUpsertCounts.updated,
      error,
      stageIndex: autoFlow?.kind === 'smart-running' ? autoFlow.current : undefined,
      stageTotal: autoFlow?.kind === 'smart-running' ? autoFlow.total : undefined,
      stageCatalog: autoFlow?.kind === 'smart-running' ? autoFlow.catalogNumber : undefined,
      flowCount: autoFlow && (autoFlow.kind === 'deep-dig-prompt' || autoFlow.kind === 'smart-prompt')
        ? autoFlow.catalogs.length
        : undefined,
      flowPlatforms: autoFlow?.kind === 'deep-dig-prompt' ? autoFlow.platforms : undefined,
      flowFailed: autoFlow?.kind === 'smart-done' ? autoFlow.failed : undefined
    }
  }, [
    autoFlow, isDeepSearching, isLoading, isCancelling, input, searchMode, results.size,
    progressCatalogs, progressPlatforms, progressByCatalog, totalCount,
    completedCount, progressPercent, lanUpsertCounts, error
  ])

  // Mirror the snapshot to the main process. Debounced so bursts of progress
  // events coalesce into one push.
  useEffect(() => {
    const timer = setTimeout(() => {
      void window.electronAPI.setLanSearchState(lanSearchState).catch(() => {})
    }, 150)
    return () => clearTimeout(timer)
  }, [lanSearchState])

  // Deep dig pass over catalogs that produced no "found" result. Merges the
  // extra platform results into the given working copies (state updates race
  // with query:progress events otherwise) and returns the merged map, or null
  // when the dig never ran / failed.
  const runDeepDig = useCallback(async (
    targets: string[],
    platforms: Platform[],
    workingResults: Map<string, QueryResult[]>,
    workingEnriched: Map<string, CDDetails>
  ): Promise<Map<string, QueryResult[]> | null> => {
    if (targets.length === 0 || platforms.length === 0 || isDeepSearching) return null

    setError(null)
    void window.electronAPI.setLanSearchAvailability(false).catch(() => {})
    cancelledRef.current = false
    deepSearchSucceededRef.current = false
    // Clear leftover terminal statuses for the dig targets so the bar starts
    // at 0% instead of flashing 100% from the standard-search pass. The rest
    // of the map and completedCatalogs are left intact for the full view that
    // returns once the dig finishes.
    setProgressStatus(prev => clearProgressEntries(prev, targets, platforms))
    setDeepSearchTargets(targets)
    setDeepSearchPlatforms(platforms)
    setIsDeepSearching(true)
    window.electronAPI.log('debug', 'app.deepSearch', 'deep search started', { targets, platforms })
    try {
      const batchResults = await window.electronAPI.executeBatchQuery(targets, platforms)
      window.electronAPI.log('debug', 'app.deepSearch', 'deep search finished', { resultCount: batchResults.length })
      const merged = applyBatchResults(workingResults, batchResults)
      setResults(merged)
      await persistCatalogsToLibrary(
        batchResults.map(batch => batch.catalogNumber),
        merged,
        workingEnriched
      )
      deepSearchSucceededRef.current = true
      return merged
    } catch (err) {
      window.electronAPI.log('warn', 'app.deepSearch', 'deep search failed', { error: err instanceof Error ? err.message : String(err) })
      setError(err instanceof Error ? err.message : t('error.queryFailed'))
      return null
    } finally {
      setIsDeepSearching(false)
      setDeepSearchTargets([])
      setDeepSearchPlatforms([])
    }
  }, [isDeepSearching, persistCatalogsToLibrary, t])

  const handleDeepDigConfirm = useCallback(async () => {
    if (autoFlow?.kind !== 'deep-dig-prompt') return
    const { catalogs, platforms } = autoFlow
    setAutoFlow(null)
    const merged = await runDeepDig(catalogs, platforms, results, enrichedDetails)
    if (cancelledRef.current) {
      showLibraryToast()
      return
    }
    const prompted = await maybePromptSmartGenerate(catalogOrder, merged ?? results, enrichedDetails)
    if (!prompted) showLibraryToast()
  }, [autoFlow, catalogOrder, enrichedDetails, maybePromptSmartGenerate, results, runDeepDig, showLibraryToast])

  const handleDeepDigSkip = useCallback(async () => {
    if (autoFlow?.kind !== 'deep-dig-prompt') return
    setAutoFlow(null)
    const prompted = await maybePromptSmartGenerate(catalogOrder, results, enrichedDetails)
    if (!prompted) showLibraryToast()
  }, [autoFlow, catalogOrder, enrichedDetails, maybePromptSmartGenerate, results, showLibraryToast])

  const handleSmartConfirm = useCallback(async () => {
    if (autoFlow?.kind !== 'smart-prompt') return
    const targets = autoFlow.catalogs
    const workingResults = new Map(results)
    const workingEnriched = new Map(enrichedDetails)
    const completedCatalogs: string[] = []
    let failed = 0
    let cancelled = false

    smartCancelRef.current = false

    for (let index = 0; index < targets.length; index++) {
      const catalogNumber = targets[index]
      smartCurrentCatalogRef.current = catalogNumber
      setAutoFlow({
        kind: 'smart-running',
        current: index + 1,
        total: targets.length,
        catalogNumber,
        phase: null,
        platform: null,
        cancelling: false
      })
      window.electronAPI.log('info', 'app.smartGenerate', 'auto smart generation started', { catalogNumber })
      try {
        const enrichment = await window.electronAPI.enrichDetails(
          catalogNumber,
          workingResults.get(catalogNumber) || [],
          workingEnriched.get(catalogNumber)
        )
        if (enrichment.status === 'cancelled') {
          cancelled = true
          break
        }
        if (enrichment.status === 'error') failed++
        workingEnriched.set(catalogNumber, enrichment.details)
        setEnrichedDetails(new Map(workingEnriched))
        completedCatalogs.push(catalogNumber)
      } catch (err) {
        failed++
        window.electronAPI.log('warn', 'app.smartGenerate', 'auto smart generation failed', {
          catalogNumber,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    }

    smartCurrentCatalogRef.current = null

    if (cancelled) {
      // Persist only the numbers that finished before the abort; the
      // interrupted one is intentionally not saved.
      await persistCatalogsToLibrary(completedCatalogs, workingResults, workingEnriched)
      setAutoFlow({ kind: 'smart-cancelled', completed: completedCatalogs.length, total: targets.length })
      return
    }

    await persistCatalogsToLibrary(targets, workingResults, workingEnriched)
    setAutoFlow({ kind: 'smart-done', failed })
  }, [autoFlow, enrichedDetails, persistCatalogsToLibrary, results])

  const handleSmartCancel = useCallback(() => {
    if (autoFlow?.kind !== 'smart-running') return
    smartCancelRef.current = true
    setAutoFlow({ ...autoFlow, cancelling: true })
    void window.electronAPI.cancelEnrichDetails()
  }, [autoFlow])

  const handleSmartSkip = useCallback(() => {
    if (autoFlow?.kind !== 'smart-prompt') return
    setAutoFlow(null)
    showLibraryToast()
  }, [autoFlow, showLibraryToast])

  const handleFlowClose = useCallback(() => {
    if (autoFlow?.kind !== 'smart-done' && autoFlow?.kind !== 'smart-cancelled') return
    setAutoFlow(null)
    showLibraryToast()
  }, [autoFlow, showLibraryToast])

  // Remote actions on the post-search dialogs (deep dig / smart generation).
  // Each handler re-checks the current dialog kind, so stale actions from a
  // phone that is behind on snapshots are safe no-ops.
  useEffect(() => {
    return window.electronAPI.receive('lan:flow-confirm', () => {
      void handleDeepDigConfirm()
      void handleSmartConfirm()
    })
  }, [handleDeepDigConfirm, handleSmartConfirm])

  useEffect(() => {
    return window.electronAPI.receive('lan:flow-skip', () => {
      void handleDeepDigSkip()
      void handleSmartSkip()
    })
  }, [handleDeepDigSkip, handleSmartSkip])

  useEffect(() => {
    return window.electronAPI.receive('lan:flow-close', () => {
      handleFlowClose()
    })
  }, [handleFlowClose])

  // Live phase feed for the smart generation dialog. The main process
  // broadcasts progress per catalog number; we only surface events that match
  // the number currently being enriched so parallel runs never cross-talk.
  useEffect(() => {
    return window.electronAPI.receive('detail:enrich-progress', (...args: unknown[]) => {
      const progress = args[0] as DetailEnrichProgress | undefined
      if (!progress || progress.catalogNumber !== smartCurrentCatalogRef.current) return
      setAutoFlow(prev => {
        if (prev?.kind !== 'smart-running' || prev.catalogNumber !== progress.catalogNumber) return prev
        return { ...prev, phase: progress.status, platform: progress.platform }
      })
    })
  }, [])

  const handleNewCatalogsViewed = useCallback(() => {
    setLibraryNewCatalogs(new Set())
  }, [])

  const handleTitleClick = useCallback((catalogNumber: string) => {
    window.electronAPI.log('debug', 'app.detail', 'detail modal opened', { catalogNumber })
    setSelectedCatalog(catalogNumber)
    setShowDetailModal(true)
  }, [])

  const handleCurrencyChange = useCallback((currency: DisplayCurrency) => {
    setDisplayCurrency(currency)
    void window.electronAPI.setSetting('displayCurrency', currency).catch(() => {})
  }, [])

  // Load the saved display currency and pre-fetch the USD -> CNY rate once, so
  // toggling between currencies is instant afterwards.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const saved = await window.electronAPI.getSetting('displayCurrency')
      if (!cancelled) setDisplayCurrency(saved === 'CNY' ? 'CNY' : 'USD')
      const rate = await window.electronAPI.getUsdToDisplayRate('CNY')
      if (!cancelled) setUsdToCnyRate(rate)
    })().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Super CD Search</h1>
        <div className="app-header-actions">
          <button
            className="lan-button"
            onClick={() => setShowLanPanel(true)}
            title={t('lan.buttonTitle')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="7" y="2" width="10" height="20" rx="2.5"/>
              <line x1="11" y1="18" x2="13" y2="18"/>
            </svg>
          </button>
          <button
            className="settings-button"
            onClick={() => setShowSettings(true)}
            title={t('settings.buttonTitle')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
        </div>
      </header>
      <nav className="app-tabs" aria-label="Main sections">
        <button className={activeTab === 'search' ? 'active' : ''} onClick={() => setActiveTab('search')}>{t('tab.search')}</button>
        <button className={activeTab === 'library' ? 'active' : ''} onClick={() => setActiveTab('library')}>{t('tab.library')}</button>
      </nav>
      {librarySyncError && <div className="library-sync-error">{librarySyncError}</div>}
      {activeTab === 'search' ? (
      <main className="app-main">
        <aside className="left-panel">
          <div className="panel-header">
            <h2>{t('panel.input')}</h2>
          </div>
          <div className="panel-content">
            <textarea
              className="catalog-input"
              placeholder={t('input.placeholder')}
              value={input}
              onChange={e => handleInputChange(e.target.value)}
              disabled={isLoading || isCancelling || isDeepSearching}
              rows={10}
            />
            {error && <div className="error-message">{error}</div>}
            {mobileNotice && <div className={`mobile-notice ${mobileNotice.kind}`}>{mobileNotice.text}</div>}
            <div className="search-mode-selector">
              <label className="search-mode-label" htmlFor="search-mode">{t('input.searchMode')}</label>
              <div className="search-mode-field">
                <select
                  id="search-mode"
                  className="search-mode-select"
                  value={searchMode}
                  onChange={e => setSearchMode(e.target.value as SearchMode)}
                  disabled={isLoading || isCancelling || isDeepSearching}
                >
                  <option value="standard">{t('searchMode.standard')}</option>
                  <option value="deep">{t('searchMode.deep')}</option>
                </select>
                <svg className="search-mode-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>
              {searchMode === 'deep' && (
                <span className="search-mode-warning" role="img" aria-label={t('searchMode.deepWarningShort')}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <span className="search-mode-warning-tooltip">{t('searchMode.deepWarning')}</span>
                </span>
              )}
            </div>
            <div className="search-actions">
              <button
                className="search-button"
                onClick={handleSearch}
                disabled={isLoading || isCancelling || isDeepSearching}
              >
                {isCancelling ? t('search.cancelling') : isDeepSearching ? t('search.deepDigging') : isLoading ? t('search.searching') : t('search.button')}
              </button>
              {(isLoading || isDeepSearching) && (
                <button
                  className="cancel-button-icon"
                  onClick={handleCancel}
                  disabled={isCancelling}
                  title={t('search.cancelTitle')}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              )}
            </div>
            {(isLoading || isDeepSearching || hasProgress) && (
              <div className="run-progress">
                <div className="progress-summary">
                  {isDeepProgress && <span className="run-progress-badge">{t('progress.deepDig')}</span>}
                  <span className="progress-label">{t('progress.done', { done: completedCount, total: totalCount })}</span>
                  <span className="progress-percent">{progressPercent}%</span>
                </div>
                <div className="progress-bar-track">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <div className="progress-catalogs">
                  {progressCatalogs.map(cn => {
                    const platforms = progressByCatalog.get(cn)
                    const isComplete = platforms?.size === progressPlatforms.length &&
                      progressPlatforms.every(p => {
                        const s = platforms?.get(p)
                        return s === 'complete' || s === 'not_found' || s === 'error' || s === 'challenge'
                      })
                    return (
                      <div key={cn} className={`progress-catalog-item ${isComplete ? 'complete' : ''}`}>
                        <span className="progress-catalog-name">{cn}</span>
                        <div className="progress-platforms">
                          {progressPlatforms.map(p => {
                            const status = platforms?.get(p)
                            return (
                              <span
                                key={p}
                                className={`progress-platform-status ${status || 'pending'}`}
                              >
                                <span className="platform-status-icon">
                                  {status === 'loading' && '⏳'}
                                  {status === 'complete' && '✓'}
                                  {status === 'not_found' && '−'}
                                  {status === 'challenge' && '⚠'}
                                  {status === 'error' && '✗'}
                                  {!status && '○'}
                                </span>
                                <span className="platform-status-label">{PLATFORM_LABELS[p]}</span>
                              </span>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </aside>
        <section className="right-panel">
          <div className="panel-header">
            <h2>{t('panel.results')}</h2>
            <div className="currency-toggle" role="group" aria-label="Currency">
              <button
                type="button"
                className={displayCurrency === 'USD' ? 'active' : ''}
                onClick={() => handleCurrencyChange('USD')}
                title={t('currency.usdTitle')}
              >
                USD
              </button>
              <button
                type="button"
                className={displayCurrency === 'CNY' ? 'active' : ''}
                onClick={() => handleCurrencyChange('CNY')}
                title={t('currency.cnyTitle')}
              >
                CNY
              </button>
            </div>
          </div>
          <div className="panel-content">
            {results.size === 0 && !hasProgress && (
              <div className="placeholder-text">
                <svg className="empty-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <circle cx="24" cy="24" r="20" />
                  <circle cx="24" cy="24" r="12" strokeOpacity="0.5" />
                  <circle cx="24" cy="24" r="3" fill="currentColor" stroke="none" />
                </svg>
                <span>{t('results.placeholder')}</span>
              </div>
            )}
            {isCancelling && (
              <div className="progress-area cancelling">
                <div className="spinner" />
                <p>{t('progress.cancelling')}</p>
              </div>
            )}
            {!isCancelling && hasProgress && results.size === 0 && (
              <div className="progress-area">
                <div className="spinner" />
                <p>{t('progress.querying')}</p>
              </div>
            )}
            {results.size > 0 && (
              <div className="results-area">
                {catalogOrder.map((catalogNumber) => {
                  const resultData = results.get(catalogNumber)
                  if (!resultData) return null
                  return (
                    <ResultCard
                      key={catalogNumber}
                      catalogNumber={catalogNumber}
                      results={resultData}
                      onTitleClick={handleTitleClick}
                      displayCurrency={displayCurrency}
                      usdToCnyRate={usdToCnyRate}
                    />
                  )
                })}
              </div>
            )}
          </div>
        </section>
      </main>
      ) : (
        <main className="app-main library-main">
          <CDLibrary
            refreshVersion={libraryRefreshVersion}
            newCatalogs={libraryNewCatalogs}
            onNewCatalogsViewed={handleNewCatalogsViewed}
          />
        </main>
      )}
      {libraryToast && (
        <div className="app-toast" role="status" aria-live="polite">{libraryToast}</div>
      )}
      <LanPanel isOpen={showLanPanel} onClose={() => setShowLanPanel(false)} />
      <SettingsPanel isOpen={showSettings} onClose={() => setShowSettings(false)} />
      <FlowDialog
        flow={autoFlow}
        onDeepDigConfirm={handleDeepDigConfirm}
        onDeepDigSkip={handleDeepDigSkip}
        onSmartConfirm={handleSmartConfirm}
        onSmartSkip={handleSmartSkip}
        onSmartCancel={handleSmartCancel}
        onClose={handleFlowClose}
      />
      {showDetailModal && selectedCatalog && (
        <DetailModal
          isOpen={showDetailModal}
          onClose={() => setShowDetailModal(false)}
          catalogNumber={selectedCatalog}
          results={results.get(selectedCatalog) || []}
          enrichedDetails={enrichedDetails.get(selectedCatalog)}
        />
      )}
    </div>
  )
}

export default App
