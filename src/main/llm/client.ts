import type { LLMSettings } from '../../shared/types'
import type { ChatMessage, ChatOptions, LLMResponse } from './types'

const DEFAULT_TIMEOUT = 60000
/** Deterministic JSON extraction; no longer user-configurable. */
const DEFAULT_TEMPERATURE = 0

class EmptyLLMResponseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EmptyLLMResponseError'
  }
}

interface LLMApiResponse {
  choices?: Array<{
    message?: {
      role?: string
      content?: string | null
      reasoning_content?: string | null
    }
    finish_reason?: string | null
  }>
  error?: { message?: string }
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

/**
 * Accept both the provider root (`https://api.deepseek.com`), the OpenAI-style
 * versioned root (`https://api.deepseek.com/v1`), and an already-complete
 * `/chat/completions` endpoint. Avoids the doubled `/chat/completions` URL that
 * previously produced empty-looking responses.
 */
function buildChatUrl(apiBaseUrl: string): string {
  const trimmed = apiBaseUrl.trim().replace(/\/+$/, '')
  if (/\/chat\/completions$/i.test(trimmed)) {
    return trimmed
  }
  return `${trimmed}/chat/completions`
}

export class LLMClient {
  private settings: LLMSettings

  constructor(settings: LLMSettings) {
    this.settings = settings
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<LLMResponse> {
    try {
      return await this.request(messages, options)
    } catch (err) {
      // Some reasoning models (DeepSeek R1 / V4 flash) spend their completion
      // budget on reasoning when `max_tokens` is small, leaving `content`
      // empty. Retry once without the cap so the model has room for its final
      // JSON answer.
      if (err instanceof EmptyLLMResponseError && options?.maxTokens !== undefined) {
        return await this.request(messages, { ...options, maxTokens: undefined })
      }
      throw err
    }
  }

  private async request(messages: ChatMessage[], options?: ChatOptions): Promise<LLMResponse> {
    const url = buildChatUrl(this.settings.apiBaseUrl)

    const body: Record<string, unknown> = {
      model: this.settings.model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: options?.temperature ?? DEFAULT_TEMPERATURE
    }
    if (options?.maxTokens !== undefined) {
      body.max_tokens = options.maxTokens
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

      let data: LLMApiResponse
      try {
        data = await response.json() as LLMApiResponse
      } catch {
        throw new EmptyLLMResponseError('LLM returned an invalid JSON response')
      }

      if (!data.choices || data.choices.length === 0) {
        throw new EmptyLLMResponseError(data.error?.message || 'Empty response from LLM')
      }

      const choice = data.choices[0]
      let content = typeof choice?.message?.content === 'string'
        ? choice.message.content.trim()
        : ''

      // OpenAI-compatible fallback for providers that put the final answer in
      // `reasoning_content` while leaving `content` empty.
      if (!content && typeof choice?.message?.reasoning_content === 'string') {
        content = choice.message.reasoning_content.trim()
      }

      if (!content) {
        throw new EmptyLLMResponseError(
          `Empty response from LLM (finish_reason: ${choice?.finish_reason ?? 'unknown'})`
        )
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
