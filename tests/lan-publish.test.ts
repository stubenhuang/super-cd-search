import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BrowserWindow } from 'electron'
import { createServer } from 'net'
import type { AddressInfo } from 'net'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { CDLibraryRecordInput } from '../src/shared/types'

vi.mock('../src/main/barcode/resolver', () => ({
  resolveBarcodeCatalogCached: vi.fn()
}))

vi.mock('../src/main/queries/discogs', () => ({
  normalizeDiscogsBarcode: vi.fn((barcode: string) => barcode)
}))

vi.mock('../src/main/orchestrator', () => ({
  isBatchQueryRunning: vi.fn(() => false)
}))

import { applyLanServer, closeLanServer } from '../src/main/lan'
import { setLanToken, setSetting } from '../src/main/settings'
import { closeCDLibrary, initCDLibrary, listLibraryRecords, upsertImportedRecords } from '../src/main/library'
import { finishPublishRound, startPublishRound } from '../src/main/publish/round'

const TOKEN = 'publish-token'

function record(catalogNumber: string, overrides: Partial<CDLibraryRecordInput> = {}): CDLibraryRecordInput {
  return {
    catalogNumber,
    imageUrl: '',
    details: `详情 ${catalogNumber}`,
    lowestPriceUsd: 1,
    highestPriceUsd: 2,
    lowestPriceCny: 7.2,
    highestPriceCny: 14.4,
    ...overrides
  }
}

function mockDesktopWindow(send = vi.fn()) {
  return { isDestroyed: () => false, webContents: { send } }
}

function getFreePort(): Promise<number> {
  return new Promise(resolve => {
    const probe = createServer()
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address() as AddressInfo
      probe.close(() => resolve(address.port))
    })
  })
}

let dir = ''
let baseUrl = ''

function url(path: string): string {
  return `${baseUrl}${path}${path.includes('?') ? '&' : '?'}token=${TOKEN}`
}

beforeEach(async () => {
  vi.clearAllMocks()
  dir = mkdtempSync(join(tmpdir(), 'scd-lan-publish-'))
  initCDLibrary(dir)
  setSetting('lanEnabled', true)
  setSetting('lanHost', '127.0.0.1')
  // A fresh port per test keeps undici's connection pool from reusing sockets
  // of the server instance that the previous test already closed.
  setSetting('lanPort', await getFreePort())
  setLanToken(TOKEN)

  const status = await applyLanServer()
  expect(status.state).toBe('running')
  baseUrl = `http://127.0.0.1:${status.port}`
})

afterEach(async () => {
  finishPublishRound()
  setSetting('lanEnabled', false)
  await closeLanServer()
  closeCDLibrary()
  rmSync(dir, { recursive: true, force: true })
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([])
})

describe('LAN publish API', () => {
  it('serves the publish round and persists phone-side state changes', async () => {
    upsertImportedRecords([{ ...record('A-1'), embeddedImage: null }])
    startPublishRound(['A-1'])

    const send = vi.fn()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockDesktopWindow(send) as never])

    const listResponse = await fetch(url('/api/publish/list'))
    expect(listResponse.status).toBe(200)
    const snapshot = await listResponse.json()
    expect(snapshot.publishedAt).not.toBeNull()
    expect(snapshot.items).toHaveLength(1)
    expect(snapshot.items[0]).toMatchObject({ catalogNumber: 'A-1', details: '详情 A-1', published: false, platforms: [] })

    // Pre-publish accepts case-insensitive catalog numbers and notifies the desktop.
    const stateResponse = await fetch(url('/api/publish/state'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalogNumber: 'a-1', published: true })
    })
    expect(stateResponse.status).toBe(200)
    expect(await stateResponse.json()).toEqual({ status: 'ok' })
    expect(listLibraryRecords({ catalogQuery: '', page: 1, pageSize: 20 }).records[0].published).toBe(true)
    expect(send).toHaveBeenCalledWith('library:publish-updated')

    send.mockClear()
    const platformsResponse = await fetch(url('/api/publish/platforms'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalogNumber: 'A-1', platforms: ['taobao', 'discogs'] })
    })
    expect(platformsResponse.status).toBe(200)
    expect(await platformsResponse.json()).toEqual({ status: 'ok' })
    expect(listLibraryRecords({ catalogQuery: '', page: 1, pageSize: 20 }).records[0].platforms)
      .toEqual(['taobao', 'discogs'])
    expect(send).toHaveBeenCalledWith('library:publish-updated')

    // Closing the round on the desktop empties the phone view; state persists.
    finishPublishRound()
    const emptied = await fetch(url('/api/publish/list'))
    expect((await emptied.json()).items).toEqual([])
    expect(listLibraryRecords({ catalogQuery: '', page: 1, pageSize: 20 }).records[0].published).toBe(true)
  })

  it('rejects updates for numbers missing from the library', async () => {
    upsertImportedRecords([{ ...record('A-1'), embeddedImage: null }])

    const stateResponse = await fetch(url('/api/publish/state'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalogNumber: 'GONE-1', published: true })
    })
    expect(stateResponse.status).toBe(200)
    expect(await stateResponse.json()).toEqual({ status: 'error', message: '记录不存在' })

    const platformsResponse = await fetch(url('/api/publish/platforms'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalogNumber: 'GONE-1', platforms: ['taobao'] })
    })
    expect(await platformsResponse.json()).toEqual({ status: 'error', message: '记录不存在' })
  })

  it('pushes publish changes to SSE clients instantly', async () => {
    upsertImportedRecords([{ ...record('A-1'), embeddedImage: null }])
    startPublishRound(['A-1'])

    const events = await fetch(url('/api/publish/events'))
    expect(events.status).toBe(200)
    expect(events.headers.get('Content-Type')).toContain('text/event-stream')
    const reader = events.body!.getReader()
    await reader.read() // retry hint

    const stateResponse = await fetch(url('/api/publish/state'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalogNumber: 'A-1', published: true })
    })
    expect(stateResponse.status).toBe(200)

    const chunk = await reader.read()
    expect(Buffer.from(chunk.value!).toString('utf8')).toContain('event: changed')
    await reader.cancel()
  })

  it('serves embedded cover images and hides records without one', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
    upsertImportedRecords([
      { ...record('IMG-1'), embeddedImage: { buffer: png, mimeType: 'image/png' } },
      { ...record('NO-IMG'), embeddedImage: null }
    ])
    startPublishRound(['IMG-1', 'NO-IMG'])

    const imageResponse = await fetch(url('/publish/image?catalog=IMG-1'))
    expect(imageResponse.status).toBe(200)
    expect(imageResponse.headers.get('Content-Type')).toBe('image/png')
    expect(Buffer.from(await imageResponse.arrayBuffer())).toEqual(png)

    const missingResponse = await fetch(url('/publish/image?catalog=NO-IMG'))
    expect(missingResponse.status).toBe(404)
  })
})
