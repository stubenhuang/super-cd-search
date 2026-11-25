import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FeishuSettings } from '../src/shared/types'
import { FEISHU_FIELD_TYPE_ATTACHMENT, FEISHU_FIELD_TYPE_TEXT } from '../src/shared/feishu'

const { mockDownloadImage, mockUploadMedia } = vi.hoisted(() => ({
  mockDownloadImage: vi.fn(),
  mockUploadMedia: vi.fn()
}))

// The real image module imports electron; mock it so this file stays a pure
// unit test of the upload orchestration.
vi.mock('../src/main/image/index', () => ({
  downloadImage: mockDownloadImage,
  extForMimeType: (mimeType: string) => mimeType.includes('png') ? 'png' : 'jpg'
}))

vi.mock('../src/main/feishu/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/feishu/client')>()
  return { ...actual, uploadMedia: mockUploadMedia }
})

import { FeishuClientError } from '../src/main/feishu/client'
import {
  applyImageDecision,
  createImageSyncContext,
  decideImageValue,
  resetFeishuMediaState
} from '../src/main/feishu/media'

const SETTINGS: FeishuSettings = {
  enabled: true,
  appId: 'cli_a1',
  appSecret: 'secret',
  appToken: 'appTOKEN',
  tableId: 'tblXYZ',
  mappingTableId: '',
  syncImages: true
}

const COVER = 'https://img.example/a.jpg'
const JPEG_BYTES = 'fake-jpeg-bytes'

beforeEach(() => {
  vi.resetAllMocks()
  resetFeishuMediaState()
  mockDownloadImage.mockResolvedValue({
    base64: Buffer.from(JPEG_BYTES).toString('base64'),
    mimeType: 'image/jpeg'
  })
  mockUploadMedia.mockResolvedValue('boxcnTOKEN')
})

describe('applyImageDecision', () => {
  it('is pure and leaves the input untouched', () => {
    const fields = { 编号: 'X-1', coverUrl: COVER }
    expect(applyImageDecision(fields, 'coverUrl', { action: 'keep-url' }))
      .toEqual({ 编号: 'X-1', coverUrl: COVER })
    expect(fields.coverUrl).toBe(COVER)
  })

  it('replaces the column with a file_token list', () => {
    expect(applyImageDecision({ 编号: 'X-1', coverUrl: COVER }, 'coverUrl', {
      action: 'write-attachment', value: [{ file_token: 'tok' }]
    })).toEqual({ 编号: 'X-1', coverUrl: [{ file_token: 'tok' }] })
  })

  it('omits the column entirely', () => {
    expect(applyImageDecision({ 编号: 'X-1', coverUrl: COVER }, 'coverUrl', { action: 'omit' }))
      .toEqual({ 编号: 'X-1' })
  })
})

describe('createImageSyncContext', () => {
  it('defaults to a bounded upload budget', () => {
    const ctx = createImageSyncContext(SETTINGS)
    expect(ctx.settings).toBe(SETTINGS)
    expect(ctx.uploads).toBe(0)
    expect(ctx.maxUploads).toBeGreaterThan(0)
  })
})

describe('decideImageValue', () => {
  it('keeps the URL and downloads nothing while the column is still text', async () => {
    const ctx = createImageSyncContext(SETTINGS)
    const decision = await decideImageValue(ctx, COVER, 'coverUrl', FEISHU_FIELD_TYPE_TEXT)
    expect(decision).toEqual({ action: 'keep-url' })
    expect(mockDownloadImage).not.toHaveBeenCalled()
    expect(mockUploadMedia).not.toHaveBeenCalled()
  })

  it('keeps the URL when the field type is unknown', async () => {
    const ctx = createImageSyncContext(SETTINGS)
    expect(await decideImageValue(ctx, COVER, 'coverUrl', undefined)).toEqual({ action: 'keep-url' })
    expect(mockDownloadImage).not.toHaveBeenCalled()
  })

  it('does not download or upload anything when image sync is off', async () => {
    const ctx = createImageSyncContext({ ...SETTINGS, syncImages: false })
    expect(await decideImageValue(ctx, COVER, 'coverUrl', FEISHU_FIELD_TYPE_ATTACHMENT))
      .toEqual({ action: 'omit' })
    expect(mockDownloadImage).not.toHaveBeenCalled()
    expect(mockUploadMedia).not.toHaveBeenCalled()
  })

  it('skips an empty URL', async () => {
    const ctx = createImageSyncContext(SETTINGS)
    expect(await decideImageValue(ctx, '   ', 'coverUrl', FEISHU_FIELD_TYPE_ATTACHMENT))
      .toEqual({ action: 'omit' })
    expect(mockDownloadImage).not.toHaveBeenCalled()
  })

  it('downloads a private-network-safe thumbnail and uploads it to the Bitable app', async () => {
    const ctx = createImageSyncContext(SETTINGS)
    const decision = await decideImageValue(ctx, COVER, 'coverUrl', FEISHU_FIELD_TYPE_ATTACHMENT)

    expect(decision).toEqual({ action: 'write-attachment', value: [{ file_token: 'boxcnTOKEN' }] })
    expect(mockDownloadImage).toHaveBeenCalledWith(COVER, 800, false)
    expect(ctx.uploads).toBe(1)

    const [settings, params] = mockUploadMedia.mock.calls[0] as unknown as [
      FeishuSettings,
      { fileName: string; bytes: Buffer; mimeType: string; parentNode: string; extra: string }
    ]
    expect(settings).toBe(SETTINGS)
    expect(params.fileName).toMatch(/^cover_[0-9a-f]{16}\.jpg$/)
    expect(Buffer.from(params.bytes).toString()).toBe(JPEG_BYTES)
    expect(params.mimeType).toBe('image/jpeg')
    expect(params.parentNode).toBe('appTOKEN')
    expect(params.extra).toBe(JSON.stringify({ drive_route_token: 'appTOKEN' }))
  })

  it('never throws when the cover download returns nothing', async () => {
    mockDownloadImage.mockResolvedValue(null)
    const ctx = createImageSyncContext(SETTINGS)
    expect(await decideImageValue(ctx, COVER, 'coverUrl', FEISHU_FIELD_TYPE_ATTACHMENT))
      .toEqual({ action: 'omit' })
    expect(mockUploadMedia).not.toHaveBeenCalled()
  })

  it('never throws when the download rejects', async () => {
    mockDownloadImage.mockRejectedValue(new Error('ECONNRESET'))
    const ctx = createImageSyncContext(SETTINGS)
    expect(await decideImageValue(ctx, COVER, 'coverUrl', FEISHU_FIELD_TYPE_ATTACHMENT))
      .toEqual({ action: 'omit' })
    expect(mockUploadMedia).not.toHaveBeenCalled()
  })

  it('never throws when the upload fails with a non-retryable error', async () => {
    mockUploadMedia.mockRejectedValue(new Error('403 forbidden'))
    const ctx = createImageSyncContext(SETTINGS)
    expect(await decideImageValue(ctx, COVER, 'coverUrl', FEISHU_FIELD_TYPE_ATTACHMENT))
      .toEqual({ action: 'omit' })
    expect(mockUploadMedia).toHaveBeenCalledTimes(1)
  })

  it('retries the 1061045 concurrent-upload error', async () => {
    mockUploadMedia
      .mockRejectedValueOnce(new FeishuClientError('busy', 'api', { apiCode: 1061045 }))
      .mockRejectedValueOnce(new FeishuClientError('busy', 'api', { apiCode: 1061045 }))
      .mockResolvedValueOnce('boxcnRETRY')
    const ctx = createImageSyncContext(SETTINGS)
    expect(await decideImageValue(ctx, COVER, 'coverUrl', FEISHU_FIELD_TYPE_ATTACHMENT))
      .toEqual({ action: 'write-attachment', value: [{ file_token: 'boxcnRETRY' }] })
    expect(mockUploadMedia).toHaveBeenCalledTimes(3)
  })

  it('shares one file_token across repeated URLs and tables', async () => {
    const ctx = createImageSyncContext(SETTINGS)
    const first = await decideImageValue(ctx, COVER, 'coverUrl', FEISHU_FIELD_TYPE_ATTACHMENT)
    const second = await decideImageValue(ctx, COVER, 'cover_image', FEISHU_FIELD_TYPE_ATTACHMENT)

    expect(first).toEqual({ action: 'write-attachment', value: [{ file_token: 'boxcnTOKEN' }] })
    expect(second).toEqual({ action: 'write-attachment', value: [{ file_token: 'boxcnTOKEN' }] })
    expect(mockDownloadImage).toHaveBeenCalledTimes(1)
    expect(mockUploadMedia).toHaveBeenCalledTimes(1)
    expect(ctx.uploads).toBe(1)
  })

  it('stops uploading after the per-batch cap', async () => {
    const ctx = createImageSyncContext(SETTINGS, 1)
    const first = await decideImageValue(ctx, COVER, 'coverUrl', FEISHU_FIELD_TYPE_ATTACHMENT)
    const second = await decideImageValue(ctx, 'https://img.example/b.jpg', 'coverUrl', FEISHU_FIELD_TYPE_ATTACHMENT)

    expect(first.action).toBe('write-attachment')
    expect(second).toEqual({ action: 'omit' })
    expect(mockUploadMedia).toHaveBeenCalledTimes(1)
  })

  it('uses a png filename for a png download', async () => {
    mockDownloadImage.mockResolvedValue({
      base64: Buffer.from('png-bytes').toString('base64'),
      mimeType: 'image/png'
    })
    const ctx = createImageSyncContext(SETTINGS)
    await decideImageValue(ctx, COVER, 'coverUrl', FEISHU_FIELD_TYPE_ATTACHMENT)
    const params = mockUploadMedia.mock.calls[0][1] as { fileName: string; mimeType: string }
    expect(params.fileName).toMatch(/\.png$/)
    expect(params.mimeType).toBe('image/png')
  })
})
