import { describe, it, expect, vi } from 'vitest'
import { waitForResultOrNoResult } from '../src/main/queries/wait'

function createFakePage(resultDelay = 0, noResultDelay = 0, rejectResult = false, rejectNoResult = false) {
  const waitForSelector = vi.fn(async (selector: string) => {
    if (selector.includes('no-result') || selector.includes('empty')) {
      if (rejectNoResult) throw new Error('no-result timeout')
      await new Promise(r => setTimeout(r, noResultDelay))
      return {}
    }
    if (rejectResult) throw new Error('result timeout')
    await new Promise(r => setTimeout(r, resultDelay))
    return {}
  })
  return { waitForSelector } as never
}

describe('waitForResultOrNoResult', () => {
  it('returns result when the result selector matches', async () => {
    const page = createFakePage(0, 1000)
    const outcome = await waitForResultOrNoResult(page, {
      resultSelector: '.result',
      noResultSelectors: ['.no-result']
    })
    expect(outcome).toBe('result')
  })

  it('returns no_result when the empty-state selector matches first', async () => {
    const page = createFakePage(1000, 0)
    const outcome = await waitForResultOrNoResult(page, {
      resultSelector: '.result',
      noResultSelectors: ['.empty']
    })
    expect(outcome).toBe('no_result')
  })

  it('returns timeout when neither selector matches', async () => {
    const page = createFakePage(0, 0, true, true)
    const outcome = await waitForResultOrNoResult(page, {
      resultSelector: '.result',
      noResultSelectors: ['.empty'],
      timeoutMs: 1000
    })
    expect(outcome).toBe('timeout')
  })

  it('falls back to a result-only wait when no no-result selectors are given', async () => {
    const page = createFakePage(0, 0, false, false)
    const outcome = await waitForResultOrNoResult(page, { resultSelector: '.result' })
    expect(outcome).toBe('result')
    expect(page.waitForSelector).toHaveBeenCalledTimes(1)
  })
})
