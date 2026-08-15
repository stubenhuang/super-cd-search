import { randomBytes } from 'crypto'
import { BrowserWindow } from 'electron'
import { getSetting, getLanToken, setLanToken } from '../settings'
import { listLanCandidates, selectAutoLanAddress, isAllowedLanIPv4, normalizeLanPort } from './network'
import { LanHttpServer } from './server'
import { isBatchQueryRunning } from '../orchestrator'
import { resolveBarcodeCatalogCached } from '../barcode/resolver'
import { normalizeDiscogsBarcode } from '../queries/discogs'
import { BARCODE_PROVIDER_LABELS } from '../../shared/platforms'
import { logger } from '../logger'
import type {
  BarcodeCatalogCandidate,
  LanBarcodeLookupResponse,
  LanCatalogAddedEvent,
  LanServerStatus
} from '../../shared/types'

export const DEFAULT_LAN_PORT = 8787

const httpServer = new LanHttpServer()

let currentStatus: LanServerStatus = {
  state: 'disabled',
  enabled: false,
  host: '',
  port: DEFAULT_LAN_PORT
}
let lastStart: { host: string; port: number; token: string } | null = null

/** Whether the desktop renderer reported its search controls as idle. */
let rendererSearchAvailable = false

/** How many catalog numbers are currently in the desktop search input. */
let rendererCatalogCount = 0

export function setLanSearchAvailability(available: boolean): void {
  rendererSearchAvailable = available
}

export function setLanSearchCatalogCount(count: number): void {
  rendererCatalogCount = count
}

const MAX_SEARCH_INPUT_CATALOGS = 10

function canAcceptLanBarcodeLookup(): boolean {
  return (
    httpServer.running &&
    BrowserWindow.getAllWindows().length > 0 &&
    !isBatchQueryRunning() &&
    rendererSearchAvailable &&
    rendererCatalogCount < MAX_SEARCH_INPUT_CATALOGS
  )
}

function barcodeUnavailableMessage(): string {
  if (rendererCatalogCount >= MAX_SEARCH_INPUT_CATALOGS) {
    return '桌面搜索框已达到 10 个编号上限，请先移除一些编号'
  }
  return '桌面端正在搜索，请稍后再试'
}

function emitCatalogAdded(event: LanCatalogAddedEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('lan:catalog-added', event)
    }
  }
}

interface PendingBarcodeCandidates {
  candidates: BarcodeCatalogCandidate[]
  expiresAt: number
}

const PENDING_CANDIDATE_TTL_MS = 10 * 60 * 1000
const pendingBarcodeCandidates = new Map<string, PendingBarcodeCandidates>()

function prunePendingCandidates(): void {
  const now = Date.now()
  for (const [barcode, entry] of pendingBarcodeCandidates) {
    if (now > entry.expiresAt) pendingBarcodeCandidates.delete(barcode)
  }
}

function providerNames(providers: BarcodeCatalogCandidate['source'][]): string {
  return providers.map(provider => BARCODE_PROVIDER_LABELS[provider]).join('、')
}

/**
 * Resolve a phone-submitted barcode through the configured provider chain and
 * push the catalog number into the desktop search box. Availability is checked
 * before the (slow) lookups and again right before writing. High-confidence
 * hits are added immediately; low-confidence hits are returned as candidates
 * for the phone user to choose from.
 */
export async function handleLanBarcodeLookup(rawBarcode: string): Promise<LanBarcodeLookupResponse> {
  if (!canAcceptLanBarcodeLookup()) {
    return { status: 'unavailable', barcode: rawBarcode.slice(0, 32), message: barcodeUnavailableMessage() }
  }

  const barcode = normalizeDiscogsBarcode(rawBarcode)
  if (!barcode) {
    return { status: 'error', barcode: rawBarcode.slice(0, 32), message: '条码必须是 8-14 位数字' }
  }

  const resolution = await resolveBarcodeCatalogCached(barcode)

  if (resolution.status === 'found') {
    if (!canAcceptLanBarcodeLookup()) {
      return { status: 'unavailable', barcode, message: barcodeUnavailableMessage() }
    }

    const event: LanCatalogAddedEvent = {
      catalogNumber: resolution.candidate.catalogNumber,
      title: resolution.candidate.title
    }
    emitCatalogAdded(event)
    logger.info('lan', 'catalog number added from phone', {
      catalogNumber: event.catalogNumber,
      source: resolution.candidate.source,
      hasTitle: !!event.title
    })
    return {
      status: 'added',
      barcode,
      catalogNumber: event.catalogNumber,
      title: event.title,
      source: resolution.candidate.source
    }
  }

  if (resolution.status === 'candidates') {
    prunePendingCandidates()
    pendingBarcodeCandidates.set(barcode, {
      candidates: resolution.candidates,
      expiresAt: Date.now() + PENDING_CANDIDATE_TTL_MS
    })
    return {
      status: 'candidates',
      barcode,
      candidates: resolution.candidates,
      message: `在 ${providerNames(resolution.attemptedSources)} 中找到 ${resolution.candidates.length} 个候选，请选择`
    }
  }

  if (resolution.status === 'no_token') {
    return {
      status: 'no_token',
      barcode,
      message: 'Discogs 未配置 Token；其他已启用的条码来源也未找到结果，请先在桌面端设置 Discogs Token'
    }
  }

  if (resolution.status === 'error') {
    return { status: 'error', barcode, message: resolution.message }
  }

  return {
    status: 'not_found',
    barcode,
    message: `已尝试 ${providerNames(resolution.attemptedSources)}，均未找到该条码对应的 CD`
  }
}

/** Confirm one of the low-confidence candidates returned earlier. */
export async function handleLanBarcodeSelection(
  rawBarcode: string,
  rawCatalogNumber: string
): Promise<LanBarcodeLookupResponse> {
  if (!canAcceptLanBarcodeLookup()) {
    return { status: 'unavailable', barcode: rawBarcode.slice(0, 32), message: barcodeUnavailableMessage() }
  }

  const barcode = normalizeDiscogsBarcode(rawBarcode)
  const catalogNumber = rawCatalogNumber.trim().toUpperCase()
  if (!barcode || !catalogNumber) {
    return { status: 'error', barcode: rawBarcode.slice(0, 32), message: '无效的选择请求' }
  }

  prunePendingCandidates()
  const pending = pendingBarcodeCandidates.get(barcode)
  const candidate = pending?.candidates.find(item => item.catalogNumber.toUpperCase() === catalogNumber)
  if (!candidate) {
    return { status: 'error', barcode, message: '候选已过期，请重新扫描条码' }
  }

  pendingBarcodeCandidates.delete(barcode)
  const event: LanCatalogAddedEvent = { catalogNumber: candidate.catalogNumber, title: candidate.title }
  emitCatalogAdded(event)
  logger.info('lan', 'catalog number selected from phone candidate list', {
    catalogNumber: event.catalogNumber,
    source: candidate.source
  })
  return {
    status: 'added',
    barcode,
    catalogNumber: candidate.catalogNumber,
    title: candidate.title,
    source: candidate.source
  }
}

function configuredPort(): number {
  return getSetting('lanPort') ?? DEFAULT_LAN_PORT
}

function ensureToken(): string {
  const existing = getLanToken()
  if (existing) return existing
  const token = randomBytes(24).toString('base64url')
  setLanToken(token)
  return token
}

function errorStatus(message: string, host = ''): LanServerStatus {
  return {
    state: 'error',
    enabled: true,
    host,
    port: configuredPort(),
    error: message
  }
}

function disabledStatus(): LanServerStatus {
  return {
    state: 'disabled',
    enabled: false,
    host: '',
    port: configuredPort()
  }
}

function runningStatus(): LanServerStatus {
  return {
    state: 'running',
    enabled: true,
    host: httpServer.host,
    port: httpServer.port,
    url: httpServer.url ?? undefined
  }
}

/** Start/stop the server to match the persisted LAN settings. */
export async function applyLanServer(): Promise<LanServerStatus> {
  const enabled = getSetting('lanEnabled') === true

  if (!enabled) {
    await httpServer.stop()
    lastStart = null
    currentStatus = disabledStatus()
    return currentStatus
  }

  const requestedHost = (getSetting('lanHost') as string) || ''
  const port = normalizeLanPort(configuredPort())
  if (port === null) {
    await httpServer.stop()
    lastStart = null
    currentStatus = errorStatus('端口必须是 1-65535 之间的整数')
    return currentStatus
  }

  let host: string
  if (requestedHost) {
    if (!isAllowedLanIPv4(requestedHost)) {
      await httpServer.stop()
      lastStart = null
      currentStatus = errorStatus('只允许绑定局域网 IPv4 地址（如 192.168.x.x、10.x.x.x）', requestedHost)
      return currentStatus
    }
    host = requestedHost
  } else {
    const auto = selectAutoLanAddress(listLanCandidates())
    if (!auto) {
      await httpServer.stop()
      lastStart = null
      currentStatus = {
        state: 'no_network',
        enabled: true,
        host: '',
        port,
        error: '未检测到局域网 IPv4 地址，请在下方手动选择绑定的 IP'
      }
      return currentStatus
    }
    host = auto
  }

  const token = ensureToken()
  if (lastStart && httpServer.running && lastStart.host === host && lastStart.port === port && lastStart.token === token) {
    currentStatus = runningStatus()
    return currentStatus
  }

  await httpServer.stop()
  try {
    await httpServer.start({
      host,
      port,
      token,
      handleBarcodeLookup: handleLanBarcodeLookup,
      handleBarcodeSelection: handleLanBarcodeSelection
    })
    lastStart = { host, port, token }
    currentStatus = runningStatus()
    logger.info('lan', 'LAN server started', { host, port })
  } catch (err) {
    lastStart = null
    const message = err instanceof Error ? err.message : String(err)
    currentStatus = errorStatus(message, host)
    logger.warn('lan', 'LAN server failed to start', { host, port, error: message })
  }
  return currentStatus
}

/** Rotate the access token and restart the server (when enabled). */
export async function regenerateLanToken(): Promise<LanServerStatus> {
  setLanToken(randomBytes(24).toString('base64url'))
  lastStart = null
  logger.info('lan', 'LAN access token regenerated')
  return applyLanServer()
}

export function getLanServerStatus(): LanServerStatus {
  if (getSetting('lanEnabled') !== true) return disabledStatus()
  return currentStatus
}

export async function closeLanServer(): Promise<void> {
  await httpServer.stop()
  lastStart = null
}

export { listLanCandidates }
