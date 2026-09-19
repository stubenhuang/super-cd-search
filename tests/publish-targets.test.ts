import { describe, it, expect, beforeEach } from 'vitest'
import {
  normalizePublishTarget,
  listPublishTargets,
  listEnabledPublishTargets,
  getPublishTarget,
  patchPublishTarget,
  resolveDiscogsToken
} from '../src/main/publish/targets'
import { setSetting, getSetting } from '../src/main/settings'
import { XIANYU_CONDITIONS, type PublishTarget } from '../src/shared/publish'

function rawTarget(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 't-1', platform: 'xianyu', name: '闲鱼小店', account: 'me', ...overrides }
}

beforeEach(() => {
  // The mocked electron-store is a module-level singleton: every test starts
  // from a clean publish/token configuration.
  setSetting('publishTargets', [])
  setSetting('discogsToken', '')
})

describe('normalizePublishTarget', () => {
  it('rejects non-objects and unknown platforms', () => {
    expect(normalizePublishTarget(null)).toBeNull()
    expect(normalizePublishTarget(undefined)).toBeNull()
    expect(normalizePublishTarget('xianyu')).toBeNull()
    expect(normalizePublishTarget(42)).toBeNull()
    expect(normalizePublishTarget([])).toBeNull()
    expect(normalizePublishTarget({ platform: 'ebay', name: 'x' })).toBeNull()
    expect(normalizePublishTarget({ name: 'no platform' })).toBeNull()
  })

  it('falls back to the platform default name when name is missing or blank', () => {
    expect(normalizePublishTarget(rawTarget({ name: undefined }))?.name).toBe('闲鱼')
    expect(normalizePublishTarget(rawTarget({ name: '   ' }))?.name).toBe('闲鱼')
    expect(normalizePublishTarget({ platform: 'discogs', account: '' })?.name).toBe('Discogs')
    expect(normalizePublishTarget(rawTarget({ name: '  自定义  ' }))?.name).toBe('自定义')
  })

  it('generates an id when missing and trims supplied account/id', () => {
    const generated = normalizePublishTarget(rawTarget({ id: undefined }))
    expect(generated?.id).toBeTruthy()
    expect(generated?.id).not.toBe('')

    const trimmed = normalizePublishTarget(rawTarget({ id: '  t-9 ', account: '  seller  ' }))
    expect(trimmed?.id).toBe('t-9')
    expect(trimmed?.account).toBe('seller')
  })

  it('treats enabled as "not explicitly false"', () => {
    expect(normalizePublishTarget(rawTarget())?.enabled).toBe(true)
    expect(normalizePublishTarget(rawTarget({ enabled: false }))?.enabled).toBe(false)
    expect(normalizePublishTarget(rawTarget({ enabled: 0 }))?.enabled).toBe(true)
    expect(normalizePublishTarget(rawTarget({ enabled: 'no' }))?.enabled).toBe(true)
  })

  it('falls back to the current time for an unparsable createdAt', () => {
    const before = Date.now()
    const normalized = normalizePublishTarget(rawTarget({ createdAt: 'not-a-date' }))
    const after = Date.now()
    expect(normalized!.createdAt).toBeGreaterThanOrEqual(before)
    expect(normalized!.createdAt).toBeLessThanOrEqual(after)

    expect(normalizePublishTarget(rawTarget({ createdAt: '123' }))?.createdAt).toBe(123)
    expect(normalizePublishTarget(rawTarget({ createdAt: 456 }))?.createdAt).toBe(456)
  })

  it('keeps valid Discogs enums and drops unknown values', () => {
    const kept = normalizePublishTarget({
      platform: 'discogs',
      currency: 'CNY',
      condition: 'Very Good (VG)',
      sleeveCondition: 'Generic',
      status: 'Draft',
      allowOffers: true,
      location: '  上海  ',
      weight: '180',
      formatQuantity: 2,
      token: '  tok-1  '
    })
    expect(kept).toMatchObject({
      platform: 'discogs',
      currency: 'CNY',
      condition: 'Very Good (VG)',
      sleeveCondition: 'Generic',
      status: 'Draft',
      allowOffers: true,
      location: '上海',
      weight: 180,
      formatQuantity: 2,
      token: 'tok-1'
    })

    const dropped = normalizePublishTarget({
      platform: 'discogs',
      currency: 'XYZ',
      condition: 'Mint',
      sleeveCondition: 'Mint Box',
      status: 'Sold',
      allowOffers: 'yes',
      location: '   ',
      token: '   '
    })
    expect(dropped?.currency).toBeUndefined()
    expect(dropped?.condition).toBeUndefined()
    expect(dropped?.sleeveCondition).toBeUndefined()
    expect(dropped?.status).toBeUndefined()
    expect(dropped?.allowOffers).toBeUndefined()
    expect(dropped?.location).toBeUndefined()
    expect(dropped?.token).toBeUndefined()
  })

  it('normalizes Discogs numeric fields and keeps explicit false for allowOffers', () => {
    expect(normalizePublishTarget({ platform: 'discogs', weight: '' })?.weight).toBeNull()
    expect(normalizePublishTarget({ platform: 'discogs', weight: 'abc' })?.weight).toBeNull()
    expect(normalizePublishTarget({ platform: 'discogs' })?.weight).toBeNull()
    expect(normalizePublishTarget({ platform: 'discogs', formatQuantity: null })?.formatQuantity).toBeNull()
    expect(normalizePublishTarget({ platform: 'discogs', allowOffers: false })?.allowOffers).toBe(false)
    expect(normalizePublishTarget({ platform: 'discogs', status: 'For Sale' })?.status).toBe('For Sale')
  })

  it('falls back to the first 闲鱼 condition and keeps valid ones', () => {
    expect(normalizePublishTarget(rawTarget({ xianyuCondition: '全新' }))?.xianyuCondition).toBe('全新')
    expect(normalizePublishTarget(rawTarget({ xianyuCondition: '几乎全新' }))?.xianyuCondition).toBe('几乎全新')
    expect(normalizePublishTarget(rawTarget({ xianyuCondition: '全新未拆' }))?.xianyuCondition).toBe(
      XIANYU_CONDITIONS[0]
    )
    expect(normalizePublishTarget(rawTarget())?.xianyuCondition).toBe(XIANYU_CONDITIONS[0])
  })

  it('treats uploadCover as "not explicitly false"', () => {
    expect(normalizePublishTarget(rawTarget())?.uploadCover).toBe(true)
    expect(normalizePublishTarget(rawTarget({ uploadCover: false }))?.uploadCover).toBe(false)
    expect(normalizePublishTarget(rawTarget({ uploadCover: 0 }))?.uploadCover).toBe(true)
  })

  it('does not attach Discogs-only fields to a 闲鱼 target', () => {
    const target = normalizePublishTarget(rawTarget({ currency: 'CNY', condition: 'Mint (M)', token: 'tok' }))
    expect(target?.currency).toBeUndefined()
    expect(target?.condition).toBeUndefined()
    expect(target?.token).toBeUndefined()
  })

  it('keeps the detected 闲鱼 account and login timestamp', () => {
    const kept = normalizePublishTarget(rawTarget({ account: '  闲鱼小铺  ', xianyuLoginAt: '1700000000000' }))
    expect(kept?.account).toBe('闲鱼小铺')
    expect(kept?.xianyuLoginAt).toBe(1700000000000)

    const blank = normalizePublishTarget(rawTarget({ account: '   ', xianyuLoginAt: 'not-a-number' }))
    expect(blank?.account).toBe('')
    expect(blank?.xianyuLoginAt).toBeUndefined()
  })

  it('never attaches 闲鱼 login fields to a Discogs target and ignores the removed xianyuAccount', () => {
    const target = normalizePublishTarget({
      platform: 'discogs',
      account: 'seller',
      xianyuAccount: 'nope',
      xianyuLoginAt: 123
    })
    expect(target?.account).toBe('seller')
    expect(target?.xianyuLoginAt).toBeUndefined()
    expect(target).not.toHaveProperty('xianyuAccount')
  })
})

describe('listPublishTargets / listEnabledPublishTargets / getPublishTarget', () => {
  it('returns an empty list when nothing is configured', () => {
    expect(listPublishTargets()).toEqual([])
    expect(listEnabledPublishTargets()).toEqual([])
    expect(getPublishTarget('missing')).toBeNull()
  })

  it('cleans dirty stored entries and keeps valid ones', () => {
    const valid: PublishTarget = {
      id: 'valid-1',
      platform: 'discogs',
      name: '我的 Discogs',
      account: 'seller',
      enabled: true,
      createdAt: 111
    }
    setSetting('publishTargets', [
      null,
      'oops',
      { platform: 'ebay', name: 'nope' },
      valid,
      rawTarget({ id: 'xy-1', enabled: false })
    ] as never)

    const list = listPublishTargets()
    expect(list).toHaveLength(2)
    expect(list.map(target => target.id)).toEqual(['valid-1', 'xy-1'])
    expect(listEnabledPublishTargets().map(target => target.id)).toEqual(['valid-1'])
    expect(getPublishTarget('xy-1')?.name).toBe('闲鱼小店')
    expect(getPublishTarget('nope')).toBeNull()
  })

  it('returns an empty array when the stored value is not an array', () => {
    setSetting('publishTargets', 'oops' as never)
    expect(getSetting('publishTargets')).toBe('oops')
    expect(listPublishTargets()).toEqual([])
    expect(listEnabledPublishTargets()).toEqual([])
    expect(getPublishTarget('anything')).toBeNull()
  })
})

describe('patchPublishTarget', () => {
  it('patches one field and preserves every other field', () => {
    setSetting('publishTargets', [rawTarget()])

    const patched = patchPublishTarget('t-1', { account: '闲鱼小铺' })

    expect(patched).toMatchObject({
      id: 't-1',
      platform: 'xianyu',
      name: '闲鱼小店',
      account: '闲鱼小铺',
      enabled: true
    })
    const stored = getPublishTarget('t-1')!
    expect(stored.account).toBe('闲鱼小铺')
    expect(stored.name).toBe('闲鱼小店')
    expect(stored.xianyuCondition).toBe(XIANYU_CONDITIONS[0])
    expect(stored.uploadCover).toBe(true)
  })

  it('persists both the detected account and the login timestamp', () => {
    setSetting('publishTargets', [rawTarget()])

    const patched = patchPublishTarget('t-1', { account: 'nick', xianyuLoginAt: 123456 })

    expect(patched?.account).toBe('nick')
    expect(patched?.xianyuLoginAt).toBe(123456)
    expect(getPublishTarget('t-1')?.account).toBe('nick')
    expect(getPublishTarget('t-1')?.xianyuLoginAt).toBe(123456)
  })

  it('returns null and leaves the store untouched for an unknown id', () => {
    setSetting('publishTargets', [rawTarget()])

    expect(patchPublishTarget('missing', { account: 'x' })).toBeNull()
    expect(getPublishTarget('t-1')?.account).toBe('me')
    expect(listPublishTargets()).toHaveLength(1)
  })

  it('normalizes an invalid patched value instead of storing it raw', () => {
    setSetting('publishTargets', [rawTarget()])

    const patched = patchPublishTarget('t-1', { xianyuCondition: '不存在的成色' as never })

    expect(patched?.xianyuCondition).toBe(XIANYU_CONDITIONS[0])
    expect(getPublishTarget('t-1')?.xianyuCondition).toBe(XIANYU_CONDITIONS[0])
  })

  it('returns null and keeps the stored target when the patch invalidates it', () => {
    setSetting('publishTargets', [rawTarget()])

    expect(patchPublishTarget('t-1', { platform: 'ebay' as never })).toBeNull()
    expect(getPublishTarget('t-1')?.platform).toBe('xianyu')
  })

  it('patches a Discogs target without dropping its platform defaults', () => {
    setSetting('publishTargets', [
      { id: 'd-1', platform: 'discogs', name: 'D', account: 'seller', token: 'tok', currency: 'CNY' }
    ])

    const patched = patchPublishTarget('d-1', { account: '  new-seller  ' })

    expect(patched?.account).toBe('new-seller')
    expect(patched?.token).toBe('tok')
    expect(patched?.currency).toBe('CNY')
  })
})

describe('resolveDiscogsToken', () => {
  it('prefers the per-target token over the global one', () => {
    setSetting('discogsToken', 'global-token')
    const target = normalizePublishTarget({ platform: 'discogs', token: '  target-token  ' })!
    expect(resolveDiscogsToken(target)).toBe('target-token')
  })

  it('falls back to the global discogsToken', () => {
    setSetting('discogsToken', '  global-token  ')
    const target = normalizePublishTarget({ platform: 'discogs' })!
    expect(resolveDiscogsToken(target)).toBe('global-token')
  })

  it('returns an empty string when neither token is configured', () => {
    setSetting('discogsToken', '')
    const target = normalizePublishTarget({ platform: 'discogs' })!
    expect(resolveDiscogsToken(target)).toBe('')
  })
})
