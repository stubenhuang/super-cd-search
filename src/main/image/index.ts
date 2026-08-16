import { app, nativeImage } from 'electron'
import { createHash } from 'crypto'
import { mkdir, readFile, readdir, writeFile, stat, unlink } from 'fs/promises'
import { join } from 'path'
import { SocksProxyAgent } from 'socks-proxy-agent'
import { request } from 'http'
import { request as httpsRequest } from 'https'
import { getSetting } from '../settings'
import { logger } from '../logger'
import { isPrivateNetworkUrl } from '../security/urls'

const DEFAULT_SIZE = 160
const JPEG_QUALITY = 80
const TIMEOUT_MS = 15000
const CACHE_LIMIT = 200
const DISK_TTL = 24 * 60 * 60 * 1000 // 1 day
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_REDIRECTS = 5
const MAX_NETWORK_CONCURRENCY = 6
const MAX_DISK_CACHE_BYTES = 250 * 1024 * 1024
const MAX_DISK_CACHE_FILES = 1000

export interface DownloadImageResult {
  base64: string
  mimeType: string
}

interface CacheEntry extends DownloadImageResult {
  fetchedAt: number
}

const lruCache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<DownloadImageResult | null>>()
const rawInflight = new Map<string, Promise<{ buffer: Buffer; mimeType: string } | null>>()
const networkWaiters: Array<() => void> = []
let activeNetworkRequests = 0
let diskPruneRunning = false
let diskWriteCount = 0

/**
 * Get referer header based on image URL domain
 */
function getReferer(url: string): string {
  const hostname = new URL(url).hostname

  if (hostname.includes('hmv.co.jp')) return 'https://www.hmv.co.jp/'
  if (hostname.includes('kojimarokuon.com')) return 'https://kojimarokuon.com/'
  if (hostname.includes('shopping.yahoo.co.jp')) return 'https://shopping.yahoo.co.jp/'
  if (hostname.includes('discogs.com')) return 'https://www.discogs.com/'
  if (hostname.includes('ebay')) return 'https://www.ebay.com/'
  if (hostname.includes('cdjapan.co.jp')) return 'https://www.cdjapan.co.jp/'
  if (hostname.includes('tower.jp')) return 'https://tower.jp/'

  return ''
}

function cacheKey(url: string, size: number): string {
  return `${size}:${url}`
}

function touchCache(key: string, entry: CacheEntry): void {
  lruCache.delete(key)
  lruCache.set(key, entry)
  if (lruCache.size > CACHE_LIMIT) {
    const oldest = lruCache.keys().next().value
    if (oldest !== undefined) lruCache.delete(oldest)
  }
}

/** Clear only the in-memory cache; on-disk files are kept. Used by tests. */
export function clearImageCache(): void {
  lruCache.clear()
}

function getImageCacheDir(): string {
  return join(app.getPath('userData'), 'image-cache')
}

function urlHash(url: string): string {
  return createHash('sha1').update(url).digest('hex')
}

function extForMimeType(mimeType: string): string {
  if (mimeType.includes('png')) return 'png'
  if (mimeType.includes('gif')) return 'gif'
  if (mimeType.includes('webp')) return 'webp'
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg'
  return 'bin'
}

function mimeTypeFromExt(ext: string): string {
  switch (ext) {
    case 'png': return 'image/png'
    case 'gif': return 'image/gif'
    case 'webp': return 'image/webp'
    case 'jpg': return 'image/jpeg'
    default: return 'application/octet-stream'
  }
}

/**
 * Read the original bytes of a previously downloaded image from disk, if the
 * file still exists and is within the 1-day TTL. Expired files are deleted.
 */
async function readDiskCache(url: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const base = join(getImageCacheDir(), urlHash(url))

  for (const ext of ['jpg', 'png', 'gif', 'webp', 'bin']) {
    const file = `${base}.${ext}`
    try {
      const fileStat = await stat(file)
      if (Date.now() - fileStat.mtimeMs > DISK_TTL) {
        try { await unlink(file) } catch { /* ignore */ }
        continue
      }
      return { buffer: await readFile(file), mimeType: mimeTypeFromExt(ext) }
    } catch {
      // Try the next extension / report a miss.
    }
  }

  return null
}

/** Persist the original downloaded bytes so later requests skip the network. */
async function writeDiskCache(url: string, buffer: Buffer, mimeType: string): Promise<void> {
  try {
    const dir = getImageCacheDir()
    await mkdir(dir, { recursive: true })
    const file = join(dir, `${urlHash(url)}.${extForMimeType(mimeType)}`)
    await writeFile(file, buffer)
    diskWriteCount++
    if (diskWriteCount === 1 || diskWriteCount % 25 === 0) void pruneDiskCache(dir)
  } catch (err) {
    logger.warn('image', 'failed to write image cache', { error: err instanceof Error ? err.message : String(err) })
  }
}

async function pruneDiskCache(dir: string): Promise<void> {
  if (diskPruneRunning) return
  diskPruneRunning = true
  try {
    const names = await readdir(dir)
    const files = (await Promise.all(names.map(async name => {
      const path = join(dir, name)
      try {
        const fileStat = await stat(path)
        return fileStat.isFile() ? { path, size: fileStat.size, mtimeMs: fileStat.mtimeMs } : null
      } catch {
        return null
      }
    }))).filter((file): file is { path: string; size: number; mtimeMs: number } => file !== null)

    files.sort((a, b) => a.mtimeMs - b.mtimeMs)
    let totalBytes = files.reduce((sum, file) => sum + file.size, 0)
    let remainingFiles = files.length
    for (const file of files) {
      const expired = Date.now() - file.mtimeMs > DISK_TTL
      if (!expired && totalBytes <= MAX_DISK_CACHE_BYTES && remainingFiles <= MAX_DISK_CACHE_FILES) break
      try {
        await unlink(file.path)
        totalBytes -= file.size
        remainingFiles--
      } catch {
        // Another request may already have removed it.
      }
    }
  } catch (err) {
    logger.warn('image', 'failed to prune image cache', { error: err instanceof Error ? err.message : String(err) })
  } finally {
    diskPruneRunning = false
  }
}

/**
 * Downscale the downloaded buffer to a small JPEG so the base64 payload sent
 * over IPC stays tiny. Falls back to the raw buffer when decoding fails.
 */
function processImage(buffer: Buffer, mimeType: string, size: number): DownloadImageResult {
  try {
    const image = nativeImage.createFromBuffer(buffer)
    if (!image.isEmpty()) {
      const resized = image.resize({ width: size })
      const jpeg = resized.toJPEG(JPEG_QUALITY)
      if (jpeg && jpeg.length > 0) {
        return { base64: jpeg.toString('base64'), mimeType: 'image/jpeg' }
      }
    }
  } catch (err) {
    logger.warn('image', 'failed to resize image, using raw buffer', { error: err instanceof Error ? err.message : String(err) })
  }

  return { base64: buffer.toString('base64'), mimeType }
}

async function withNetworkSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeNetworkRequests >= MAX_NETWORK_CONCURRENCY) {
    await new Promise<void>(resolve => networkWaiters.push(resolve))
  }
  activeNetworkRequests++
  try {
    return await task()
  } finally {
    activeNetworkRequests--
    networkWaiters.shift()?.()
  }
}

function fetchBuffer(url: string, redirectCount = 0, allowPrivateNetwork = true): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const proxyEnabled = getSetting('proxyEnabled')
  const proxyHost = getSetting('proxyHost')
  const proxyPort = getSetting('proxyPort')

  return new Promise((resolve) => {
    let settled = false
    const finish = (value: { buffer: Buffer; mimeType: string } | null) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(value)
    }

    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
    } catch {
      resolve(null)
      return
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      resolve(null)
      return
    }
    if (!allowPrivateNetwork && isPrivateNetworkUrl(url)) {
      resolve(null)
      return
    }
    const isHttps = parsedUrl.protocol === 'https:'
    const requestFn = isHttps ? httpsRequest : request
    const referer = getReferer(url)

    const options: any = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        ...(referer ? { Referer: referer } : {})
      }
    }

    if (proxyEnabled && proxyHost && proxyPort) {
      options.agent = new SocksProxyAgent(`socks5://${proxyHost}:${proxyPort}`)
    }

    const req = requestFn(options, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        if (redirectCount >= MAX_REDIRECTS) {
          finish(null)
          return
        }
        clearTimeout(timeout)
        let redirectUrl: string
        try {
          redirectUrl = new URL(res.headers.location, parsedUrl).toString()
        } catch {
          finish(null)
          return
        }
        fetchBuffer(redirectUrl, redirectCount + 1, allowPrivateNetwork).then(finish)
        return
      }

      if (res.statusCode !== 200) {
        res.resume()
        finish(null)
        return
      }

      const contentLength = Number(res.headers['content-length'] || 0)
      if (contentLength > MAX_IMAGE_BYTES) {
        res.destroy()
        finish(null)
        return
      }
      const declaredMimeType = res.headers['content-type'] as string | undefined
      if (declaredMimeType && !declaredMimeType.toLowerCase().startsWith('image/')) {
        res.resume()
        finish(null)
        return
      }

      const chunks: Buffer[] = []
      let bytes = 0
      res.on('data', (chunk: Buffer) => {
        bytes += chunk.length
        if (bytes > MAX_IMAGE_BYTES) {
          res.destroy()
          finish(null)
          return
        }
        chunks.push(chunk)
      })
      res.on('end', () => {
        if (bytes > MAX_IMAGE_BYTES) return
        const mimeType = declaredMimeType || 'image/jpeg'
        finish({ buffer: Buffer.concat(chunks), mimeType })
      })
    })

    const timeout = setTimeout(() => {
      req.destroy()
      finish(null)
    }, TIMEOUT_MS)

    req.on('error', (err) => {
      logger.warn('image', 'failed to download image', { url, error: err instanceof Error ? err.message : String(err) })
      finish(null)
    })

    req.end()
  })
}

/**
 * Return a resized thumbnail for an image URL as base64. Loads are unified
 * through this single entry point with this priority:
 *   1. in-memory LRU cache (keyed by url + size)
 *   2. in-flight dedupe for the same key
 *   3. on-disk cache (original bytes, shared across sizes, 1-day TTL)
 *   4. concurrency-limited network fetch, then persisted to disk
 */
export function downloadImage(url: string, size: number = DEFAULT_SIZE, allowPrivateNetwork = true): Promise<DownloadImageResult | null> {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return Promise.resolve(null)
    if (!allowPrivateNetwork && isPrivateNetworkUrl(url)) return Promise.resolve(null)
  } catch {
    return Promise.resolve(null)
  }
  size = Math.min(1000, Math.max(32, Math.round(size)))
  const key = cacheKey(url, size)
  logger.debug('image', 'downloadImage start', { url, size, key })

  const cached = lruCache.get(key)
  if (cached) {
    if (Date.now() - cached.fetchedAt < DISK_TTL) {
      logger.debug('image', 'memory cache hit', { url, size })
      touchCache(key, cached)
      return Promise.resolve({ base64: cached.base64, mimeType: cached.mimeType })
    }
    lruCache.delete(key)
  }

  const existing = inflight.get(key)
  if (existing) {
    logger.debug('image', 'joining in-flight request', { url, size })
    return existing
  }

  const promise = (async () => {
    const disk = await readDiskCache(url)
    if (disk) {
      logger.debug('image', 'disk cache hit', { url, size })
      return processImage(disk.buffer, disk.mimeType, size)
    }

    logger.debug('image', 'network fetch required', { url, size })
    const rawKey = `${allowPrivateNetwork ? 'internal' : 'restricted'}:${url}`
    let rawRequest = rawInflight.get(rawKey)
    if (!rawRequest) {
      rawRequest = withNetworkSlot(() => fetchBuffer(url, 0, allowPrivateNetwork))
      rawInflight.set(rawKey, rawRequest)
      void rawRequest.finally(() => rawInflight.delete(rawKey))
    }
    const fetched = await rawRequest
    if (!fetched) return null
    await writeDiskCache(url, fetched.buffer, fetched.mimeType)
    return processImage(fetched.buffer, fetched.mimeType, size)
  })()

  inflight.set(key, promise)
  promise.then((result) => {
    inflight.delete(key)
    if (result) {
      touchCache(key, { ...result, fetchedAt: Date.now() })
    }
  }).catch(() => {
    inflight.delete(key)
  })

  return promise
}
