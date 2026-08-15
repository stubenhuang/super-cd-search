import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../src/main/lan/network', () => ({
  listLanCandidates: vi.fn(() => []),
  selectAutoLanAddress: vi.fn(() => null),
  isAllowedLanIPv4: vi.fn(() => true),
  normalizeLanPort: vi.fn((port: number) => port)
}))

import { applyLanServer, closeLanServer } from '../src/main/lan'
import { setSetting } from '../src/main/settings'

beforeEach(() => {
  setSetting('lanEnabled', true)
  setSetting('lanHost', '')
  setSetting('lanPort', 8787)
})

afterEach(async () => {
  setSetting('lanEnabled', false)
  await closeLanServer()
})

describe('LAN server manager without network candidates', () => {
  it('reports no_network and asks the user to choose an IP manually', async () => {
    const status = await applyLanServer()
    expect(status.state).toBe('no_network')
    expect(status.error).toContain('手动选择')
  })
})
