import { describe, it, expect, afterEach } from 'vitest'
import { PassThrough } from 'stream'
import type { IncomingMessage, ServerResponse } from 'http'
import {
  buildLanUrl,
  createLanRequestHandler,
  extractCookieToken,
  extractRequestHost,
  isAllowedRequestHost,
  LanHttpServer
} from '../src/main/lan/server'

class MockResponse {
  statusCode = 200
  headers: Record<string, string | number | string[]> = {}
  body = ''
  private resolveFinished!: () => void
  readonly finished = new Promise<void>(resolve => {
    this.resolveFinished = resolve
  })

  setHeader(name: string, value: string | number | string[]): void {
    this.headers[name] = value
  }

  writeHead(status: number, headers?: Record<string, string | number | string[]>): void {
    this.statusCode = status
    if (headers) Object.assign(this.headers, headers)
  }

  end(data?: string): void {
    if (data) this.body += data
    this.resolveFinished()
  }
}

function callHandler(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  host: string | undefined,
  url: string,
  cookie?: string
): MockResponse {
  const res = new MockResponse()
  const headers: Record<string, string> = {}
  if (host) headers.host = host
  if (cookie) headers.cookie = cookie
  handler({ headers, url } as unknown as IncomingMessage, res as unknown as ServerResponse)
  return res
}

async function callPostHandler(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  body: string | null,
  barcodeHandler?: (barcode: string) => Promise<{ status: string; barcode: string; catalogNumber?: string; title?: string; message?: string }>,
  selectionHandler?: (barcode: string, catalogNumber: string) => Promise<{ status: string; barcode: string; catalogNumber?: string; title?: string; message?: string }>,
  path = '/api/barcode'
): Promise<MockResponse> {
  const res = new MockResponse()
  const req = new PassThrough() as unknown as IncomingMessage & { headers: Record<string, string>; method: string; url: string }
  req.headers = { host: '192.168.1.5:8787', cookie: 'super_cd_lan=token', 'content-type': 'application/json' }
  req.method = 'POST'
  req.url = path

  const requestHandler = barcodeHandler || selectionHandler
    ? createLanRequestHandler('192.168.1.5', 'token', barcodeHandler, selectionHandler)
    : handler
  requestHandler(req as unknown as IncomingMessage, res as unknown as ServerResponse)
  if (body !== null) req.write(body)
  req.end()
  await res.finished
  return res
}

const openServers: LanHttpServer[] = []

afterEach(async () => {
  await Promise.all(openServers.splice(0).map(server => server.stop()))
})

describe('extractRequestHost / isAllowedRequestHost', () => {
  it('strips the port and brackets', () => {
    expect(extractRequestHost('192.168.1.5:8787')).toBe('192.168.1.5')
    expect(extractRequestHost('[fe80::1]:8787')).toBe('fe80::1')
    expect(extractRequestHost('')).toBeNull()
    expect(extractRequestHost(undefined)).toBeNull()
  })

  it('only accepts the exact bound host to block DNS rebinding', () => {
    expect(isAllowedRequestHost('192.168.1.5:8787', '192.168.1.5')).toBe(true)
    expect(isAllowedRequestHost('192.168.1.5', '192.168.1.5')).toBe(true)
    expect(isAllowedRequestHost('evil.example:8787', '192.168.1.5')).toBe(false)
    expect(isAllowedRequestHost('127.0.0.1:1', '127.0.0.1')).toBe(true)
    expect(isAllowedRequestHost('localhost:1', '127.0.0.1')).toBe(true)
    expect(isAllowedRequestHost('localhost', '192.168.1.5')).toBe(false)
  })
})

describe('createLanRequestHandler', () => {
  it('rejects mismatched Host headers with 421', () => {
    const res = callHandler(createLanRequestHandler('192.168.1.5', 'token'), 'attacker.example', '/?token=token')
    expect(res.statusCode).toBe(421)
    expect(res.body).toContain('Misdirected Request')
  })

  it('requires the correct token', () => {
    const handler = createLanRequestHandler('192.168.1.5', 'token')

    expect(callHandler(handler, '192.168.1.5', '/').statusCode).toBe(401)
    expect(callHandler(handler, '192.168.1.5', '/?token=wrong').statusCode).toBe(401)
    expect(callHandler(handler, '192.168.1.5', '/?token=token2').statusCode).toBe(401)
  })

  it('also accepts the token from the cookie for later page loads', () => {
    const handler = createLanRequestHandler('192.168.1.5', 'token')
    const res = callHandler(handler, '192.168.1.5', '/', 'a=1; super_cd_lan=token; b=2')
    expect(res.statusCode).toBe(200)
    expect(callHandler(handler, '192.168.1.5', '/', 'super_cd_lan=wrong').statusCode).toBe(401)
  })

  it('extracts the LAN cookie token safely', () => {
    expect(extractCookieToken(undefined)).toBe('')
    expect(extractCookieToken('a=1; super_cd_lan=abc%2Bdef; b=2')).toBe('abc+def')
    expect(extractCookieToken('super_cd_lan=%')).toBe('%')
  })

  it('serves the connection page with a token cookie', () => {
    const res = callHandler(createLanRequestHandler('192.168.1.5', 'token'), '192.168.1.5:8787', '/?token=token')
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('已连接')
    expect(res.body).toContain('Super CD Search')
    expect(res.headers['Set-Cookie']).toContain('super_cd_lan=token')
  })

  it('serves the scan page and local scanner assets', () => {
    const handler = createLanRequestHandler('192.168.1.5', 'token')

    const page = callHandler(handler, '192.168.1.5', '/?token=token')
    expect(page.body).toContain('快速添加 CD 编号')
    expect(page.body).toContain('file-input')

    const zxing = callHandler(handler, '192.168.1.5', '/zxing.js?token=token')
    expect(zxing.statusCode).toBe(200)
    expect(zxing.body).toContain('ZXingWasmReader')

    const app = callHandler(handler, '192.168.1.5', '/mobile.js?token=token')
    expect(app.statusCode).toBe(200)
    expect(app.body).toContain('decodeBarcodeFile')
  })

  it('serves health checks and 404s unknown paths', () => {
    const handler = createLanRequestHandler('192.168.1.5', 'token')

    const health = callHandler(handler, '192.168.1.5', '/health?token=token')
    expect(health.statusCode).toBe(200)
    expect(JSON.parse(health.body)).toEqual({ ok: true, service: 'super-cd-search' })

    const missing = callHandler(handler, '192.168.1.5', '/other?token=token')
    expect(missing.statusCode).toBe(404)
  })

  it('turns malformed URLs into a 500 response', () => {
    const res = callHandler(createLanRequestHandler('192.168.1.5', 'token'), '192.168.1.5', '//[?token=token')
    expect(res.statusCode).toBe(500)
  })

  it('rejects barcode posts when no lookup handler is configured', async () => {
    const handler = createLanRequestHandler('192.168.1.5', 'token')
    const res = await callPostHandler(handler, JSON.stringify({ barcode: '4988006812345' }))
    expect(res.statusCode).toBe(404)
  })

  it('validates the barcode JSON payload', async () => {
    const handler = createLanRequestHandler('192.168.1.5', 'token', async () => ({
      status: 'added',
      barcode: '4988006812345',
      catalogNumber: 'TOCP-1'
    }))

    expect((await callPostHandler(handler, 'not-json')).statusCode).toBe(400)
    expect((await callPostHandler(handler, JSON.stringify({}))).statusCode).toBe(400)
    expect(JSON.parse((await callPostHandler(handler, JSON.stringify({ barcode: '' }))).body).status).toBe('error')
  })

  it('returns added and unavailable responses from the barcode handler', async () => {
    const handler = createLanRequestHandler('192.168.1.5', 'token', async barcode => {
      if (barcode === '4988006812345') {
        return { status: 'added', barcode, catalogNumber: 'TOCP-1', title: 'Artist - Album' }
      }
      return { status: 'unavailable', barcode, message: 'busy' }
    })

    const added = await callPostHandler(handler, JSON.stringify({ barcode: '4988006812345' }))
    expect(added.statusCode).toBe(200)
    expect(JSON.parse(added.body)).toEqual({
      status: 'added',
      barcode: '4988006812345',
      catalogNumber: 'TOCP-1',
      title: 'Artist - Album'
    })

    const unavailable = await callPostHandler(handler, JSON.stringify({ barcode: '12345678' }))
    expect(unavailable.statusCode).toBe(409)
    expect(JSON.parse(unavailable.body).status).toBe('unavailable')
  })

  it('forwards low-confidence candidate selections to the selection handler', async () => {
    const handler = createLanRequestHandler(
      '192.168.1.5',
      'token',
      async () => ({ status: 'candidates', barcode: '4943674029365' }),
      async (barcode, catalogNumber) => ({
        status: 'added',
        barcode,
        catalogNumber,
        title: 'Luminosa'
      })
    )

    const response = await callPostHandler(
      handler,
      JSON.stringify({ barcode: '4943674029365', catalogNumber: 'WPCS-11100' }),
      undefined,
      async (barcode, catalogNumber) => ({ status: 'added', barcode, catalogNumber, title: 'Luminosa' }),
      '/api/barcode/select'
    )
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toEqual({
      status: 'added',
      barcode: '4943674029365',
      catalogNumber: 'WPCS-11100',
      title: 'Luminosa'
    })

    const missing = await callPostHandler(
      handler,
      JSON.stringify({ barcode: '4943674029365' }),
      undefined,
      async () => ({ status: 'added', barcode: 'x', catalogNumber: 'X' }),
      '/api/barcode/select'
    )
    expect(missing.statusCode).toBe(400)
  })
})

describe('buildLanUrl', () => {
  it('builds a QR URL with the token encoded', () => {
    expect(buildLanUrl('192.168.1.5', 8787, 'a b&c')).toBe('http://192.168.1.5:8787/?token=a%20b%26c')
  })
})

describe('LanHttpServer', () => {
  it('starts on loopback, serves authorized requests and stops', async () => {
    const server = new LanHttpServer()
    openServers.push(server)

    const port = await server.start({ host: '127.0.0.1', port: 0, token: 'integration-token' })
    expect(server.running).toBe(true)
    expect(server.port).toBe(port)
    expect(server.url).toBe(`http://127.0.0.1:${port}/?token=integration-token`)

    const root = await fetch(server.url as string)
    expect(root.status).toBe(200)
    expect(await root.text()).toContain('已连接')

    const health = await fetch(`http://127.0.0.1:${port}/health?token=integration-token`)
    expect(health.status).toBe(200)
    expect(await health.json()).toEqual({ ok: true, service: 'super-cd-search' })

    const unauthorized = await fetch(`http://127.0.0.1:${port}/`)
    expect(unauthorized.status).toBe(401)

    await server.stop()
    expect(server.running).toBe(false)
    expect(server.url).toBeNull()
  })

  it('handles authorized barcode posts end to end', async () => {
    const server = new LanHttpServer()
    openServers.push(server)

    const port = await server.start({
      host: '127.0.0.1',
      port: 0,
      token: 'integration-token',
      handleBarcodeLookup: async barcode => ({ status: 'added', barcode, catalogNumber: 'TOCP-1' })
    })

    const response = await fetch(`http://127.0.0.1:${port}/api/barcode?token=integration-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ barcode: '4988006812345' })
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'added', catalogNumber: 'TOCP-1' })
  })

  it('rejects a second server on the same port', async () => {
    const first = new LanHttpServer()
    const second = new LanHttpServer()
    openServers.push(first, second)

    const port = await first.start({ host: '127.0.0.1', port: 0, token: 'one' })
    await expect(second.start({ host: '127.0.0.1', port, token: 'two' })).rejects.toThrow()
  })
})
