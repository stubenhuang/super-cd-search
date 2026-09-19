import { randomUUID } from 'crypto'
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
  const raw = getSetting('publishTargets')
  if (!Array.isArray(raw)) return []
  const normalized = raw
    .map(entry => normalizePublishTarget(entry))
    .filter((entry): entry is PublishTarget => entry !== null)
  return normalized
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
 * Discogs token for a target: the per-target override wins, otherwise the
 * globally configured token is reused so a single-account setup needs no
 * duplication.
 */
export function resolveDiscogsToken(target: PublishTarget): string {
  return (target.token ?? '').trim() || (getSetting('discogsToken') ?? '').trim()
}
