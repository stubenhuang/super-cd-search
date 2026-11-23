import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { FeishuSettings } from '../src/shared/types'
import { DEFAULT_FEISHU_SETTINGS } from '../src/shared/feishu'
import { deleteSetting, setSetting } from '../src/main/settings'
import {
  FeishuClientError,
  batchCreate,
  batchUpdate,
  ensureFields,
  findRecordIds,
  isFeishuConfigured,
  readFeishuSettings,
  resetFeishuClientState,
  testFeishuConnection
} from '../src/main/feishu/client'

const CONFIG: FeishuSettings = {
  enabled: true,
  appId: 'cli_a1',
  appSecret: 'secret-xyz',
  appToken: 'appTOKEN',
  tableId: 'tblXYZ'
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const okToken = () => json({ code: 0, tenant_access_token: 'tnt-token', expire: 7200 })
const okFields = (items: Array<{ field_name: string }> = []) =>
  () => json({ code: 0, data: { items, has_more: false } })
const okApi = () => json({ code: 0, data: {} })

type Reply = () => Response
type Routes = Record<string, Reply[] | Reply>

/** Route by method + URL substring; array entries are consumed in order. */
function setupRoutes(routes: Routes): void {
  const consumed = new Map<string, number>()
  fetchMock.mockImplementation(async (url: string, options: { method: string }) => {
    const method = options.method
    const keys = Object.keys(routes).sort((a, b) => b.length - a.length)
    const key = keys.find(k => {
      const [m, needle] = k.split(' ')
      return m === method && url.includes(needle)
    })
    if (!key) throw new Error(`unexpected request: ${method} ${url}`)
    const value = routes[key]
    if (Array.isArray(value)) {
      const index = consumed.get(key) ?? 0
      consumed.set(key, index + 1)
      return value[Math.min(index, value.length - 1)]()
    }
    return value()
  })
}

function calls(method: string, needle: string) {
  return fetchMock.mock.calls.filter(([url, options]) =>
    (options as { method: string }).method === method && (url as string).includes(needle))
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  resetFeishuClientState()
})

afterEach(() => {
  vi.unstubAllGlobals()
  deleteSetting('feishu')
  resetFeishuClientState()
})

describe('settings helpers', () => {
  it('merges defaults and detects incomplete configs', () => {
    expect(readFeishuSettings()).toEqual(DEFAULT_FEISHU_SETTINGS)
    expect(isFeishuConfigured(DEFAULT_FEISHU_SETTINGS)).toBe(false)
    setSetting('feishu', { appId: 'id' } as FeishuSettings)
    expect(readFeishuSettings()).toEqual({ ...DEFAULT_FEISHU_SETTINGS, appId: 'id' })
    expect(isFeishuConfigured(readFeishuSettings())).toBe(false)
    expect(isFeishuConfigured(CONFIG)).toBe(true)
  })
})

describe('ensureFields', () => {
  it('creates only the missing columns as multi-line text and caches the result', async () => {
    setupRoutes({
      'POST /auth/v3/tenant_access_token/internal': okToken,
      'GET /fields?': okFields([{ field_name: '编号' }, { field_name: 'name' }]),
      'POST /fields': okApi
    })

    await ensureFields(CONFIG)
    const created = calls('POST', '/fields')
    expect(created).toHaveLength(10)
    const names = created.map(([, options]) => JSON.parse((options as { body: string }).body).field_name)
    expect(names).not.toContain('编号')
    expect(names).not.toContain('name')
    expect(names).toContain('priceAll')
    for (const [, options] of created) {
      expect(JSON.parse((options as { body: string }).body).type).toBe(1)
    }

    const before = fetchMock.mock.calls.length
    await ensureFields(CONFIG)
    expect(fetchMock.mock.calls.length).toBe(before)
  })

  it('keeps credentials out of URLs and sends the token only as a Bearer header', async () => {
    setupRoutes({
      'POST /auth/v3/tenant_access_token/internal': okToken,
      'GET /fields?': okFields(),
      'POST /fields': okApi
    })
    await ensureFields(CONFIG)

    for (const [url, options] of fetchMock.mock.calls) {
      expect(url as string).not.toContain('secret-xyz')
      expect(url as string).not.toContain('tnt-token')
      const headers = (options as { headers: Record<string, string> }).headers
      if ((url as string).includes('/auth/v3/')) {
        expect(headers.Authorization).toBeUndefined()
        expect(JSON.parse((options as { body: string }).body)).toEqual({ app_id: 'cli_a1', app_secret: 'secret-xyz' })
      } else {
        expect(headers.Authorization).toBe('Bearer tnt-token')
      }
    }
  })

  it('reuses a cached token until it is close to expiry', async () => {
    setupRoutes({
      'POST /auth/v3/tenant_access_token/internal': okToken,
      'GET /fields?': okFields()
    })
    await testFeishuConnection(CONFIG)
    await testFeishuConnection(CONFIG)
    expect(calls('POST', '/auth/v3/tenant_access_token/internal')).toHaveLength(1)

    resetFeishuClientState()
    fetchMock.mockClear()
    setupRoutes({
      'POST /auth/v3/tenant_access_token/internal': () => json({ code: 0, tenant_access_token: 'short', expire: 1 }),
      'GET /fields?': okFields()
    })
    // With a near-expired token, even the probe's own two steps (explicit
    // token fetch + authenticated field read) each obtain a fresh one.
    await testFeishuConnection(CONFIG)
    expect(calls('POST', '/auth/v3/tenant_access_token/internal')).toHaveLength(2)
  })

  it('retries once after an HTTP 401 with a freshly fetched token', async () => {
    setupRoutes({
      'POST /auth/v3/tenant_access_token/internal': [
        () => json({ code: 0, tenant_access_token: 'token-1', expire: 7200 }),
        () => json({ code: 0, tenant_access_token: 'token-2', expire: 7200 })
      ],
      'GET /fields?': [
        () => new Response('unauthorized', { status: 401 }),
        okFields()
      ]
    })

    await testFeishuConnection(CONFIG)
    expect(calls('POST', '/auth/v3/tenant_access_token/internal')).toHaveLength(2)
    const secondGet = calls('GET', '/fields?')[1]
    expect((secondGet[1] as { headers: Record<string, string> }).headers.Authorization).toBe('Bearer token-2')
  })

  it('retries once on the invalid-token business code', async () => {
    setupRoutes({
      'POST /auth/v3/tenant_access_token/internal': [
        () => json({ code: 0, tenant_access_token: 'token-1', expire: 7200 }),
        () => json({ code: 0, tenant_access_token: 'token-2', expire: 7200 })
      ],
      'GET /fields?': [
        () => json({ code: 99991661, msg: 'token expired' }),
        okFields()
      ]
    })

    await testFeishuConnection(CONFIG)
    expect(calls('POST', '/auth/v3/tenant_access_token/internal')).toHaveLength(2)
  })

  it('maps a non-zero business code to a FeishuClientError', async () => {
    setupRoutes({
      'POST /auth/v3/tenant_access_token/internal': okToken,
      'GET /fields?': () => json({ code: 1254045, msg: 'table not found' })
    })
    await expect(ensureFields(CONFIG)).rejects.toMatchObject({
      name: 'FeishuClientError', code: 'api', apiCode: 1254045
    })
  })

  it('reports invalid JSON and never rejects from the connection probe', async () => {
    setupRoutes({
      'POST /auth/v3/tenant_access_token/internal': okToken,
      'GET /fields?': () => new Response('not json', { status: 200 })
    })
    await expect(ensureFields(CONFIG)).rejects.toBeInstanceOf(FeishuClientError)

    resetFeishuClientState()
    setupRoutes({
      'POST /auth/v3/tenant_access_token/internal': () => json({ code: 99991663, msg: 'bad app secret' }),
      'GET /fields?': okFields()
    })
    await expect(testFeishuConnection(CONFIG)).resolves.toMatchObject({ ok: false })
  })
})

describe('record upsert endpoints', () => {
  it('builds an or-filter over the batch and pages through matches', async () => {
    setupRoutes({
      'POST /auth/v3/tenant_access_token/internal': okToken,
      'POST /records/search': [
        () => json({ code: 0, data: { items: [{ record_id: 'rec-1', fields: { '编号': 'X-1' } }], has_more: true, page_token: 'p2' } }),
        () => json({ code: 0, data: { items: [{ record_id: 'rec-2', fields: { '编号': 'X-2' } }], has_more: false } })
      ]
    })

    const ids = await findRecordIds(CONFIG, ['X-1', 'X-2'])
    expect(ids).toEqual(new Map([['X-1', 'rec-1'], ['X-2', 'rec-2']]))
    const first = calls('POST', '/records/search')[0]
    const body = JSON.parse((first[1] as { body: string }).body)
    expect(body.filter.conjunction).toBe('or')
    expect(body.filter.conditions).toHaveLength(2)
    expect(body.filter.conditions[0]).toEqual({ field_name: '编号', operator: 'is', value: ['X-1'] })
    expect(calls('POST', '/records/search')).toHaveLength(2)
    expect(JSON.parse((calls('POST', '/records/search')[1][1] as { body: string }).body).page_token).toBe('p2')
  })

  it('sends batch_create / batch_update payloads and skips empty batches', async () => {
    setupRoutes({
      'POST /auth/v3/tenant_access_token/internal': okToken,
      'POST /records/batch_create': () => json({ code: 0, data: { records: [{}, {}] } }),
      'POST /records/batch_update': () => json({ code: 0, data: { records: [{}] } })
    })

    expect(await batchCreate(CONFIG, [{ '编号': 'A' }, { '编号': 'B' }])).toBe(2)
    expect(await batchUpdate(CONFIG, [{ record_id: 'r1', fields: { '编号': 'C' } }])).toBe(1)
    expect(await batchCreate(CONFIG, [])).toBe(0)
    expect(await batchUpdate(CONFIG, [])).toBe(0)

    const createBody = JSON.parse((calls('POST', '/records/batch_create')[0][1] as { body: string }).body)
    expect(createBody.records).toEqual([{ fields: { '编号': 'A' } }, { fields: { '编号': 'B' } }])
    const updateBody = JSON.parse((calls('POST', '/records/batch_update')[0][1] as { body: string }).body)
    expect(updateBody.records).toEqual([{ record_id: 'r1', fields: { '编号': 'C' } }])
  })
})
