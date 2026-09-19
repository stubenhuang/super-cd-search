import { createHash, randomUUID } from 'crypto'
import { getSetting, updateSettings } from '../settings'
import {
  PUBLISH_CURRENCIES,
  PUBLISH_MEDIA_CONDITIONS,
  PUBLISH_PLATFORMS,
  PUBLISH_SLEEVE_CONDITIONS,
  XIANYU_CONDITIONS,
  type PublishCurrency,
  type PublishListingStatus,
  type PublishMediaCondition,
  type PublishPlatform,
  type PublishSleeveCondition,
  type PublishTarget
} from '../../shared/publish'
import { logger } from '../logger'

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function inList<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : undefined
}

function asNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Short, non-reversible fingerprint of a Discogs token.
 *
 * Persisted next to the token so the app can tell「这个 token 验证过」from「验证
 * 过之后又改过」without ever storing the verification token twice; the hash is
 * truncated because it only needs to detect a change, not to resist attack.
 */
export function discogsTokenFingerprint(token: string): string {
  return createHash('sha256').update(token.trim()).digest('hex').slice(0, 16)
}

/**
 * Coerce one stored entry into a valid target.
 *
 * Settings are user-editable JSON on disk (and restored from backups), so
 * unknown platforms / enum values are dropped instead of being trusted.
 * Returns null only when the entry cannot be made meaningful at all.
 */
export function normalizePublishTarget(raw: unknown): PublishTarget | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const platform = inList<PublishPlatform>(record.platform, PUBLISH_PLATFORMS)
  if (!platform) return null

  const name = asString(record.name).trim()
  const id = asString(record.id).trim() || randomUUID()
  const account = asString(record.account).trim()

  const target: PublishTarget = {
    id,
    platform,
    name: name || (platform === 'xianyu' ? '闲鱼' : 'Discogs'),
    account,
    enabled: record.enabled !== false,
    createdAt: Number.isFinite(Number(record.createdAt)) ? Number(record.createdAt) : Date.now()
  }

  const status = inList<PublishListingStatus>(record.status, ['For Sale', 'Draft'])
  if (status) target.status = status

  if (platform === 'discogs') {
    const currency = inList<PublishCurrency>(record.currency, PUBLISH_CURRENCIES)
    if (currency) target.currency = currency
    const condition = inList<PublishMediaCondition>(record.condition, PUBLISH_MEDIA_CONDITIONS)
    if (condition) target.condition = condition
    const sleeve = inList<PublishSleeveCondition>(record.sleeveCondition, PUBLISH_SLEEVE_CONDITIONS)
    if (sleeve) target.sleeveCondition = sleeve
    if (typeof record.allowOffers === 'boolean') target.allowOffers = record.allowOffers
    const location = asString(record.location).trim()
    if (location) target.location = location
    target.weight = asNumberOrNull(record.weight)
    target.formatQuantity = asNumberOrNull(record.formatQuantity)
    const token = asString(record.token).trim()
    if (token) target.token = token
    const tokenFingerprint = asString(record.tokenFingerprint).trim()
    if (tokenFingerprint) target.tokenFingerprint = tokenFingerprint
  } else {
    const condition = asString(record.xianyuCondition).trim()
    target.xianyuCondition = (XIANYU_CONDITIONS as readonly string[]).includes(condition)
      ? condition
      : XIANYU_CONDITIONS[0]
    target.uploadCover = record.uploadCover !== false
    if (Number.isFinite(Number(record.xianyuLoginAt))) target.xianyuLoginAt = Number(record.xianyuLoginAt)
  }

  return target
}

function readTargets(): PublishTarget[] {
  return preparePublishTargets(getSetting('publishTargets'))
}

/**
 * Canonical form of a `publishTargets` array: normalized entries plus the
 * one-time Discogs-token migration below.
 *
 * Used on every WRITE as well as every read, so a renderer that saved its list
 * from a slightly older snapshot can never undo the migration (it would
 * otherwise persist targets without a token and lock them).
 */
export function preparePublishTargets(raw: unknown): PublishTarget[] {
  if (!Array.isArray(raw)) return []
  const normalized = raw
    .map(entry => normalizePublishTarget(entry))
    .filter((entry): entry is PublishTarget => entry !== null)
  return migrateDiscogsTokens(normalized)
}

/**
 * One-time migration for installations from before per-target Discogs tokens
 * were mandatory: their Discogs targets relied on the global `discogsToken`, so
 * without this they would all read as「未配置专用 Token」and lock.
 *
 * Only targets with an EMPTY token are touched, and only while a global token
 * still exists; the value is copied so every target can be changed (or cleared)
 * on its own afterwards. `tokenFingerprint` is deliberately NOT set: the old
 * `account` string is not proof that this token was ever verified.
 */
function migrateDiscogsTokens(targets: PublishTarget[]): PublishTarget[] {
  const globalToken = (getSetting('discogsToken') ?? '').trim()
  if (!globalToken) return targets

  let migrated = 0
  const next = targets.map(target => {
    if (target.platform !== 'discogs' || (target.token ?? '').trim()) return target
    migrated++
    return { ...target, token: globalToken }
  })
  if (migrated === 0) return targets

  updateSettings({ publishTargets: next })
  logger.info('publish.targets', 'copied the global Discogs token into targets that had none', { count: migrated })
  return next
}

/**
 * Whether a target may be switched on, i.e. whether publishing through it has
 * a chance of working.
 *
 * 闲鱼's browser session lives in memory, so a target whose profile is not
 * running right now is still「就绪」as long as it was logged in before
 * (`xianyuLoginAt`) — otherwise every app restart would silently disable a
 * perfectly good target. Discogs has no session: its token must be present and
 * carry the fingerprint written after a successful `/oauth/identity` check.
 */
export function isTargetCredentialReady(target: PublishTarget): boolean {
  if (target.platform === 'xianyu') return Boolean(target.xianyuLoginAt)
  const token = (target.token ?? '').trim()
  if (!token) return false
  return (target.tokenFingerprint ?? '') === discogsTokenFingerprint(token)
}

export function listPublishTargets(): PublishTarget[] {
  return readTargets()
}

export function listEnabledPublishTargets(): PublishTarget[] {
  return readTargets().filter(target => target.enabled)
}

export function getPublishTarget(id: string): PublishTarget | null {
  return readTargets().find(target => target.id === id) ?? null
}

/**
 * Persist selected fields of one target (used for the detected 闲鱼 login
 * account). Unknown ids are ignored rather than resurrecting a deleted target.
 */
export function patchPublishTarget(id: string, fields: Partial<PublishTarget>): PublishTarget | null {
  const targets = readTargets()
  const index = targets.findIndex(target => target.id === id)
  if (index < 0) return null
  const merged = normalizePublishTarget({ ...targets[index], ...fields })
  if (!merged) return null
  targets[index] = merged
  updateSettings({ publishTargets: targets })
  logger.debug('publish.targets', 'target patched', { id, fields: Object.keys(fields) })
  return merged
}

/**
 * Discogs token of one target.
 *
 * There is no global fallback on purpose: two Discogs targets may list under
 * two different accounts, so each one owns its credential. The global
 * `discogsToken` setting only feeds the search queries.
 */
export function resolveDiscogsToken(target: PublishTarget): string {
  return (target.token ?? '').trim()
}
