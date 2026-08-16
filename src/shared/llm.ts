import type { LLMSettings } from './types'

/** True when the LLM settings carry everything needed to call the API. */
export function isLlmConfigured(llm?: LLMSettings | null): boolean {
  return !!(
    llm?.enabled &&
    llm.apiKey &&
    llm.apiBaseUrl &&
    llm.model
  )
}
