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

vi.mock('../src/main/browser/chrome-path', () => ({
  findChromeExecutable: () => '/fake/chrome'
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
    setRequestInterception: vi.fn().mockResolvedValue(undefined),
    setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
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
    const pageC = createFakePage()
    const browserC = createFakeBrowser(pageC)
    mockLaunch
      .mockResolvedValueOnce(browserA)
      .mockResolvedValueOnce(browserB)
      .mockResolvedValueOnce(browserC)

    const first = await browserPool.acquire()
    const second = await browserPool.acquire()
    const third = await browserPool.acquire()
    expect(mockLaunch).toHaveBeenCalledTimes(3)

    const fourthPromise = browserPool.acquire()
    await vi.waitFor(() => expect(browserA.newPage).toHaveBeenCalledTimes(1))

    await browserPool.release(first.browser, first.page)
    const fourth = await fourthPromise

    // The waiter is served by the released browser with the same reused page.
    expect(fourth.browser).toBe(browserA)
    expect(fourth.page).toBe(pageA)
    expect(browserA.newPage).toHaveBeenCalledTimes(1)
    expect(pageA.close).not.toHaveBeenCalled()
    expect(third.browser).toBe(browserC)
  })

  it('never exceeds the browser limit when acquires start concurrently', async () => {
    const launchResolvers: Array<(browser: ReturnType<typeof createFakeBrowser>) => void> = []
    mockLaunch.mockImplementation(() => new Promise(resolve => launchResolvers.push(resolve)))

    const acquires = Array.from({ length: 6 }, () => browserPool.acquire())
    await vi.waitFor(() => expect(mockLaunch).toHaveBeenCalledTimes(3))

    const firstBrowsers = Array.from({ length: 3 }, () => createFakeBrowser())
    launchResolvers.forEach((resolve, index) => resolve(firstBrowsers[index]))
    const firstThree = await Promise.all(acquires.slice(0, 3))

    expect(mockLaunch).toHaveBeenCalledTimes(3)
    await Promise.all(firstThree.map(item => browserPool.release(item.browser, item.page)))
    const remaining = await Promise.all(acquires.slice(3))

    expect(mockLaunch).toHaveBeenCalledTimes(3)
    expect(remaining.map(item => item.browser)).toEqual(expect.arrayContaining(firstBrowsers))
  })

  it('release resets the page state and ignores unknown browsers', async () => {
    const page = createFakePage()
    const browser = createFakeBrowser(page)
    mockLaunch.mockResolvedValue(browser)

    const acquired = await browserPool.acquire()
    await browserPool.release(acquired.browser, acquired.page)
    expect(page.close).not.toHaveBeenCalled()
    expect(page.setExtraHTTPHeaders).toHaveBeenCalledWith({})

    await browserPool.release({} as never, createFakePage() as never)
    expect(mockLaunch).toHaveBeenCalledTimes(1)
  })

  it('reuses the same page across a sequential acquire/release cycle', async () => {
    const page = createFakePage()
    const browser = createFakeBrowser(page)
    mockLaunch.mockResolvedValue(browser)

    const first = await browserPool.acquire()
    await browserPool.release(first.browser, first.page)

    const second = await browserPool.acquire()
    expect(second.browser).toBe(browser)
    expect(second.page).toBe(page)
    expect(browser.newPage).toHaveBeenCalledTimes(1)
    expect(page.close).not.toHaveBeenCalled()
  })

  it('closeAll closes every browser and rejects queued waiters', async () => {
    const browserA = createFakeBrowser()
    const browserB = createFakeBrowser()
    const browserC = createFakeBrowser()
    mockLaunch
      .mockResolvedValueOnce(browserA)
      .mockResolvedValueOnce(browserB)
      .mockResolvedValueOnce(browserC)

    await browserPool.acquire()
    await browserPool.acquire()
    await browserPool.acquire()
    const waiter = browserPool.acquire()
    const rejection = expect(waiter).rejects.toThrow('Browser pool closed')

    await browserPool.closeAll()

    expect(browserA.close).toHaveBeenCalled()
    expect(browserB.close).toHaveBeenCalled()
    expect(browserC.close).toHaveBeenCalled()
    await rejection
  })

  it('does not retain a browser whose launch finishes after closeAll', async () => {
    let finishLaunch!: (browser: ReturnType<typeof createFakeBrowser>) => void
    mockLaunch.mockImplementation(() => new Promise(resolve => { finishLaunch = resolve }))
    const browser = createFakeBrowser()
    const acquiring = browserPool.acquire()
    const assertion = expect(acquiring).rejects.toThrow('Browser pool closed')
    await vi.waitFor(() => expect(mockLaunch).toHaveBeenCalledTimes(1))

    await browserPool.closeAll()
    finishLaunch(browser)

    await assertion
    expect(browser.close).toHaveBeenCalled()
  })

  it('removes a queued acquire when its caller aborts', async () => {
    mockLaunch
      .mockResolvedValueOnce(createFakeBrowser())
      .mockResolvedValueOnce(createFakeBrowser())
      .mockResolvedValueOnce(createFakeBrowser())
    const acquired = await Promise.all([
      browserPool.acquire(),
      browserPool.acquire(),
      browserPool.acquire()
    ])
    const controller = new AbortController()
    const queued = browserPool.acquire(controller.signal)
    const assertion = expect(queued).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await assertion

    await browserPool.release(acquired[0].browser, acquired[0].page)
    const next = await browserPool.acquire()
    expect(next.browser).toBe(acquired[0].browser)
  })

  it('serves images a 1x1 GIF and blocks media/font requests on new pages', async () => {
    const page = createFakePage()
    const browser = createFakeBrowser(page)
    mockLaunch.mockResolvedValue(browser)

    await browserPool.acquire()

    expect(page.setRequestInterception).toHaveBeenCalledWith(true)
    const handler = page.on.mock.calls.find(([event]) => event === 'request')?.[1] as
      | ((request: {
          resourceType: () => string
          abort: ReturnType<typeof vi.fn>
          continue: ReturnType<typeof vi.fn>
          respond: ReturnType<typeof vi.fn>
        }) => void)
      | undefined
    expect(handler).toBeDefined()

    // Images are answered with a valid 1x1 GIF (not aborted) so that the
    // <img> element's onerror never fires and rewrites the src attribute.
    const image = {
      resourceType: () => 'image',
      abort: vi.fn(() => Promise.resolve()),
      continue: vi.fn(() => Promise.resolve()),
      respond: vi.fn(() => Promise.resolve())
    }
    handler!(image)
    expect(image.respond).toHaveBeenCalledWith(expect.objectContaining({ status: 200, contentType: 'image/gif' }))
    expect(image.abort).not.toHaveBeenCalled()
    expect(image.continue).not.toHaveBeenCalled()

    for (const type of ['media', 'font']) {
      const request = {
        resourceType: () => type,
        abort: vi.fn(() => Promise.resolve()),
        continue: vi.fn(() => Promise.resolve()),
        respond: vi.fn(() => Promise.resolve())
      }
      handler!(request)
      expect(request.abort).toHaveBeenCalled()
      expect(request.continue).not.toHaveBeenCalled()
      expect(request.respond).not.toHaveBeenCalled()
    }

    const allowed = {
      resourceType: () => 'script',
      abort: vi.fn(() => Promise.resolve()),
      continue: vi.fn(() => Promise.resolve()),
      respond: vi.fn(() => Promise.resolve())
    }
    handler!(allowed)
    expect(allowed.continue).toHaveBeenCalled()
    expect(allowed.abort).not.toHaveBeenCalled()
    expect(allowed.respond).not.toHaveBeenCalled()
  })
})
