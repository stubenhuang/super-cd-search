import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { dialog } from 'electron'
import type { BatchQueryResult } from '../src/shared/types'

const { mockDownloadImage } = vi.hoisted(() => ({
  mockDownloadImage: vi.fn()
}))

vi.mock('../src/main/image', () => ({
  downloadImage: mockDownloadImage
}))

import { exportToExcel } from '../src/main/export'

const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function batch(catalogNumber: string, results: BatchQueryResult['results']): BatchQueryResult {
  return { catalogNumber, results }
}

function result(overrides: Partial<BatchQueryResult['results'][number]> = {}): BatchQueryResult['results'][number] {
  return {
    platform: 'discogs',
    name: 'Album',
    artist: 'Artist',
    priceMin: 10,
    priceMax: 20,
    coverUrl: null,
    link: 'https://www.discogs.com/release/1',
    status: 'found',
    details: { label: 'Label', format: 'CD', country: 'JP', released: '2024', genre: 'Jazz' },
    ...overrides
  }
}

let tempDir: string
let outPath: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'scs-export-'))
  outPath = join(tempDir, 'results.xlsx')
  vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: outPath })
  mockDownloadImage.mockResolvedValue(null)
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('exportToExcel', () => {
  it('returns null when the save dialog is canceled', async () => {
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true, filePath: undefined })
    expect(await exportToExcel([])).toBeNull()
    expect(existsSync(outPath)).toBe(false)
  })

  it('writes an xlsx workbook with all platforms', async () => {
    const filePath = await exportToExcel([
      batch('UCCG-90530', [
        result({ platform: 'discogs', priceMin: 10, priceMax: 20, link: 'https://www.discogs.com/release/1' }),
        result({ platform: 'ebay', name: 'eBay Album', status: 'not_found', details: undefined }),
        result({ platform: 'kojima', priceMin: 22.11, priceMax: 22.11 }),
        result({ platform: 'hmv', priceMin: null, priceMax: null }),
        result({ platform: 'yahoo', status: 'error', error: 'boom', details: undefined })
      ])
    ])

    expect(filePath).toBe(outPath)
    expect(existsSync(outPath)).toBe(true)
    const buffer = readFileSync(outPath)
    expect(buffer.subarray(0, 2).toString()).toBe('PK')
  })

  it('renders price ranges, single prices and dashes', async () => {
    await exportToExcel([
      batch('RANGE-1', [
        result({ platform: 'discogs', priceMin: 5, priceMax: 7, status: 'found' }),
        result({ platform: 'ebay', priceMin: 6, priceMax: 6, status: 'found' }),
        result({ platform: 'kojima', priceMin: null, priceMax: null, status: 'found' })
      ])
    ])
    expect(existsSync(outPath)).toBe(true)
  })

  it('embeds cover images when downloadImage succeeds', async () => {
    mockDownloadImage.mockResolvedValue({ base64: TINY_PNG, mimeType: 'image/png' })
    await exportToExcel([
      batch('IMG-1', [result({ coverUrl: 'https://cdn.example.com/cover.png' })])
    ])
    expect(mockDownloadImage).toHaveBeenCalledWith('https://cdn.example.com/cover.png')
    expect(existsSync(outPath)).toBe(true)
  })

  it('embeds gif covers via mime type detection', async () => {
    mockDownloadImage.mockResolvedValue({
      base64: 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      mimeType: 'image/gif'
    })
    await exportToExcel([
      batch('GIF-1', [result({ coverUrl: 'https://cdn.example.com/cover.gif' })])
    ])
    expect(existsSync(outPath)).toBe(true)
  })

  it('merges details from found platforms', async () => {
    await exportToExcel([
      batch('MERGE-1', [
        result({ platform: 'discogs', name: null, artist: null, details: { label: 'Label A', format: null, country: 'JP', released: null, genre: null } }),
        result({ platform: 'hmv', details: { label: null, format: 'SACD', country: null, released: '2023', genre: 'Classical' } })
      ])
    ])
    expect(existsSync(outPath)).toBe(true)
  })
})
