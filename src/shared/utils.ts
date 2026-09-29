/**
 * Normalize catalog number by inserting hyphen between letters and numbers if missing.
 * E.g., "UCCG90530" -> "UCCG-90530"
 */
export function normalizeCatalogNumber(catalogNumber: string): string {
  const trimmed = catalogNumber.trim().toUpperCase().replace(/\s+/g, '')
  return trimmed.replace(/^([A-Z]+)(\d+)$/, '$1-$2')
}

/**
 * Stable human-readable message for anything that was thrown.
 *
 * Replaces the `err instanceof Error ? err.message : String(err)` idiom that
 * used to be spelled out at ~70 call sites (and re-implemented privately in
 * the updater with a slightly different body).
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return typeof err === 'string' ? err : String(err)
}

/**
 * Resolve a possibly-relative URL against the page's base.
 *
 * Handles the two shapes retailers emit in their `src`/`href` attributes:
 * protocol-relative (`//cdn.example/x.jpg`) and root-relative
 * (`/item/123`). Absolute URLs are returned unchanged.
 */
export function normalizeUrl(base: string, value: string | undefined | null): string | undefined {
  if (!value) return undefined
  if (value.startsWith('//')) return `https:${value}`
  if (value.startsWith('/')) return `${base}${value}`
  return value
}

/** Inline placeholders that stand in for a missing cover image. */
const PLACEHOLDER_URL_PATTERN = /blank\.|spacer\.|1x1|^data:image\/gif;base64,R0lGOD/i

/**
 * Normalize a cover image URL: same rules as {@link normalizeUrl}, plus the
 * cleanups the scrapers applied by hand — upgrade `http:` to `https:` (mixed
 * content is blocked in the renderer) and drop placeholder/spacer images,
 * which are indistinguishable from a real cover in the DOM.
 */
export function normalizeCoverUrl(base: string, value: string | undefined | null): string | null {
  const resolved = normalizeUrl(base, value)
  if (!resolved) return null
  if (PLACEHOLDER_URL_PATTERN.test(resolved)) return null
  if (resolved.startsWith('http://')) return resolved.replace('http://', 'https://')
  return resolved
}
