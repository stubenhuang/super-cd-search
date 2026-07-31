import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockLaunch, mockStealthUse } = vi.hoisted(() => ({
  mockLaunch: vi.fn(),
  mockStealthUse: vi.fn()
}))

const { mockGetSetting } = vi.hoisted(() => ({
  mockGetSetting: vi.fn()
}))

vi.mock('puppeteer-extra', () => ({
  default: {
    use: mockStealthUse,
    launch: mockLaunch
  }
}))

vi.mock('puppeteer-extra-plugin-stealth', () => ({
  default: () => ({ name: 'stealth-mock' })
}))

vi.mock('puppeteer', () => ({
  executablePath: () => '/fake/chrome'
}))

vi.mock('../src/main/settings', () => ({
  getSetting: mockGetSetting
}))

import { browserPool } from '../src/main/browser/pool'

function createFakePage() {
  return {
    setUserAgent: vi.fn().mockResolvedValue(undefined),
    setViewport: vi.fn().mockResolvedValue(undefined),
    evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined)
  }
}

function createFakeBrowser(page: ReturnType<typeof createFakePage> = createFakePage()) {
  return {
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSetting.mockReturnValue(undefined)
})

afterEach(async () => {
  await browserPool.closeAll()
})

describe('browserPool', () => {
  it('launches browsers through puppeteer-extra and applies a fingerprint', async () => {
    const page = createFakePage()
    const browser = createFakeBrowser(page)
    mockLaunch.mockResolvedValue(browser)

    const acquired = await browserPool.acquire()

    expect(mockLaunch).toHaveBeenCalledWith({
      headless: true,
      executablePath: '/fake/chrome',
      args: expect.arrayContaining(['--no-sandbox', '--disable-gpu'])
    })
    expect(acquired.browser).toBe(browser)
    expect(page.setUserAgent).toHaveBeenCalledWith(expect.any(String))
    expect(page.setViewport).toHaveBeenCalledWith(expect.any(Object))
    expect(page.evaluateOnNewDocument).toHaveBeenCalledTimes(1)
  })

  it('passes proxy server args when proxy settings are enabled', async () => {
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'proxyEnabled') return true
      if (key === 'proxyHost') return '127.0.0.1'
      if (key === 'proxyPort') return 1080
      return undefined
    })
    const page = createFakePage()
    mockLaunch.mockResolvedValue(createFakeBrowser(page))

    await browserPool.acquire()

    expect(mockLaunch.mock.calls[0][0].args).toContain('--proxy-server=socks5://127.0.0.1:1080')
  })

  it('reuses idle instances and queues waiters when the pool is full', async () => {
    const pageA = createFakePage()
    const browserA = createFakeBrowser(pageA)
    const pageB = createFakePage()
    const browserB = createFakeBrowser(pageB)
    mockLaunch.mockResolvedValueOnce(browserA).mockResolvedValueOnce(browserB)

    const first = await browserPool.acquire()
    const second = await browserPool.acquire()
    expect(mockLaunch).toHaveBeenCalledTimes(2)

    const thirdPromise = browserPool.acquire()
    await vi.waitFor(() => expect(browserA.newPage).toHaveBeenCalledTimes(1))

    await browserPool.release(first.browser, first.page)
    const third = await thirdPromise

    // The waiter is served by the released browser with a fresh page
    expect(third.browser).toBe(browserA)
    expect(browserA.newPage).toHaveBeenCalledTimes(2)
    expect(pageA.close).toHaveBeenCalled()
  })

  it('release closes the page and ignores unknown browsers', async () => {
    const page = createFakePage()
    const browser = createFakeBrowser(page)
    mockLaunch.mockResolvedValue(browser)

    const acquired = await browserPool.acquire()
    await browserPool.release(acquired.browser, acquired.page)
    expect(page.close).toHaveBeenCalled()

    await browserPool.release({} as never, createFakePage() as never)
    expect(mockLaunch).toHaveBeenCalledTimes(1)
  })

  it('closeAll closes every browser and rejects queued waiters', async () => {
    const browserA = createFakeBrowser()
    const browserB = createFakeBrowser()
    mockLaunch.mockResolvedValueOnce(browserA).mockResolvedValueOnce(browserB)

    await browserPool.acquire()
    await browserPool.acquire()
    const waiter = browserPool.acquire()
    const rejection = expect(waiter).rejects.toThrow('Browser pool closed')

    await browserPool.closeAll()

    expect(browserA.close).toHaveBeenCalled()
    expect(browserB.close).toHaveBeenCalled()
    await rejection
  })
})
