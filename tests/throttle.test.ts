import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ipcMain } from 'electron'
import {
  throttledFetch,
  getThrottleStatus,
  registerThrottleIpc,
  destroyProxyAgents
} from '../src/main/throttle'

const { mockGetSetting } = vi.hoisted(() => ({
  mockGetSetting: vi.fn()
}))

vi.mock('../src/main/settings', () => ({
  getSetting: mockGetSetting
}))

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  mockGetSetting.mockReturnValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('throttledFetch', () => {
  it('performs a plain fetch after the domain delay', async () => {
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }))

    const promise = throttledFetch('plain.test', 'https://plain.test/1')
    await vi.advanceTimersByTimeAsync(10000)
    const response = await promise

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith('https://plain.test/1', undefined)
  })

  it('uses a custom delay range when provided', async () => {
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }))

    const promise = throttledFetch(
      'custom.test',
      'https://custom.test/1',
      undefined,
      { minDelay: 10, maxDelay: 20 }
    )
    await vi.advanceTimersByTimeAsync(30)
    const response = await promise

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('spaces consecutive requests from the completion of the previous one', async () => {
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }))

    const first = throttledFetch('spaced.test', 'https://spaced.test/1', undefined, { minDelay: 200, maxDelay: 200 })
    await vi.advanceTimersByTimeAsync(50)
    await first

    const second = throttledFetch('spaced.test', 'https://spaced.test/2', undefined, { minDelay: 200, maxDelay: 200 })
    await vi.advanceTimersByTimeAsync(50)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(200)
    await second
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries with backoff on 429 responses', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('rate', { status: 429 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))

    const promise = throttledFetch('retry.test', 'https://retry.test/1')
    await vi.advanceTimersByTimeAsync(6000)
    await vi.advanceTimersByTimeAsync(2000)
    await vi.advanceTimersByTimeAsync(6000)
    const response = await promise

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects after exhausting all retries', async () => {
    fetchMock.mockResolvedValue(new Response('rate', { status: 429 }))

    const promise = throttledFetch('exhaust.test', 'https://exhaust.test/1')
    const assertion = expect(promise).rejects.toThrow(/Rate limited by exhaust\.test after 3 retries/)
    await vi.advanceTimersByTimeAsync(6000)
    await vi.advanceTimersByTimeAsync(2000 + 6000)
    await vi.advanceTimersByTimeAsync(4000 + 6000)
    await vi.advanceTimersByTimeAsync(8000 + 6000)

    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('rejects and propagates fetch errors', async () => {
    fetchMock.mockRejectedValue(new Error('network failure'))

    const promise = throttledFetch('error.test', 'https://error.test/1')
    const assertion = expect(promise).rejects.toThrow('network failure')
    await vi.advanceTimersByTimeAsync(10000)

    await assertion
  })

  it('uses a SOCKS proxy agent when proxy settings are enabled', async () => {
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'proxyEnabled') return true
      if (key === 'proxyHost') return '127.0.0.1'
      if (key === 'proxyPort') return 1080
      return undefined
    })
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }))

    const promise = throttledFetch('proxy.test', 'https://proxy.test/1')
    await vi.advanceTimersByTimeAsync(10000)
    await promise

    const [, options] = fetchMock.mock.calls[0]
    expect(options.agent).toBeDefined()
  })

  it('reuses the same SOCKS proxy agent across requests', async () => {
    destroyProxyAgents()
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'proxyEnabled') return true
      if (key === 'proxyHost') return '127.0.0.1'
      if (key === 'proxyPort') return 1080
      return undefined
    })
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }))

    const first = throttledFetch('reuse.test', 'https://reuse.test/1')
    await vi.advanceTimersByTimeAsync(10000)
    await first

    const second = throttledFetch('reuse.test', 'https://reuse.test/2')
    await vi.advanceTimersByTimeAsync(10000)
    await second

    const agent1 = fetchMock.mock.calls[0][1].agent
    const agent2 = fetchMock.mock.calls[1][1].agent
    expect(agent1).toBe(agent2)
  })

  it('destroys pooled proxy agents', async () => {
    destroyProxyAgents()
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'proxyEnabled') return true
      if (key === 'proxyHost') return '127.0.0.1'
      if (key === 'proxyPort') return 1080
      return undefined
    })
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }))

    const promise = throttledFetch('destroy.test', 'https://destroy.test/1')
    await vi.advanceTimersByTimeAsync(10000)
    await promise
    const agent = fetchMock.mock.calls[0][1].agent
    const destroySpy = vi.spyOn(agent, 'destroy')

    destroyProxyAgents()

    expect(destroySpy).toHaveBeenCalled()
  })
})

describe('getThrottleStatus', () => {
  it('reports empty domains when nothing has been requested', async () => {
    vi.resetModules()
    const { getThrottleStatus } = await import('../src/main/throttle')
    expect(getThrottleStatus()).toEqual({ domains: {} })
  })

  it('reports an idle domain after a completed request', async () => {
    vi.resetModules()
    const mod = await import('../src/main/throttle')
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }))
    const promise = mod.throttledFetch('status.test', 'https://status.test/1')
    await vi.advanceTimersByTimeAsync(10000)
    await promise

    expect(mod.getThrottleStatus().domains['status.test']).toMatchObject({
      pendingRequests: 0,
      active: false,
      backoffAttempt: null,
      nextBackoffDelay: null
    })
  })
})

describe('registerThrottleIpc', () => {
  it('registers a getThrottleStatus handler', async () => {
    vi.resetModules()
    const mod = await import('../src/main/throttle')
    mod.registerThrottleIpc()
    const call = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === 'getThrottleStatus')
    expect(call).toBeDefined()
    expect(call![1]()).toEqual({ domains: {} })
  })
})
