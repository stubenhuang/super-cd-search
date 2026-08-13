import { describe, it, expect } from 'vitest'
import { buildParsePrompt } from '../src/main/llm/prompt'

const content = {
  text: 'Album title here',
  pageUrl: 'https://example.com/item/1',
  imageUrls: ['https://example.com/cover.jpg'],
  linkUrls: ['https://example.com/release/1']
}

describe('buildParsePrompt', () => {
  it('includes platform name, catalog number and page URL', () => {
    const prompt = buildParsePrompt('discogs', 'UCCG-90530', content)
    expect(prompt).toContain('Discogs')
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
      tower: 'Tower Records Japan'
    }
    for (const [platform, name] of Object.entries(names)) {
      expect(buildParsePrompt(platform as never, 'X-1', content)).toContain(name)
    }
  })

  it('requires JSON-only output with all expected fields', () => {
    const prompt = buildParsePrompt('hmv', 'ABC-123', content)
    expect(prompt).toContain('"name"')
    expect(prompt).toContain('"priceMin"')
    expect(prompt).toContain('"priceCurrency"')
    expect(prompt).toContain('"details"')
    expect(prompt).toContain('Return ONLY the JSON object')
  })
})
