import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createServer } from 'net'
import type { AddressInfo } from 'net'
import {
  applyLanServer,
  closeLanServer,
  getLanServerStatus,
  regenerateLanToken
} from '../src/main/lan'
import { deleteSetting, setSetting, setLanToken, getLanToken } from '../src/main/settings'

async function getFreePort(): Promise<number> {
  return new Promise(resolve => {
    const probe = createServer()
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address() as AddressInfo
      probe.close(() => resolve(address.port))
    })
  })
}

beforeEach(() => {
  setSetting('lanEnabled', false)
  setSetting('lanHost', '')
  deleteSetting('lanPort')
  setLanToken('')
})

afterEach(async () => {
  setSetting('lanEnabled', false)
  await closeLanServer()
})

describe('LAN server manager', () => {
  it('stays disabled when the feature is off', async () => {
    const status = await applyLanServer()
    expect(status).toMatchObject({ state: 'disabled', enabled: false })
    expect(getLanServerStatus().state).toBe('disabled')
  })

  it('rejects public IPs and invalid ports', async () => {
    setSetting('lanEnabled', true)
    setSetting('lanHost', '8.8.8.8')
    setSetting('lanPort', await getFreePort())

    let status = await applyLanServer()
    expect(status.state).toBe('error')
    expect(status.error).toContain('只允许绑定局域网 IPv4 地址')

    setSetting('lanHost', '127.0.0.1')
    setSetting('lanPort', 0)
    status = await applyLanServer()
    expect(status.state).toBe('error')
    expect(status.error).toContain('端口')
  })

  it('starts on a chosen LAN address and serves the tokenized URL', async () => {
    const port = await getFreePort()
    setSetting('lanEnabled', true)
    setSetting('lanHost', '127.0.0.1')
    setSetting('lanPort', port)

    const status = await applyLanServer()
    expect(status).toMatchObject({ state: 'running', host: '127.0.0.1', port })
    expect(status.url).toContain('token=')
    expect(getLanToken()).toHaveLength(32)

    const response = await fetch(status.url as string)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('已连接')
  })

  it('regenerating the token invalidates the previous QR URL', async () => {
    const port = await getFreePort()
    setSetting('lanEnabled', true)
    setSetting('lanHost', '127.0.0.1')
    setSetting('lanPort', port)

    const before = await applyLanServer()
    const oldUrl = before.url as string
    const oldToken = new URL(oldUrl).searchParams.get('token')

    const after = await regenerateLanToken()
    const newToken = new URL(after.url as string).searchParams.get('token')

    expect(after.state).toBe('running')
    expect(newToken).not.toBe(oldToken)

    const oldResponse = await fetch(oldUrl)
    expect(oldResponse.status).toBe(401)
    const newResponse = await fetch(after.url as string)
    expect(newResponse.status).toBe(200)
  })
})
