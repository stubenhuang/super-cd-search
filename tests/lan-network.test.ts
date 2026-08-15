import { describe, it, expect } from 'vitest'
import type { NetworkInterfaceInfo } from 'os'
import {
  isPrivateIPv4,
  isLoopbackIPv4,
  isAllowedLanIPv4,
  isVirtualInterfaceName,
  listLanCandidates,
  selectAutoLanAddress,
  normalizeLanPort
} from '../src/main/lan/network'

function ipv4(address: string, internal = false): NetworkInterfaceInfo {
  return { address, netmask: '255.255.255.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal, cidr: null }
}

function ipv6(address: string): NetworkInterfaceInfo {
  return { address, netmask: '', family: 'IPv6', mac: '00:00:00:00:00:00', internal: false, cidr: null, scopeid: 0 }
}

describe('isPrivateIPv4', () => {
  it('accepts RFC1918 private ranges', () => {
    expect(isPrivateIPv4('10.0.0.1')).toBe(true)
    expect(isPrivateIPv4('10.255.255.255')).toBe(true)
    expect(isPrivateIPv4('172.16.0.1')).toBe(true)
    expect(isPrivateIPv4('172.31.255.254')).toBe(true)
    expect(isPrivateIPv4('192.168.1.5')).toBe(true)
  })

  it('rejects public, link-local and malformed addresses', () => {
    expect(isPrivateIPv4('172.15.0.1')).toBe(false)
    expect(isPrivateIPv4('172.32.0.1')).toBe(false)
    expect(isPrivateIPv4('11.0.0.1')).toBe(false)
    expect(isPrivateIPv4('100.64.0.1')).toBe(false)
    expect(isPrivateIPv4('169.254.1.1')).toBe(false)
    expect(isPrivateIPv4('192.168.1.256')).toBe(false)
    expect(isPrivateIPv4('192.168.1')).toBe(false)
    expect(isPrivateIPv4('192.168.1.1.1')).toBe(false)
  })
})

describe('isLoopbackIPv4 / isAllowedLanIPv4', () => {
  it('identifies loopback addresses', () => {
    expect(isLoopbackIPv4('127.0.0.1')).toBe(true)
    expect(isLoopbackIPv4('127.8.9.10')).toBe(true)
    expect(isLoopbackIPv4('192.168.1.1')).toBe(false)
  })

  it('only allows private LAN or loopback binding', () => {
    expect(isAllowedLanIPv4('192.168.1.10')).toBe(true)
    expect(isAllowedLanIPv4('127.0.0.1')).toBe(true)
    expect(isAllowedLanIPv4('8.8.8.8')).toBe(false)
    expect(isAllowedLanIPv4('0.0.0.0')).toBe(false)
    expect(isAllowedLanIPv4('169.254.0.1')).toBe(false)
    expect(isAllowedLanIPv4('not-an-ip')).toBe(false)
  })
})

describe('listLanCandidates', () => {
  it('collects, deduplicates and ranks private IPv4 interfaces', () => {
    const candidates = listLanCandidates({
      lo0: [ipv4('127.0.0.1', true)],
      awdl0: [ipv6('fe80::1')],
      utun3: [ipv4('10.1.2.3')],
      docker0: [ipv4('172.17.0.1')],
      en0: [ipv4('192.168.1.5'), ipv6('fe80::2')],
      en1: [ipv4('192.168.1.5')]
    })

    expect(candidates.map(c => c.address)).toEqual(['192.168.1.5', '10.1.2.3', '172.17.0.1'])
    expect(candidates[0].interfaceName).toBe('en0')
  })

  it('auto-select skips VM/VPN adapters and picks the primary LAN interface', () => {
    const candidates = listLanCandidates({
      docker0: [ipv4('172.17.0.1')],
      vEthernet: [ipv4('172.25.0.2')],
      'Wi-Fi': [ipv4('192.168.1.20')]
    })
    expect(selectAutoLanAddress(candidates)).toBe('192.168.1.20')
    expect(selectAutoLanAddress([{ address: '172.17.0.1', interfaceName: 'docker0' }])).toBeNull()
  })
})

describe('virtual interface names', () => {
  it('flags adapter names used by VMs, containers and VPNs', () => {
    for (const name of ['docker0', 'vEthernet (Default Switch)', 'VMware Network Adapter', 'utun3', 'tailscale0']) {
      expect(isVirtualInterfaceName(name)).toBe(true)
    }
    for (const name of ['en0', 'eth0', 'Wi-Fi', '以太网', '无线局域网连接 1']) {
      expect(isVirtualInterfaceName(name)).toBe(false)
    }
  })
})

describe('normalizeLanPort', () => {
  it('accepts valid TCP ports and rejects the rest', () => {
    expect(normalizeLanPort(1)).toBe(1)
    expect(normalizeLanPort(8787)).toBe(8787)
    expect(normalizeLanPort(65535)).toBe(65535)
    expect(normalizeLanPort(0)).toBeNull()
    expect(normalizeLanPort(65536)).toBeNull()
    expect(normalizeLanPort(80.5)).toBeNull()
    expect(normalizeLanPort(NaN)).toBeNull()
  })
})
