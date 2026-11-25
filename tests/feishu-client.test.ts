import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { FeishuSettings } from '../src/shared/types'
import { DEFAULT_FEISHU_SETTINGS, FEISHU_FIELD_TYPE_ATTACHMENT } from '../src/shared/feishu'
import { deleteSetting, setSetting } from '../src/main/settings'
import {
  FeishuClientError,
  batchCreate,
  batchUpdate,
  createTable,
  ensureFields,
  findRecordIds,
  isFeishuConfigured,
  normalizeFeishuSettings,
  parsePrimaryFieldText,
  readFeishuSettings,
  resetFeishuClientState,
  testFeishuConnection,
  uploadMedia
} from '../src/main/feishu/client'
import { resetFeishuSyncState, syncToFeishu } from '../src/main/feishu/sync'

const CONFIG: FeishuSettings = {
  enabled: true,
  appId: 'cli_a1',
  appSecret: 'secret-xyz',
  appToken: 'appTOKEN',
  tableId: 'tblXYZ',
  mappingTableId: 'tblMAP',
  syncImages: false
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const okToken = () => json({ code: 0, tenant_access_token: 'tnt-token', expire: 7200 })
/** Default to a table whose first column is already the 编号 primary field. */
const okFields = (items: Array<{ field_name: string; is_primary?: boolean; type?: number }> = [{ field_name: '编号', is_primary: true }]) =>
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
  resetFeishuSyncState()
})

afterEach(() => {
  vi.unstubAllGlobals()
  deleteSetting('feishu')
  resetFeishuClientState()
  resetFeishuSyncState()
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

  it('normalizeFeishuSettings keeps and trims mappingTableId and syncImages', () => {
    expect(normalizeFeishuSettings({ ...CONFIG, mappingTableId: '  tblMAP  ' }))
      .toEqual({ ...CONFIG, mappingTableId: 'tblMAP' })
    // Old persisted configs may predate the field; do not drop or crash.
    expect(normalizeFeishuSettings({ ...CONFIG, mappingTableId: undefined as unknown as string }))
      .toEqual({ ...CONFIG, mappingTableId: '' })
    expect(normalizeFeishuSettings({ ...CONFIG, syncImages: true }).syncImages).toBe(true)
  })
})

describe('ensureFields', () => {
  it('creates only the missing columns as multi-line text and reports their types', async () => {
    setupRoutes({
      'POST /auth/v3/tenant_access_token/internal': okToken,
      'GET /fields?': okFields([{ field_name: '编号', is_primary: true }, { field_name: 'name' }]),
      'POST /fields': okApi
    })

    const types = await ensureFields(CONFIG)
    const created = calls('POST', '/fields')
    expect(created).toHaveLength(10)
    const names = created.map(([, options]) => JSON.parse((options as { body: string }).body).field_name)
    expect(names).not.toContain('编号')
    expect(names).not.toContain('name')
    expect(names).toContain('priceAll')
    for (const [, options] of created) {
      expect(JSON.parse((options as { body: string }).body).type).toBe(1)
    }
    expect(types.get('编号')).toBe(1)
    expect(types.get('priceAll')).toBe(1)

    // No cache: a user may convert a column to 附件 in the Feishu UI at any
    // time, so every call re-reads the real field types.
    const before = fetchMock.mock.calls.length
    await ensureFields(CONFIG)
    expect(fetchMock.mock.calls.length).toBeGreaterThan(before)
  })

  it('rejects with actionable guidance when the primary field is not 编号', async () => {
    setupRoutes({
      'POST /auth/v3/tenant_access_token/internal': okToken,
      'GET /fields?': okFields([{ field_name: '标题', is_primary: true }, { field_name: '编号' }]),
      'POST /fields': okApi
    })

    await expect(ensureFields(CONFIG)).rejects.toThrow(/主字段（首列）必须命名为「编号」/)
    // A wrong primary field must not leave a stale cache or half-created columns.
    expect(calls('POST', '/fields')).toHaveLength(0)
  })

  it('finds the primary field by is_primary and never creates 编号', async () => {
    setupRoutes({
      'POST /auth/v3/tenant_access_token/internal': okToken,
      'GET /fields?': okFields([{ field_name: 'name' }, { field_name: '编号', is_primary: true }]),
      'POST /fields': okApi
    })

    await ensureFields(CONFIG)
    const names = calls('POST', '/fields').map(([, options]) => JSON.parse((options as { body: string }).body).field_name)
    expect(names).not.toContain('编号')
    expect(names).toContain('artist')
    expect(names).toHaveLength(10)
  })

  it('treats the first column as primary when is_primary is omitted', async () => {
    setupRoutes({
      'POST /auth/v3/tenant_access_token/internal': okToken,
      'GET /fields?': okFields([{ field_name: '编号' }, { field_name: 'name' }]),
      'POST /fields': okApi
    })
    await expect(ensureFields(CONFIG)).resolves.toBeInstanceOf(Map)
  })

  it('reports a wrong primary field through the connection probe', async () => {
    setupRoutes({
      'POST /auth/v3/tenant_access_token/internal': okToken,
      'GET /fields?': okFields([{ field_name: '标题', is_primary: true }])
    })
    const result = await testFeishuConnection(CONFIG)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('主字段（首列）必须命名为「编号」')
    expect(result.message).toContain('标题')
  })

  it('reports the primary field on a successful connection probe', async () => {
    setupRoutes({
      'POST /auth/v3/tenant_access_token/internal': okToken,
      'GET /fields?': okFields([{ field_name: '编号', is_primary: true }, { field_name: 'name' }])
    })
    const result = await testFeishuConnection(CONFIG)
    expect(result.ok).toBe(true)
    expect(result.message).toContain('主字段为「编号」')
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

describe('field types', () => {
  it('createTable applies per-column attachment overrides', async () => {
    setupRoutes({
      'POST /auth/v3/tenant_access_token/internal': okToken,
      'POST /apps/appTOKEN/tables': () => json({ code: 0, data: { table_id: 'tblNEW' } })
    })
    await createTable(CONFIG, 'T', ['编号', 'coverUrl'], { fieldTypes: { coverUrl: FEISHU_FIELD_TYPE_ATTACHMENT } })

    const body = JSON.parse((calls('POST', '/apps/appTOKEN/tables')[0][1] as { body: string }).body)
    expect(body.table.fields).toEqual([
      { field_name: '编号', type: 1 },
      { field_name: 'coverUrl', type: FEISHU_FIELD_TYPE_ATTACHMENT }
    ])
  })

  it('ensureFields reports the real type of an existing attachment column', async () => {
    setupRoutes({
      'POST /auth/v3/tenant_access_token/internal': okToken,
      'GET /fields?': okFields([
        { field_name: '编号', is_primary: true },
        { field_name: 'coverUrl', type: FEISHU_FIELD_TYPE_ATTACHMENT }
      ]),
      'POST /fields': okApi
    })
    const types = await ensureFields(CONFIG)
    expect(types.get('coverUrl')).toBe(FEISHU_FIELD_TYPE_ATTACHMENT)
    const created = calls('POST', '/fields')
      .map(([, options]) => JSON.parse((options as { body: string }).body).field_name)
    expect(created).not.toContain('coverUrl')
  })
})

describe('uploadMedia', () => {
  const params = () => ({
    fileName: 'cover.jpg',
    bytes: Buffer.from('fake-jpeg-bytes'),
    mimeType: 'image/jpeg',
    parentNode: 'appTOKEN',
    extra: JSON.stringify({ drive_route_token: 'appTOKEN' })
  })

  it('posts a multipart form without a JSON Content-Type and returns file_token', async () => {
    setupRoutes({
      'POST /auth/v3/tenant_access_token/internal': okToken,
      'POST /drive/v1/medias/upload_all': () => json({ code: 0, data: { file_token: 'boxcnTOKEN' } })
    })

    expect(await uploadMedia(CONFIG, params())).toBe('boxcnTOKEN')

    const call = calls('POST', '/drive/v1/medias/upload_all')[0]
    const options = call[1] as unknown as { headers: Record<string, string>; body: FormData }
    expect(options.headers['Content-Type']).toBeUndefined()
    expect(options.headers.Authorization).toBe('Bearer tnt-token')
    const fd = options.body
    expect(fd.get('file_name')).toBe('cover.jpg')
    expect(fd.get('parent_type')).toBe('bitable_image')
    expect(fd.get('parent_node')).toBe('appTOKEN')
    expect(fd.get('size')).toBe(String(Buffer.from('fake-jpeg-bytes').length))
    expect(fd.get('extra')).toBe(JSON.stringify({ drive_route_token: 'appTOKEN' }))
    expect((fd.get('file') as File).name).toBe('cover.jpg')
    expect((fd.get('file') as File).type).toBe('image/jpeg')
  })

  it('rebuilds the FormData on a 401 token-refresh retry', async () => {
    setupRoutes({
      'POST /auth/v3/tenant_access_token/internal': [
        () => json({ code: 0, tenant_access_token: 'token-1', expire: 7200 }),
        () => json({ code: 0, tenant_access_token: 'token-2', expire: 7200 })
      ],
      'POST /drive/v1/medias/upload_all': [
        () => new Response('unauthorized', { status: 401 }),
        () => json({ code: 0, data: { file_token: 'boxcnRETRY' } })
      ]
    })

    expect(await uploadMedia(CONFIG, params())).toBe('boxcnRETRY')
    const attempts = calls('POST', '/drive/v1/medias/upload_all')
    expect(attempts).toHaveLength(2)
    const firstForm = (attempts[0][1] as unknown as { body: FormData }).body
    const secondForm = (attempts[1][1] as unknown as { body: FormData }).body
    expect(secondForm).not.toBe(firstForm)
    expect(secondForm.get('file_name')).toBe('cover.jpg')
    expect((attempts[1][1] as unknown as { headers: Record<string, string> }).headers.Authorization)
      .toBe('Bearer token-2')
  })

  it('throws when upload_all omits file_token', async () => {
    setupRoutes({
      'POST /auth/v3/tenant_access_token/internal': okToken,
      'POST /drive/v1/medias/upload_all': () => json({ code: 0, data: {} })
    })
    await expect(uploadMedia(CONFIG, params())).rejects.toMatchObject({ code: 'invalid_response' })
  })
})

describe('record upsert endpoints', () => {
  it('builds an or-filter over the batch and pages through matches', async () => {
    setupRoutes({
      'POST /auth/v3/tenant_access_token/internal': okToken,
      'POST /records/search': [
        () => json({ code: 0, data: { items: [{ record_id: 'rec-1', fields: { '编号': [{ text: 'X-1', type: 'text' }] } }], has_more: true, page_token: 'p2' } }),
        () => json({ code: 0, data: { items: [{ record_id: 'rec-2', fields: { '编号': [{ text: 'X-2', type: 'text' }] } }], has_more: false } })
      ]
    })

    const ids = await findRecordIds(CONFIG, ['X-1', 'X-2'])
    expect(ids).toEqual(new Map([['X-1', 'rec-1'], ['X-2', 'rec-2']]))
    const searches = calls('POST', '/records/search')
    const body = JSON.parse((searches[0][1] as { body: string }).body)
    expect(body.filter.conjunction).toBe('or')
    expect(body.filter.conditions).toHaveLength(2)
    expect(body.filter.conditions[0]).toEqual({ field_name: '编号', operator: 'is', value: ['X-1'] })
    expect(body.field_names).toEqual(['编号'])
    expect(body.automatic_fields).toBe(false)
    expect(body).not.toHaveProperty('page_size')
    expect(searches).toHaveLength(2)
    expect(searches[0][0]).toContain('page_size=100')
    expect(searches[1][0]).toContain('page_token=p2')
    expect(JSON.parse((searches[1][1] as { body: string }).body)).not.toHaveProperty('page_token')
  })

  it('flattens text segments and string arrays into a lookup key', () => {
    expect(parsePrimaryFieldText([{ text: 'SICP-', type: 'text' }, { text: '6480', type: 'text' }])).toBe('SICP-6480')
    expect(parsePrimaryFieldText(['X-1'])).toBe('X-1')
    expect(parsePrimaryFieldText(' X-2 ')).toBe('X-2')
    expect(parsePrimaryFieldText(null)).toBe('')
  })

  it('sends batch_create / batch_update payloads and returns created ids', async () => {
    setupRoutes({
      'POST /auth/v3/tenant_access_token/internal': okToken,
      'POST /records/batch_create': () => json({ code: 0, data: { records: [{ record_id: 'rec-a' }, { record_id: 'rec-b' }] } }),
      'POST /records/batch_update': () => json({ code: 0, data: { records: [{}] } })
    })

    expect(await batchCreate(CONFIG, [{ '编号': 'A' }, { '编号': 'B' }])).toEqual(['rec-a', 'rec-b'])
    expect(await batchUpdate(CONFIG, [{ record_id: 'r1', fields: { '编号': 'C' } }])).toBe(1)
    expect(await batchCreate(CONFIG, [])).toEqual([])
    expect(await batchUpdate(CONFIG, [])).toBe(0)

    const createBody = JSON.parse((calls('POST', '/records/batch_create')[0][1] as { body: string }).body)
    expect(createBody.records).toEqual([{ fields: { '编号': 'A' } }, { fields: { '编号': 'B' } }])
    const updateBody = JSON.parse((calls('POST', '/records/batch_update')[0][1] as { body: string }).body)
    expect(updateBody.records).toEqual([{ record_id: 'r1', fields: { '编号': 'C' } }])
  })
})

describe('feishu upsert end to end (real client)', () => {
  it('creates once and updates the second time for the same 编号', async () => {
    setSetting('feishu', CONFIG)
    setupRoutes({
      'POST /auth/v3/tenant_access_token/internal': okToken,
      'GET /fields?': okFields(),
      'POST /fields': okApi,
      'POST /records/search': () => json({ code: 0, data: { items: [], has_more: false } }),
      'POST /records/batch_create': () => json({ code: 0, data: { records: [{ record_id: 'rec-new' }] } }),
      'POST /records/batch_update': () => json({ code: 0, data: { records: [{}] } })
    })

    const row = { catalogNumber: 'X-1', results: [] }
    const first = await syncToFeishu({ rows: [row] })
    const second = await syncToFeishu({ rows: [row] })

    expect(first).toEqual({ status: 'ok', created: 1, updated: 0, failed: 0 })
    expect(second).toEqual({ status: 'ok', created: 0, updated: 1, failed: 0 })
    expect(calls('POST', '/records/batch_create')).toHaveLength(1)
    expect(calls('POST', '/records/batch_update')).toHaveLength(1)
  })

  it('updates an existing record when search returns text segments', async () => {
    setSetting('feishu', CONFIG)
    setupRoutes({
      'POST /auth/v3/tenant_access_token/internal': okToken,
      'GET /fields?': okFields(),
      'POST /fields': okApi,
      'POST /records/search': () => json({ code: 0, data: { items: [{ record_id: 'rec-existing', fields: { '编号': [{ text: 'X-1', type: 'text' }] } }], has_more: false } }),
      'POST /records/batch_create': okApi,
      'POST /records/batch_update': () => json({ code: 0, data: { records: [{}] } })
    })

    const result = await syncToFeishu({ rows: [{ catalogNumber: 'X-1', results: [] }] })

    expect(result).toEqual({ status: 'ok', created: 0, updated: 1, failed: 0 })
    expect(calls('POST', '/records/batch_create')).toHaveLength(0)
  })
})
