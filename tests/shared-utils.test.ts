import { describe, it, expect } from 'vitest'
import { normalizeCatalogNumber } from '../src/shared/utils'

describe('normalizeCatalogNumber', () => {
  it('inserts a hyphen between letters and trailing digits', () => {
    expect(normalizeCatalogNumber('UCCG90530')).toBe('UCCG-90530')
  })

  it('trims and uppercases input', () => {
    expect(normalizeCatalogNumber('  uicd6234 ')).toBe('UICD-6234')
  })

  it('normalizes whitespace between the prefix and number', () => {
    expect(normalizeCatalogNumber('UCCG 90530')).toBe('UCCG-90530')
  })

  it('leaves already-normalized numbers untouched', () => {
    expect(normalizeCatalogNumber('UCCG-90530')).toBe('UCCG-90530')
  })

  it('handles numbers without a letter prefix', () => {
    expect(normalizeCatalogNumber('12345')).toBe('12345')
  })

  it('handles letters-only and digits-only edge cases', () => {
    expect(normalizeCatalogNumber('ABC')).toBe('ABC')
    expect(normalizeCatalogNumber('')).toBe('')
  })
})
