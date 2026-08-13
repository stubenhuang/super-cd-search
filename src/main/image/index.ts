import { app, nativeImage } from 'electron'
import { createHash } from 'crypto'
import { mkdirSync, readFileSync, writeFileSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import { SocksProxyAgent } from 'socks-proxy-agent'
import { request } from 'http'
import { request as httpsRequest } from 'https'
import { getSetting } from '../settings'

const DEFAULT_SIZE = 160
const JPEG_QUALITY = 80
const TIMEOUT_MS = 15000
const CACHE_LIMIT = 200
const DISK_TTL = 24 * 60 * 60 * 1000 // 1 day

export interface DownloadImageResult {
  base64: string
  mimeType: string
}

interface CacheEntry extends DownloadImageResult {
  fetchedAt: number
}

const lruCache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<DownloadImageResult | null>>()

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
function readDiskCache(url: string): { buffer: Buffer; mimeType: string } | null {
  const base = join(getImageCacheDir(), urlHash(url))

  for (const ext of ['jpg', 'png', 'gif', 'webp', 'bin']) {
    const file = `${base}.${ext}`
    try {
      const stat = statSync(file)
      if (Date.now() - stat.mtimeMs > DISK_TTL) {
        try { unlinkSync(file) } catch { /* ignore */ }
        continue
      }
      return { buffer: readFileSync(file), mimeType: mimeTypeFromExt(ext) }
    } catch {
      // Try the next extension / report a miss.
    }
  }

  return null
}

/** Persist the original downloaded bytes so later requests skip the network. */
function writeDiskCache(url: string, buffer: Buffer, mimeType: string): void {
  try {
    const dir = getImageCacheDir()
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${urlHash(url)}.${extForMimeType(mimeType)}`)
    writeFileSync(file, buffer)
  } catch (err) {
    console.warn('Failed to write image cache:', err)
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
    console.warn('Failed to resize image, using raw buffer:', err)
  }

  return { base64: buffer.toString('base64'), mimeType }
}

function fetchBuffer(url: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const proxyEnabled = getSetting('proxyEnabled')
  const proxyHost = getSetting('proxyHost')
  const proxyPort = getSetting('proxyPort')

  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), TIMEOUT_MS)

    const parsedUrl = new URL(url)
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
        clearTimeout(timeout)
        fetchBuffer(res.headers.location).then(resolve)
        return
      }

      if (res.statusCode !== 200) {
        clearTimeout(timeout)
        resolve(null)
        return
      }

      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        clearTimeout(timeout)
        const mimeType = (res.headers['content-type'] as string) || 'image/jpeg'
        resolve({ buffer: Buffer.concat(chunks), mimeType })
      })
    })

    req.on('error', (err) => {
      clearTimeout(timeout)
      console.warn('Failed to download image:', url, err)
      resolve(null)
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
 *   4. network fetch (unlimited concurrency), then persisted to disk
 */
export function downloadImage(url: string, size: number = DEFAULT_SIZE): Promise<DownloadImageResult | null> {
  const key = cacheKey(url, size)

  const cached = lruCache.get(key)
  if (cached) {
    if (Date.now() - cached.fetchedAt < DISK_TTL) {
      touchCache(key, cached)
      return Promise.resolve({ base64: cached.base64, mimeType: cached.mimeType })
    }
    lruCache.delete(key)
  }

  const existing = inflight.get(key)
  if (existing) return existing

  const promise = (async () => {
    const disk = readDiskCache(url)
    if (disk) {
      return processImage(disk.buffer, disk.mimeType, size)
    }

    const fetched = await fetchBuffer(url)
    if (!fetched) return null
    writeDiskCache(url, fetched.buffer, fetched.mimeType)
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
