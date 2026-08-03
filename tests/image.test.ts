import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import http from 'http'
import type { AddressInfo } from 'net'
import { nativeImage } from 'electron'

const { mockGetSetting } = vi.hoisted(() => ({
  mockGetSetting: vi.fn()
}))

vi.mock('../src/main/settings', () => ({
  getSetting: mockGetSetting
}))

import { downloadImage } from '../src/main/image'

let server: http.Server
let baseUrl: string
let handler: (req: http.IncomingMessage, res: http.ServerResponse) => void

beforeAll(async () => {
  server = http.createServer((req, res) => handler(req, res))
  await new Promise<void>(resolve => server.listen(0, resolve))
  const address = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
})

beforeEach(() => {
  mockGetSetting.mockReturnValue(undefined)
  handler = (_req, res) => {
    res.statusCode = 404
    res.end()
  }
})

describe('downloadImage', () => {
  it('downloads an image and returns base64 with mime type', async () => {
    handler = (_req, res) => {
      res.statusCode = 200
      res.setHeader('Content-Type', 'image/png')
      res.end(Buffer.from([1, 2, 3]))
    }

    const result = await downloadImage(`${baseUrl}/img.png`)
    expect(result).toEqual({ base64: 'AQID', mimeType: 'image/png' })
  })

  it('defaults the mime type to image/jpeg when absent', async () => {
    handler = (_req, res) => {
      res.statusCode = 200
      res.end(Buffer.from([1]))
    }
    const result = await downloadImage(`${baseUrl}/no-type`)
    expect(result?.mimeType).toBe('image/jpeg')
  })

  it('follows absolute redirects', async () => {
    handler = (req, res) => {
      if (req.url === '/first') {
        res.statusCode = 302
        res.setHeader('Location', `${baseUrl}/second`)
        res.end()
      } else {
        res.statusCode = 200
        res.setHeader('Content-Type', 'image/gif')
        res.end(Buffer.from([9, 9]))
      }
    }

    const result = await downloadImage(`${baseUrl}/first`)
    expect(result).toEqual({ base64: 'CQk=', mimeType: 'image/gif' })
  })

  it('resolves null on non-200 responses', async () => {
    expect(await downloadImage(`${baseUrl}/missing`)).toBeNull()
  })

  it('resolves null on request errors', async () => {
    const dead = http.createServer()
    await new Promise<void>(resolve => dead.listen(0, resolve))
    const port = (dead.address() as AddressInfo).port
    await new Promise<void>(resolve => dead.close(() => resolve()))

    expect(await downloadImage(`http://127.0.0.1:${port}/x`)).toBeNull()
  })

  it('resolves null when the server times out', async () => {
    vi.useFakeTimers()
    handler = () => {
      // Never respond
    }

    const promise = downloadImage(`${baseUrl}/hang`)
    await vi.advanceTimersByTimeAsync(15000)
    expect(await promise).toBeNull()
    vi.useRealTimers()
  })

  it('uses a SOCKS proxy agent when proxy settings are enabled', async () => {
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'proxyEnabled') return true
      if (key === 'proxyHost') return '127.0.0.1'
      if (key === 'proxyPort') return 1
      return undefined
    })

    // No SOCKS server is listening on port 1, so the request errors -> null
    expect(await downloadImage(`${baseUrl}/proxy`)).toBeNull()
  })

  it('caches successful downloads by URL and size', async () => {
    let hits = 0
    handler = (_req, res) => {
      hits++
      res.statusCode = 200
      res.setHeader('Content-Type', 'image/png')
      res.end(Buffer.from([1, 2, 3]))
    }

    const first = await downloadImage(`${baseUrl}/cached.png`)
    const second = await downloadImage(`${baseUrl}/cached.png`)

    expect(hits).toBe(1)
    expect(first).toEqual(second)
  })

  it('merges concurrent downloads for the same URL', async () => {
    let hits = 0
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    handler = (_req, res) => {
      hits++
      setTimeout(() => {
        res.statusCode = 200
        res.setHeader('Content-Type', 'image/png')
        res.end(Buffer.from([1]))
        release()
      }, 10)
    }

    const firstPromise = downloadImage(`${baseUrl}/merged.png`)
    await gate
    const secondPromise = downloadImage(`${baseUrl}/merged.png`)
    const [first, second] = await Promise.all([firstPromise, secondPromise])

    expect(hits).toBe(1)
    expect(first).toEqual(second)
  })

  it('resizes images to the requested size as JPEG', async () => {
    const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff])
    vi.mocked(nativeImage.createFromBuffer).mockImplementation(() => ({
      isEmpty: () => false,
      resize: vi.fn(() => ({ toJPEG: vi.fn(() => jpegBuffer) }))
    }))

    handler = (_req, res) => {
      res.statusCode = 200
      res.setHeader('Content-Type', 'image/png')
      res.end(Buffer.from([9, 9]))
    }

    const result = await downloadImage(`${baseUrl}/resize.png`, 240)

    expect(result).toEqual({ base64: jpegBuffer.toString('base64'), mimeType: 'image/jpeg' })
    const results = vi.mocked(nativeImage.createFromBuffer).mock.results
    const image = results[results.length - 1].value as {
      resize: ReturnType<typeof vi.fn>
    }
    expect(image.resize).toHaveBeenCalledWith({ width: 240 })
  })

  it('limits concurrent downloads to four', async () => {
    let active = 0
    let maxActive = 0
    const pending: Array<() => void> = []
    handler = (_req, res) => {
      active++
      maxActive = Math.max(maxActive, active)
      pending.push(() => {
        active--
        res.statusCode = 200
        res.end(Buffer.from([1]))
      })
    }

    const urls = Array.from({ length: 6 }, (_, i) => `${baseUrl}/concurrent-${i}`)
    const promises = urls.map(url => downloadImage(url))

    await vi.waitFor(() => expect(pending.length).toBe(4))
    expect(maxActive).toBe(4)

    // Completing one request frees a slot for the next queued download.
    pending.shift()!()
    await vi.waitFor(() => expect(pending.length).toBe(4))

    while (pending.length > 0) pending.shift()!()
    await Promise.all(promises)
    expect(maxActive).toBe(4)
  })
})
