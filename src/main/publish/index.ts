import { BrowserWindow } from 'electron'
import { isBatchQueryRunning } from '../orchestrator'
import { logger } from '../logger'
import { createDiscogsListing } from './discogs'
import { getPublishTarget, resolveDiscogsToken } from './targets'
import { publishToXianyu } from './xianyu'
import type {
  PublishField,
  PublishListingStatus,
  PublishMediaCondition,
  PublishOutcome,
  PublishProgress,
  PublishRunRequest,
  PublishSleeveCondition,
  PublishStage
} from '../../shared/publish'

export { listEnabledPublishTargets, listPublishTargets, getPublishTarget, normalizePublishTarget, resolveDiscogsToken } from './targets'
export { buildPublishDraft } from './draft'
export { verifyDiscogsCredentials } from './discogs'
export { forgetTarget, getTargetStatus, loginTarget, testTarget } from './status'
export { closeAllPublishProfiles, initPublishProfiles } from './profiles'

interface RunningPublish {
  catalogNumber: string
  targetId: string
  controller: AbortController
}

let running: RunningPublish | null = null

/** A publish holds the shared Chrome session, so searches and publishes are mutually exclusive. */
export function isPublishRunning(): boolean {
  return running !== null
}

function emitProgress(progress: PublishProgress): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('publish:progress', progress)
  }
}

function readField(fields: readonly PublishField[], key: string): PublishField | undefined {
  return fields.find(field => field.key === key)
}

function readString(fields: readonly PublishField[], key: string, fallback = ''): string {
  const value = readField(fields, key)?.value
  if (value === null || value === undefined) return fallback
  return typeof value === 'string' ? value.trim() : String(value).trim()
}

function readNumber(fields: readonly PublishField[], key: string): number | null {
  const value = readField(fields, key)?.value
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function readBoolean(fields: readonly PublishField[], key: string, fallback = false): boolean {
  const value = readField(fields, key)?.value
  return typeof value === 'boolean' ? value : fallback
}

function failure(
  request: PublishRunRequest,
  error: string,
  platform: PublishOutcome['platform'],
  targetName: string,
  artifacts?: string[]
): PublishOutcome {
  logger.warn('publish', 'publish failed', { catalogNumber: request.catalogNumber, targetId: request.targetId, error })
  return {
    status: 'error',
    platform,
    targetName,
    catalogNumber: request.catalogNumber,
    error,
    ...(artifacts && artifacts.length > 0 ? { artifacts } : {})
  }
}

/**
 * Publish one catalog number to the target's platform.
 *
 * Never rejects: every failure is reported as a `status: 'error'` outcome so
 * the dialog always has something concrete to show. Progress is pushed on the
 * `publish:progress` channel for the progress bar.
 */
export async function runPublish(request: PublishRunRequest): Promise<PublishOutcome> {
  const target = getPublishTarget(request.targetId)
  if (!target) {
    return failure(request, '发布目标不存在，请到设置中重新配置', 'discogs', '')
  }

  if (running) {
    return failure(request, '已有发布任务正在进行中，请等待它结束或先取消', target.platform, target.name)
  }
  if (isBatchQueryRunning()) {
    return failure(request, '搜索正在进行中，请等搜索结束后再发布', target.platform, target.name)
  }

  const controller = new AbortController()
  running = { catalogNumber: request.catalogNumber, targetId: target.id, controller }

  const base = {
    catalogNumber: request.catalogNumber,
    targetId: target.id
  }
  const progress = (stage: PublishStage, step: number, totalSteps: number, message: string, extra: Partial<PublishProgress> = {}): void => {
    emitProgress({ ...base, stage, step, totalSteps, message, ...extra })
  }

  try {
    if (target.platform === 'discogs') {
      const totalSteps = 3
      progress('preparing', 1, totalSteps, '正在校验 Discogs 发布参数…')

      const token = resolveDiscogsToken(target)
      if (!token) {
        return failure(request, '未配置 Discogs Token：请到「设置 → API 令牌」填写，或在该发布目标里单独填写', 'discogs', target.name)
      }

      const releaseId = readNumber(request.fields, 'release')
      const condition = readString(request.fields, 'condition') as PublishMediaCondition
      const price = readNumber(request.fields, 'price')
      const status = (readString(request.fields, 'status', 'For Sale') || 'For Sale') as PublishListingStatus

      if (!releaseId) return failure(request, '请选择要发布的 Discogs Release', 'discogs', target.name)
      if (!condition) return failure(request, '请选择唱片成色', 'discogs', target.name)
      if (price === null || price <= 0) return failure(request, '价格必须是大于 0 的数字', 'discogs', target.name)

      progress('preparing', 1, totalSteps, '正在向 Discogs 提交发布…')
      const result = await createDiscogsListing(token, {
        releaseId,
        condition,
        price,
        status,
        sleeveCondition: readString(request.fields, 'sleeveCondition') as PublishSleeveCondition | '',
        comments: readString(request.fields, 'comments'),
        allowOffers: readBoolean(request.fields, 'allowOffers'),
        externalId: readString(request.fields, 'externalId'),
        location: readString(request.fields, 'location'),
        weight: readNumber(request.fields, 'weight'),
        formatQuantity: readNumber(request.fields, 'formatQuantity')
      }, controller.signal)

      progress('done', totalSteps, totalSteps, status === 'Draft' ? '已保存为 Discogs 草稿' : '已发布到 Discogs')

      return {
        status: 'published',
        platform: 'discogs',
        targetName: target.name,
        catalogNumber: request.catalogNumber,
        listingId: result.listingId,
        listingUrl: result.listingUrl
      }
    }

    // 闲鱼: automated filling, manual final click, then automated detection.
    const totalSteps = 4
    let step = 1
    progress('preparing', step, totalSteps, '正在准备闲鱼发布…')

    const result = await publishToXianyu({
      targetId: target.id,
      catalogNumber: request.catalogNumber,
      title: readString(request.fields, 'title'),
      description: readString(request.fields, 'description'),
      price: readString(request.fields, 'price'),
      condition: readString(request.fields, 'condition'),
      imageUrl: readString(request.fields, 'image'),
      uploadCover: target.uploadCover !== false,
      signal: controller.signal,
      onProgress: (message, needsUserAction) => {
        if (needsUserAction) {
          step = 3
          progress('awaiting-user', step, totalSteps, message, { needsUserAction: true })
          return
        }
        if (step < 2) step = 2
        progress(step >= 3 ? 'verifying' : 'filling', step, totalSteps, message)
      }
    })

    if (result.status === 'published') {
      progress('done', totalSteps, totalSteps, '已检测到闲鱼发布成功')
      const listingUrl = result.listingUrl && /item|detail/i.test(result.listingUrl) ? result.listingUrl : undefined
      return {
        status: 'published',
        platform: 'xianyu',
        targetName: target.name,
        catalogNumber: request.catalogNumber,
        ...(listingUrl ? { listingUrl } : {}),
        artifacts: result.artifacts
      }
    }

    progress('cancelled', step, totalSteps, result.message ?? '已取消发布')
    return {
      status: 'cancelled',
      platform: 'xianyu',
      targetName: target.name,
      catalogNumber: request.catalogNumber,
      error: result.message,
      artifacts: result.artifacts
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const cancelled = controller.signal.aborted || /abort/i.test(message)
    if (cancelled) {
      progress('cancelled', 1, 1, '已取消发布')
      return {
        status: 'cancelled',
        platform: target.platform,
        targetName: target.name,
        catalogNumber: request.catalogNumber
      }
    }
    progress('error', 1, 1, message, { error: message })
    return failure(request, message, target.platform, target.name)
  } finally {
    running = null
  }
}

/** Abort the in-flight publish. Safe to call when nothing is running. */
export function cancelPublish(): void {
  if (!running) return
  logger.info('publish', 'publish cancelled', { catalogNumber: running.catalogNumber, targetId: running.targetId })
  running.controller.abort()
}
