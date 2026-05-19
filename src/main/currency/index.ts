interface ExchangeRates {
  JPY: number
  EUR: number
  GBP: number
  CNY: number
  updatedAt: number
}

let cachedRates: ExchangeRates | null = null
const CACHE_DURATION = 60 * 60 * 1000 // 1 hour

async function fetchExchangeRates(): Promise<ExchangeRates | null> {
  try {
    // Use free API that doesn't require key
    const response = await fetch('https://open.er-api.com/v6/latest/USD')
    if (!response.ok) return null

    const data = await response.json()
    if (!data.rates) return null

    return {
      JPY: 1 / data.rates.JPY, // JPY to USD
      EUR: 1 / data.rates.EUR, // EUR to USD
      GBP: 1 / data.rates.GBP, // GBP to USD
      CNY: 1 / data.rates.CNY, // CNY to USD
      updatedAt: Date.now()
    }
  } catch (err) {
    console.warn('Failed to fetch exchange rates:', err)
    return null
  }
}

async function getExchangeRates(): Promise<ExchangeRates | null> {
  if (cachedRates && Date.now() - cachedRates.updatedAt < CACHE_DURATION) {
    return cachedRates
  }

  cachedRates = await fetchExchangeRates()
  return cachedRates
}

export type Currency = 'JPY' | 'EUR' | 'GBP' | 'CNY' | 'USD'

export async function convertToUSD(amount: number, fromCurrency: Currency): Promise<number | null> {
  if (fromCurrency === 'USD') return amount

  const rates = await getExchangeRates()
  if (!rates) return null

  const rate = rates[fromCurrency]
  if (!rate) return null

  return Math.round(amount * rate * 100) / 100 // Round to 2 decimal places
}

export function formatPriceUSD(price: number | null): string {
  if (price === null) return '-'
  return `$${price.toFixed(2)}`
}

// Fallback rates (approximate, used when API fails)
const FALLBACK_RATES: ExchangeRates = {
  JPY: 0.0067,
  EUR: 1.08,
  GBP: 1.27,
  CNY: 0.14,
  updatedAt: Date.now()
}

export async function convertToUSDWithFallback(amount: number, fromCurrency: Currency): Promise<number> {
  const result = await convertToUSD(amount, fromCurrency)
  if (result !== null) return result

  // Use fallback rates if API fails
  if (fromCurrency === 'USD') return amount
  const rate = FALLBACK_RATES[fromCurrency]
  if (!rate) return amount
  return Math.round(amount * rate * 100) / 100
}
