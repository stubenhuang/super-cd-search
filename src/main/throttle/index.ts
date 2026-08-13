import { ipcMain } from 'electron'
import { SocksProxyAgent } from 'socks-proxy-agent'
import { getSetting } from '../settings'
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

export interface ThrottleOptions {
  minDelay?: number
  maxDelay?: number
}

function getDomainState(domain: string): DomainState {
  let state = domainStates.get(domain)
  if (!state) {
    state = { lastRequestTime: 0, pending: [], active: false }
    domainStates.set(domain, state)
  }
  return state
}

function getRandomDelay(minDelay: number, maxDelay: number): number {
  return minDelay + Math.random() * (maxDelay - minDelay)
}

function processQueue(domain: string): void {
  const state = domainStates.get(domain)
  if (!state || state.active || state.pending.length === 0) return

  const next = state.pending[0]
  const now = Date.now()
  const elapsed = now - state.lastRequestTime
  const requiredDelay = getRandomDelay(next.minDelay, next.maxDelay)
  const remaining = Math.max(0, requiredDelay - elapsed)

  setTimeout(() => {
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

    const executeRequest = async () => {
      try {
        let response: Response

        const proxyEnabled = getSetting('proxyEnabled')
        const proxyHost = getSetting('proxyHost')
        const proxyPort = getSetting('proxyPort')

        if (proxyEnabled && proxyHost && proxyPort) {
          const agent = getProxyAgent(proxyHost, proxyPort)
          response = await fetch(url, { ...options, agent } as NodeFetchOptions)
        } else {
          response = await fetch(url, options)
        }

        if (response.status === 429) {
          const backoff = backoffStates.get(domain) || { attempt: 0, nextDelay: BACKOFF_DELAYS[0] }

          if (backoff.attempt >= MAX_RETRIES) {
            state.active = false
            backoffStates.delete(domain)
            reject(new Error(
              `Rate limited by ${domain} after ${MAX_RETRIES} retries. Manual intervention needed.`
            ))
            processQueue(domain)
            return
          }

          backoffStates.set(domain, backoff)

          setTimeout(async () => {
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
        resolve(response)
        processQueue(domain)
      } catch (err) {
        state.active = false
        state.lastRequestTime = Date.now()
        reject(err)
        processQueue(domain)
      }
    }

    state.pending.push({ run: executeRequest, minDelay, maxDelay })
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
