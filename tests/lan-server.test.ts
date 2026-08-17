import { describe, it, expect, vi, afterEach } from 'vitest'
import { PassThrough } from 'stream'
import type { IncomingMessage, ServerResponse } from 'http'
import {
  buildLanUrl,
  createLanRequestHandler,
  extractCookieToken,
  extractRequestHost,
  isAllowedRequestHost,
  LanHttpServer,
  type LanPublishHandlers,
  type LanSearchHandlers
} from '../src/main/lan/server'
import type { LanSearchState } from '../src/shared/types'

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

async function callGetHandler(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  url: string
): Promise<MockResponse> {
  const res = new MockResponse()
  const headers: Record<string, string> = { host: '192.168.1.5:8787', cookie: 'super_cd_lan=token' }
  handler({ headers, url, method: 'GET' } as unknown as IncomingMessage, res as unknown as ServerResponse)
  await res.finished
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

  it('serves the search page and local scanner assets', () => {
    const handler = createLanRequestHandler('192.168.1.5', 'token')

    const page = callHandler(handler, '192.168.1.5', '/?token=token')
    expect(page.body).toContain('远程搜索')
    expect(page.body).toContain('search-input')
    expect(page.body).toContain('tab-search')
    expect(page.body).toContain('mode-standard')
    expect(page.body).toContain('flow-dialog')
    expect(page.body).toContain('file-input')
    // Manual barcode entry was removed; only camera scanning remains.
    expect(page.body).not.toContain('barcode-input')
    expect(page.body).not.toContain('手动输入条码')

    const zxing = callHandler(handler, '192.168.1.5', '/zxing.js?token=token')
    expect(zxing.statusCode).toBe(200)
    expect(zxing.body).toContain('ZXingWasmReader')

    const app = callHandler(handler, '192.168.1.5', '/mobile.js?token=token')
    expect(app.statusCode).toBe(200)
    expect(app.body).toContain('decodeBarcodeFile')
    expect(app.body).toContain('/api/search/input')
    expect(app.body).toContain('/api/search/state')
    expect(app.body).toContain('/api/search/mode')
    expect(app.body).toContain('/api/search/flow/')
    expect(app.body).not.toContain('barcode-input')
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

function mockPublishHandlers(overrides: Partial<LanPublishHandlers> = {}): LanPublishHandlers {
  return {
    list: async () => ({
      publishedAt: 1710000000000,
      items: [
        {
          catalogNumber: 'TOCP-1',
          imageUrl: '',
          hasEmbeddedImage: false,
          details: 'detail text',
          lowestPriceUsd: 1,
          highestPriceUsd: 2,
          lowestPriceCny: null,
          highestPriceCny: null,
          published: false,
          platforms: []
        }
      ]
    }),
    subscribe: () => () => {},
    setPublished: async () => ({ status: 'ok' }),
    setPlatforms: async () => ({ status: 'ok' }),
    image: async () => null,
    ...overrides
  }
}

function mockSearchState(overrides: Partial<LanSearchState> = {}): LanSearchState {
  return {
    phase: 'idle',
    input: '',
    busy: false,
    searchMode: 'standard',
    catalogs: [],
    platforms: [],
    total: 0,
    completed: 0,
    percent: 0,
    progress: [],
    inserted: 0,
    updated: 0,
    error: null,
    ...overrides
  }
}

function mockSearchHandlers(overrides: Partial<LanSearchHandlers> = {}): LanSearchHandlers {
  return {
    getState: () => mockSearchState(),
    setInput: async () => ({ status: 'ok' }),
    run: async () => ({ status: 'ok' }),
    ...overrides
  }
}

describe('createLanRequestHandler publish routes', () => {
  it('requires authentication for publish endpoints', () => {
    const handler = createLanRequestHandler('192.168.1.5', 'token', undefined, undefined, mockPublishHandlers())
    expect(callHandler(handler, '192.168.1.5', '/api/publish/list').statusCode).toBe(401)
    expect(callHandler(handler, '192.168.1.5', '/api/publish/events').statusCode).toBe(401)
    expect(callHandler(handler, '192.168.1.5', '/publish/image?catalog=X').statusCode).toBe(401)
  })

  it('rejects publish routes when no handlers are configured', async () => {
    const handler = createLanRequestHandler('192.168.1.5', 'token')
    expect(callHandler(handler, '192.168.1.5', '/api/publish/list?token=token').statusCode).toBe(404)
    expect((await callGetHandler(handler, '/api/publish/events?token=token')).statusCode).toBe(404)
    expect(callHandler(handler, '192.168.1.5', '/publish/image?catalog=X&token=token').statusCode).toBe(404)
  })

  it('serves the publish snapshot', async () => {
    const handler = createLanRequestHandler('192.168.1.5', 'token', undefined, undefined, mockPublishHandlers())
    const res = await callGetHandler(handler, '/api/publish/list')
    expect(res.statusCode).toBe(200)
    const snapshot = JSON.parse(res.body)
    expect(snapshot.publishedAt).toBe(1710000000000)
    expect(snapshot.items[0].catalogNumber).toBe('TOCP-1')
  })

  it('turns publish list failures into a 500 response', async () => {
    const handler = createLanRequestHandler(
      '192.168.1.5',
      'token',
      undefined,
      undefined,
      mockPublishHandlers({ list: async () => { throw new Error('db down') } })
    )
    expect((await callGetHandler(handler, '/api/publish/list')).statusCode).toBe(500)
  })

  it('validates publish-state bodies', async () => {
    const calls: Array<[string, boolean]> = []
    const handler = createLanRequestHandler(
      '192.168.1.5',
      'token',
      undefined,
      undefined,
      mockPublishHandlers({
        setPublished: async (catalogNumber, published) => {
          calls.push([catalogNumber, published])
          return { status: 'ok' }
        }
      })
    )

    const ok = await callPostHandler(handler, JSON.stringify({ catalogNumber: 'TOCP-1', published: true }), undefined, undefined, '/api/publish/state')
    expect(ok.statusCode).toBe(200)
    expect(JSON.parse(ok.body).status).toBe('ok')
    expect(calls).toEqual([['TOCP-1', true]])

    expect((await callPostHandler(handler, 'not-json', undefined, undefined, '/api/publish/state')).statusCode).toBe(400)
    expect((await callPostHandler(handler, JSON.stringify({ catalogNumber: 'TOCP-1' }), undefined, undefined, '/api/publish/state')).statusCode).toBe(400)
    expect((await callPostHandler(handler, JSON.stringify({ published: true }), undefined, undefined, '/api/publish/state')).statusCode).toBe(400)
  })

  it('validates platform bodies', async () => {
    const calls: Array<[string, string[]]> = []
    const handler = createLanRequestHandler(
      '192.168.1.5',
      'token',
      undefined,
      undefined,
      mockPublishHandlers({
        setPlatforms: async (catalogNumber, platforms) => {
          calls.push([catalogNumber, [...platforms]])
          return { status: 'ok' }
        }
      })
    )

    const ok = await callPostHandler(
      handler,
      JSON.stringify({ catalogNumber: 'TOCP-1', platforms: ['taobao', 'xianyu'] }),
      undefined,
      undefined,
      '/api/publish/platforms'
    )
    expect(ok.statusCode).toBe(200)
    expect(calls).toEqual([['TOCP-1', ['taobao', 'xianyu']]])

    expect((await callPostHandler(handler, JSON.stringify({ catalogNumber: 'TOCP-1' }), undefined, undefined, '/api/publish/platforms')).statusCode).toBe(400)
    expect((await callPostHandler(handler, JSON.stringify({ catalogNumber: 'TOCP-1', platforms: 'taobao' }), undefined, undefined, '/api/publish/platforms')).statusCode).toBe(400)
    expect((await callPostHandler(handler, JSON.stringify({ catalogNumber: 'TOCP-1', platforms: [1] }), undefined, undefined, '/api/publish/platforms')).statusCode).toBe(400)
  })

  it('validates the publish image query parameter', async () => {
    const handler = createLanRequestHandler('192.168.1.5', 'token', undefined, undefined, mockPublishHandlers())
    expect((await callGetHandler(handler, '/publish/image')).statusCode).toBe(400)
    expect((await callGetHandler(handler, '/publish/image?catalog=')).statusCode).toBe(400)
    expect((await callGetHandler(handler, '/publish/image?catalog=TOCP-1')).statusCode).toBe(404)
  })
})

describe('createLanRequestHandler search routes', () => {
  it('requires authentication for search endpoints', () => {
    const handler = createLanRequestHandler('192.168.1.5', 'token', undefined, undefined, undefined, mockSearchHandlers())
    expect(callHandler(handler, '192.168.1.5', '/api/search/state').statusCode).toBe(401)
    expect(callHandler(handler, '192.168.1.5', '/api/search/input').statusCode).toBe(401)
    expect(callHandler(handler, '192.168.1.5', '/api/search/run').statusCode).toBe(401)
    expect(callHandler(handler, '192.168.1.5', '/api/search/mode').statusCode).toBe(401)
    expect(callHandler(handler, '192.168.1.5', '/api/search/flow/confirm').statusCode).toBe(401)
    expect(callHandler(handler, '192.168.1.5', '/api/search/flow/skip').statusCode).toBe(401)
    expect(callHandler(handler, '192.168.1.5', '/api/search/flow/close').statusCode).toBe(401)
  })

  it('rejects search routes when no handlers are configured', async () => {
    const handler = createLanRequestHandler('192.168.1.5', 'token')
    expect(callHandler(handler, '192.168.1.5', '/api/search/state?token=token').statusCode).toBe(404)
    expect((await callPostHandler(handler, JSON.stringify({ text: 'x' }), undefined, undefined, '/api/search/input')).statusCode).toBe(404)
    expect((await callPostHandler(handler, null, undefined, undefined, '/api/search/run')).statusCode).toBe(404)
    expect((await callPostHandler(handler, JSON.stringify({ mode: 'deep' }), undefined, undefined, '/api/search/mode')).statusCode).toBe(404)
    expect((await callPostHandler(handler, null, undefined, undefined, '/api/search/flow/confirm')).statusCode).toBe(404)
  })

  it('serves the stored search state snapshot', async () => {
    const handler = createLanRequestHandler(
      '192.168.1.5',
      'token',
      undefined,
      undefined,
      undefined,
      mockSearchHandlers({
        getState: () => mockSearchState({
          phase: 'searching',
          input: 'TOCP-1',
          busy: true,
          total: 1,
          completed: 1,
          percent: 100,
          inserted: 2,
          updated: 1
        })
      })
    )
    const res = await callGetHandler(handler, '/api/search/state')
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).state).toMatchObject({
      phase: 'searching',
      input: 'TOCP-1',
      busy: true,
      total: 1,
      percent: 100,
      inserted: 2,
      updated: 1
    })
  })

  it('validates search-input bodies and forwards the text', async () => {
    const calls: string[] = []
    const handler = createLanRequestHandler(
      '192.168.1.5',
      'token',
      undefined,
      undefined,
      undefined,
      mockSearchHandlers({
        setInput: async (text: string) => {
          calls.push(text)
          return { status: 'ok' }
        }
      })
    )

    const ok = await callPostHandler(handler, JSON.stringify({ text: 'TOCP-1\nVICP-2' }), undefined, undefined, '/api/search/input')
    expect(ok.statusCode).toBe(200)
    expect(JSON.parse(ok.body).status).toBe('ok')
    expect(calls).toEqual(['TOCP-1\nVICP-2'])

    expect((await callPostHandler(handler, 'not-json', undefined, undefined, '/api/search/input')).statusCode).toBe(400)
    expect((await callPostHandler(handler, JSON.stringify({}), undefined, undefined, '/api/search/input')).statusCode).toBe(400)
    expect((await callPostHandler(handler, JSON.stringify({ text: 42 }), undefined, undefined, '/api/search/input')).statusCode).toBe(400)
  })

  it('maps search-control rejections to the right status codes', async () => {
    const handler = createLanRequestHandler(
      '192.168.1.5',
      'token',
      undefined,
      undefined,
      undefined,
      mockSearchHandlers({
        setInput: async () => ({ status: 'unavailable', message: 'busy' }),
        run: async () => ({ status: 'error', message: 'empty box' })
      })
    )

    const input = await callPostHandler(handler, JSON.stringify({ text: 'x' }), undefined, undefined, '/api/search/input')
    expect(input.statusCode).toBe(409)
    expect(JSON.parse(input.body)).toEqual({ status: 'unavailable', message: 'busy' })

    const run = await callPostHandler(handler, null, undefined, undefined, '/api/search/run')
    expect(run.statusCode).toBe(400)
    expect(JSON.parse(run.body)).toEqual({ status: 'error', message: 'empty box' })
  })

  it('starts a remote search', async () => {
    const run = vi.fn(async () => ({ status: 'ok' }))
    const handler = createLanRequestHandler(
      '192.168.1.5',
      'token',
      undefined,
      undefined,
      undefined,
      mockSearchHandlers({ run })
    )
    const res = await callPostHandler(handler, null, undefined, undefined, '/api/search/run')
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).status).toBe('ok')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('validates search-mode bodies and forwards the mode', async () => {
    const calls: string[] = []
    const handler = createLanRequestHandler(
      '192.168.1.5',
      'token',
      undefined,
      undefined,
      undefined,
      mockSearchHandlers({
        setMode: async (mode: string) => {
          calls.push(mode)
          return { status: 'ok' }
        }
      })
    )

    const ok = await callPostHandler(handler, JSON.stringify({ mode: 'deep' }), undefined, undefined, '/api/search/mode')
    expect(ok.statusCode).toBe(200)
    expect(JSON.parse(ok.body).status).toBe('ok')
    expect(calls).toEqual(['deep'])

    expect((await callPostHandler(handler, JSON.stringify({}), undefined, undefined, '/api/search/mode')).statusCode).toBe(400)
    expect((await callPostHandler(handler, JSON.stringify({ mode: 'bogus' }), undefined, undefined, '/api/search/mode')).statusCode).toBe(400)
    expect((await callPostHandler(handler, JSON.stringify({ mode: 1 }), undefined, undefined, '/api/search/mode')).statusCode).toBe(400)
  })

  it('drives post-search flow actions', async () => {
    const actions: string[] = []
    const handler = createLanRequestHandler(
      '192.168.1.5',
      'token',
      undefined,
      undefined,
      undefined,
      mockSearchHandlers({
        flow: async (action: 'confirm' | 'skip' | 'close') => {
          actions.push(action)
          return { status: 'ok' }
        }
      })
    )

    for (const action of ['confirm', 'skip', 'close']) {
      const res = await callPostHandler(handler, null, undefined, undefined, '/api/search/flow/' + action)
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body).status).toBe('ok')
    }
    expect(actions).toEqual(['confirm', 'skip', 'close'])
  })

  it('maps unavailable search-control rejections to 409', async () => {
    const handler = createLanRequestHandler(
      '192.168.1.5',
      'token',
      undefined,
      undefined,
      undefined,
      mockSearchHandlers({
        setMode: async () => ({ status: 'unavailable', message: 'busy' }),
        flow: async () => ({ status: 'unavailable', message: 'busy' })
      })
    )

    const mode = await callPostHandler(handler, JSON.stringify({ mode: 'deep' }), undefined, undefined, '/api/search/mode')
    expect(mode.statusCode).toBe(409)
    expect(JSON.parse(mode.body)).toEqual({ status: 'unavailable', message: 'busy' })

    const flow = await callPostHandler(handler, null, undefined, undefined, '/api/search/flow/confirm')
    expect(flow.statusCode).toBe(409)
    expect(JSON.parse(flow.body)).toEqual({ status: 'unavailable', message: 'busy' })
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

  it('serves publish cover images as binary responses', async () => {
    const server = new LanHttpServer()
    openServers.push(server)
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')

    const port = await server.start({
      host: '127.0.0.1',
      port: 0,
      token: 'integration-token',
      publishHandlers: mockPublishHandlers({
        image: async () => ({ buffer: png, mimeType: 'image/png' })
      })
    })

    const response = await fetch(`http://127.0.0.1:${port}/publish/image?catalog=TOCP-1&token=integration-token`)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png)
  })

  it('streams publish changes over SSE and stops cleanly with open streams', async () => {
    const server = new LanHttpServer()
    openServers.push(server)
    let notify: ((kind: string) => void) | null = null
    const port = await server.start({
      host: '127.0.0.1',
      port: 0,
      token: 'integration-token',
      publishHandlers: mockPublishHandlers({
        subscribe: listener => {
          notify = listener as (kind: string) => void
          return () => { notify = null }
        }
      })
    })

    const response = await fetch(`http://127.0.0.1:${port}/api/publish/events?token=integration-token`)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/event-stream')

    const reader = response.body!.getReader()
    const first = await reader.read()
    expect(Buffer.from(first.value!).toString('utf8')).toContain('retry: 2000')

    notify!('finished')
    const event = await reader.read()
    expect(Buffer.from(event.value!).toString('utf8')).toContain('event: finished')

    // Leaving the stream open must not hang stop(): SSE connections are destroyed.
    await reader.cancel()
    await server.stop()
    expect(server.running).toBe(false)
  })

  it('rejects a second server on the same port', async () => {
    const first = new LanHttpServer()
    const second = new LanHttpServer()
    openServers.push(first, second)

    const port = await first.start({ host: '127.0.0.1', port: 0, token: 'one' })
    await expect(second.start({ host: '127.0.0.1', port, token: 'two' })).rejects.toThrow()
  })
})
