import { ipcMain } from 'electron'
import { SocksProxyAgent } from 'socks-proxy-agent'
import { getSetting } from '../settings'

// Node.js native fetch supports agent option for custom connections
interface NodeFetchOptions extends RequestInit {
  agent?: SocksProxyAgent
}

interface DomainState {
  lastRequestTime: number
  pending: Array<() => void>
  active: boolean
}

interface BackoffState {
  attempt: number
  nextDelay: number
}

const domainStates = new Map<string, DomainState>()
const backoffStates = new Map<string, BackoffState>()

const MIN_DELAY = 2000
const MAX_DELAY = 6000
const BACKOFF_DELAYS = [2000, 4000, 8000]
const MAX_RETRIES = 3

function getDomainState(domain: string): DomainState {
  let state = domainStates.get(domain)
  if (!state) {
    state = { lastRequestTime: 0, pending: [], active: false }
    domainStates.set(domain, state)
  }
  return state
}

function getRandomDelay(): number {
  return MIN_DELAY + Math.random() * (MAX_DELAY - MIN_DELAY)
}

function processQueue(domain: string): void {
  const state = domainStates.get(domain)
  if (!state || state.active || state.pending.length === 0) return

  const now = Date.now()
  const elapsed = now - state.lastRequestTime
  const requiredDelay = getRandomDelay()
  const remaining = Math.max(0, requiredDelay - elapsed)

  setTimeout(() => {
    const next = state.pending.shift()
    if (next) {
      state.active = true
      state.lastRequestTime = Date.now()
      next()
    }
  }, remaining)
}

export async function throttledFetch(
  domain: string,
  url: string,
  options?: RequestInit
): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const state = getDomainState(domain)

    const executeRequest = async () => {
      try {
        let response: Response

        const proxyEnabled = getSetting('proxyEnabled')
        const proxyHost = getSetting('proxyHost')
        const proxyPort = getSetting('proxyPort')

        if (proxyEnabled && proxyHost && proxyPort) {
          const agent = new SocksProxyAgent(`socks5://${proxyHost}:${proxyPort}`)
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
            state.lastRequestTime = Date.now()

            try {
              const retryResponse = await throttledFetch(domain, url, options)
              backoffStates.delete(domain)
              resolve(retryResponse)
            } catch (err) {
              reject(err)
            }
          }, backoff.nextDelay)

          return
        }

        backoffStates.delete(domain)
        state.active = false
        resolve(response)
        processQueue(domain)
      } catch (err) {
        state.active = false
        reject(err)
        processQueue(domain)
      }
    }

    state.pending.push(executeRequest)
    processQueue(domain)
  })
}

export interface ThrottleStatus {
  domains: Record<string, {
    pendingRequests: number
    active: boolean
    backoffAttempt: number | null
    nextBackoffDelay: number | null
  }>
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
