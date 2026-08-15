import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { timingSafeEqual } from 'crypto'
import type { AddressInfo } from 'net'
import type { LanBarcodeLookupResponse } from '../../shared/types'
import { MOBILE_APP_JS, MOBILE_PAGE_HTML, MOBILE_ZXING_JS } from './mobile'

export type LanBarcodeLookupHandler = (barcode: string) => Promise<LanBarcodeLookupResponse>

export type LanBarcodeSelectionHandler = (barcode: string, catalogNumber: string) => Promise<LanBarcodeLookupResponse>

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
}

function securityHeaders(res: ServerResponse): void {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
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
  handleBarcodeSelection?: LanBarcodeSelectionHandler
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

  async start(options: LanServerBindOptions): Promise<number> {
    await this.stop()

    const handler = createLanRequestHandler(
      options.host,
      options.token,
      options.handleBarcodeLookup,
      options.handleBarcodeSelection
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
    return this.boundPort
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    this.boundPort = 0
    this.token = ''
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
