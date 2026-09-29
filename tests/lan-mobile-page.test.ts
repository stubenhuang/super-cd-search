import { describe, it, expect, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { MOBILE_APP_JS } from '../src/main/lan/mobile'

/**
 * The phone page is one big inline script (`MOBILE_APP_JS`), so TypeScript and
 * the renderer's `verify:ui` screenshots never execute it: an undefined
 * identifier in there is a silent runtime crash (the IIFE aborts and every
 * listener registered afterwards simply never exists). Running the real body
 * in a jsdom window is the only cheap way to keep that class of bug out.
 */

const ELEMENT_IDS = [
  'toast',
  'scan-btn',
  'file-input',
  'status',
  'search-input',
  'search-run',
  'search-status',
  'search-progress',
  'search-progress-fill',
  'search-progress-summary',
  'search-catalogs',
  'mode-standard',
  'mode-deep',
  'flow-dialog',
  'flow-dialog-title',
  'flow-dialog-body',
  'flow-dialog-actions'
]

function createFakeElement(id: string) {
  return {
    id,
    innerHTML: '',
    textContent: '',
    hidden: false,
    disabled: false,
    className: '',
    value: '',
    files: null,
    onclick: null,
    classList: {
      add: vi.fn(),
      remove: vi.fn(),
      toggle: vi.fn(),
      contains: vi.fn(() => false)
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setAttribute: vi.fn(),
    getAttribute: vi.fn(() => null),
    appendChild: vi.fn(),
    removeChild: vi.fn(),
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
    focus: vi.fn(),
    click: vi.fn()
  }
}

function runMobileAppJs() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test/' })
  const elements = new Map<string, ReturnType<typeof createFakeElement>>()

  for (const id of ELEMENT_IDS) {
    elements.set(id, createFakeElement(id))
  }

  const documentStub = {
    getElementById: (id: string) => elements.get(id) ?? null,
    addEventListener: vi.fn(),
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
    createElement: vi.fn(() => createFakeElement('created')),
    body: createFakeElement('body'),
    documentElement: createFakeElement('html'),
    hidden: false
  }

  const fetchStub = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ status: 'ok', state: { busy: false, searchMode: 'standard', phase: 'idle', catalogs: [] } })
  }))

  const run = new Function(
    'window',
    'document',
    'fetch',
    'navigator',
    'setInterval',
    'clearInterval',
    'setTimeout',
    'clearTimeout',
    'ZXingWasmReader',
    `"use strict";\n${MOBILE_APP_JS}`
  )

  const intervals: ReturnType<typeof setInterval>[] = []
  const timers: ReturnType<typeof setTimeout>[] = []
  const windowStub = {
    location: { href: 'https://example.test/' },
    isSecureContext: true
  }

  // The script body is wrapped in its own IIFE, so calling it as a function
  // body runs it exactly once, like the browser does with a <script> tag.
  run(
    windowStub,
    documentStub,
    fetchStub,
    { clipboard: { writeText: async () => undefined } },
    (fn: () => void, ms: number) => {
      const handle = setInterval(fn, ms)
      intervals.push(handle)
      return handle
    },
    (handle: ReturnType<typeof setInterval>) => clearInterval(handle),
    (fn: () => void, ms: number) => {
      const handle = setTimeout(fn, ms)
      timers.push(handle)
      return handle
    },
    (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
    { decodeBarcodeFile: async () => '4943674029365' }
  )

  return { documentStub, elements, fetchStub, intervals, timers }
}

describe('MOBILE_APP_JS', () => {
  it('runs to completion and registers the barcode scan listeners', () => {
    let context: ReturnType<typeof runMobileAppJs>
    // An undefined identifier anywhere in the IIFE aborts the whole script,
    // which used to leave the scan button and file input dead.
    expect(() => { context = runMobileAppJs() }).not.toThrow()

    expect(context!.elements.get('scan-btn')!.addEventListener).toHaveBeenCalledWith('click', expect.any(Function))
    expect(context!.elements.get('file-input')!.addEventListener).toHaveBeenCalledWith('change', expect.any(Function))
    expect(context!.elements.get('search-run')!.addEventListener).toHaveBeenCalledWith('click', expect.any(Function))
    // The mode buttons and the flow dialog actions are wired too.
    expect(context!.elements.get('mode-standard')!.addEventListener).toHaveBeenCalled()
    expect(context!.elements.get('mode-deep')!.addEventListener).toHaveBeenCalled()
  })

  it('starts the desktop-state poller and polls immediately once', () => {
    const context = runMobileAppJs()
    expect(context.intervals).toHaveLength(1)
    expect(context.fetchStub).toHaveBeenCalledTimes(1)
    expect(context.fetchStub.mock.calls[0]?.[0]).toBe('/api/search/state')
  })

  it('keeps polling while the page is visible and stops while it is hidden', () => {
    const context = runMobileAppJs()
    const poll = context.intervals[0] as unknown as { _onTimeout?: () => void }
    const tick = poll._onTimeout!
    context.fetchStub.mockClear()

    tick()
    expect(context.fetchStub).toHaveBeenCalledTimes(1)

    // Hidden page: the poller must be a no-op, exactly like the browser.
    context.documentStub.hidden = true
    tick()
    expect(context.fetchStub).toHaveBeenCalledTimes(1)
  })
})
