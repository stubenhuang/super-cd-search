import { describe, it, expect, vi } from 'vitest'
import { isCloudflareChallenge } from '../src/main/cloudflare/detect'
import { createDomEvaluate } from './helpers/dom-evaluate'

describe('isCloudflareChallenge', () => {
  it('detects the Cloudflare "Just a moment" managed challenge page', async () => {
    const page = {
      evaluate: createDomEvaluate(['<html><head><title>Just a moment...</title></head><body>Enable JavaScript and cookies to continue</body></html>'])
    }
    expect(await isCloudflareChallenge(page as never)).toBe(true)
  })

  it('detects the "Verifying you are human" challenge text', async () => {
    const page = {
      evaluate: createDomEvaluate(['<html><head><title>Just a moment...</title></head><body>Verifying you are human. This may take a few seconds.</body></html>'])
    }
    expect(await isCloudflareChallenge(page as never)).toBe(true)
  })

  it('returns false for a normal product page', async () => {
    const page = {
      evaluate: createDomEvaluate(['<html><head><title>Product</title></head><body>Some product</body></html>'])
    }
    expect(await isCloudflareChallenge(page as never)).toBe(false)
  })

  it('treats an evaluate failure as not-a-challenge', async () => {
    const page = { evaluate: vi.fn().mockRejectedValue(new Error('boom')) }
    expect(await isCloudflareChallenge(page as never)).toBe(false)
  })
})
