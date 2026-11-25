import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { BatchQueryResult, FeishuSettings, QueryResult } from '../src/shared/types'
import {
  FEISHU_FIELD_TYPE_ATTACHMENT,
  FEISHU_PRIMARY_FIELD,
  MAPPING_TARGET_FIELD,
  PLATFORM_TABLE_COMMON_FIELDS,
  PLATFORM_TABLE_FIELDS,
  platformTableAutoColumns,
  platformTableColumns,
  platformTableImageColumn
} from '../src/shared/feishu'
import { PLATFORMS } from '../src/shared/platforms'
import { deleteSetting, setSetting } from '../src/main/settings'
import {
  createTable,
  ensureFields,
  listRecords,
  listTables,
  resetFeishuClientState
} from '../src/main/feishu/client'
import { enqueueFeishu, resetFeishuSyncState } from '../src/main/feishu/sync'
import {
  buildRawRecord,
  flushPlatformTables,
  groupRawItems,
  platformRecordKey
} from '../src/main/feishu/platform-tables'

const CONFIG: FeishuSettings = {
  enabled: true,
  appId: 'cli_a1',
  appSecret: 'secret',
  appToken: 'appTOKEN',
  tableId: 'tblAGG',
  mappingTableId: 'tblMAP',
  syncImages: false
}

const OK = () => json({ code: 0, data: {} })
const okToken = () => json({ code: 0, tenant_access_token: 'tnt-token', expire: 7200 })

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

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

function calls(method: string, needle: string): Array<[string, { method: string; body?: string }]> {
  return fetchMock.mock.calls.filter(([url, options]) =>
    (options as { method: string }).method === method && (url as string).includes(needle)) as never
}

function bodyOf(call: [string, { method: string; body?: string }]): Record<string, unknown> {
  return JSON.parse(call[1].body ?? '{}') as Record<string, unknown>
}

/** create-table is the only POST whose URL ends at /tables (no /tables/<id>/...). */
function createTableCalls(): Array<[string, { method: string; body?: string }]> {
  return calls('POST', '/apps/appTOKEN/tables').filter(([url]) => !url.includes('/tables/'))
}

async function waitFor(predicate: () => boolean): Promise<void> {
  await vi.waitFor(() => expect(predicate()).toBe(true), { timeout: 8000, interval: 25 })
}

/** Mapping table: arbitrary primary name, no tableId column yet, no rows. */
const mappingFields = () => json({ code: 0, data: {
  items: [{ field_name: '平台', is_primary: true }], has_more: false
} })
const emptyRecords = () => json({ code: 0, data: { items: [], has_more: false } })

/** Platform table: all columns already exist and 编号 is primary. */
const platformFields = (platform: keyof typeof PLATFORM_TABLE_FIELDS, imageType = 1) => () => json({ code: 0, data: {
  items: platformTableColumns(platform).map((name, index) => ({
    field_name: name,
    is_primary: index === 0,
    type: name === platformTableImageColumn(platform) ? imageType : 1
  })),
  has_more: false
} })

function result(platform: QueryResult['platform'], rawItems?: QueryResult['rawItems']): QueryResult {
  return {
    platform,
    name: 'Album',
    artist: null,
    priceMin: null,
    priceMax: null,
    coverUrl: null,
    link: null,
    status: 'found',
    ...(rawItems ? { rawItems } : {})
  }
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

describe('pure helpers', () => {
  it('PLATFORM_TABLE_FIELDS is exhaustive and uses distinct, stable columns', () => {
    expect(Object.keys(PLATFORM_TABLE_FIELDS).sort()).toEqual([...PLATFORMS].sort())
    for (const platform of PLATFORMS) {
      const columns = PLATFORM_TABLE_FIELDS[platform]
      expect(columns.length).toBeGreaterThan(0)
      expect(new Set(columns).size).toBe(columns.length)
      for (const name of columns) {
        expect([FEISHU_PRIMARY_FIELD, ...PLATFORM_TABLE_COMMON_FIELDS]).not.toContain(name)
        expect(name).not.toBe(MAPPING_TARGET_FIELD)
      }
      expect(platformTableColumns(platform)[0]).toBe(FEISHU_PRIMARY_FIELD)
      expect(platformTableAutoColumns(platform)).not.toContain(FEISHU_PRIMARY_FIELD)
    }
  })

  it('groupRawItems groups by platform with 1-based ranks and skips empty/not_found results', () => {
    const completed: BatchQueryResult[] = [
      {
        catalogNumber: 'X-1',
        results: [
          result('tower', [{ name: 'A' }, { name: 'B' }]),
          result('ebay'),
          { ...result('yahoo'), status: 'not_found' }
        ]
      },
      { catalogNumber: 'X-2', results: [result('tower', [{ name: 'C' }])] }
    ]
    const groups = groupRawItems(completed)
    expect([...groups.keys()]).toEqual(['tower'])
    expect(groups.get('tower')).toEqual([
      { catalogNumber: 'X-1', rank: 1, item: { name: 'A' } },
      { catalogNumber: 'X-1', rank: 2, item: { name: 'B' } },
      { catalogNumber: 'X-2', rank: 1, item: { name: 'C' } }
    ])
  })

  it('buildRawRecord writes only schema columns, stringifies scalars and omits blanks', () => {
    const entry = {
      catalogNumber: 'X-1',
      rank: 3,
      item: {
        title: 'Album',
        priceCNY: 88.5,
        url: 'https://example/item',
        coverUrl: null,
        format: '  ',
        unknownColumn: 'ignored'
      }
    }
    const fields = buildRawRecord('taobao', entry)
    expect(fields).toEqual({
      [FEISHU_PRIMARY_FIELD]: 'X-1#3',
      '目录号': 'X-1',
      '序号': '3',
      title: 'Album',
      priceCNY: '88.5',
      url: 'https://example/item'
    })
    // Whitelist projection: no column outside the schema, and blank/null values omitted.
    const allowed = new Set<string>([
      FEISHU_PRIMARY_FIELD, ...PLATFORM_TABLE_COMMON_FIELDS, ...PLATFORM_TABLE_FIELDS.taobao
    ])
    for (const key of Object.keys(fields)) expect(allowed.has(key)).toBe(true)
    expect(fields).not.toHaveProperty('unknownColumn')
    expect(fields).not.toHaveProperty('coverUrl')
    expect(platformRecordKey(entry)).toBe('X-1#3')
  })
})

describe('client additions', () => {
  it('createTable posts app-scoped URL with 编号 first and returns table_id', async () => {
    setupRoutes({
      'POST /auth/v3/tenant_access_token/internal': okToken,
      'POST /apps/appTOKEN/tables': () => json({ code: 0, data: { table_id: 'tblNEW' } })
    })
    const id = await createTable(CONFIG, 'CD数据-淘宝', platformTableColumns('taobao'))
    expect(id).toBe('tblNEW')
    const call = calls('POST', '/apps/appTOKEN/tables')[0]
    const body = bodyOf(call) as { table: { name: string; fields: Array<{ field_name: string; type: number }> } }
    expect(body.table.name).toBe('CD数据-淘宝')
    expect(body.table.fields[0]).toEqual({ field_name: FEISHU_PRIMARY_FIELD, type: 1 })
    expect(body.table.fields.map(f => f.field_name)).toEqual(platformTableColumns('taobao'))
  })

  it('listRecords and listTables page via URL query params', async () => {
    setupRoutes({
      'POST /auth/v3/tenant_access_token/internal': okToken,
      'GET /tables/tblMAP/records?': [
        () => json({ code: 0, data: { items: [{ record_id: 'r1', fields: { 平台: [{ text: 'discogs' }] } }], has_more: true, page_token: 'PAGE2' } }),
        () => json({ code: 0, data: { items: [{ record_id: 'r2', fields: {} }], has_more: false } })
      ],
      'GET /apps/appTOKEN/tables?': [
        () => json({ code: 0, data: { items: [{ table_id: 't1', name: 'CD数据-Discogs' }], has_more: true, page_token: 'P2' } }),
        () => json({ code: 0, data: { items: [{ table_id: 't2', name: 'CD数据-eBay' }], has_more: false } })
      ]
    })
    const records = await listRecords({ ...CONFIG, tableId: 'tblMAP' })
    expect(records.map(r => r.record_id)).toEqual(['r1', 'r2'])
    expect(calls('GET', 'page_token=PAGE2')).toHaveLength(1)
    const tables = await listTables(CONFIG)
    expect(tables).toEqual([
      { tableId: 't1', name: 'CD数据-Discogs' },
      { tableId: 't2', name: 'CD数据-eBay' }
    ])
    expect(calls('GET', 'page_token=P2')).toHaveLength(1)
  })

  it('ensureFields honours a custom column list per table (no stale type cache)', async () => {
    setupRoutes({
      'POST /auth/v3/tenant_access_token/internal': okToken,
      'GET /tables/tblA/fields?': () => json({ code: 0, data: { items: [{ field_name: '编号', is_primary: true }], has_more: false } }),
      'GET /tables/tblB/fields?': () => json({ code: 0, data: { items: [{ field_name: '编号', is_primary: true }], has_more: false } }),
      'POST /tables/tblA/fields': OK,
      'POST /tables/tblB/fields': OK
    })
    await ensureFields({ ...CONFIG, tableId: 'tblA' }, ['自定义列'])
    const types = await ensureFields({ ...CONFIG, tableId: 'tblA' }, ['自定义列'])
    await ensureFields({ ...CONFIG, tableId: 'tblB' }, ['自定义列'])
    const aCreates = calls('POST', '/tables/tblA/fields')
    const bCreates = calls('POST', '/tables/tblB/fields')
    // The field-type cache was removed: each call re-reads the real types.
    expect(aCreates).toHaveLength(2)
    expect(bCreates).toHaveLength(1)
    expect((bodyOf(aCreates[0]) as { field_name: string }).field_name).toBe('自定义列')
    expect(types.get('自定义列')).toBe(1)
  })
})

describe('enqueueFeishu', () => {
  it('serializes tasks and keeps the queue usable after a failure', async () => {
    const order: string[] = []
    const first = enqueueFeishu(async () => {
      await new Promise(resolve => setTimeout(resolve, 20))
      order.push('first')
      return 1
    })
    const second = enqueueFeishu(async () => { order.push('second'); return 2 })
    const failed = enqueueFeishu(async () => { throw new Error('boom') })

    await expect(failed).rejects.toThrow('boom')
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2])
    expect(order).toEqual(['first', 'second'])
    await expect(enqueueFeishu(async () => 3)).resolves.toBe(3)
  })
})

describe('flushPlatformTables gate', () => {
  it('does nothing when disabled, when mappingTableId is blank, or when there are no raw items', () => {
    setSetting('feishu', { ...CONFIG, enabled: false })
    flushPlatformTables([{ catalogNumber: 'X-1', results: [result('tower', [{ name: 'A' }])] }])
    setSetting('feishu', { ...CONFIG, mappingTableId: '' })
    flushPlatformTables([{ catalogNumber: 'X-1', results: [result('tower', [{ name: 'A' }])] }])
    setSetting('feishu', CONFIG)
    flushPlatformTables([{ catalogNumber: 'X-1', results: [result('tower')] }])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('flushPlatformTables end-to-end', () => {
  const baseRoutes = (): Routes => ({
    'POST /auth/v3/tenant_access_token/internal': okToken,
    'GET /tables/tblMAP/fields?': mappingFields,
    'POST /tables/tblMAP/fields': OK,
    'GET /tables/tblMAP/records?': emptyRecords,
    'POST /tables/tblMAP/records/batch_create': () => json({ code: 0, data: { records: [{ record_id: 'rec-map' }] } }),
    // Short fallback key: every other table-scoped POST key is longer and wins.
    'POST /apps/': () => json({ code: 0, data: { table_id: 'tblTOWER' } }),
    'GET /tables/tblTOWER/fields?': platformFields('tower'),
    'POST /tables/tblTOWER/records/search?': emptyRecords,
    'POST /tables/tblTOWER/records/batch_create': () => json({ code: 0, data: { records: [{ record_id: 'rec-1' }, { record_id: 'rec-2' }] } })
  })

  it('creates the table, writes back the mapping and upserts one row per raw item', async () => {
    setupRoutes(baseRoutes())
    setSetting('feishu', CONFIG)

    flushPlatformTables([{
      catalogNumber: 'X-1',
      results: [result('tower', [
        { name: 'A', artist: 'Artist', coverUrl: null, link: 'https://t/1', priceText: '¥3,300', format: 'CD', released: '2020-01-01', label: 'L', country: 'Japan' },
        { name: 'B', priceText: '¥2,200' }
      ])]
    }])

    await waitFor(() => calls('POST', '/tables/tblTOWER/records/batch_create').length === 1)

    // Mapping table got a tableId column and one mapping row.
    const mapFieldCreates = calls('POST', '/tables/tblMAP/fields')
    expect(mapFieldCreates).toHaveLength(1)
    expect((bodyOf(mapFieldCreates[0]) as { field_name: string }).field_name).toBe(MAPPING_TARGET_FIELD)
    const mapRows = calls('POST', '/tables/tblMAP/records/batch_create')
    expect(mapRows).toHaveLength(1)
    expect(bodyOf(mapRows[0])).toEqual({ records: [{ fields: { 平台: 'tower', tableId: 'tblTOWER' } }] })

    // Create-table used the tower schema with 编号 first.
    expect(createTableCalls()).toHaveLength(1)
    const createBody = bodyOf(createTableCalls()[0]) as { table: { fields: Array<{ field_name: string; type: number }> } }
    expect(createBody.table.fields.map(f => f.field_name)).toEqual(platformTableColumns('tower'))
    // Toggle is off by default: a fresh table keeps the historical text column.
    expect(createBody.table.fields.find(f => f.field_name === platformTableImageColumn('tower'))?.type)
      .toBe(1)

    // Two rows written with composite primary keys.
    const createRows = bodyOf(calls('POST', '/tables/tblTOWER/records/batch_create')[0]) as {
      records: Array<{ fields: Record<string, string> }>
    }
    expect(createRows.records).toHaveLength(2)
    expect(createRows.records[0].fields).toMatchObject({
      [FEISHU_PRIMARY_FIELD]: 'X-1#1', 目录号: 'X-1', 序号: '1', name: 'A', priceText: '¥3,300'
    })
    expect(createRows.records[1].fields).toMatchObject({
      [FEISHU_PRIMARY_FIELD]: 'X-1#2', 目录号: 'X-1', 序号: '2', name: 'B'
    })
  })

  it('creates the platform image column as an attachment when image sync is on', async () => {
    setupRoutes(baseRoutes())
    setSetting('feishu', { ...CONFIG, syncImages: true })

    flushPlatformTables([{ catalogNumber: 'X-1', results: [result('tower', [{ name: 'A' }])] }])

    await waitFor(() => calls('POST', '/tables/tblTOWER/records/batch_create').length === 1)
    expect(createTableCalls()).toHaveLength(1)
    const createBody = bodyOf(createTableCalls()[0]) as { table: { fields: Array<{ field_name: string; type: number }> } }
    expect(createBody.table.fields.find(f => f.field_name === platformTableImageColumn('tower'))?.type)
      .toBe(FEISHU_FIELD_TYPE_ATTACHMENT)
  })

  it('reuses an existing mapping and updates an existing record instead of creating', async () => {
    setupRoutes({
      ...baseRoutes(),
      'GET /tables/tblMAP/fields?': () => json({ code: 0, data: {
        items: [{ field_name: '平台', is_primary: true }, { field_name: MAPPING_TARGET_FIELD }], has_more: false
      } }),
      'GET /tables/tblMAP/records?': () => json({ code: 0, data: {
        items: [{ record_id: 'rec-map', fields: { 平台: [{ text: 'tower' }], tableId: [{ text: 'tblTOWER' }] } }], has_more: false
      } }),
      'POST /tables/tblTOWER/records/search?': () => json({ code: 0, data: {
        items: [{ record_id: 'rec-existing', fields: { 编号: [{ text: 'X-1#1' }] } }], has_more: false
      } }),
      'POST /tables/tblTOWER/records/batch_update': () => json({ code: 0, data: { records: [{ record_id: 'rec-existing' }] } })
    })
    setSetting('feishu', CONFIG)

    flushPlatformTables([{ catalogNumber: 'X-1', results: [result('tower', [{ name: 'A' }])] }])

    await waitFor(() => calls('POST', '/tables/tblTOWER/records/batch_update').length === 1)
    expect(createTableCalls()).toHaveLength(0)
    expect(calls('POST', '/tables/tblMAP/records/batch_create')).toHaveLength(0)
    const update = bodyOf(calls('POST', '/tables/tblTOWER/records/batch_update')[0]) as {
      records: Array<{ record_id: string; fields: Record<string, string> }>
    }
    expect(update.records[0]).toMatchObject({ record_id: 'rec-existing', fields: { [FEISHU_PRIMARY_FIELD]: 'X-1#1' } })
  })

  it('splits creates and updates and chunks batch_create at 500 rows', async () => {
    setupRoutes({
      ...baseRoutes(),
      'POST /tables/tblTOWER/records/search?': () => json({ code: 0, data: {
        items: [{ record_id: 'rec-1', fields: { 编号: [{ text: 'X-1#1' }] } }], has_more: false
      } }),
      'POST /tables/tblTOWER/records/batch_create': () => json({ code: 0, data: { records: [] } }),
      'POST /tables/tblTOWER/records/batch_update': () => json({ code: 0, data: { records: [] } })
    })
    setSetting('feishu', CONFIG)

    // 502 items: one is an existing record (update), leaving 501 creates -> two chunks.
    const items = Array.from({ length: 502 }, (_, i) => ({ name: `Item ${i}` }))
    flushPlatformTables([{ catalogNumber: 'X-1', results: [result('tower', items)] }])

    await waitFor(() => calls('POST', '/tables/tblTOWER/records/batch_create').length === 2)
    const createCalls = calls('POST', '/tables/tblTOWER/records/batch_create')
    expect(createCalls).toHaveLength(2)
    const sizes = createCalls.map(call => (bodyOf(call) as { records: unknown[] }).records.length)
    expect(sizes.sort((a, b) => a - b)).toEqual([1, 500])
    expect(calls('POST', '/tables/tblTOWER/records/batch_update')).toHaveLength(1)
  })

  it('heals a duplicate table name (1254013) by reusing the existing table', async () => {
    setupRoutes({
      ...baseRoutes(),
      'POST /apps/': () => json({ code: 1254013, msg: 'TableNameDuplicated' }),
      'GET /apps/appTOKEN/tables?': () => json({ code: 0, data: {
        items: [{ table_id: 'tblEXISTING', name: 'CD数据-Tower Records Japan' }], has_more: false
      } }),
      'GET /tables/tblEXISTING/fields?': platformFields('tower'),
      'POST /tables/tblEXISTING/records/search?': emptyRecords,
      'POST /tables/tblEXISTING/records/batch_create': () => json({ code: 0, data: { records: [{ record_id: 'rec-1' }] } })
    })
    setSetting('feishu', CONFIG)

    flushPlatformTables([{ catalogNumber: 'X-1', results: [result('tower', [{ name: 'A' }])] }])

    await waitFor(() => calls('POST', '/tables/tblEXISTING/records/batch_create').length === 1)
    const mapRows = calls('POST', '/tables/tblMAP/records/batch_create')
    expect(bodyOf(mapRows[0])).toEqual({ records: [{ fields: { 平台: 'tower', tableId: 'tblEXISTING' } }] })
  })

  it('never writes a URL string into an attachment image column when image sync is off', async () => {
    setupRoutes({
      ...baseRoutes(),
      'GET /tables/tblTOWER/fields?': platformFields('tower', FEISHU_FIELD_TYPE_ATTACHMENT)
    })
    setSetting('feishu', CONFIG)

    flushPlatformTables([{
      catalogNumber: 'X-1',
      results: [result('tower', [{ name: 'A', coverUrl: 'https://img/a.jpg' }])]
    }])

    await waitFor(() => calls('POST', '/tables/tblTOWER/records/batch_create').length === 1)
    const createRows = bodyOf(calls('POST', '/tables/tblTOWER/records/batch_create')[0]) as {
      records: Array<{ fields: Record<string, unknown> }>
    }
    expect(createRows.records[0].fields).not.toHaveProperty(platformTableImageColumn('tower'))
  })

  it('keeps the URL string and uploads nothing when the image column is still text', async () => {
    setupRoutes(baseRoutes())
    setSetting('feishu', { ...CONFIG, syncImages: true })

    flushPlatformTables([{
      catalogNumber: 'X-1',
      results: [result('tower', [{ name: 'A', coverUrl: 'https://img/a.jpg' }])]
    }])

    await waitFor(() => calls('POST', '/tables/tblTOWER/records/batch_create').length === 1)
    const createRows = bodyOf(calls('POST', '/tables/tblTOWER/records/batch_create')[0]) as {
      records: Array<{ fields: Record<string, unknown> }>
    }
    expect(createRows.records[0].fields[platformTableImageColumn('tower')]).toBe('https://img/a.jpg')
    expect(calls('POST', '/drive/v1/medias/upload_all')).toHaveLength(0)
  })
})
