import { SocksProxyAgent } from 'socks-proxy-agent'
import { request } from 'http'
import { request as httpsRequest } from 'https'
import { getSetting } from '../settings'

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

  return ''
}

/**
 * Download image from URL with proxy and referer support
 */
export function downloadImage(url: string): Promise<{ base64: string; mimeType: string } | null> {
  const proxyEnabled = getSetting('proxyEnabled')
  const proxyHost = getSetting('proxyHost')
  const proxyPort = getSetting('proxyPort')

  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 15000)

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
        downloadImage(res.headers.location).then(resolve)
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
        const buffer = Buffer.concat(chunks)
        const base64 = buffer.toString('base64')
        const mimeType = (res.headers['content-type'] as string) || 'image/jpeg'

        resolve({ base64, mimeType })
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
