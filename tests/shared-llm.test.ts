import { describe, it, expect } from 'vitest'
import { isLlmConfigured } from '../src/shared/llm'
import type { LLMSettings } from '../src/shared/types'

function llmSettings(overrides: Partial<LLMSettings> = {}): LLMSettings {
  return {
    enabled: true,
    apiBaseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-test',
    model: 'gpt-test',
    platformEnabled: {
      discogs: true,
      ebay: true,
      kojima: true,
      hmv: true,
      yahoo: true,
      cdjapan: true,
      tower: true,
      surugaya: true,
      zenmarket: true
    },
    ...overrides
  }
}

describe('isLlmConfigured', () => {
  it('accepts fully configured, enabled settings', () => {
    expect(isLlmConfigured(llmSettings())).toBe(true)
  })

  it('rejects undefined and null settings', () => {
    expect(isLlmConfigured(undefined)).toBe(false)
    expect(isLlmConfigured(null)).toBe(false)
  })

  it('rejects disabled settings even when complete', () => {
    expect(isLlmConfigured(llmSettings({ enabled: false }))).toBe(false)
  })

  it('rejects settings with any missing field', () => {
    expect(isLlmConfigured(llmSettings({ apiKey: '' }))).toBe(false)
    expect(isLlmConfigured(llmSettings({ apiBaseUrl: '' }))).toBe(false)
    expect(isLlmConfigured(llmSettings({ model: '' }))).toBe(false)
  })
})
