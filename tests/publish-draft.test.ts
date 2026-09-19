import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetSetting, mockSearchReleaseCandidates, mockConvertFromUSD } = vi.hoisted(() => ({
  mockGetSetting: vi.fn(),
  mockSearchReleaseCandidates: vi.fn(),
  mockConvertFromUSD: vi.fn()
}))

vi.mock('../src/main/settings', () => ({ getSetting: mockGetSetting }))
vi.mock('../src/main/publish/discogs', () => ({ searchReleaseCandidates: mockSearchReleaseCandidates }))
vi.mock('../src/main/currency', () => ({ convertFromUSD: mockConvertFromUSD }))

import {
  lowestUsdPrice,
  pickPrimaryResult,
  mergeDetails,
  buildTitle,
  buildDiscogsFields,
  buildXianyuFields,
  buildPublishDraft
} from '../src/main/publish/draft'
import type { CDDetails, QueryResult } from '../src/shared/types'
import type { PublishPrepareRequest, PublishReleaseCandidate, PublishTarget } from '../src/shared/publish'

function result(overrides: Partial<QueryResult> = {}): QueryResult {
  return {
    platform: 'discogs',
    name: null,
    artist: null,
    priceMin: null,
    priceMax: null,
    coverUrl: null,
    link: null,
    status: 'found',
    ...overrides
  }
}

function target(overrides: Partial<PublishTarget> = {}): PublishTarget {
  return {
    id: 't-1',
    platform: 'xianyu',
    name: '闲鱼小店',
    account: 'me',
    enabled: true,
    createdAt: 1,
    ...overrides
  }
}

function setTargets(...targets: PublishTarget[]): void {
  mockGetSetting.mockImplementation((key: string) => {
    if (key === 'publishTargets') return targets
    if (key === 'discogsToken') return ''
    return undefined
  })
}

function request(overrides: Partial<PublishPrepareRequest> = {}): PublishPrepareRequest {
  return {
    catalogNumber: 'SICP-6480',
    targetId: 't-1',
    results: [],
    descriptionText: '详情文本',
    ...overrides
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockConvertFromUSD.mockImplementation(async (amount: number) => amount)
  mockSearchReleaseCandidates.mockResolvedValue({ candidates: [], best: null })
})

describe('lowestUsdPrice', () => {
  it('returns null when no result was found', () => {
    expect(lowestUsdPrice([])).toBeNull()
    expect(lowestUsdPrice([result({ status: 'not_found' }), result({ status: 'error' })])).toBeNull()
  })

  it('ignores found results without a price', () => {
    expect(lowestUsdPrice([result({ priceMin: null, priceMax: null })])).toBeNull()
    expect(lowestUsdPrice([result({ priceMin: Number.NaN, priceMax: Number.POSITIVE_INFINITY })])).toBeNull()
  })

  it('returns the minimum across priceMin/priceMax of found results', () => {
    const results = [
      result({ priceMin: 30, priceMax: 40 }),
      result({ priceMin: 12.5, priceMax: null }),
      result({ status: 'not_found', priceMin: 1 })
    ]
    expect(lowestUsdPrice(results)).toBe(12.5)
  })

  it('mixes priceMin and priceMax when only one is present', () => {
    expect(lowestUsdPrice([result({ priceMin: null, priceMax: 8 })])).toBe(8)
    expect(lowestUsdPrice([result({ priceMin: 9, priceMax: null }), result({ priceMin: null, priceMax: 20 })])).toBe(9)
  })
})

describe('pickPrimaryResult', () => {
  it('prefers a found result that has a name', () => {
    const named = result({ name: 'Album' })
    const primary = pickPrimaryResult([result({ status: 'not_found', name: 'X' }), named])
    expect(primary).toBe(named)
  })

  it('falls back to the first found result without a name', () => {
    const found = result({ name: null })
    expect(pickPrimaryResult([result({ status: 'not_found', name: 'X' }), found])).toBe(found)
  })

  it('falls back to the very first result when nothing was found', () => {
    const first = result({ status: 'not_found', name: 'Only' })
    expect(pickPrimaryResult([first, result({ status: 'error' })])).toBe(first)
    expect(pickPrimaryResult([])).toBeUndefined()
  })
})

describe('mergeDetails', () => {
  it('uses aggregated details and fills gaps from the enriched details', () => {
    const results = [
      result({ details: { label: 'Label A', format: null, country: null, released: null, genre: null } })
    ]
    const enriched: CDDetails = {
      label: 'Label B',
      format: 'CD',
      country: 'Japan',
      released: null,
      genre: 'Rock'
    }
    const merged = mergeDetails(results, enriched)
    expect(merged).toEqual({
      label: 'Label A',
      format: 'CD',
      country: 'Japan',
      released: null,
      genre: 'Rock'
    })
  })

  it('trims enriched values and ignores blank ones', () => {
    const merged = mergeDetails([], {
      label: '  Label C  ',
      format: '   ',
      country: null,
      released: undefined as unknown as string,
      genre: '  Pop '
    })
    expect(merged.label).toBe('Label C')
    expect(merged.format).toBeNull()
    expect(merged.released).toBeNull()
    expect(merged.genre).toBe('Pop')
  })

  it('returns everything empty when there is nothing to merge', () => {
    expect(mergeDetails([], null)).toEqual({
      label: null,
      format: null,
      country: null,
      released: null,
      genre: null
    })
  })
})

describe('buildTitle', () => {
  it('joins artist and album with an em dash', () => {
    expect(buildTitle('X-1', [result({ artist: 'Artist', name: 'Album' })])).toBe('Artist — Album')
  })

  it('uses whichever part exists', () => {
    expect(buildTitle('X-1', [result({ name: 'Album', artist: null })])).toBe('Album')
    expect(buildTitle('X-1', [result({ name: null, artist: 'Artist' })])).toBe('Artist')
  })

  it('falls back to the catalog number when both are missing', () => {
    expect(buildTitle('X-1', [])).toBe('X-1')
    expect(buildTitle('X-1', [result({ name: '  ', artist: '  ' })])).toBe('X-1')
  })

  it('does not repeat the name when artist equals name', () => {
    expect(buildTitle('X-1', [result({ artist: 'Same', name: 'Same' })])).toBe('Same')
  })
})

describe('buildDiscogsFields', () => {
  const candidates: PublishReleaseCandidate[] = [
    { id: 11, title: 'Artist - Album', catno: 'OTHER', year: 2001, format: 'CD' },
    { id: 22, title: 'Artist - Album', catno: 'SICP-6480', year: 2005 }
  ]

  function field(fields: ReturnType<typeof buildDiscogsFields>, key: string) {
    const match = fields.find(item => item.key === key)
    if (!match) throw new Error(`missing field ${key}`)
    return match
  }

  it('builds the release select with the best candidate preselected', () => {
    const fields = buildDiscogsFields(target({ platform: 'discogs' }), 'SICP-6480', 'desc', candidates, candidates[1]!, 12.5)
    const release = field(fields, 'release')
    expect(release.kind).toBe('select')
    expect(release.value).toBe('22')
    expect(release.required).toBe(true)
    expect(release.options?.map(option => option.value)).toEqual(['11', '22'])
    expect(release.options?.[0]?.label).toBe('Artist - Album [OTHER] (2001)')
    expect(release.options?.[1]?.label).toBe('Artist - Album [SICP-6480] (2005)')
  })

  it('leaves the release empty when there is no candidate', () => {
    const fields = buildDiscogsFields(target({ platform: 'discogs' }), 'X-1', 'desc', [], null, null)
    expect(field(fields, 'release').value).toBe('')
    expect(field(fields, 'release').options).toEqual([])
  })

  it('uses target defaults and falls back for everything unset', () => {
    const fields = buildDiscogsFields(target({ platform: 'discogs' }), 'X-1', 'description text', candidates, null, 10)
    expect(field(fields, 'catalogNumber').value).toBe('X-1')
    expect(field(fields, 'condition').value).toBe('Very Good Plus (VG+)')
    expect(field(fields, 'condition').options).toHaveLength(8)
    const sleeve = field(fields, 'sleeveCondition')
    expect(sleeve.value).toBe('')
    expect(sleeve.options?.[0]).toEqual({ value: '', label: '—' })
    expect(sleeve.options?.some(option => option.value === 'No Cover')).toBe(true)
    expect(field(fields, 'price').value).toBe(10)
    expect(field(fields, 'currency').value).toBe('USD')
    expect(field(fields, 'status').value).toBe('For Sale')
    expect(field(fields, 'allowOffers').value).toBe(false)
    expect(field(fields, 'comments').value).toBe('description text')
    expect(field(fields, 'externalId').value).toBe('X-1')
    expect(field(fields, 'location').value).toBe('')
    expect(field(fields, 'weight').value).toBe('')
    expect(field(fields, 'formatQuantity').value).toBe('')
  })

  it('honours every configured target default', () => {
    const configured = target({
      platform: 'discogs',
      condition: 'Near Mint (NM or M-)',
      sleeveCondition: 'Generic',
      currency: 'EUR',
      status: 'Draft',
      allowOffers: true,
      location: '上海',
      weight: 180,
      formatQuantity: 2
    })
    const fields = buildDiscogsFields(configured, 'X-1', 'd', candidates, candidates[0]!, null)
    expect(field(fields, 'condition').value).toBe('Near Mint (NM or M-)')
    expect(field(fields, 'sleeveCondition').value).toBe('Generic')
    expect(field(fields, 'currency').value).toBe('EUR')
    expect(field(fields, 'status').value).toBe('Draft')
    expect(field(fields, 'allowOffers').value).toBe(true)
    expect(field(fields, 'location').value).toBe('上海')
    expect(field(fields, 'weight').value).toBe(180)
    expect(field(fields, 'formatQuantity').value).toBe(2)
    expect(field(fields, 'price').value).toBe('')
  })
})

describe('buildXianyuFields', () => {
  function field(fields: ReturnType<typeof buildXianyuFields>, key: string) {
    const match = fields.find(item => item.key === key)
    if (!match) throw new Error(`missing field ${key}`)
    return match
  }

  it('prefills title/price/condition/description/image from the results', () => {
    const results = [
      result({ status: 'not_found', coverUrl: 'https://cdn/other.jpg' }),
      result({ artist: 'Artist', name: 'Album', coverUrl: 'https://cdn/cover.jpg' })
    ]
    const fields = buildXianyuFields(target({ xianyuCondition: '轻微使用痕迹' }), 'SICP-6480', results, '描述文本', 88.5)
    expect(field(fields, 'title')).toMatchObject({ kind: 'text', value: 'Artist — Album', required: true, maxLength: 60 })
    expect(field(fields, 'price')).toMatchObject({ kind: 'number', value: 88.5, required: true })
    expect(field(fields, 'condition').value).toBe('轻微使用痕迹')
    expect(field(fields, 'condition').options?.map(option => option.value)).toEqual([
      '全新',
      '几乎全新',
      '轻微使用痕迹',
      '明显使用痕迹',
      '严重使用痕迹'
    ])
    expect(field(fields, 'description')).toMatchObject({ kind: 'textarea', value: '描述文本' })
    expect(field(fields, 'image')).toMatchObject({ kind: 'image', value: 'https://cdn/cover.jpg' })
    // The very first result is not the one with the cover, so the picked result
    // must be the first *found* one.
    expect(field(fields, 'image').value).not.toBe('https://cdn/other.jpg')
  })

  it('defaults the condition and uses an empty image/price when missing', () => {
    const fields = buildXianyuFields(target(), 'X-1', [], 'd', null)
    expect(field(fields, 'condition').value).toBe('全新')
    expect(field(fields, 'image').value).toBe('')
    expect(field(fields, 'price').value).toBe('')
  })
})

describe('buildPublishDraft', () => {
  it('rejects when the target does not exist', async () => {
    setTargets()
    await expect(buildPublishDraft(request())).rejects.toThrow('目标不存在')
  })

  describe('discogs', () => {
    const discogsTarget = target({ id: 'd-1', platform: 'discogs', name: '我的 Discogs', account: 'seller' })

    it('reports a blocker when no token is configured', async () => {
      setTargets(discogsTarget)
      const draft = await buildPublishDraft(request({ targetId: 'd-1', results: [result({ priceMin: 10 })] }))
      expect(draft.blockers.some(message => message.includes('Token'))).toBe(true)
      expect(draft.blockers.some(message => message.includes('Release'))).toBe(true)
      // The Discogs database search is public, so candidates are still resolved
      // (with an empty token) to let the user pick the release first.
      expect(mockSearchReleaseCandidates).toHaveBeenCalledWith('SICP-6480', '')
      expect(draft.platform).toBe('discogs')
      expect(draft.targetName).toBe('我的 Discogs')
    })

    it('exposes candidates and preselects the best match when a token exists', async () => {
      setTargets({ ...discogsTarget, token: 'tok' })
      const candidates: PublishReleaseCandidate[] = [
        { id: 7, title: 'A - B', catno: 'X' },
        { id: 9, title: 'A - B', catno: 'SICP-6480' }
      ]
      mockSearchReleaseCandidates.mockResolvedValue({ candidates, best: candidates[1]! })
      mockConvertFromUSD.mockResolvedValue(72)

      const draft = await buildPublishDraft(
        request({ targetId: 'd-1', results: [result({ priceMin: 10 })], descriptionText: 'D' })
      )

      expect(mockSearchReleaseCandidates).toHaveBeenCalledWith('SICP-6480', 'tok')
      expect(mockConvertFromUSD).toHaveBeenCalledWith(10, 'USD')
      expect(draft.meta.candidates).toEqual(candidates)
      expect(draft.blockers).toEqual([])
      expect(draft.warnings).toEqual([])
      const release = draft.fields.find(item => item.key === 'release')!
      expect(release.value).toBe('9')
      expect(release.options).toHaveLength(2)
      expect(draft.fields.find(item => item.key === 'price')?.value).toBe(72)
    })

    it('turns a failing release search into a warning', async () => {
      setTargets({ ...discogsTarget, token: 'tok' })
      mockSearchReleaseCandidates.mockRejectedValue(new Error('boom'))
      const draft = await buildPublishDraft(
        request({ targetId: 'd-1', results: [result({ priceMin: 10 })] })
      )
      expect(draft.warnings.some(message => message.includes('Discogs 搜索失败') && message.includes('boom'))).toBe(true)
      expect(draft.blockers.some(message => message.includes('Release'))).toBe(true)
      expect(draft.meta.candidates).toEqual([])
    })

    it('blocks when the search returns no candidate', async () => {
      setTargets({ ...discogsTarget, token: 'tok' })
      mockSearchReleaseCandidates.mockResolvedValue({ candidates: [], best: null })
      const draft = await buildPublishDraft(request({ targetId: 'd-1', results: [result({ priceMin: 10 })] }))
      expect(draft.blockers.some(message => message.includes('没有找到对应的 Discogs Release'))).toBe(true)
    })

    it('warns about a missing price and leaves it blank for a Discogs target', async () => {
      // The Discogs username is detected from the token, so an empty account no
      // longer produces a warning of its own.
      setTargets({ ...discogsTarget, account: '', token: 'tok' })
      mockSearchReleaseCandidates.mockResolvedValue({
        candidates: [{ id: 1, title: 'A - B', catno: 'SICP-6480' }],
        best: { id: 1, title: 'A - B', catno: 'SICP-6480' }
      })
      const draft = await buildPublishDraft(request({ targetId: 'd-1', results: [] }))
      expect(draft.warnings).toEqual(['搜索结果是空的，价格需要手动填写'])
      expect(draft.blockers).toEqual([])
      expect(mockConvertFromUSD).not.toHaveBeenCalled()
      expect(draft.fields.find(item => item.key === 'price')?.value).toBe('')
    })

    it('warns and leaves the price blank when the exchange-rate lookup fails', async () => {
      setTargets({ ...discogsTarget, token: 'tok' })
      mockConvertFromUSD.mockRejectedValue(new Error('rate API down'))
      mockSearchReleaseCandidates.mockResolvedValue({
        candidates: [{ id: 1, title: 'A - B', catno: 'SICP-6480' }],
        best: { id: 1, title: 'A - B', catno: 'SICP-6480' }
      })
      const draft = await buildPublishDraft(request({ targetId: 'd-1', results: [result({ priceMin: 10 })] }))
      expect(draft.warnings.some(message => message.includes('汇率查询超时'))).toBe(true)
      expect(draft.fields.find(item => item.key === 'price')?.value).toBe('')
    })
  })

  describe('xianyu', () => {
    const xianyuTarget = target({ id: 'x-1' })

    it('warns when no cover image is available and converts the price to CNY', async () => {
      setTargets(xianyuTarget)
      mockConvertFromUSD.mockResolvedValue(71.43)
      const draft = await buildPublishDraft(
        request({ targetId: 'x-1', results: [result({ priceMin: 10, name: 'Album', coverUrl: null })] })
      )
      expect(mockConvertFromUSD).toHaveBeenCalledWith(10, 'CNY')
      expect(draft.warnings.some(message => message.includes('封面'))).toBe(true)
      expect(draft.fields.find(item => item.key === 'price')?.value).toBe(71.43)
      expect(draft.meta).toEqual({})
    })

    it('does not warn when a cover image exists', async () => {
      setTargets(xianyuTarget)
      const draft = await buildPublishDraft(
        request({ targetId: 'x-1', results: [result({ name: 'Album', coverUrl: 'https://cdn/c.jpg', priceMin: 5 })] })
      )
      expect(draft.warnings).toEqual([])
      expect(mockConvertFromUSD).toHaveBeenCalledWith(5, 'CNY')
    })

    it('warns about a missing price and skips conversion when nothing was found', async () => {
      setTargets(xianyuTarget)
      const draft = await buildPublishDraft(
        request({ targetId: 'x-1', results: [result({ status: 'not_found', coverUrl: 'https://cdn/c.jpg' })] })
      )
      expect(draft.warnings.some(message => message.includes('价格需要手动填写'))).toBe(true)
      expect(mockConvertFromUSD).not.toHaveBeenCalled()
      expect(draft.fields.find(item => item.key === 'price')?.value).toBe('')
    })

    it('warns and leaves the price blank when the CNY conversion fails', async () => {
      setTargets(xianyuTarget)
      mockConvertFromUSD.mockRejectedValue(new Error('rate API down'))
      const draft = await buildPublishDraft(
        request({ targetId: 'x-1', results: [result({ name: 'Album', priceMin: 10, coverUrl: 'https://cdn/c.jpg' })] })
      )
      expect(draft.warnings).toEqual(['汇率查询超时，价格需要手动填写'])
      expect(draft.fields.find(item => item.key === 'price')?.value).toBe('')
    })
  })
})
