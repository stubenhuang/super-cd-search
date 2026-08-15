import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BrowserWindow } from 'electron'
import { createServer } from 'net'
import type { AddressInfo } from 'net'

const { mockResolveBarcodeCatalogCached, mockNormalizeBarcode, mockIsBatchQueryRunning } = vi.hoisted(() => ({
  mockResolveBarcodeCatalogCached: vi.fn(),
  mockNormalizeBarcode: vi.fn((barcode: string) => barcode),
  mockIsBatchQueryRunning: vi.fn(() => false)
}))

vi.mock('../src/main/barcode/resolver', () => ({
  resolveBarcodeCatalogCached: mockResolveBarcodeCatalogCached
}))

vi.mock('../src/main/queries/discogs', () => ({
  normalizeDiscogsBarcode: mockNormalizeBarcode
}))

vi.mock('../src/main/orchestrator', () => ({
  isBatchQueryRunning: mockIsBatchQueryRunning
}))

import {
  applyLanServer,
  closeLanServer,
  handleLanBarcodeLookup,
  handleLanBarcodeSelection,
  setLanSearchAvailability
} from '../src/main/lan'
import { deleteSetting, setLanToken, setSetting } from '../src/main/settings'

async function getFreePort(): Promise<number> {
  return new Promise(resolve => {
    const probe = createServer()
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address() as AddressInfo
      probe.close(() => resolve(address.port))
    })
  })
}

function mockDesktopWindow(send = vi.fn()) {
  return { isDestroyed: () => false, webContents: { send } }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsBatchQueryRunning.mockReturnValue(false)
  mockNormalizeBarcode.mockImplementation((barcode: string) => barcode)
  setLanSearchAvailability(false)
  setSetting('lanEnabled', true)
  setSetting('lanHost', '127.0.0.1')
  deleteSetting('lanPort')
  setLanToken('')
})

afterEach(async () => {
  setLanSearchAvailability(false)
  setSetting('lanEnabled', false)
  await closeLanServer()
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([])
})

describe('handleLanBarcodeLookup', () => {
  it('rejects the request when the desktop search controls are unavailable', async () => {
    await applyLanServer()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockDesktopWindow() as never])

    expect(await handleLanBarcodeLookup('4988006812345')).toMatchObject({
      status: 'unavailable',
      message: expect.stringContaining('搜索')
    })
    expect(mockResolveBarcodeCatalogCached).not.toHaveBeenCalled()
  })

  it('adds a high-confidence resolved catalog number and stops the chain', async () => {
    await applyLanServer()
    const send = vi.fn()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockDesktopWindow(send) as never])
    setLanSearchAvailability(true)
    mockResolveBarcodeCatalogCached.mockResolvedValue({
      status: 'found',
      candidate: {
        catalogNumber: 'TOCP-53001',
        title: 'Artist - Album',
        source: 'tower',
        confidence: 'high'
      },
      attemptedSources: ['discogs', 'tower']
    })

    const response = await handleLanBarcodeLookup('4988006812345')
    expect(response).toEqual({
      status: 'added',
      barcode: '4988006812345',
      catalogNumber: 'TOCP-53001',
      title: 'Artist - Album',
      source: 'tower'
    })
    expect(send).toHaveBeenCalledWith('lan:catalog-added', {
      catalogNumber: 'TOCP-53001',
      title: 'Artist - Album'
    })
  })

  it('returns low-confidence candidates for the phone to choose from', async () => {
    await applyLanServer()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockDesktopWindow() as never])
    setLanSearchAvailability(true)
    mockResolveBarcodeCatalogCached.mockResolvedValue({
      status: 'candidates',
      candidates: [
        { catalogNumber: 'WPCS-11100', title: 'Luminosa', source: 'tower', confidence: 'low' },
        { catalogNumber: 'WPCS-11100', title: 'Luminosa', source: 'hmv', confidence: 'low' }
      ],
      attemptedSources: ['discogs', 'tower', 'hmv']
    })

    const response = await handleLanBarcodeLookup('4943674029365')
    expect(response.status).toBe('candidates')
    expect(response.candidates).toHaveLength(2)

    const send = vi.fn()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockDesktopWindow(send) as never])
    const selected = await handleLanBarcodeSelection('4943674029365', 'WPCS-11100')
    expect(selected).toMatchObject({ status: 'added', catalogNumber: 'WPCS-11100', source: 'tower' })
    expect(send).toHaveBeenCalledWith('lan:catalog-added', {
      catalogNumber: 'WPCS-11100',
      title: 'Luminosa'
    })
  })

  it('rejects a stale or forged candidate selection', async () => {
    await applyLanServer()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockDesktopWindow() as never])
    setLanSearchAvailability(true)

    const response = await handleLanBarcodeSelection('4943674029365', 'WRONG-1')
    expect(response).toMatchObject({ status: 'error', message: expect.stringContaining('过期') })
  })

  it('maps no_token and not_found resolutions to phone-facing responses', async () => {
    await applyLanServer()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockDesktopWindow() as never])
    setLanSearchAvailability(true)

    mockResolveBarcodeCatalogCached.mockResolvedValue({ status: 'no_token', attemptedSources: ['discogs', 'tower'] })
    expect(await handleLanBarcodeLookup('4988006812345')).toMatchObject({
      status: 'no_token',
      message: expect.stringContaining('Token')
    })

    mockResolveBarcodeCatalogCached.mockResolvedValue({ status: 'not_found', attemptedSources: ['discogs', 'tower'] })
    expect(await handleLanBarcodeLookup('4988006812345')).toMatchObject({
      status: 'not_found',
      message: expect.stringContaining('未找到')
    })
  })
})
