import { throttledFetch } from '../throttle'
import {
  DISCOGS_API_THROTTLE,
  DISCOGS_API_URL,
  compactCatalog,
  discogsRequestInit,
  type DiscogsSearchHit
} from '../queries/discogs'
import type {
  PublishListingStatus,
  PublishMediaCondition,
  PublishReleaseCandidate,
  PublishSleeveCondition,
  PublishTargetTestResult
} from '../../shared/publish'
import { logger } from '../logger'

const MAX_CANDIDATES = 5

export interface DiscogsReleaseSearch {
  candidates: PublishReleaseCandidate[]
  /** Exact catalog-number match when there is one, otherwise the first hit. */
  best: PublishReleaseCandidate | null
}

function toCandidate(hit: DiscogsSearchHit): PublishReleaseCandidate {
  return {
    id: hit.id,
    title: hit.title,
    catno: hit.catno ?? '',
    ...(hit.year ? { year: Number(hit.year) } : {}),
    ...(Array.isArray(hit.format) && hit.format.length > 0 ? { format: hit.format.join(', ') } : {})
  }
}

/**
 * Resolve a catalog number to Discogs release candidates.
 *
 * Discogs writes catalog numbers with varying separators ("SICP 6480" vs the
 * app's "SICP-6480"), so an exact match ignoring spaces/dashes is preferred
 * over the search's own ranking.
 */
export async function searchReleaseCandidates(
  catalogNumber: string,
  token: string,
  signal?: AbortSignal
): Promise<DiscogsReleaseSearch> {
  const url = `${DISCOGS_API_URL}/database/search?catno=${encodeURIComponent(catalogNumber)}&type=release`
  const response = await throttledFetch('api.discogs.com', url, discogsRequestInit(token, signal), DISCOGS_API_THROTTLE)
  if (!response.ok) {
    throw new Error(`Discogs 搜索失败（HTTP ${response.status}）`)
  }

  const data = await response.json() as { results?: DiscogsSearchHit[] }
  const hits = data.results ?? []
  if (hits.length === 0) return { candidates: [], best: null }

  const candidates = hits.slice(0, MAX_CANDIDATES).map(toCandidate)
  const normalized = compactCatalog(catalogNumber)
  const exact = candidates.find(candidate => candidate.catno && compactCatalog(candidate.catno) === normalized)

  logger.debug('publish.discogs', 'release candidates resolved', {
    catalogNumber,
    count: candidates.length,
    exactMatch: exact?.id ?? null
  })

  return { candidates, best: exact ?? candidates[0]! }
}

async function discogsErrorMessage(response: Response, fallback: string): Promise<string> {
  let detail = ''
  try {
    const body = await response.json() as { message?: string }
    detail = typeof body?.message === 'string' ? body.message : ''
  } catch {
    detail = ''
  }
  switch (response.status) {
    case 401:
      return `Discogs 认证失败（401）：Token 无效或权限不足${detail ? ` — ${detail}` : ''}`
    case 403:
      return `Discogs 拒绝访问（403）：账号可能没有卖家权限，或该操作不被允许${detail ? ` — ${detail}` : ''}`
    case 404:
      return `Discogs 资源不存在（404）${detail ? ` — ${detail}` : ''}`
    case 422:
      return `Discogs 拒绝了该发布内容（422）${detail ? ` — ${detail}` : ''}`
    default:
      return `${fallback}（HTTP ${response.status}）${detail ? ` — ${detail}` : ''}`
  }
}

/**
 * Which account a token belongs to.
 *
 * `/oauth/identity` is the only endpoint that reports the authenticated seller
 * without knowing their username, which is what lets the app auto-detect it
 * instead of asking the user to type it.
 */
export async function fetchDiscogsIdentity(
  token: string,
  signal?: AbortSignal
): Promise<{ id: number; username: string } | null> {
  const response = await throttledFetch(
    'api.discogs.com',
    `${DISCOGS_API_URL}/oauth/identity`,
    discogsRequestInit(token.trim(), signal),
    DISCOGS_API_THROTTLE
  )
  if (!response.ok) throw new Error(await discogsErrorMessage(response, 'Discogs 身份校验失败'))
  const data = await response.json() as { id?: number; username?: string }
  if (!data.username) return null
  return { id: Number(data.id ?? 0), username: data.username }
}

/**
 * Validate a Discogs token and report the account behind it.
 *
 * The app never asks for a username: whatever the token can do is what the
 * target can do, and the identity endpoint tells us whose inventory it is.
 */
export async function verifyDiscogsCredentials(rawToken: string): Promise<PublishTargetTestResult> {
  const token = rawToken.trim()
  if (!token) return { ok: false, message: '未配置 Discogs Token（可在「API 令牌」分区填写，或在此目标里单独填写）' }

  try {
    const identity = await fetchDiscogsIdentity(token)
    if (!identity) return { ok: false, message: 'Discogs 返回了无法识别的身份信息' }
    return { ok: true, account: identity.username, message: `已连接：${identity.username}` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : `连接 Discogs 失败：${String(err)}` }
  }
}

export interface DiscogsListingInput {
  releaseId: number
  condition: PublishMediaCondition
  price: number
  status: PublishListingStatus
  sleeveCondition?: PublishSleeveCondition | ''
  comments?: string
  allowOffers?: boolean
  externalId?: string
  location?: string
  weight?: number | null
  formatQuantity?: number | null
}

export interface DiscogsListingResult {
  listingId: string
  listingUrl: string
}

/**
 * Create a marketplace listing for the authenticated seller.
 *
 * Field names follow the official spec (`POST /marketplace/listings`); empty
 * optional values are omitted rather than sent as null, which Discogs rejects.
 */
export async function createDiscogsListing(
  token: string,
  input: DiscogsListingInput,
  signal?: AbortSignal
): Promise<DiscogsListingResult> {
  const body: Record<string, unknown> = {
    release_id: input.releaseId,
    condition: input.condition,
    price: input.price,
    status: input.status
  }
  if (input.sleeveCondition) body.sleeve_condition = input.sleeveCondition
  if (input.comments?.trim()) body.comments = input.comments.trim()
  if (typeof input.allowOffers === 'boolean') body.allow_offers = input.allowOffers
  if (input.externalId?.trim()) body.external_id = input.externalId.trim()
  if (input.location?.trim()) body.location = input.location.trim()
  if (typeof input.weight === 'number' && Number.isFinite(input.weight)) body.weight = Math.round(input.weight)
  if (typeof input.formatQuantity === 'number' && Number.isFinite(input.formatQuantity)) {
    body.format_quantity = Math.round(input.formatQuantity)
  }

  const init = discogsRequestInit(token, signal)
  const response = await throttledFetch('api.discogs.com', `${DISCOGS_API_URL}/marketplace/listings`, {
    ...init,
    method: 'POST',
    headers: { ...(init.headers as Record<string, string>), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    throw new Error(await discogsErrorMessage(response, 'Discogs 发布失败'))
  }

  const data = await response.json() as { listing_id?: number; resource_url?: string }
  const listingId = data.listing_id !== undefined ? String(data.listing_id) : ''
  logger.info('publish.discogs', 'listing created', { listingId, releaseId: input.releaseId, status: input.status })

  return {
    listingId,
    listingUrl: data.resource_url ?? (listingId ? `https://www.discogs.com/sell/item/${listingId}` : '')
  }
}
