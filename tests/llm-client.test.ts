import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { LLMClient } from '../src/main/llm/client'

const baseSettings = {
  enabled: true,
  apiBaseUrl: 'https://llm.example.com/v1',
  apiKey: 'secret-key',
  model: 'test-model',
  temperature: 0.3,
  platformEnabled: {
    discogs: true,
    ebay: true,
    kojima: true,
    hmv: true,
    yahoo: true
  }
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('LLMClient', () => {
  it('sends chat completions request and maps the response', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"name":"Album"}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
        }),
        { status: 200 }
      )
    )

    const client = new LLMClient(baseSettings)
    const result = await client.chat([{ role: 'user', content: 'hi' }], { temperature: 0.7, maxTokens: 100 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('https://llm.example.com/v1/chat/completions')
    expect(options.method).toBe('POST')
    expect(options.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer secret-key'
    })
    const body = JSON.parse(options.body)
    expect(body).toMatchObject({
      model: 'test-model',
      temperature: 0.7,
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }]
    })
    expect(result.content).toBe('{"name":"Album"}')
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 })
  })

  it('defaults temperature from settings and omits max_tokens', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })
    )
    const client = new LLMClient(baseSettings)
    await client.chat([{ role: 'system', content: 'be nice' }])
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.temperature).toBe(0.3)
    expect(body.max_tokens).toBeUndefined()
  })

  it('reports usage as undefined when the API omits it', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })
    )
    const client = new LLMClient(baseSettings)
    const result = await client.chat([{ role: 'user', content: 'x' }])
    expect(result.usage).toBeUndefined()
  })

  it('throws with status text on non-ok responses', async () => {
    fetchMock.mockResolvedValue(new Response('rate limited', { status: 429 }))
    const client = new LLMClient(baseSettings)
    await expect(client.chat([{ role: 'user', content: 'x' }])).rejects.toThrow(
      'LLM API error 429: rate limited'
    )
  })

  it('throws on empty response content', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), { status: 200 }))
    const client = new LLMClient(baseSettings)
    await expect(client.chat([{ role: 'user', content: 'x' }])).rejects.toThrow('Empty response from LLM')
  })

  it('rethrows non-abort fetch errors', async () => {
    fetchMock.mockRejectedValue(new Error('connection refused'))
    const client = new LLMClient(baseSettings)
    await expect(client.chat([{ role: 'user', content: 'x' }])).rejects.toThrow('connection refused')
  })

  it('maps an AbortError to a timeout message', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(
      (_url: string, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            const err = new Error('Aborted')
            err.name = 'AbortError'
            reject(err)
          })
        })
    )

    const client = new LLMClient(baseSettings)
    const promise = client.chat([{ role: 'user', content: 'x' }])
    const assertion = expect(promise).rejects.toThrow('LLM API request timed out')
    await vi.advanceTimersByTimeAsync(60000)
    await assertion
  })
})
