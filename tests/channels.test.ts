// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Page } from 'puppeteer'
import { checkLoginState, LOGIN_DEFS, type LoginCookie } from '../src/main/cloudflare/login'
import { describeBrowserSessionFromUa } from '../src/main/cloudflare/chrome'
import { parseCNYPrice, loginRequired, notFound } from '../src/main/queries/types'
import { extractCards as extractGoofishCards, queryXianyu } from '../src/main/queries/xianyu'
import { extractCards as extractTaobaoCards, queryTaobaoImage } from '../src/main/queries/taobao'
import { SEARCH_PLATFORMS, SELECTABLE_PLATFORMS, CHANNEL_PLATFORMS, DEFAULT_STANDARD_PLATFORMS, DEFAULT_DEEP_PLATFORMS } from '../src/shared/platforms'

const { mockAcquireCloudflarePage } = vi.hoisted(() => ({ mockAcquireCloudflarePage: vi.fn() }))

vi.mock('../src/main/cloudflare', () => ({ acquireCloudflarePage: mockAcquireCloudflarePage }))

// Deterministic CNY->USD rate for price-parsing assertions.
vi.mock('../src/main/currency', () => ({
  convertToUSDWithFallback: async (amount: number, from: string) =>
    from === 'CNY' ? Math.round(amount * 0.14 * 100) / 100 : amount
}))

const cookie = (overrides: Partial<LoginCookie>): LoginCookie => ({
  name: 'unb',
  value: '123456',
  domain: '.goofish.com',
  ...overrides
})

describe('checkLoginState', () => {
  const def = LOGIN_DEFS.xianyu

  it('reports logged in when an unexpired login cookie exists on the right domain', () => {
    const cookies = [cookie({ expires: 4102444800 })]
    expect(checkLoginState(cookies, def, 1700000000000)).toBe('logged_in')
  })

  it('reports expired when every matching cookie is past its expiry', () => {
    const cookies = [cookie({ expires: 1600000000 })]
    expect(checkLoginState(cookies, def, 1700000000000)).toBe('expired')
  })

  it('treats session cookies (no expiry) as active', () => {
    expect(checkLoginState([cookie({})], def, 1700000000000)).toBe('logged_in')
    expect(checkLoginState([cookie({ expires: -1 })], def, 1700000000000)).toBe('logged_in')
  })

  it('reports logged out for wrong name, wrong domain, or empty value', () => {
    expect(checkLoginState([cookie({ name: 'other' })], def)).toBe('logged_out')
    expect(checkLoginState([cookie({ domain: '.taobao.com' })], def)).toBe('logged_out')
    expect(checkLoginState([cookie({ value: '' })], def)).toBe('logged_out')
    expect(checkLoginState([], def)).toBe('logged_out')
  })

  it('accepts any of the configured cookie names (taobao any-of)', () => {
    const tracknick = cookie({ name: 'tracknick', domain: '.taobao.com' })
    expect(checkLoginState([tracknick], LOGIN_DEFS.taobao)).toBe('logged_in')
  })

  it('expires take precedence over logged out only when a matching cookie exists', () => {
    const mixed = [cookie({ expires: 1600000000 }), cookie({ domain: '.other.com' })]
    expect(checkLoginState(mixed, def, 1700000000000)).toBe('expired')
  })

  it('defines login entries for every login platform', () => {
    for (const platform of ['surugaya', 'zenmarket', 'xianyu', 'taobao'] as const) {
      expect(LOGIN_DEFS[platform].loginUrl).toMatch(/^https:\/\//)
      expect(LOGIN_DEFS[platform].cookieNames.length).toBeGreaterThan(0)
    }
    expect(LOGIN_DEFS.taobao.loginUrl).toContain('login.taobao.com')
    expect(LOGIN_DEFS.xianyu.domainSuffix).toBe('goofish.com')
  })
})

describe('describeBrowserSessionFromUa', () => {
  it('masks a headless UA and classifies the session as headless', () => {
    const headlessUa = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/151.0.0.0 Safari/537.36'
    expect(describeBrowserSessionFromUa(headlessUa)).toEqual({
      maskedUa: 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
      mode: 'headless'
    })
  })

  it('keeps a headed browser unmasked', () => {
    const headedUa = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'
    expect(describeBrowserSessionFromUa(headedUa)).toEqual({ maskedUa: '', mode: 'headed' })
  })
})

describe('platform lists', () => {
  it('keeps the marketplace channels out of the text-platform list', () => {
    for (const channel of CHANNEL_PLATFORMS) {
      expect(SEARCH_PLATFORMS).not.toContain(channel)
    }
  })

  it('appends the channels to the selectable list in canonical order', () => {
    expect(SELECTABLE_PLATFORMS).toEqual([...SEARCH_PLATFORMS, ...CHANNEL_PLATFORMS])
    expect(SELECTABLE_PLATFORMS.slice(-2)).toEqual(['xianyu', 'taobao'])
  })

  it('defaults do not pre-check any channel', () => {
    for (const channel of CHANNEL_PLATFORMS) {
      expect(DEFAULT_STANDARD_PLATFORMS).not.toContain(channel)
      expect(DEFAULT_DEEP_PLATFORMS).not.toContain(channel)
    }
  })
})

describe('parseCNYPrice', () => {
  it('parses yuan-prefixed and yuan-suffixed prices', async () => {
    expect(await parseCNYPrice('¥88.00')).toBe(12.32)
    expect(await parseCNYPrice('￥1,234')).toBe(172.76)
    expect(await parseCNYPrice('88元')).toBe(12.32)
    expect(await parseCNYPrice('¥88')).toBe(12.32)
  })

  it('returns null for text without a price', async () => {
    expect(await parseCNYPrice('no price here')).toBeNull()
    expect(await parseCNYPrice('')).toBeNull()
  })
})

describe('loginRequired result', () => {
  it('uses the challenge status with a scan-login hint', () => {
    const result = loginRequired('xianyu')
    expect(result.status).toBe('challenge')
    expect(result.error).toContain('扫码登录')
  })

  it('notFound keeps the challenge-free gray state', () => {
    expect(notFound('taobao').status).toBe('not_found')
  })
})

describe('xianyu search-card extraction', () => {
  const fakePage = (html: string) =>
    ({
      evaluate: (fn: (selectors: string) => unknown, selectors: string) => {
        document.body.innerHTML = html
        return fn(selectors)
      }
    }) as unknown as Page

  it('extracts title, price text, cover and link, deduplicating per item id', async () => {
    const html = `
      <a href="/item?id=111"><div><img src="//img.goofish.com/a.jpg"><span>Beatles Abbey Road 日版</span><span>¥88.00</span></div></a>
      <a href="/item?id=222"><div><img data-src="https://img.goofish.com/b.jpg"><span>Nirvana Nevermind</span><span>￥1,234</span></div></a>
      <a href="https://www.goofish.com/item?id=111">nested duplicate anchor</a>
    `
    const cards = await extractGoofishCards(fakePage(html))
    expect(cards).toHaveLength(2)
    expect(cards[0]).toMatchObject({
      title: 'Beatles Abbey Road 日版',
      priceText: '¥88.00',
      cover: '//img.goofish.com/a.jpg',
      link: '/item?id=111'
    })
    expect(cards[1]).toMatchObject({ title: 'Nirvana Nevermind', priceText: '￥1,234', cover: 'https://img.goofish.com/b.jpg' })
  })

  it('falls back to the full text as the title when no price fragment exists', async () => {
    const cards = await extractGoofishCards(fakePage('<a href="/item?id=333"><div>纯粹的一张CD</div></a>'))
    expect(cards).toHaveLength(1)
    expect(cards[0]?.title).toBe('纯粹的一张CD')
    expect(cards[0]?.priceText).toBeNull()
  })

  it('uses the structured price row so want-counts and original prices stay out', async () => {
    // Mirrors the live goofish card markup (feeds-item-wrap -- hashed classes).
    const html = `
      <a class="feeds-item-wrap--rGdH_KoF" href="https://www.goofish.com/item?id=555&categoryId=1268">
        <div class="feeds-image-container--x"><img src="//img.alicdn.com/real.jpg"></div>
        <div class="feeds-content--y">
          <div class="row1-wrap-title--z"><div class="main-title--abc">山本达郎 1982 日版</div></div>
          <div class="row3-wrap-price--p">
            <div class="price-wrap--q"><span class="sign--s">¥</span><span class="number--n">1,280</span><span class="decimal--d"></span></div>
            <div class="price-desc--d">3人想要</div>
          </div>
        </div>
      </a>
    `
    const cards = await extractGoofishCards(fakePage(html))
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      title: '山本达郎 1982 日版',
      priceText: '¥1,280',
      cover: '//img.alicdn.com/real.jpg',
      link: 'https://www.goofish.com/item?id=555&categoryId=1268'
    })
  })

  it('skips lazy-load placeholder srcs in favour of data-src / srcset', async () => {
    // At first paint goofish cards carry a placeholder `src` (black LQIP /
    // data URI) and the real CDN URL hides in data-src / srcset until
    // hydration; letting a placeholder through renders a solid-black cover.
    const html = `
      <a href="/item?id=701"><div><img src="data:image/svg+xml,gray" data-src="//img.alicdn.com/imgextra/real-1.jpg"><span>Abyss ¥1</span></div></a>
      <a href="/item?id=702"><div><img src="data:image/gif;base64,R0lGODlhAQ" srcset="//img.alicdn.com/imgextra/real-2.jpg 400w, /tiny.jpg 60w"><span>Beps ¥2</span></div></a>
      <a href="/item?id=703"><div><img src="data:image/gif;base64,R0lGODlhAQ"><span>Cake ¥3</span></div></a>
    `
    const cards = await extractGoofishCards(fakePage(html))
    expect(cards).toHaveLength(3)
    expect(cards[0]?.cover).toBe('//img.alicdn.com/imgextra/real-1.jpg')
    expect(cards[1]?.cover).toBe('//img.alicdn.com/imgextra/real-2.jpg')
    expect(cards[2]?.cover).toBeNull()
  })
})

describe('taobao image-search card extraction', () => {
  const fakePage = (html: string) =>
    ({
      evaluate: (fn: (selectors: string) => unknown, selectors: string) => {
        document.body.innerHTML = html
        return fn(selectors)
      }
    }) as unknown as Page

  it('extracts item cards from taobao/tmall result links', async () => {
    const html = `
      <a href="//item.taobao.com/item.htm?id=333"><div><span>Taylor Swift 1989 CD</span><span>¥45.00</span></div></a>
      <a href="https://detail.tmall.com/item.htm?id=444"><div><span>Madonna Like a Prayer</span><span>¥1,200</span></div></a>
      <a href="//item.taobao.com/item.htm?id=333">duplicate</a>
    `
    const cards = await extractTaobaoCards(fakePage(html))
    expect(cards).toHaveLength(2)
    expect(cards[0]).toMatchObject({ title: 'Taylor Swift 1989 CD', priceText: '¥45.00', link: '//item.taobao.com/item.htm?id=333' })
    expect(cards[1]).toMatchObject({ title: 'Madonna Like a Prayer', priceText: '¥1,200' })
  })

  it('returns an empty list when the result grid is absent', async () => {
    const cards = await extractTaobaoCards(fakePage('<div class="skeleton">loading</div>'))
    expect(cards).toEqual([])
  })

  it('reads structured title/price nodes so the pay-count stays out of prices', async () => {
    // Mirrors the live image-search card markup (2026-08, hashed classes):
    // flattened text would concatenate "¥251" + "3人付款" into "¥2513".
    const html = `
      <a class="doubleCardWrapperAdapt--mEcC7olq" id="item_id_657684166583" href="//item.taobao.com/item.htm?id=657684166583&ns=1&xxc=taobaoSearch">
        <img class="mainPic--Ds3X7I8z" src="//g-search2.alicdn.com/img/bao/uploaded/i4/x.jpg_360x360q90.jpg_.webp">
        <div class="title--ASSt27UY"><span>贾斯汀比伯 Justin Bieber Justice Complete Edition CD</span></div>
        <div class="priceWrapper--dBtPZ2K1">
          <span class="unit--D3KGoZe2">¥</span>
          <div class="innerPriceWrapper--aAJhHXD4"><div class="priceInt--yqqZMJ5a">251</div><div class="priceFloat--XpixvyQ1"></div></div>
          <span class="realSales--XZJiepmt">3人付款</span>
        </div>
      </a>
    `
    const cards = await extractTaobaoCards(fakePage(html))
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      title: '贾斯汀比伯 Justin Bieber Justice Complete Edition CD',
      priceText: '¥251',
      cover: '//g-search2.alicdn.com/img/bao/uploaded/i4/x.jpg_360x360q90.jpg_.webp',
      link: '//item.taobao.com/item.htm?id=657684166583&ns=1&xxc=taobaoSearch'
    })
  })
})

/** Image-search result-tab URL (matched by waitForResultPage / same-tab fallback). */
const RESULT_TAB_URL = 'https://s.taobao.com/search?ie=utf8&search_type=item&tab=all&localImgKey=localImgSearchKey1_1'

const RESULT_GRID_HTML = `
  <a href="//item.taobao.com/item.htm?id=333&ns=1&xxc=taobaoSearch">
    <img src="//g-search1.alicdn.com/img/a.jpg">
    <div class="title--a"><span>Taylor Swift 1989 CD</span></div>
    <div class="priceWrapper--a"><span class="unit--a">¥</span><div class="priceInt--a">45</div><div class="priceFloat--a">.00</div><span class="realSales--a">2人付款</span></div>
  </a>
  <a href="https://detail.tmall.com/item.htm?id=444">
    <div class="title--b"><span>Madonna Like a Prayer</span></div>
    <div class="priceWrapper--b"><div class="priceInt--b">1,200</div></div>
  </a>
  <a href="//item.taobao.com/item.htm?id=555">
    <div class="title--c"><span>Justin Bieber Justice</span></div>
    <div class="priceWrapper--c"><div class="priceInt--c">251</div><span class="realSales--c">3人付款</span></div>
  </a>
`

const READY_OVERLAY_HTML = '<div id="image-search-upload-button">搜索</div>'

/**
 * Fake real-Chrome page: DOM-backed evaluate, scriptable cookies, file input
 * and the overlay's search button. `browser()` backs the result-tab wait; by
 * default it never resolves so the same-tab fallback path drives the flow.
 */
function fakeChromePage(options: {
  html?: string
  cookies?: LoginCookie[]
  fileInput?: { uploadFile: ReturnType<typeof vi.fn> } | null
  url?: string
  waitForSelector?: 'input' | 'error'
}) {
  const {
    html = READY_OVERLAY_HTML + RESULT_GRID_HTML,
    cookies = [cookie({ domain: '.taobao.com' })],
    fileInput = null,
    url = RESULT_TAB_URL,
    waitForSelector = 'input'
  } = options
  const uploadFile = fileInput?.uploadFile ?? vi.fn()
  const inputHandle = fileInput ? { uploadFile } : null
  const buttonHandle = { click: vi.fn().mockResolvedValue(undefined) }
  const browser = { waitForTarget: vi.fn(() => new Promise(() => {})) }
  const page = {
    cookies: vi.fn().mockResolvedValue(cookies),
    setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(undefined),
    waitForFunction: vi.fn().mockResolvedValue(undefined),
    waitForSelector:
      waitForSelector === 'error'
        ? vi.fn().mockRejectedValue(new Error('timeout'))
        : vi.fn().mockResolvedValue(inputHandle),
    url: vi.fn().mockReturnValue(url),
    $: vi.fn().mockImplementation((selector: string) =>
      Promise.resolve(selector === '#image-search-upload-button' ? buttonHandle : null)),
    evaluate: async (fn: (arg?: unknown) => unknown, selectors?: unknown) => {
      document.body.innerHTML = html
      return fn(selectors)
    },
    close: vi.fn().mockResolvedValue(undefined),
    browser: vi.fn(() => browser)
  }
  return { page, browser, uploadFile, buttonHandle }
}

/**
 * Drive the fake clock while a query runs. The query's fs writes complete on
 * the real event loop, so timers must be advanced repeatedly alongside it — a
 * single runAllTimersAsync would return before the first timer is scheduled.
 */
async function runWithFakeClock(pending: Promise<unknown>, advanceMs = 1000, maxTicks = 100): Promise<void> {
  let done = false
  const advancing = (async () => {
    for (let tick = 0; tick < maxTicks && !done; tick++) {
      await vi.advanceTimersByTimeAsync(advanceMs)
    }
  })()
  await pending
  done = true
  await advancing
}

const loggedInCookies = (domain: string): LoginCookie[] => [cookie({ domain })]

describe('queryXianyu web flow', () => {
  beforeEach(() => {
    mockAcquireCloudflarePage.mockReset()
  })

  it('reports login-required when no real-Chrome session exists', async () => {
    mockAcquireCloudflarePage.mockResolvedValue(null)
    const result = await queryXianyu('XY-1')
    expect(result.status).toBe('challenge')
    expect(result.error).toContain('扫码登录')
  })

  it('reports login-required when the goofish session cookie is missing', async () => {
    const release = vi.fn()
    const { page } = fakeChromePage({ cookies: [], html: '<a href="/item?id=1"><div>x ¥1</div></a>' })
    mockAcquireCloudflarePage.mockResolvedValue({ page: page as unknown as Page, release })
    const result = await queryXianyu('XY-2')
    expect(result.status).toBe('challenge')
    expect(release).toHaveBeenCalled()
  })

  it('scrapes the first listing and uses its price as the fixed channel price', async () => {
    const release = vi.fn()
    const { page } = fakeChromePage({
      cookies: loggedInCookies('.goofish.com'),
      html: `
        <a href="/item?id=111"><div><img src="//img.goofish.com/a.jpg"><span>Beatles Abbey Road 日版</span><span>¥88.00</span></div></a>
        <a href="/item?id=222"><div><span>Nirvana Nevermind</span><span>￥1,234</span></div></a>
      `
    })
    mockAcquireCloudflarePage.mockResolvedValue({ page: page as unknown as Page, release })

    const result = await queryXianyu('XY-3')
    expect(result).toMatchObject({
      platform: 'xianyu',
      status: 'found',
      name: 'Beatles Abbey Road 日版',
      priceMin: 12.32,
      priceMax: 12.32,
      coverUrl: 'https://img.goofish.com/a.jpg',
      link: 'https://www.goofish.com/item?id=111'
    })
    // Login must be checked against the platform's own cookie jar scope, not
    // whatever URL the shared page currently sits on.
    expect(page.cookies).toHaveBeenCalledWith('https://www.goofish.com/')
    expect(release).toHaveBeenCalled()
  })

  it('takes the real cover from data-src when the visible src is still a lazy-load placeholder', async () => {
    const release = vi.fn()
    const { page } = fakeChromePage({
      cookies: loggedInCookies('.goofish.com'),
      html: `
        <a href="/item?id=111"><div><img src="data:image/svg+xml,gray" data-src="//img.alicdn.com/imgextra/a.jpg"><span>Beatles Abbey Road 日版</span><span>¥88.00</span></div></a>
      `
    })
    mockAcquireCloudflarePage.mockResolvedValue({ page: page as unknown as Page, release })

    const result = await queryXianyu('XY-4')
    expect(result).toMatchObject({
      platform: 'xianyu',
      status: 'found',
      coverUrl: 'https://img.alicdn.com/imgextra/a.jpg'
    })
    // The bounded hydration wait must be attempted once results are visible.
    expect(page.waitForFunction).toHaveBeenCalled()
    expect(release).toHaveBeenCalled()
  })
})

describe('queryTaobaoImage web flow', () => {
  beforeEach(() => {
    mockAcquireCloudflarePage.mockReset()
  })

  it('reports login-required when the taobao session cookie is missing', async () => {
    const release = vi.fn()
    const { page } = fakeChromePage({ cookies: [] })
    mockAcquireCloudflarePage.mockResolvedValue({ page: page as unknown as Page, release })
    const result = await queryTaobaoImage('TB-LOGIN', { buffer: Buffer.from('x'), mimeType: 'image/jpeg' })
    expect(result.status).toBe('challenge')
    expect(release).toHaveBeenCalled()
  })

  it('uploads the cover, clicks the ready 搜索 button and scrapes the result tab', async () => {
    const release = vi.fn()
    const uploadFile = vi.fn().mockResolvedValue(undefined)
    const { page, buttonHandle } = fakeChromePage({ cookies: loggedInCookies('.taobao.com'), fileInput: { uploadFile } })
    mockAcquireCloudflarePage.mockResolvedValue({ page: page as unknown as Page, release })

    const result = await queryTaobaoImage('TB-FOUND', { buffer: Buffer.from('jpeg-bytes'), mimeType: 'image/jpeg' })

    expect(page.cookies).toHaveBeenCalledWith('https://www.taobao.com/')
    expect(uploadFile).toHaveBeenCalledTimes(1)
    const [uploadedPath] = uploadFile.mock.calls[0] as [string]
    expect(uploadedPath).toMatch(/super-cd-search-upload-\d+\.jpg$/)
    expect(buttonHandle.click).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      platform: 'taobao',
      status: 'found',
      name: 'Taylor Swift 1989 CD',
      priceMin: 6.3,
      priceMax: 6.3,
      coverUrl: 'https://g-search1.alicdn.com/img/a.jpg',
      link: 'https://item.taobao.com/item.htm?id=333&ns=1&xxc=taobaoSearch'
    })
    // The shared scrape page itself never becomes the result tab, so it must
    // never be closed; the structured price nodes keep "¥251"+"3人付款" out.
    expect(page.close).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalled()
  })

  it('scrapes the popup result tab and closes it afterwards', async () => {
    const release = vi.fn()
    const uploadFile = vi.fn().mockResolvedValue(undefined)
    const popupPage = {
      waitForSelector: vi.fn().mockResolvedValue(null),
      evaluate: async (fn: (selectors: string) => unknown, selectors: string) => {
        document.body.innerHTML = RESULT_GRID_HTML
        return fn(selectors)
      },
      url: vi.fn().mockReturnValue(RESULT_TAB_URL),
      close: vi.fn().mockResolvedValue(undefined)
    }
    const target = { page: vi.fn(async () => popupPage) }
    const { page, browser } = fakeChromePage({
      cookies: loggedInCookies('.taobao.com'),
      fileInput: { uploadFile }
    })
    browser.waitForTarget.mockResolvedValue(target)
    mockAcquireCloudflarePage.mockResolvedValue({ page: page as unknown as Page, release })

    const result = await queryTaobaoImage('TB-POPUP', { buffer: Buffer.from('jpeg-bytes'), mimeType: 'image/jpeg' })

    expect(browser.waitForTarget).toHaveBeenCalled()
    expect(result).toMatchObject({ platform: 'taobao', status: 'found', name: 'Taylor Swift 1989 CD' })
    expect(popupPage.close).toHaveBeenCalled()
    expect(page.close).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalled()
  })

  it('re-feeds the image and reports an error when the search button never becomes ready', async () => {
    vi.useFakeTimers()
    try {
      const release = vi.fn()
      const uploadFile = vi.fn().mockResolvedValue(undefined)
      const { page, buttonHandle } = fakeChromePage({
        cookies: loggedInCookies('.taobao.com'),
        fileInput: { uploadFile },
        html: '<div id="image-search-upload-button">上传图片</div>'
      })
      mockAcquireCloudflarePage.mockResolvedValue({ page: page as unknown as Page, release })

      const pending = queryTaobaoImage('TB-STUCK', { buffer: Buffer.from('x'), mimeType: 'image/jpeg' })
      await runWithFakeClock(pending)
      const result = await pending

      expect(uploadFile).toHaveBeenCalledTimes(3)
      expect(result.status).toBe('error')
      expect(result.error).toContain('上传未完成')
      expect(buttonHandle.click).not.toHaveBeenCalled()
      expect(release).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports an error when the result tab never opens', async () => {
    vi.useFakeTimers()
    try {
      const release = vi.fn()
      const uploadFile = vi.fn().mockResolvedValue(undefined)
      const { page } = fakeChromePage({
        cookies: loggedInCookies('.taobao.com'),
        fileInput: { uploadFile },
        url: 'https://www.taobao.com/'
      })
      mockAcquireCloudflarePage.mockResolvedValue({ page: page as unknown as Page, release })

      const pending = queryTaobaoImage('TB-NOTAB', { buffer: Buffer.from('x'), mimeType: 'image/jpeg' })
      await runWithFakeClock(pending)
      const result = await pending

      expect(result.status).toBe('error')
      expect(result.error).toContain('结果页未打开')
      expect(release).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns a query error when no upload input can be found', async () => {
    const release = vi.fn()
    const { page } = fakeChromePage({ cookies: loggedInCookies('.taobao.com'), waitForSelector: 'error' })
    mockAcquireCloudflarePage.mockResolvedValue({ page: page as unknown as Page, release })
    const result = await queryTaobaoImage('TB-NOINPUT', { buffer: Buffer.from('x'), mimeType: 'image/jpeg' })
    expect(result.status).toBe('error')
    expect(result.error).toContain('图片上传入口')
    expect(release).toHaveBeenCalled()
  })
})
