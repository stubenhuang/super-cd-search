import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { timingSafeEqual } from 'crypto'
import type { AddressInfo } from 'net'
import type { PublishPlatform, PublishSnapshot, LanBarcodeLookupResponse, LanSearchState, LanSearchStatusResponse } from '../../shared/types'
import { MOBILE_APP_JS, MOBILE_PAGE_HTML, MOBILE_ZXING_JS } from './mobile'

export type LanBarcodeLookupHandler = (barcode: string) => Promise<LanBarcodeLookupResponse>

export type LanBarcodeSelectionHandler = (
  barcode: string,
  catalogNumber: string
) => Promise<LanBarcodeLookupResponse>

/** Cover image bytes served to the phone for one publish item. */
export interface LanPublishImage {
  buffer: Buffer
  mimeType: 'image/png' | 'image/jpeg'
}

export interface LanPublishStatusResponse {
  status: 'ok' | 'error'
  message?: string
}

export type PublishChangeKind = 'changed' | 'finished'

/** Phone/desktop-facing publish batch API backed by the desktop library storage. */
export interface LanPublishHandlers {
  list: () => Promise<PublishSnapshot>
  setPublished: (catalogNumber: string, published: boolean) => Promise<LanPublishStatusResponse>
  setPlatforms: (catalogNumber: string, platforms: PublishPlatform[]) => Promise<LanPublishStatusResponse>
  image: (catalogNumber: string) => Promise<LanPublishImage | null>
  /** SSE subscription: the returned unsubscribe drops the connection's listener. */
  subscribe: (listener: (kind: PublishChangeKind) => void) => () => void
}

/**
 * Phone-facing remote-search API backed by the desktop search state machine.
 * `setInput` replaces the desktop search box text; `run` starts the desktop
 * search pipeline with whatever the desktop box currently holds; `setMode`
 * switches the desktop search mode; `flow` drives the post-search dialogs
 * (deep dig / smart generation confirm, skip, close).
 */
export interface LanSearchHandlers {
  /** Latest search state machine snapshot pushed by the desktop renderer. */
  getState: () => LanSearchState
  setInput: (text: string) => LanSearchStatusResponse | Promise<LanSearchStatusResponse>
  run: () => LanSearchStatusResponse | Promise<LanSearchStatusResponse>
  setMode: (mode: string) => LanSearchStatusResponse | Promise<LanSearchStatusResponse>
  flow: (action: 'confirm' | 'skip' | 'close') => LanSearchStatusResponse | Promise<LanSearchStatusResponse>
}

export interface LanServerBindOptions {
  /** IPv4 address to bind to. The manager only passes private/loopback IPs. */
  host: string
  port: number
  /** Random access token embedded in the QR URL. */
  token: string
  /** Resolves a phone-submitted barcode to a desktop catalog number. */
  handleBarcodeLookup?: LanBarcodeLookupHandler
  /** Confirms one of the low-confidence catalog-number candidates. */
  handleBarcodeSelection?: LanBarcodeSelectionHandler
  /** Publish batch API for the phone "发布" tab. */
  publishHandlers?: LanPublishHandlers
  /** Remote-search API for the phone "搜索" tab. */
  searchHandlers?: LanSearchHandlers
}

function securityHeaders(res: ServerResponse): void {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  )
}

function sendText(res: ServerResponse, status: number, body: string, contentType = 'text/plain; charset=utf-8'): void {
  securityHeaders(res)
  res.writeHead(status, { 'Content-Type': contentType })
  res.end(body)
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  securityHeaders(res)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

const MAX_JSON_BODY_BYTES = 1024

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_JSON_BODY_BYTES) {
        reject(new Error('Request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new Error('JSON body must be an object'))
          return
        }
        resolve(parsed as Record<string, unknown>)
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

function tokensMatch(expected: string, received: string): boolean {
  const a = Buffer.from(expected)
  const b = Buffer.from(received)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function extractCookieToken(cookieHeader: string | undefined): string {
  if (!cookieHeader) return ''
  const match = /(?:^|;\s*)super_cd_lan=([^;]*)/.exec(cookieHeader)
  if (!match) return ''
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

/**
 * The Host header must match the bound LAN address. This blocks DNS-rebinding
 * style requests (e.g. a public hostname resolving to the private IP), which
 * is part of keeping the feature LAN-only.
 */
export function extractRequestHost(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null
  let host = hostHeader.trim().toLowerCase()
  if (!host) return null

  // [ipv6]:port form.
  if (host.startsWith('[')) {
    const close = host.indexOf(']')
    if (close > 0) return host.slice(1, close)
    return null
  }

  // Strip the port for plain IPv4 host headers.
  const colon = host.lastIndexOf(':')
  if (colon > 0 && host.indexOf(':') === colon) {
    host = host.slice(0, colon)
  }
  return host || null
}

export function isAllowedRequestHost(hostHeader: string | undefined, boundHost: string): boolean {
  const requestHost = extractRequestHost(hostHeader)
  if (!requestHost) return false
  if (requestHost === boundHost.toLowerCase()) return true

  // Loopback-bound servers (development only) also accept localhost forms.
  if (boundHost === '127.0.0.1') {
    return requestHost === 'localhost' || requestHost === '127.0.0.1'
  }
  return false
}

export function createLanRequestHandler(
  boundHost: string,
  token: string,
  handleBarcodeLookup?: LanBarcodeLookupHandler,
  handleBarcodeSelection?: LanBarcodeSelectionHandler,
  publishHandlers?: LanPublishHandlers,
  searchHandlers?: LanSearchHandlers,
  sseConnections: Set<ServerResponse> = new Set()
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    void (async () => {
      try {
        if (!isAllowedRequestHost(req.headers.host, boundHost)) {
          sendText(res, 421, 'Misdirected Request')
          return
        }

        const url = new URL(req.url ?? '/', `http://${boundHost}`)
        const urlToken = url.searchParams.get('token') ?? ''
        const cookieToken = extractCookieToken(req.headers.cookie)
        if (!tokensMatch(token, urlToken) && !tokensMatch(token, cookieToken)) {
          sendText(res, 401, 'Unauthorized')
          return
        }

        res.setHeader('Set-Cookie', `super_cd_lan=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict`)

        if (url.pathname === '/' || url.pathname === '/index.html') {
          sendText(res, 200, MOBILE_PAGE_HTML, 'text/html; charset=utf-8')
          return
        }

        if (url.pathname === '/zxing.js') {
          sendText(res, 200, MOBILE_ZXING_JS, 'text/javascript; charset=utf-8')
          return
        }

        if (url.pathname === '/mobile.js') {
          sendText(res, 200, MOBILE_APP_JS, 'text/javascript; charset=utf-8')
          return
        }

        if (url.pathname === '/health') {
          securityHeaders(res)
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, service: 'super-cd-search' }))
          return
        }

        if (url.pathname === '/api/publish/list' && (req.method ?? 'GET') === 'GET') {
          if (!publishHandlers) {
            sendJson(res, 404, { status: 'error', message: 'Publish is disabled' })
            return
          }
          try {
            sendJson(res, 200, await publishHandlers.list())
          } catch {
            sendJson(res, 500, { status: 'error', message: '无法读取发布内容' })
          }
          return
        }

        if (url.pathname === '/api/publish/state' && req.method === 'POST') {
          if (!publishHandlers) {
            sendJson(res, 404, { status: 'error', message: 'Publish is disabled' })
            return
          }
          let body: Record<string, unknown>
          try {
            body = await readJsonBody(req)
          } catch {
            sendJson(res, 400, { status: 'error', message: 'Invalid JSON body' })
            return
          }
          const rawCatalog = typeof body.catalogNumber === 'string' ? body.catalogNumber.trim() : ''
          if (!rawCatalog || typeof body.published !== 'boolean') {
            sendJson(res, 400, { status: 'error', message: 'Missing catalogNumber or published' })
            return
          }
          sendJson(res, 200, await publishHandlers.setPublished(rawCatalog, body.published))
          return
        }

        if (url.pathname === '/api/publish/platforms' && req.method === 'POST') {
          if (!publishHandlers) {
            sendJson(res, 404, { status: 'error', message: 'Publish is disabled' })
            return
          }
          let body: Record<string, unknown>
          try {
            body = await readJsonBody(req)
          } catch {
            sendJson(res, 400, { status: 'error', message: 'Invalid JSON body' })
            return
          }
          const rawCatalog = typeof body.catalogNumber === 'string' ? body.catalogNumber.trim() : ''
          const platforms = body.platforms
          if (!rawCatalog || !Array.isArray(platforms) || platforms.some(item => typeof item !== 'string')) {
            sendJson(res, 400, { status: 'error', message: 'Missing catalogNumber or platforms' })
            return
          }
          sendJson(res, 200, await publishHandlers.setPlatforms(rawCatalog, platforms as PublishPlatform[]))
          return
        }

        if (url.pathname === '/api/publish/events' && (req.method ?? 'GET') === 'GET') {
          if (!publishHandlers) {
            sendText(res, 404, 'Not Found')
            return
          }
          securityHeaders(res)
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-store',
            Connection: 'keep-alive'
          })
          res.write('retry: 2000\n\n')
          sseConnections.add(res)
          const unsubscribe = publishHandlers.subscribe(kind => {
            res.write(`event: ${kind}\ndata: {}\n\n`)
          })
          // Comment frames keep proxies/NATs from closing the idle stream.
          const heartbeat = setInterval(() => {
            res.write(': ping\n\n')
          }, 15000)
          const cleanup = (): void => {
            clearInterval(heartbeat)
            unsubscribe()
            sseConnections.delete(res)
          }
          req.on('close', cleanup)
          res.on('close', cleanup)
          return
        }

        if (url.pathname === '/publish/image' && (req.method ?? 'GET') === 'GET') {
          if (!publishHandlers) {
            sendText(res, 404, 'Not Found')
            return
          }
          const catalog = (url.searchParams.get('catalog') ?? '').trim()
          if (!catalog) {
            sendText(res, 400, 'Missing catalog')
            return
          }
          try {
            const image = await publishHandlers.image(catalog)
            if (!image) {
              sendText(res, 404, 'Not Found')
              return
            }
            securityHeaders(res)
            res.writeHead(200, { 'Content-Type': image.mimeType })
            res.end(image.buffer)
          } catch {
            sendText(res, 500, 'Internal Server Error')
          }
          return
        }

        if (url.pathname === '/api/barcode' && req.method === 'POST') {
          if (!handleBarcodeLookup) {
            sendJson(res, 404, { status: 'error', barcode: '', message: 'Barcode lookup is disabled' })
            return
          }

          let body: Record<string, unknown>
          try {
            body = await readJsonBody(req)
          } catch {
            sendJson(res, 400, { status: 'error', barcode: '', message: 'Invalid JSON body' })
            return
          }

          const rawBarcode = typeof body.barcode === 'string' ? body.barcode.trim() : ''
          if (!rawBarcode) {
            sendJson(res, 400, { status: 'error', barcode: '', message: 'Missing barcode' })
            return
          }

          const response = await handleBarcodeLookup(rawBarcode)
          sendJson(res, response.status === 'unavailable' ? 409 : 200, response)
          return
        }

        if (url.pathname === '/api/barcode/select' && req.method === 'POST') {
          if (!handleBarcodeSelection) {
            sendJson(res, 404, { status: 'error', barcode: '', message: 'Candidate selection is disabled' })
            return
          }

          let body: Record<string, unknown>
          try {
            body = await readJsonBody(req)
          } catch {
            sendJson(res, 400, { status: 'error', barcode: '', message: 'Invalid JSON body' })
            return
          }

          const rawBarcode = typeof body.barcode === 'string' ? body.barcode.trim() : ''
          const rawCatalogNumber = typeof body.catalogNumber === 'string' ? body.catalogNumber.trim() : ''
          if (!rawBarcode || !rawCatalogNumber) {
            sendJson(res, 400, { status: 'error', barcode: rawBarcode, message: 'Missing barcode or catalogNumber' })
            return
          }

          const response = await handleBarcodeSelection(rawBarcode, rawCatalogNumber)
          sendJson(res, response.status === 'unavailable' ? 409 : 200, response)
          return
        }

        if (url.pathname === '/api/search/state' && (req.method ?? 'GET') === 'GET') {
          if (!searchHandlers) {
            sendJson(res, 404, { status: 'error', message: 'Remote search is disabled' })
            return
          }
          sendJson(res, 200, { status: 'ok', state: searchHandlers.getState() })
          return
        }

        if (url.pathname === '/api/search/input' && req.method === 'POST') {
          if (!searchHandlers) {
            sendJson(res, 404, { status: 'error', message: 'Remote search is disabled' })
            return
          }

          let body: Record<string, unknown>
          try {
            body = await readJsonBody(req)
          } catch {
            sendJson(res, 400, { status: 'error', message: 'Invalid JSON body' })
            return
          }

          const text = typeof body.text === 'string' ? body.text : null
          if (text === null) {
            sendJson(res, 400, { status: 'error', message: 'Missing text' })
            return
          }

          const response = await searchHandlers.setInput(text)
          const status = response.status === 'unavailable' ? 409 : response.status === 'error' ? 400 : 200
          sendJson(res, status, response)
          return
        }

        if (url.pathname === '/api/search/run' && req.method === 'POST') {
          if (!searchHandlers) {
            sendJson(res, 404, { status: 'error', message: 'Remote search is disabled' })
            return
          }

          const response = await searchHandlers.run()
          const status = response.status === 'unavailable' ? 409 : response.status === 'error' ? 400 : 200
          sendJson(res, status, response)
          return
        }

        if (url.pathname === '/api/search/mode' && req.method === 'POST') {
          if (!searchHandlers) {
            sendJson(res, 404, { status: 'error', message: 'Remote search is disabled' })
            return
          }

          let body: Record<string, unknown>
          try {
            body = await readJsonBody(req)
          } catch {
            sendJson(res, 400, { status: 'error', message: 'Invalid JSON body' })
            return
          }

          const mode = typeof body.mode === 'string' ? body.mode : ''
          if (mode !== 'standard' && mode !== 'deep') {
            sendJson(res, 400, { status: 'error', message: 'Invalid mode' })
            return
          }

          const response = await searchHandlers.setMode(mode)
          const status = response.status === 'unavailable' ? 409 : response.status === 'error' ? 400 : 200
          sendJson(res, status, response)
          return
        }

        if (
          (url.pathname === '/api/search/flow/confirm' ||
            url.pathname === '/api/search/flow/skip' ||
            url.pathname === '/api/search/flow/close') &&
          req.method === 'POST'
        ) {
          if (!searchHandlers) {
            sendJson(res, 404, { status: 'error', message: 'Remote search is disabled' })
            return
          }

          const action = url.pathname === '/api/search/flow/confirm'
            ? 'confirm'
            : url.pathname === '/api/search/flow/skip'
              ? 'skip'
              : 'close'
          const response = await searchHandlers.flow(action)
          const status = response.status === 'unavailable' ? 409 : response.status === 'error' ? 400 : 200
          sendJson(res, status, response)
          return
        }

        sendText(res, 404, 'Not Found')
      } catch {
        if (!res.headersSent) sendText(res, 500, 'Internal Server Error')
      }
    })()
  }
}

export function buildLanUrl(host: string, port: number, token: string): string {
  return `http://${host}:${port}/?token=${encodeURIComponent(token)}`
}

export class LanHttpServer {
  private server: Server | null = null
  private boundHost = ''
  private boundPort = 0
  private token = ''
  private sseConnections = new Set<ServerResponse>()

  async start(options: LanServerBindOptions): Promise<number> {
    await this.stop()

    const sseConnections = new Set<ServerResponse>()
    const handler = createLanRequestHandler(
      options.host,
      options.token,
      options.handleBarcodeLookup,
      options.handleBarcodeSelection,
      options.publishHandlers,
      options.searchHandlers,
      sseConnections
    )
    const server = createServer(handler)
    server.keepAliveTimeout = 5000
    server.headersTimeout = 6000
    server.on('clientError', (_err, socket) => {
      if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
    })

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error): void => {
        server.removeListener('listening', onListening)
        reject(err)
      }
      const onListening = (): void => {
        server.removeListener('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(options.port, options.host)
    })

    const address = server.address() as AddressInfo
    this.server = server
    this.boundHost = options.host
    this.boundPort = address.port
    this.token = options.token
    this.sseConnections = sseConnections
    return this.boundPort
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    this.boundPort = 0
    this.token = ''
    // SSE streams never end on their own; destroy them or close() hangs forever.
    for (const res of this.sseConnections) res.destroy()
    this.sseConnections = new Set()
    if (!server) return
    await new Promise<void>(resolve => {
      server.close(() => resolve())
      server.closeIdleConnections()
    })
  }

  get running(): boolean {
    return this.server !== null
  }

  get host(): string {
    return this.boundHost
  }

  get port(): number {
    return this.boundPort
  }

  get url(): string | null {
    if (!this.running || this.boundPort === 0 || !this.token) return null
    return buildLanUrl(this.boundHost, this.boundPort, this.token)
  }
}
