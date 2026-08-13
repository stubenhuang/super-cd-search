import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetSetting, mockChat, mockCompressHtml, mockConvert } = vi.hoisted(() => ({
  mockGetSetting: vi.fn(),
  mockChat: vi.fn(),
  mockCompressHtml: vi.fn(),
  mockConvert: vi.fn(async (amount: number) => amount * 0.01)
}))

vi.mock('../src/main/settings', () => ({
  getSetting: mockGetSetting
}))

vi.mock('../src/main/llm/client', () => ({
  LLMClient: class {
    async chat() {
      return mockChat()
    }
  }
}))

vi.mock('../src/main/llm/prompt', () => ({
  buildParsePrompt: vi.fn(() => 'prompt')
}))

vi.mock('../src/main/parser/readability', () => ({
  compressHtml: mockCompressHtml
}))

vi.mock('../src/main/currency', () => ({
  convertToUSDWithFallback: mockConvert
}))

import { tryLLMParse } from '../src/main/llm/parser'

const enabledSettings = {
  enabled: true,
  apiBaseUrl: 'https://api.example.com/v1',
  apiKey: 'key',
  model: 'model',
  temperature: 0,
  platformEnabled: {
    discogs: true,
    ebay: true,
    kojima: true,
    hmv: true,
    yahoo: true,
    cdjapan: true,
    tower: true
  }
}

function setupSettings(llm: unknown): void {
  mockGetSetting.mockImplementation((key: string) => {
    if (key === 'llm') return llm
    return undefined
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCompressHtml.mockReturnValue({
    text: 'compressed text',
    pageUrl: 'https://www.discogs.com/release/123',
    imageUrls: [],
    linkUrls: []
  })
})

describe('tryLLMParse', () => {
  it('returns null when LLM is not enabled', async () => {
    setupSettings(undefined)
    expect(await tryLLMParse('discogs', 'X-1', '<html/>', 'https://x')).toBeNull()
  })

  it('returns null when the platform is disabled', async () => {
    setupSettings({
      ...enabledSettings,
      platformEnabled: { discogs: false, ebay: false, kojima: false, hmv: false, yahoo: false, cdjapan: false, tower: false }
    })
    expect(await tryLLMParse('discogs', 'X-1', '<html/>', 'https://x')).toBeNull()
  })

  it('returns null when API configuration is incomplete', async () => {
    setupSettings({ ...enabledSettings, apiKey: '' })
    expect(await tryLLMParse('discogs', 'X-1', '<html/>', 'https://x')).toBeNull()

    setupSettings({ ...enabledSettings, apiBaseUrl: '' })
    expect(await tryLLMParse('discogs', 'X-1', '<html/>', 'https://x')).toBeNull()

    setupSettings({ ...enabledSettings, model: '' })
    expect(await tryLLMParse('discogs', 'X-1', '<html/>', 'https://x')).toBeNull()
  })

  it('parses fenced JSON and converts prices to USD', async () => {
    setupSettings(enabledSettings)
    mockChat.mockResolvedValue({
      content: '```json\n{"name":"Some Album","artist":"Artist","priceMin":3000,"priceMax":3300,"priceCurrency":"JPY","coverUrl":null,"link":null,"details":null}\n```'
    })

    const result = await tryLLMParse('discogs', 'X-1', '<html/>', 'https://www.discogs.com/release/123')
    expect(result).toMatchObject({
      platform: 'discogs',
      name: 'Some Album',
      artist: 'Artist',
      priceMin: 30,
      priceMax: 33,
      status: 'found'
    })
    expect(mockConvert).toHaveBeenCalledWith(3000, 'JPY')
  })

  it('returns null when the model output is invalid JSON', async () => {
    setupSettings(enabledSettings)
    mockChat.mockResolvedValue({ content: 'not json at all' })
    expect(await tryLLMParse('discogs', 'X-1', '<html/>', 'https://x')).toBeNull()
  })

  it('returns null when the model output is not an object', async () => {
    setupSettings(enabledSettings)
    mockChat.mockResolvedValue({ content: '"a string"' })
    expect(await tryLLMParse('discogs', 'X-1', '<html/>', 'https://x')).toBeNull()
  })

  it('returns not_found when the model output has no name', async () => {
    setupSettings(enabledSettings)
    mockChat.mockResolvedValue({
      content: '{"name":null,"artist":null,"priceMin":null,"priceMax":null,"priceCurrency":null,"coverUrl":null,"link":null,"details":null}'
    })
    const result = await tryLLMParse('discogs', 'X-1', '<html/>', 'https://x')
    expect(result?.status).toBe('not_found')
  })

  it('returns null when the chat call throws', async () => {
    setupSettings(enabledSettings)
    mockChat.mockRejectedValue(new Error('boom'))
    expect(await tryLLMParse('discogs', 'X-1', '<html/>', 'https://x')).toBeNull()
  })

  it('resolves relative cover and link URLs against the page URL', async () => {
    setupSettings(enabledSettings)
    mockChat.mockResolvedValue({
      content: JSON.stringify({
        name: 'Album',
        artist: 'Artist',
        priceMin: null,
        priceMax: null,
        priceCurrency: null,
        coverUrl: '/media/cover.jpg',
        link: '/release/123',
        details: { label: 'L', format: 'CD', country: 'JP', released: '2024', genre: 'Jazz' }
      })
    })

    const result = await tryLLMParse('discogs', 'X-1', '<html/>', 'https://www.discogs.com/search?q=1')
    expect(result?.coverUrl).toBe('https://www.discogs.com/media/cover.jpg')
    expect(result?.link).toBe('https://www.discogs.com/release/123')
    expect(result?.details).toEqual({ label: 'L', format: 'CD', country: 'JP', released: '2024', genre: 'Jazz' })
  })

  it('keeps relative URLs as-is when the page URL is invalid', async () => {
    setupSettings(enabledSettings)
    mockChat.mockResolvedValue({
      content: JSON.stringify({
        name: 'Album',
        artist: null,
        priceMin: null,
        priceMax: null,
        priceCurrency: null,
        coverUrl: '/media/cover.jpg',
        link: '/release/123',
        details: null
      })
    })
    const result = await tryLLMParse('discogs', 'X-1', '<html/>', 'not a valid url')
    expect(result?.coverUrl).toBe('/media/cover.jpg')
    expect(result?.link).toBe('/release/123')
  })

  it('picks a cover image from compressed image URLs when the model provides none', async () => {
    setupSettings(enabledSettings)
    mockCompressHtml.mockReturnValue({
      text: 't',
      pageUrl: 'https://www.discogs.com/release/123',
      imageUrls: ['https://cdn.example.com/icon.png', 'https://img.example.com/release/123-cover.jpg'],
      linkUrls: []
    })
    mockChat.mockResolvedValue({
      content: JSON.stringify({
        name: 'Album',
        artist: null,
        priceMin: null,
        priceMax: null,
        priceCurrency: null,
        coverUrl: null,
        link: null,
        details: null
      })
    })
    const result = await tryLLMParse('discogs', 'X-1', '<html/>', 'https://www.discogs.com/release/123')
    expect(result?.coverUrl).toBe('https://img.example.com/release/123-cover.jpg')
  })

  it('falls back to the first non-excluded image URL', async () => {
    setupSettings(enabledSettings)
    mockCompressHtml.mockReturnValue({
      text: 't',
      pageUrl: 'https://example.com/item/1',
      imageUrls: ['https://cdn.example.com/icon.png', 'https://cdn.example.com/photo1.jpg'],
      linkUrls: []
    })
    mockChat.mockResolvedValue({
      content: JSON.stringify({
        name: 'Album',
        artist: null,
        priceMin: null,
        priceMax: null,
        priceCurrency: null,
        coverUrl: null,
        link: null,
        details: null
      })
    })
    const result = await tryLLMParse('ebay', 'X-1', '<html/>', 'https://example.com/item/1')
    expect(result?.coverUrl).toBe('https://cdn.example.com/photo1.jpg')
  })

  it('uses the page URL as link when it matches a product pattern', async () => {
    setupSettings(enabledSettings)
    mockCompressHtml.mockReturnValue({
      text: 't',
      pageUrl: 'https://www.discogs.com/release/9876',
      imageUrls: [],
      linkUrls: ['https://www.discogs.com/login', 'https://www.discogs.com/search']
    })
    mockChat.mockResolvedValue({
      content: JSON.stringify({
        name: 'Album',
        artist: null,
        priceMin: null,
        priceMax: null,
        priceCurrency: null,
        coverUrl: null,
        link: null,
        details: null
      })
    })
    const result = await tryLLMParse('discogs', 'X-1', '<html/>', 'https://www.discogs.com/release/9876')
    expect(result?.link).toBe('https://www.discogs.com/release/9876')
  })

  it('returns null cover and link when nothing matches', async () => {
    setupSettings(enabledSettings)
    mockCompressHtml.mockReturnValue({
      text: 't',
      pageUrl: 'https://example.com/home',
      imageUrls: [],
      linkUrls: []
    })
    mockChat.mockResolvedValue({
      content: JSON.stringify({
        name: 'Album',
        artist: null,
        priceMin: null,
        priceMax: null,
        priceCurrency: null,
        coverUrl: null,
        link: null,
        details: null
      })
    })
    const result = await tryLLMParse('yahoo', 'X-1', '<html/>', 'https://example.com/home')
    expect(result?.coverUrl).toBeNull()
    expect(result?.link).toBeNull()
  })
})
