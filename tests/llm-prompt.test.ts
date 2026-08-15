import { describe, it, expect } from 'vitest'
import { buildDetailFillPrompt } from '../src/main/llm/prompt'
import type { CDDetails, Platform } from '../src/shared/types'

const content = {
  text: 'Album title here',
  pageUrl: 'https://example.com/item/1',
  imageUrls: ['https://example.com/cover.jpg'],
  linkUrls: ['https://example.com/release/1']
}

const known: CDDetails = { label: 'Known Label', format: 'CD', country: null, released: null, genre: null }

describe('buildDetailFillPrompt', () => {
  it('includes platform name, catalog number and page URL', () => {
    const prompt = buildDetailFillPrompt('tower', 'UCCG-90530', content, ['released', 'genre'], known)
    expect(prompt).toContain('Tower Records Japan')
    expect(prompt).toContain('UCCG-90530')
    expect(prompt).toContain('https://example.com/item/1')
    expect(prompt).toContain('Album title here')
  })

  it('maps every platform to a human-readable name', () => {
    const names: Record<string, string> = {
      discogs: 'Discogs',
      ebay: 'eBay',
      kojima: 'Kojima Rokuon',
      hmv: 'HMV Japan',
      yahoo: 'Yahoo Shopping Japan',
      cdjapan: 'CDJapan',
      tower: 'Tower Records Japan',
      surugaya: 'Suruga-ya',
      zenmarket: 'ZenMarket'
    }
    for (const [platform, name] of Object.entries(names)) {
      expect(buildDetailFillPrompt(platform as Platform, 'X-1', content, ['label'], known)).toContain(name)
    }
  })

  it('asks only for the missing fields and lists already-known values', () => {
    const prompt = buildDetailFillPrompt('hmv', 'ABC-123', content, ['released', 'genre'], known)
    expect(prompt).toContain('Missing fields to find')
    expect(prompt).toContain('release date')
    expect(prompt).toContain('genre / style')
    expect(prompt).toContain('Known Label')
    expect(prompt).toContain('CD')
    expect(prompt).toContain('do NOT change or return these')
    expect(prompt).toContain('Return ONLY the JSON object')
  })

  it('asks for every detail field when none are missing (safety fallback)', () => {
    const prompt = buildDetailFillPrompt('cdjapan', 'ABC-123', content, [], known)
    expect(prompt).toContain('"label"')
    expect(prompt).toContain('"format"')
    expect(prompt).toContain('"country"')
    expect(prompt).toContain('"released"')
    expect(prompt).toContain('"genre"')
  })

  it('instructs the model to prefer the structured-data section', () => {
    const prompt = buildDetailFillPrompt('tower', 'ABC-123', content, ['genre'], known)
    expect(prompt).toContain('[STRUCTURED DATA]')
  })

  it('instructs normalization to Discogs-style conventions', () => {
    const prompt = buildDetailFillPrompt('tower', 'ABC-123', content, ['country', 'format', 'released', 'genre'], known)
    expect(prompt).toContain('国内')
    expect(prompt).toContain('Japan')
    expect(prompt).toContain('CD, Album')
    expect(prompt).toContain('YYYY-MM-DD')
    expect(prompt).toContain('クラシック')
    expect(prompt).toContain('Classical')
  })
})
