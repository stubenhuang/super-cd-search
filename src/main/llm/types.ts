export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  temperature?: number
  maxTokens?: number
}

export interface LLMResponse {
  content: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

export interface LLMPlatformResult {
  name: string | null
  artist: string | null
  priceMin: number | null
  priceMax: number | null
  priceCurrency: string | null
  coverUrl: string | null
  link: string | null
  details: {
    label: string | null
    format: string | null
    country: string | null
    released: string | null
    genre: string | null
  }
}
