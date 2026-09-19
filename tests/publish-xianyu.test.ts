import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const {
  mockAcquirePublishPage,
  mockRevealPublishWindow,
  mockParkPublishWindow,
  mockIsPublishProfileRunning,
  mockPeekPublishProfileLogin,
  mockClosePublishProfile,
  mockDownloadImage,
  mockAbortableDelay
} = vi.hoisted(() => ({
  mockAcquirePublishPage: vi.fn(),
  mockRevealPublishWindow: vi.fn(),
  mockParkPublishWindow: vi.fn(),
  mockIsPublishProfileRunning: vi.fn(),
  mockPeekPublishProfileLogin: vi.fn(),
  mockClosePublishProfile: vi.fn(),
  mockDownloadImage: vi.fn(),
  mockAbortableDelay: vi.fn(async () => undefined)
}))

// Each publishing target now owns its own Chrome profile, so the xianyu module
// talks to the multi-profile manager instead of the shared search-channel login
// session. `readXianyuLogin` deliberately keeps the REAL cookie-driven logic
// (dynamic import inside the factory is allowed) so the fixtures still decide
// the login state.
vi.mock('../src/main/publish/profiles', async () => {
  const { checkLoginState, LOGIN_DEFS } = await import('../src/main/login/defs')
  return {
    acquirePublishPage: mockAcquirePublishPage,
    revealPublishWindow: mockRevealPublishWindow,
    parkPublishWindow: mockParkPublishWindow,
    publishProfileId: (id: string) => `target-${id}`,
    isPublishProfileRunning: mockIsPublishProfileRunning,
    peekPublishProfileLogin: mockPeekPublishProfileLogin,
    closePublishProfile: mockClosePublishProfile,
    readXianyuLogin: async (page: { cookies: (url: string) => Promise<unknown[]> }) => {
      const cookies = await page.cookies(LOGIN_DEFS.xianyu.cookieUrl).catch(() => []) as Array<{ name: string; value: string }>
      const pick = (name: string): string => {
        const cookie = cookies.find(item => item.name === name && item.value)
        if (!cookie) return ''
        try {
          return decodeURIComponent(cookie.value)
        } catch {
          return cookie.value
        }
      }
      return {
        state: checkLoginState(cookies as never, LOGIN_DEFS.xianyu),
        account: pick('tracknick') || pick('unb')
      }
    }
  }
})
vi.mock('../src/main/image', () => ({ downloadImage: mockDownloadImage }))
vi.mock('../src/main/browser/abort', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/browser/abort')>()
  // The publish poll loop uses 2s / 10min delays that would make the suite
  // unusable; only the delay is stubbed, abort semantics stay real.
  return { ...actual, abortableDelay: mockAbortableDelay }
})

import {
  fillTextInput,
  selectCondition,
  uploadCoverImage,
  dumpPage,
  peekTargetLogin,
  loginTargetProfile,
  publishToXianyu,
  type XianyuPublishInput
} from '../src/main/publish/xianyu'

const ARTIFACT_DIR = join('/tmp', 'publish-artifacts')

const LOGGED_IN_COOKIES = [
  { name: 'unb', value: '12345', domain: '.goofish.com', expires: Math.floor(Date.now() / 1000) + 3600 }
]

interface FakeHandle {
  click: ReturnType<typeof vi.fn>
  uploadFile: ReturnType<typeof vi.fn>
  [key: string]: unknown
}

interface FakePageOptions {
  url?: string
  cookies?: unknown[]
  handle?: FakeHandle | null
  evaluate?: (...args: unknown[]) => unknown
  content?: string
  screenshotError?: Error
  cookiesError?: Error
}

function createFakePage(options: FakePageOptions = {}) {
  const handle =
    options.handle === undefined
      ? ({ click: vi.fn(async () => undefined), uploadFile: vi.fn(async () => undefined) } as FakeHandle)
      : options.handle

  const page = {
    cookies: vi.fn(async () => {
      if (options.cookiesError) throw options.cookiesError
      return options.cookies ?? []
    }),
    setExtraHTTPHeaders: vi.fn(async () => undefined),
    url: vi.fn(() => options.url ?? 'https://seller.goofish.com/publish'),
    $: vi.fn(async () => handle),
    evaluate: vi.fn(async (...args: unknown[]) => (options.evaluate ? options.evaluate(...args) : false)),
    keyboard: { type: vi.fn(async () => undefined) },
    screenshot: vi.fn(async (opts?: { path?: string }) => {
      if (options.screenshotError) throw options.screenshotError
      if (opts?.path) writeFileSync(opts.path, 'png-bytes')
    }),
    content: vi.fn(async () => options.content ?? '<html>page</html>'),
    goto: vi.fn(async () => undefined)
  }

  return { page, handle }
}

function xianyuInput(overrides: Partial<XianyuPublishInput> = {}): XianyuPublishInput {
  return {
    targetId: 't1',
    catalogNumber: 'SICP-6480',
    title: 'Album',
    description: 'desc',
    price: '99',
    condition: '全新',
    imageUrl: '',
    uploadCover: false,
    signal: new AbortController().signal,
    onProgress: vi.fn(),
    ...overrides
  }
}

/**
 * Minimal DOM stand-ins so `page.evaluate` can run the real selector callbacks
 * (selectCondition inspects `HTMLSelectElement`/`HTMLElement` instances).
 */
function installFakeDom(root: unknown, optionNodes: unknown[] = []) {
  class FakeHTMLElement {
    textContent: string
    click = vi.fn()
    dispatchEvent = vi.fn(() => true)
    constructor(text = '') {
      this.textContent = text
    }
    querySelector(_selector: string): unknown {
      return null
    }
  }
  class FakeSelectElement extends FakeHTMLElement {
    value = ''
    options: Array<{ textContent: string; value: string }>
    constructor(options: Array<{ textContent: string; value: string }>) {
      super('')
      this.options = options
    }
  }
  class FakeEvent {
    constructor(public type: string) {}
  }
  vi.stubGlobal('HTMLElement', FakeHTMLElement)
  vi.stubGlobal('HTMLSelectElement', FakeSelectElement)
  vi.stubGlobal('HTMLInputElement', class FakeHTMLInputElement {})
  vi.stubGlobal('HTMLTextAreaElement', class FakeHTMLTextAreaElement {})
  vi.stubGlobal('Event', FakeEvent)
  vi.stubGlobal('document', {
    querySelector: vi.fn(() => root),
    querySelectorAll: vi.fn(() => optionNodes)
  })
  return { FakeHTMLElement, FakeSelectElement, FakeEvent }
}

/** DOM stand-ins whose inputs expose a real `value` accessor on the prototype. */
function installFakeInputDom() {
  class FakeInput {
    dispatchEvent = vi.fn(() => true)
  }
  const valueAccessor = {
    configurable: true,
    get(this: { _value?: string }) {
      return this._value ?? ''
    },
    set(this: { _value?: string }, next: string) {
      this._value = next
    }
  }
  Object.defineProperty(FakeInput.prototype, 'value', valueAccessor)
  class FakeTextarea extends FakeInput {}
  // Subclasses need their own descriptor: the code reads it with
  // getOwnPropertyDescriptor on the exact prototype it picks.
  Object.defineProperty(FakeTextarea.prototype, 'value', valueAccessor)
  class FakeEvent {
    constructor(public type: string) {}
  }
  vi.stubGlobal('Event', FakeEvent)
  vi.stubGlobal('HTMLInputElement', FakeInput)
  vi.stubGlobal('HTMLTextAreaElement', FakeTextarea)
  vi.stubGlobal('window', { HTMLInputElement: FakeInput, HTMLTextAreaElement: FakeTextarea })
  vi.stubGlobal('document', { querySelector: vi.fn(() => null), querySelectorAll: vi.fn(() => []) })
  return { FakeInput, FakeTextarea, FakeEvent }
}

beforeEach(() => {
  vi.clearAllMocks()
  rmSync(ARTIFACT_DIR, { recursive: true, force: true })
  mockAbortableDelay.mockResolvedValue(undefined)
  mockRevealPublishWindow.mockResolvedValue(undefined)
  mockParkPublishWindow.mockResolvedValue(undefined)
  mockIsPublishProfileRunning.mockReturnValue(true)
  mockPeekPublishProfileLogin.mockResolvedValue(null)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fillTextInput', () => {
  it('returns false for an empty value without touching the page', async () => {
    const { page } = createFakePage()
    expect(await fillTextInput(page as never, ['#title'], '')).toBe(false)
    expect(page.$).not.toHaveBeenCalled()
  })

  it('returns false when no candidate selector matches', async () => {
    const { page } = createFakePage({ handle: null })
    expect(await fillTextInput(page as never, ['#title', '#name'], 'Album')).toBe(false)
    expect(page.evaluate).not.toHaveBeenCalled()
  })

  it('returns true when the native-setter evaluation sticks', async () => {
    const { page } = createFakePage({ evaluate: async () => true })
    expect(await fillTextInput(page as never, ['#title'], 'Album')).toBe(true)
    expect(page.keyboard.type).not.toHaveBeenCalled()
    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), '#title', 'Album')
  })

  it('falls back to real key events when the evaluation does not stick', async () => {
    const { page, handle } = createFakePage({ evaluate: async () => false })
    expect(await fillTextInput(page as never, ['#title', '#name'], 'Album')).toBe(true)
    expect(handle!.click).toHaveBeenCalledWith({ clickCount: 3 })
    expect(page.keyboard.type).toHaveBeenCalledWith('Album', { delay: 10 })
  })

  it('returns false when the typing fallback itself throws', async () => {
    const { page, handle } = createFakePage({ evaluate: async () => false })
    handle!.click.mockRejectedValue(new Error('detached'))
    expect(await fillTextInput(page as never, ['#title'], 'Album')).toBe(false)
    expect(page.keyboard.type).not.toHaveBeenCalled()
  })

  it('treats an evaluation rejection as "not applied" and types instead', async () => {
    const { page } = createFakePage()
    page.evaluate.mockRejectedValue(new Error('execution context destroyed'))
    expect(await fillTextInput(page as never, ['#title'], 'Album')).toBe(true)
    expect(page.keyboard.type).toHaveBeenCalled()
  })

  it('skips a selector whose lookup throws', async () => {
    const { page } = createFakePage({ evaluate: async () => true })
    page.$.mockRejectedValueOnce(new Error('detached frame'))
    expect(await fillTextInput(page as never, ['#bad', '#title'], 'Album')).toBe(true)
    expect(page.$).toHaveBeenCalledTimes(2)
  })

  it('writes through the native value setter and dispatches input + change', async () => {
    const { FakeInput } = installFakeInputDom()
    const element = new FakeInput()
    vi.stubGlobal('document', { querySelector: () => element })
    const { page } = createFakePage({ evaluate: async (fn: unknown, ...args: unknown[]) => (fn as Function)(...args) })

    expect(await fillTextInput(page as never, ['#title'], 'Album')).toBe(true)
    expect((element as unknown as { _value: string })._value).toBe('Album')
    expect(element.dispatchEvent).toHaveBeenCalledTimes(2)
    expect((element.dispatchEvent.mock.calls[0]![0] as { type: string }).type).toBe('input')
    expect((element.dispatchEvent.mock.calls[1]![0] as { type: string }).type).toBe('change')
    expect(page.keyboard.type).not.toHaveBeenCalled()
  })

  it('uses the textarea prototype for a textarea element', async () => {
    const { FakeTextarea } = installFakeInputDom()
    const element = new FakeTextarea()
    vi.stubGlobal('document', { querySelector: () => element })
    const { page } = createFakePage({ evaluate: async (fn: unknown, ...args: unknown[]) => (fn as Function)(...args) })

    expect(await fillTextInput(page as never, ['textarea'], 'desc')).toBe(true)
    expect((element as unknown as { _value: string })._value).toBe('desc')
  })

  it('falls back to typing when the element vanished from the DOM', async () => {
    installFakeInputDom()
    vi.stubGlobal('document', { querySelector: () => null })
    const { page } = createFakePage({ evaluate: async (fn: unknown, ...args: unknown[]) => (fn as Function)(...args) })
    expect(await fillTextInput(page as never, ['#title'], 'Album')).toBe(true)
    expect(page.keyboard.type).toHaveBeenCalledWith('Album', { delay: 10 })
  })

  it('falls back to typing when the element has no value setter', async () => {
    class BareInput {
      dispatchEvent = vi.fn(() => true)
    }
    vi.stubGlobal('Event', class FakeEvent {})
    vi.stubGlobal('HTMLInputElement', BareInput)
    vi.stubGlobal('HTMLTextAreaElement', class FakeTextarea {})
    vi.stubGlobal('window', { HTMLInputElement: BareInput, HTMLTextAreaElement: class FakeTextarea {} })
    vi.stubGlobal('document', { querySelector: () => new BareInput() })
    const { page } = createFakePage({ evaluate: async (fn: unknown, ...args: unknown[]) => (fn as Function)(...args) })
    expect(await fillTextInput(page as never, ['#title'], 'Album')).toBe(true)
    expect(page.keyboard.type).toHaveBeenCalled()
  })
})

describe('selectCondition', () => {
  it('returns false for an empty label', async () => {
    const { page } = createFakePage()
    expect(await selectCondition(page as never, ['select'], '')).toBe(false)
    expect(page.$).not.toHaveBeenCalled()
  })

  it('returns false when the selector does not match', async () => {
    const { page } = createFakePage({ handle: null })
    expect(await selectCondition(page as never, ['select'], '全新')).toBe(false)
  })

  it('returns false when the root node cannot be resolved in the page', async () => {
    installFakeDom(null)
    const { page } = createFakePage({ evaluate: async (fn: unknown, ...args: unknown[]) => (fn as Function)(...args) })
    expect(await selectCondition(page as never, ['select.condition'], '全新')).toBe(false)
  })

  it('selects a matching option on a native select and fires change', async () => {
    const { FakeSelectElement, FakeEvent } = installFakeDom(null)
    const select = new FakeSelectElement([
      { textContent: '全新', value: 'v-new' },
      { textContent: '几乎全新', value: 'v-almost' }
    ])
    vi.stubGlobal('document', { querySelector: () => select, querySelectorAll: () => [] })
    const { page } = createFakePage({ evaluate: async (fn: unknown, ...args: unknown[]) => (fn as Function)(...args) })

    expect(await selectCondition(page as never, ['select.condition'], '几乎全新')).toBe(true)
    expect(select.value).toBe('v-almost')
    expect(select.dispatchEvent).toHaveBeenCalledTimes(1)
    expect(select.dispatchEvent.mock.calls[0]![0]).toBeInstanceOf(FakeEvent)
    expect((select.dispatchEvent.mock.calls[0]![0] as { type: string }).type).toBe('change')
  })

  it('returns false when the native select has no matching option', async () => {
    const { FakeSelectElement } = installFakeDom(null)
    const select = new FakeSelectElement([{ textContent: '全新', value: 'v-new' }])
    vi.stubGlobal('document', { querySelector: () => select, querySelectorAll: () => [] })
    const { page } = createFakePage({ evaluate: async (fn: unknown, ...args: unknown[]) => (fn as Function)(...args) })

    expect(await selectCondition(page as never, ['select.condition'], '严重使用痕迹')).toBe(false)
    expect(select.dispatchEvent).not.toHaveBeenCalled()
  })

  it('opens a custom dropdown and clicks the matching option node', async () => {
    const { FakeHTMLElement } = installFakeDom(null)
    const root = new FakeHTMLElement('成色')
    const option = new FakeHTMLElement('严重使用痕迹')
    vi.stubGlobal('document', { querySelector: () => root, querySelectorAll: () => [option] })
    const { page } = createFakePage({ evaluate: async (fn: unknown, ...args: unknown[]) => (fn as Function)(...args) })

    expect(await selectCondition(page as never, ['[class*="成色"]'], '严重使用痕迹')).toBe(true)
    expect(root.click).toHaveBeenCalledTimes(1)
    expect(option.click).toHaveBeenCalledTimes(1)
  })

  it('returns false when a custom dropdown has no matching option node', async () => {
    const { FakeHTMLElement } = installFakeDom(null)
    const root = new FakeHTMLElement('成色')
    vi.stubGlobal('document', { querySelector: () => root, querySelectorAll: () => [] })
    const { page } = createFakePage({ evaluate: async (fn: unknown, ...args: unknown[]) => (fn as Function)(...args) })

    expect(await selectCondition(page as never, ['[class*="成色"]'], '全新')).toBe(false)
    expect(root.click).toHaveBeenCalledTimes(1)
  })

  it('returns false when the evaluation throws', async () => {
    const { page } = createFakePage()
    page.evaluate.mockRejectedValue(new Error('boom'))
    expect(await selectCondition(page as never, ['select'], '全新')).toBe(false)
  })
})

describe('uploadCoverImage', () => {
  it('returns false without an image URL', async () => {
    const { page } = createFakePage()
    expect(await uploadCoverImage(page as never, ['input[type=file]'], '')).toBe(false)
    expect(page.$).not.toHaveBeenCalled()
  })

  it('returns false when there is no file input', async () => {
    const { page } = createFakePage({ handle: null })
    expect(await uploadCoverImage(page as never, ['input[type=file]'], 'https://cdn/c.jpg')).toBe(false)
    expect(mockDownloadImage).not.toHaveBeenCalled()
  })

  it('returns false when the download fails', async () => {
    mockDownloadImage.mockResolvedValue(null)
    const { page } = createFakePage()
    expect(await uploadCoverImage(page as never, ['input[type=file]'], 'https://cdn/c.jpg')).toBe(false)
  })

  it('writes the downloaded file and uploads it through the file input', async () => {
    mockDownloadImage.mockResolvedValue({ base64: Buffer.from('cover').toString('base64'), mimeType: 'image/png' })
    const { page, handle } = createFakePage()
    expect(await uploadCoverImage(page as never, ['input[type=file]'], 'https://cdn/c.jpg')).toBe(true)
    expect(mockDownloadImage).toHaveBeenCalledWith('https://cdn/c.jpg', 1000, true)
    expect(handle!.uploadFile).toHaveBeenCalledTimes(1)
    const uploaded = handle!.uploadFile.mock.calls[0]![0] as string
    expect(uploaded).toMatch(/publish-artifacts\/cover-\d+\.png$/)
    expect(existsSync(uploaded)).toBe(true)
  })

  it('uses a .jpg extension for non-png images and returns false when upload fails', async () => {
    mockDownloadImage.mockResolvedValue({ base64: Buffer.from('cover').toString('base64'), mimeType: 'image/jpeg' })
    const { page, handle } = createFakePage()
    handle!.uploadFile.mockRejectedValue(new Error('not a file input'))
    expect(await uploadCoverImage(page as never, ['input[type=file]'], 'https://cdn/c.jpg')).toBe(false)
    expect(handle!.uploadFile.mock.calls[0]![0]).toMatch(/\.jpg$/)
  })
})

describe('dumpPage', () => {
  it('writes both a screenshot and the html source', async () => {
    const { page } = createFakePage({ content: '<html>dumped</html>' })
    const paths = await dumpPage(page as never, 'xianyu-X-1-filled')
    expect(paths).toHaveLength(2)
    expect(paths[0]).toMatch(/xianyu-X-1-filled-.*\.png$/)
    expect(paths[1]).toMatch(/xianyu-X-1-filled-.*\.html$/)
    expect(paths.every(file => existsSync(file))).toBe(true)
    expect(page.screenshot).toHaveBeenCalledWith({ path: paths[0] })
    expect(page.content).toHaveBeenCalled()
  })

  it('still writes the html dump when the screenshot fails', async () => {
    const { page } = createFakePage({ screenshotError: new Error('no surface') })
    const paths = await dumpPage(page as never, 'xianyu-X-1-error')
    expect(paths).toHaveLength(1)
    expect(paths[0]).toMatch(/\.html$/)
    expect(existsSync(paths[0]!)).toBe(true)
  })

  it('returns an empty list when every dump fails', async () => {
    const { page } = createFakePage({ screenshotError: new Error('no surface') })
    page.content.mockRejectedValue(new Error('target closed'))
    expect(await dumpPage(page as never, 'xianyu-X-1-gone')).toEqual([])
  })
})

describe('peekTargetLogin', () => {
  it('reports not_started without a running profile (never launches Chrome)', async () => {
    mockPeekPublishProfileLogin.mockResolvedValue(null)
    await expect(peekTargetLogin('t1')).resolves.toEqual({ running: false, state: 'not_started', account: '' })
    expect(mockPeekPublishProfileLogin).toHaveBeenCalledWith('target-t1')
  })

  it('reports the running profile snapshot', async () => {
    mockPeekPublishProfileLogin.mockResolvedValue({ state: 'logged_in', account: '闲鱼小铺' })
    await expect(peekTargetLogin('t1')).resolves.toEqual({ running: true, state: 'logged_in', account: '闲鱼小铺' })
  })
})

describe('loginTargetProfile', () => {
  it('reports a failure when Chrome cannot be started', async () => {
    mockAcquirePublishPage.mockResolvedValue(null)
    const result = await loginTargetProfile('t1')
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Chrome')
    expect(mockAcquirePublishPage).toHaveBeenCalledWith('target-t1', 'headed')
    expect(mockRevealPublishWindow).not.toHaveBeenCalled()
  })

  it('returns the account once the scan completes and always releases + parks the window', async () => {
    const release = vi.fn()
    // The user needs a moment to scan: the first two polls see no login.
    let polls = 0
    const { page } = createFakePage()
    page.cookies.mockImplementation(async () => {
      polls += 1
      return polls >= 3 ? LOGGED_IN_COOKIES : []
    })
    mockAcquirePublishPage.mockResolvedValue({ page, release })

    const result = await loginTargetProfile('t1')

    expect(result).toEqual({ ok: true, account: '12345', message: '已登录：12345' })
    expect(polls).toBeGreaterThanOrEqual(3)
    expect(page.goto).toHaveBeenCalledWith('https://seller.goofish.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    })
    expect(mockRevealPublishWindow).toHaveBeenCalledWith('target-t1')
    expect(release).toHaveBeenCalledTimes(1)
    expect(mockParkPublishWindow).toHaveBeenCalledWith('target-t1')
  })

  it('reports a closed window when the profile stops running before login', async () => {
    const release = vi.fn()
    const { page } = createFakePage({ cookies: [] })
    mockAcquirePublishPage.mockResolvedValue({ page, release })
    mockIsPublishProfileRunning.mockReturnValue(false)

    const result = await loginTargetProfile('t1')

    expect(result.ok).toBe(false)
    expect(result.message).toContain('窗口已关闭')
    expect(release).toHaveBeenCalledTimes(1)
    expect(mockParkPublishWindow).toHaveBeenCalledWith('target-t1')
  })

  it('times out after 5 minutes of polling', async () => {
    const release = vi.fn()
    const { page } = createFakePage({ cookies: [] })
    mockAcquirePublishPage.mockResolvedValue({ page, release })

    const realNow = Date.now()
    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValueOnce(realNow)
    nowSpy.mockReturnValue(realNow + 6 * 60 * 1000)

    try {
      const result = await loginTargetProfile('t1')
      expect(result.ok).toBe(false)
      expect(result.message).toContain('超时')
      expect(release).toHaveBeenCalledTimes(1)
      expect(mockParkPublishWindow).toHaveBeenCalledWith('target-t1')
    } finally {
      nowSpy.mockRestore()
    }
  })
})

describe('publishToXianyu', () => {
  function publishEvaluate(...args: unknown[]): unknown {
    const rest = args.slice(1)
    if (rest.length === 0) return '发布成功'
    if (Array.isArray(rest[0])) return ''
    return true
  }

  it('throws when Chrome cannot be started', async () => {
    mockAcquirePublishPage.mockResolvedValue(null)
    await expect(publishToXianyu(xianyuInput())).rejects.toThrow('无法启动真实 Chrome')
    expect(mockAcquirePublishPage).toHaveBeenCalledWith('target-t1', 'headed')
  })

  it('throws when this target is not logged in and still releases the page', async () => {
    const release = vi.fn()
    const { page } = createFakePage({ cookies: [] })
    mockAcquirePublishPage.mockResolvedValue({ page, release })
    await expect(publishToXianyu(xianyuInput())).rejects.toThrow('该发布目标尚未登录闲鱼')
    expect(release).toHaveBeenCalledTimes(1)
    expect(page.goto).not.toHaveBeenCalled()
  })

  it('reads the login from this target own cookie jar', async () => {
    const release = vi.fn()
    const { page } = createFakePage({ cookies: [] })
    mockAcquirePublishPage.mockResolvedValue({ page, release })
    await expect(publishToXianyu(xianyuInput({ targetId: 'other-target' }))).rejects.toThrow('该发布目标尚未登录闲鱼')
    expect(mockAcquirePublishPage).toHaveBeenCalledWith('target-other-target', 'headed')
    expect(page.cookies).toHaveBeenCalledWith('https://www.goofish.com/')
  })

  it('treats a cookie read failure during publishing as not logged in', async () => {
    const release = vi.fn()
    const { page } = createFakePage({ cookiesError: new Error('target closed') })
    mockAcquirePublishPage.mockResolvedValue({ page, release })
    await expect(publishToXianyu(xianyuInput())).rejects.toThrow('该发布目标尚未登录闲鱼')
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('throws immediately for an already-aborted signal', async () => {
    const release = vi.fn()
    const { page } = createFakePage({ cookies: LOGGED_IN_COOKIES })
    mockAcquirePublishPage.mockResolvedValue({ page, release })
    const controller = new AbortController()
    controller.abort()
    await expect(publishToXianyu(xianyuInput({ signal: controller.signal }))).rejects.toThrow(/abort/i)
    expect(release).toHaveBeenCalledTimes(1)
    expect(page.goto).not.toHaveBeenCalled()
  })

  it('fills the form, dumps the page and reports a published listing', async () => {
    const release = vi.fn()
    const onProgress = vi.fn()
    const { page } = createFakePage({
      url: 'https://seller.goofish.com/publish?itemId=1',
      cookies: LOGGED_IN_COOKIES,
      evaluate: publishEvaluate
    })
    mockAcquirePublishPage.mockResolvedValue({ page, release })

    const result = await publishToXianyu(xianyuInput({ onProgress }))

    expect(result.status).toBe('published')
    expect(result.filled).toEqual(['title', 'description', 'price', 'condition'])
    expect(result.missed).toEqual([])
    expect(result.artifacts.length).toBeGreaterThan(0)
    expect(result.listingUrl).toBe('https://seller.goofish.com/publish?itemId=1')
    expect(mockAcquirePublishPage).toHaveBeenCalledWith('target-t1', 'headed')
    expect(mockRevealPublishWindow).toHaveBeenCalledWith('target-t1')
    expect(mockAbortableDelay).toHaveBeenCalled()
    expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('请在浏览器窗口中确认并点击「发布」'), true)
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('reports missed fields but still waits for and detects the publication', async () => {
    const release = vi.fn()
    const { page } = createFakePage({
      url: 'https://seller.goofish.com/publish',
      cookies: LOGGED_IN_COOKIES,
      handle: null,
      evaluate: publishEvaluate
    })
    mockAcquirePublishPage.mockResolvedValue({ page, release })

    const result = await publishToXianyu(xianyuInput())

    expect(result.status).toBe('published')
    expect(result.missed).toEqual(['title', 'description', 'price', 'condition'])
    expect(result.filled).toEqual([])
    expect(mockAcquirePublishPage).toHaveBeenCalledWith('target-t1', 'headed')
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('uploads the cover image when requested and records it as filled', async () => {
    const release = vi.fn()
    mockDownloadImage.mockResolvedValue({ base64: Buffer.from('cover').toString('base64'), mimeType: 'image/png' })
    const { page, handle } = createFakePage({
      url: 'https://seller.goofish.com/publish',
      cookies: LOGGED_IN_COOKIES,
      evaluate: publishEvaluate
    })
    mockAcquirePublishPage.mockResolvedValue({ page, release })

    const result = await publishToXianyu(xianyuInput({ uploadCover: true, imageUrl: 'https://cdn/c.jpg' }))

    expect(handle!.uploadFile).toHaveBeenCalledTimes(1)
    expect(result.filled).toContain('image')
  })

  it('falls back to the image URL input when the file upload is unavailable', async () => {
    const release = vi.fn()
    const { page, handle } = createFakePage({
      url: 'https://seller.goofish.com/publish',
      cookies: LOGGED_IN_COOKIES,
      evaluate: publishEvaluate
    })
    page.$.mockImplementation(async (selector: string) => (selector.includes('type="file"') ? null : handle))
    mockAcquirePublishPage.mockResolvedValue({ page, release })

    const result = await publishToXianyu(xianyuInput({ uploadCover: true, imageUrl: 'https://cdn/c.jpg' }))

    expect(result.filled).toContain('image')
    expect(mockDownloadImage).not.toHaveBeenCalled()
  })

  it('records a missed image when both upload paths fail', async () => {
    const release = vi.fn()
    const { page } = createFakePage({
      url: 'https://seller.goofish.com/publish',
      cookies: LOGGED_IN_COOKIES,
      handle: null,
      evaluate: publishEvaluate
    })
    mockAcquirePublishPage.mockResolvedValue({ page, release })

    const result = await publishToXianyu(xianyuInput({ uploadCover: true, imageUrl: 'https://cdn/c.jpg' }))

    expect(result.missed).toContain('image')
  })

  it('returns a cancelled result when the success marker never appears', async () => {
    const release = vi.fn()
    const realNow = Date.now()
    let offset = 0
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => realNow + offset)
    installFakeDom(null)
    vi.stubGlobal('document', {
      querySelector: () => null,
      querySelectorAll: () => [],
      body: { innerText: '等待用户操作，尚未完成' }
    })
    const { page } = createFakePage({
      url: 'https://seller.goofish.com/publish',
      cookies: LOGGED_IN_COOKIES,
      evaluate: (...args: unknown[]) => {
        const [fn, ...rest] = args
        if (rest.length === 0) {
          // Jump past the 10 minute user-submit deadline on the first poll.
          offset = 11 * 60 * 1000
          return (fn as Function)()
        }
        return true
      }
    })
    mockAcquirePublishPage.mockResolvedValue({ page, release })

    try {
      const result = await publishToXianyu(xianyuInput())

      expect(result.status).toBe('cancelled')
      expect(result.message).toContain('等待超时')
      expect(result.artifacts.some(path => /timeout/.test(path))).toBe(true)
      expect(release).toHaveBeenCalledTimes(1)
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('clicks through the workbench home when the form is not open yet', async () => {
    const release = vi.fn()
    const { FakeHTMLElement } = installFakeDom(null)
    const entry = new FakeHTMLElement('发布闲置')
    vi.stubGlobal('document', { querySelector: () => null, querySelectorAll: () => [entry] })
    const { page } = createFakePage({
      // isPublishPath only inspects the URL *path*, so the real workbench home
      // (`/`) is not mistaken for the form and the entry click is attempted.
      url: 'https://seller.goofish.com/',
      cookies: LOGGED_IN_COOKIES,
      evaluate: (...args: unknown[]) => {
        const [fn, ...rest] = args
        if (rest.length === 1 && Array.isArray(rest[0])) return (fn as Function)(...rest)
        if (rest.length === 0) return '发布成功'
        return true
      }
    })
    mockAcquirePublishPage.mockResolvedValue({ page, release })

    const result = await publishToXianyu(xianyuInput())

    expect(result.status).toBe('published')
    expect(entry.click).toHaveBeenCalledTimes(1)
  })

  it('continues when no publishing entry is found on the workbench home', async () => {
    const release = vi.fn()
    const { FakeHTMLElement } = installFakeDom(null)
    const other = new FakeHTMLElement('我的订单')
    vi.stubGlobal('document', { querySelector: () => null, querySelectorAll: () => [other] })
    const { page } = createFakePage({
      url: 'https://www.goofish.com/home',
      cookies: LOGGED_IN_COOKIES,
      evaluate: (...args: unknown[]) => {
        const [fn, ...rest] = args
        if (rest.length === 1 && Array.isArray(rest[0])) return (fn as Function)(...rest)
        if (rest.length === 0) return '发布成功'
        return true
      }
    })
    mockAcquirePublishPage.mockResolvedValue({ page, release })

    const result = await publishToXianyu(xianyuInput())

    expect(result.status).toBe('published')
    expect(other.click).not.toHaveBeenCalled()
  })

  it('throws when the workbench redirects to a login page', async () => {
    const release = vi.fn()
    const { page } = createFakePage({
      url: 'https://seller.goofish.com/login?from=publish',
      cookies: LOGGED_IN_COOKIES
    })
    mockAcquirePublishPage.mockResolvedValue({ page, release })
    await expect(publishToXianyu(xianyuInput())).rejects.toThrow('登录已失效')
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('throws when no publishing page can be opened', async () => {
    const release = vi.fn()
    const { page } = createFakePage({ cookies: LOGGED_IN_COOKIES })
    page.goto.mockRejectedValue(new Error('ERR_CONNECTION_RESET'))
    mockAcquirePublishPage.mockResolvedValue({ page, release })
    await expect(publishToXianyu(xianyuInput())).rejects.toThrow('打不开闲鱼卖家工作台')
    expect(release).toHaveBeenCalledTimes(1)
  })
})
