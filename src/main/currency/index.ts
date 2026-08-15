import type { DisplayCurrency } from '../../shared/types'
import { logger } from '../logger'

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
    logger.debug('currency', 'fetching exchange rates')
    const response = await fetch('https://open.er-api.com/v6/latest/USD')
    if (!response.ok) {
      logger.warn('currency', 'exchange rate API returned non-ok', { status: response.status })
      return null
    }

    const data = await response.json()
    if (!data.rates) return null

    logger.debug('currency', 'exchange rates fetched', { jpyToUsd: 1 / data.rates.JPY, cnyToUsd: 1 / data.rates.CNY })
    return {
      JPY: 1 / data.rates.JPY, // JPY to USD
      EUR: 1 / data.rates.EUR, // EUR to USD
      GBP: 1 / data.rates.GBP, // GBP to USD
      CNY: 1 / data.rates.CNY, // CNY to USD
      updatedAt: Date.now()
    }
  } catch (err) {
    logger.warn('currency', 'failed to fetch exchange rates', { error: err instanceof Error ? err.message : String(err) })
    return null
  }
}

let ratesPromise: Promise<ExchangeRates | null> | null = null

async function getExchangeRates(): Promise<ExchangeRates | null> {
  if (cachedRates && Date.now() - cachedRates.updatedAt < CACHE_DURATION) {
    return cachedRates
  }

  // Dedupe concurrent callers: several prices in the same batch are converted
  // at once, and without this each would fire its own network request.
  if (!ratesPromise) {
    ratesPromise = fetchExchangeRates()
      .then((rates) => {
        cachedRates = rates
        return rates
      })
      .finally(() => {
        ratesPromise = null
      })
  }

  return ratesPromise
}

/** Kick off a non-blocking rate fetch at startup so the first conversion is instant. */
export function prewarmExchangeRates(): void {
  void getExchangeRates()
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
  logger.debug('currency', 'using fallback exchange rate', { amount, fromCurrency })
  if (fromCurrency === 'USD') return amount
  const rate = FALLBACK_RATES[fromCurrency]
  if (!rate) return amount
  return Math.round(amount * rate * 100) / 100
}

/**
 * Return the multiplier that converts 1 USD into the target display currency.
 * ExchangeRates stores "1 foreign unit -> USD", so USD -> foreign is its
 * reciprocal. Falls back to static rates when the API is unavailable, so this
 * never rejects and never returns null.
 */
export async function getUsdToDisplayRate(target: DisplayCurrency): Promise<number> {
  if (target === 'USD') return 1

  const rates = await getExchangeRates()
  const cnyToUsd = rates?.CNY ?? FALLBACK_RATES.CNY
  return 1 / cnyToUsd
}
