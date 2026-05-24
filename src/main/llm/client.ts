import type { LLMSettings } from '../../shared/types'
import type { ChatMessage, ChatOptions, LLMResponse } from './types'

const DEFAULT_TIMEOUT = 60000

export class LLMClient {
  private settings: LLMSettings

  constructor(settings: LLMSettings) {
    this.settings = settings
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<LLMResponse> {
    const url = `${this.settings.apiBaseUrl}/chat/completions`

    const body = {
      model: this.settings.model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: options?.temperature ?? this.settings.temperature,
      max_tokens: options?.maxTokens
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT)

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.settings.apiKey}`
        },
        body: JSON.stringify(body),
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error')
        throw new Error(`LLM API error ${response.status}: ${errorText}`)
      }

      const data = await response.json() as {
        choices: Array<{
          message: { content: string }
        }>
        usage?: {
          prompt_tokens: number
          completion_tokens: number
          total_tokens: number
        }
      }

      const content = data.choices?.[0]?.message?.content
      if (!content) {
        throw new Error('Empty response from LLM')
      }

      return {
        content,
        usage: data.usage ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens
        } : undefined
      }
    } catch (err) {
      clearTimeout(timeoutId)
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('LLM API request timed out')
      }
      throw err
    }
  }
}