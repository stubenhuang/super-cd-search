import { networkInterfaces } from 'os'
import type { NetworkInterfaceInfo } from 'os'
import type { LanCandidate } from '../../shared/types'

const PRIVATE_IPV4_PATTERN =
  /^(10(?:\.\d{1,3}){3}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|192\.168(?:\.\d{1,3}){2})$/

const LOOPBACK_IPV4_PATTERN = /^127(?:\.\d{1,3}){3}$/

/**
 * Interface names that usually belong to VMs, containers, VPNs or point-to-
 * point links. They are still listed as manual choices, but never chosen by
 * the auto-detection, because they are rarely the Wi-Fi/LAN address a phone
 * can reach.
 */
const VIRTUAL_INTERFACE_PATTERN =
  /^(veth|docker|br-|virbr|vmnet|vbox|vmware|ve?thernet|wsl|tailscale|zerotier|utun|awdl|llw|bridge|tun|tap|ppp|lo|gif|stf)(\d|[-_.])?/i

const PRIMARY_INTERFACE_PATTERN =
  /^(en0|en1|eth\d*|wlan\d*|wi-fi|wifi|lan|本地连接|以太网|无线网络|无线局域网连接)/i

function parseIPv4(address: string): number[] | null {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  const nums = parts.map(part => {
    if (!/^\d{1,3}$/.test(part)) return -1
    return Number(part)
  })
  if (nums.some(num => num < 0 || num > 255)) return null
  return nums
}

/** True for RFC1918 private IPv4 addresses (10/8, 172.16/12, 192.168/16). */
export function isPrivateIPv4(address: string): boolean {
  return PRIVATE_IPV4_PATTERN.test(address) && parseIPv4(address) !== null
}

/** True for 127.0.0.0/8. */
export function isLoopbackIPv4(address: string): boolean {
  return LOOPBACK_IPV4_PATTERN.test(address) && parseIPv4(address) !== null
}

/**
 * Addresses the LAN server is allowed to bind to: private LAN addresses plus
 * loopback (useful for local development). Public/routable addresses are
 * rejected so the feature can never be exposed to the internet by misbinding.
 */
export function isAllowedLanIPv4(address: string): boolean {
  if (isLoopbackIPv4(address)) return true
  if (!isPrivateIPv4(address)) return false

  const octets = parseIPv4(address)
  if (!octets) return false

  // 169.254.x.x is a link-local address without a usable route for phones,
  // and APIPA also signals that DHCP failed. Keep the list strictly private.
  return true
}

/** True when an interface name looks like a VM/VPN/container adapter. */
export function isVirtualInterfaceName(name: string): boolean {
  return VIRTUAL_INTERFACE_PATTERN.test(name)
}

function interfaceRank(name: string, index: number): number {
  if (isVirtualInterfaceName(name)) return 1000 + index
  if (PRIMARY_INTERFACE_PATTERN.test(name)) return index
  return 500 + index
}

/**
 * Enumerate private IPv4 addresses usable for the LAN server, sorted from
 * most to least likely to be the phone-reachable address.
 */
export function listLanCandidates(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()
): LanCandidate[] {
  const candidates = new Map<string, LanCandidate>()

  for (const [name, entries] of Object.entries(interfaces)) {
    if (!entries) continue
    for (const entry of entries) {
      if (entry.family !== 'IPv4' || entry.internal) continue
      if (!isPrivateIPv4(entry.address)) continue
      if (!candidates.has(entry.address)) {
        candidates.set(entry.address, { address: entry.address, interfaceName: name })
      }
    }
  }

  const list = [...candidates.values()]
  const order = new Map<string, number>()
  list.forEach((candidate, index) => order.set(candidate.address, index))

  return list.sort((a, b) => {
    const scoreA = interfaceRank(a.interfaceName, order.get(a.address) ?? 0)
    const scoreB = interfaceRank(b.interfaceName, order.get(b.address) ?? 0)
    return scoreA - scoreB || a.address.localeCompare(b.address)
  })
}

/** Pick the best auto-detectable address, skipping VM/VPN adapters. */
export function selectAutoLanAddress(candidates: LanCandidate[]): string | null {
  const usable = candidates.filter(candidate => !isVirtualInterfaceName(candidate.interfaceName))
  return usable[0]?.address ?? null
}

export function normalizeLanPort(port: number): number | null {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  return port
}
