/**
 * Accept-Language headers shared by the browser-driving modules.
 *
 * The Japanese retailers (Tower / HMV / Yahoo / Kojima / CDJapan) and the
 * barcode providers serve a localized page that is still parseable in English,
 * so they all use the same `ja,en` string. Keeping one constant per language
 * stops the literal drifting between the query modules, the barcode providers
 * and the LLM enrichment sources.
 */

/** Japanese-first, with an English fallback. */
export const JA_ACCEPT_LANGUAGE = { 'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8' } as const

/** English-only (CDJapan's English storefront). */
export const EN_ACCEPT_LANGUAGE = { 'Accept-Language': 'en-US,en;q=0.9' } as const

