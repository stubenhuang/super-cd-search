import { ipcMain } from 'electron'
import { SocksProxyAgent } from 'socks-proxy-agent'
import { getSetting } from '../settings'
import { logger } from '../logger'
import type { ThrottleStatus } from '../../shared/types'

// Node.js native fetch supports agent option for custom connections
interface NodeFetchOptions extends RequestInit {
  agent?: SocksProxyAgent
}

interface DomainState {
  lastRequestTime: number
  pending: Array<{
    run: () => void
    minDelay: number
    maxDelay: number
  }>
  active: boolean
  timer: ReturnType<typeof setTimeout> | null
}

interface BackoffState {
  attempt: number
  nextDelay: number
}

const domainStates = new Map<string, DomainState>()
const backoffStates = new Map<string, BackoffState>()

// Shared SOCKS proxy agents (one per proxy endpoint). Reusing the agent lets
// undici keep the underlying TCP/TLS connections alive across requests instead
// of opening a fresh connection for every fetch.
const proxyAgents = new Map<string, SocksProxyAgent>()

function getProxyAgent(host: string, port: number): SocksProxyAgent {
  const key = `${host}:${port}`
  let agent = proxyAgents.get(key)
  if (!agent) {
    agent = new SocksProxyAgent(`socks5://${host}:${port}`, { keepAlive: true })
    proxyAgents.set(key, agent)
  }
  return agent
}

/** Close all pooled proxy connections; call once on app shutdown. */
export function destroyProxyAgents(): void {
  for (const agent of proxyAgents.values()) {
    agent.destroy()
  }
  proxyAgents.clear()
}

const MIN_DELAY = 2000
const MAX_DELAY = 6000
const BACKOFF_DELAYS = [2000, 4000, 8000]
const MAX_RETRIES = 3
const DEFAULT_FETCH_TIMEOUT_MS = 30_000

export interface ThrottleOptions {
  minDelay?: number
  maxDelay?: number
  /** Abort the request if it does not settle within this many milliseconds. */
  timeoutMs?: number
}

function getDomainState(domain: string): DomainState {
  let state = domainStates.get(domain)
  if (!state) {
    state = { lastRequestTime: 0, pending: [], active: false, timer: null }
    domainStates.set(domain, state)
  }
  return state
}

function getRandomDelay(minDelay: number, maxDelay: number): number {
  return minDelay + Math.random() * (maxDelay - minDelay)
}

function processQueue(domain: string): void {
  const state = domainStates.get(domain)
  if (!state || state.active || state.timer || state.pending.length === 0) return

  const next = state.pending[0]
  const now = Date.now()
  const elapsed = now - state.lastRequestTime
  const requiredDelay = getRandomDelay(next.minDelay, next.maxDelay)
  const remaining = Math.max(0, requiredDelay - elapsed)

  state.timer = setTimeout(() => {
    state.timer = null
    // A request may have become active through another completion path while
    // this timer was pending. Never release two requests for the same domain.
    if (state.active) {
      processQueue(domain)
      return
    }
    const entry = state.pending.shift()
    if (entry) {
      state.active = true
      entry.run()
    }
  }, remaining)
}

export async function throttledFetch(
  domain: string,
  url: string,
  options?: RequestInit,
  throttle?: ThrottleOptions
): Promise<Response> {
  const minDelay = throttle?.minDelay ?? MIN_DELAY
  const maxDelay = throttle?.maxDelay ?? MAX_DELAY

  return new Promise<Response>((resolve, reject) => {
    const state = getDomainState(domain)
    const externalSignal = options?.signal
    if (externalSignal?.aborted) {
      const error = new Error('Aborted')
      error.name = 'AbortError'
      reject(error)
      return
    }
    logger.debug('throttle', 'request queued', { domain, url, pending: state.pending.length + 1, active: state.active })

    const executeRequest = async () => {
      const timeoutMs = throttle?.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS
      logger.debug('throttle', 'request executing', { domain, url })
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      const abortFromCaller = () => controller.abort()
      externalSignal?.addEventListener('abort', abortFromCaller, { once: true })

      try {
        let response: Response

        const proxyEnabled = getSetting('proxyEnabled')
        const proxyHost = getSetting('proxyHost')
        const proxyPort = getSetting('proxyPort')

        const requestOptions: NodeFetchOptions = { ...options, signal: controller.signal }
        if (proxyEnabled && proxyHost && proxyPort) {
          requestOptions.agent = getProxyAgent(proxyHost, proxyPort)
        }
        response = await fetch(url, requestOptions)
        clearTimeout(timeout)
        externalSignal?.removeEventListener('abort', abortFromCaller)

        if (response.status === 429) {
          const backoff = backoffStates.get(domain) || { attempt: 0, nextDelay: BACKOFF_DELAYS[0] }
          logger.warn('throttle', 'rate limited, applying backoff', { domain, url, attempt: backoff.attempt, nextDelay: backoff.nextDelay })

          if (backoff.attempt >= MAX_RETRIES) {
            logger.warn('throttle', 'rate limit retries exhausted', { domain, url, maxRetries: MAX_RETRIES })
            state.active = false
            backoffStates.delete(domain)
            reject(new Error(
              `Rate limited by ${domain} after ${MAX_RETRIES} retries. Manual intervention needed.`
            ))
            processQueue(domain)
            return
          }

          backoffStates.set(domain, backoff)

          let retryTimer: ReturnType<typeof setTimeout>
          const abortBackoff = () => {
            clearTimeout(retryTimer)
            backoffStates.delete(domain)
            state.active = false
            const error = new Error('Aborted')
            error.name = 'AbortError'
            reject(error)
            processQueue(domain)
          }
          externalSignal?.addEventListener('abort', abortBackoff, { once: true })
          retryTimer = setTimeout(async () => {
            externalSignal?.removeEventListener('abort', abortBackoff)
            backoff.attempt++
            backoff.nextDelay = BACKOFF_DELAYS[Math.min(backoff.attempt, BACKOFF_DELAYS.length - 1)]
            state.active = false

            try {
              const retryResponse = await throttledFetch(domain, url, options, throttle)
              backoffStates.delete(domain)
              resolve(retryResponse)
            } catch (err) {
              backoffStates.delete(domain)
              reject(err)
            }
          }, backoff.nextDelay)

          return
        }

        backoffStates.delete(domain)
        state.active = false
        state.lastRequestTime = Date.now()
        logger.debug('throttle', 'request complete', { domain, url, status: response.status })
        resolve(response)
        processQueue(domain)
      } catch (err) {
        clearTimeout(timeout)
        externalSignal?.removeEventListener('abort', abortFromCaller)
        state.active = false
        state.lastRequestTime = Date.now()
        logger.warn('throttle', 'request failed', { domain, url, error: err instanceof Error ? err.message : String(err) })
        reject(err)
        processQueue(domain)
      }
    }

    const queued: DomainState['pending'][number] = { run: executeRequest, minDelay, maxDelay }
    const abortWhileQueued = () => {
      const index = state.pending.indexOf(queued)
      if (index >= 0) {
        state.pending.splice(index, 1)
        const error = new Error('Aborted')
        error.name = 'AbortError'
        reject(error)
        processQueue(domain)
      }
    }
    externalSignal?.addEventListener('abort', abortWhileQueued, { once: true })
    const run = queued.run
    queued.run = () => {
      externalSignal?.removeEventListener('abort', abortWhileQueued)
      run()
    }
    state.pending.push(queued)
    processQueue(domain)
  })
}

export function getThrottleStatus(): ThrottleStatus {
  const domains: ThrottleStatus['domains'] = {}

  for (const [domain, state] of domainStates) {
    const backoff = backoffStates.get(domain)
    domains[domain] = {
      pendingRequests: state.pending.length,
      active: state.active,
      backoffAttempt: backoff?.attempt ?? null,
      nextBackoffDelay: backoff?.nextDelay ?? null
    }
  }

  return { domains }
}

export function registerThrottleIpc(): void {
  ipcMain.handle('getThrottleStatus', () => {
    return getThrottleStatus()
  })
}
