export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  temperature?: number
  maxTokens?: number
  /**
   * Caller-owned cancellation signal. Distinct from the client's internal
   * 60s timeout: when this aborts, the failure is reported as a cancellation
   * rather than a timeout.
   */
  signal?: AbortSignal
}

export interface LLMResponse {
  content: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}
