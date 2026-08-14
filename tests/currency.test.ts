import { describe, it, expect, vi, afterEach } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

async function loadCurrency() {
  return await import('../src/main/currency')
}

function mockRatesFetch() {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ rates: { JPY: 150, EUR: 0.92, GBP: 0.79, CNY: 7.2 } }), {
      status: 200
    })
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('currency', () => {
  it('convertToUSD returns amount unchanged for USD', async () => {
    const { convertToUSD } = await loadCurrency()
    expect(await convertToUSD(42.5, 'USD')).toBe(42.5)
  })

  it('convertToUSD converts using fetched exchange rates', async () => {
    mockRatesFetch()
    const { convertToUSD } = await loadCurrency()
    // 1000 JPY / 150 = 6.666... -> 6.67
    expect(await convertToUSD(1000, 'JPY')).toBe(6.67)
    expect(await convertToUSD(10, 'EUR')).toBe(10.87)
  })

  it('convertToUSD returns null when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const { convertToUSD } = await loadCurrency()
    expect(await convertToUSD(100, 'JPY')).toBeNull()
  })

  it('convertToUSD returns null for non-ok responses and missing rates', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad', { status: 500 })))
    const first = await loadCurrency()
    expect(await first.convertToUSD(100, 'JPY')).toBeNull()

    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 })))
    const second = await loadCurrency()
    expect(await second.convertToUSD(100, 'JPY')).toBeNull()
  })

  it('formatPriceUSD formats prices and dashes for null', async () => {
    const { formatPriceUSD } = await loadCurrency()
    expect(formatPriceUSD(null)).toBe('-')
    expect(formatPriceUSD(12.345)).toBe('$12.35')
    expect(formatPriceUSD(0)).toBe('$0.00')
  })

  it('convertToUSDWithFallback uses API rates when available', async () => {
    mockRatesFetch()
    const { convertToUSDWithFallback } = await loadCurrency()
    expect(await convertToUSDWithFallback(1000, 'JPY')).toBe(6.67)
  })

  it('convertToUSDWithFallback falls back to static rates when the API fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
    const { convertToUSDWithFallback } = await loadCurrency()
    // Fallback JPY rate is 0.0067
    expect(await convertToUSDWithFallback(1000, 'JPY')).toBe(6.7)
    expect(await convertToUSDWithFallback(10, 'EUR')).toBe(10.8)
  })

  it('convertToUSDWithFallback passes USD through without hitting the API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
    const { convertToUSDWithFallback } = await loadCurrency()
    expect(await convertToUSDWithFallback(5, 'USD')).toBe(5)
  })

  it('convertToUSDWithFallback returns the original amount for unknown currencies', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
    const { convertToUSDWithFallback } = await loadCurrency()
    expect(await convertToUSDWithFallback(7, 'GBP' as never)).toBe(8.89)
    expect(await convertToUSDWithFallback(7, 'ZZZ' as never)).toBe(7)
  })

  it('caches exchange rates within the cache window', async () => {
    const fetchMock = mockRatesFetch()
    const { convertToUSD } = await loadCurrency()
    await convertToUSD(100, 'JPY')
    await convertToUSD(100, 'JPY')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('dedupes concurrent rate fetches into a single request', async () => {
    const fetchMock = mockRatesFetch()
    const { convertToUSD } = await loadCurrency()
    await Promise.all([
      convertToUSD(100, 'JPY'),
      convertToUSD(10, 'EUR'),
      convertToUSD(1, 'GBP')
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('getUsdToDisplayRate returns 1 for USD without fetching', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { getUsdToDisplayRate } = await loadCurrency()
    expect(await getUsdToDisplayRate('USD')).toBe(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('getUsdToDisplayRate converts USD to CNY using fetched rates', async () => {
    mockRatesFetch() // rates.CNY = 7.2 -> cnyToUsd = 1/7.2 -> usdToCny = 7.2
    const { getUsdToDisplayRate } = await loadCurrency()
    expect(await getUsdToDisplayRate('CNY')).toBeCloseTo(7.2, 5)
  })

  it('getUsdToDisplayRate falls back to static rates when the API fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
    const { getUsdToDisplayRate } = await loadCurrency()
    // FALLBACK_RATES.CNY = 0.14 -> usdToCny = 1/0.14
    expect(await getUsdToDisplayRate('CNY')).toBeCloseTo(1 / 0.14, 5)
  })
})
