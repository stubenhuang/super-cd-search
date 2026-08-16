/**
 * Normalize catalog number by inserting hyphen between letters and numbers if missing.
 * E.g., "UCCG90530" -> "UCCG-90530"
 */
export function normalizeCatalogNumber(catalogNumber: string): string {
  const trimmed = catalogNumber.trim().toUpperCase().replace(/\s+/g, '')
  return trimmed.replace(/^([A-Z]+)(\d+)$/, '$1-$2')
}
