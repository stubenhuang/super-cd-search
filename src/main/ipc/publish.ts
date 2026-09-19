import { ipcMain } from 'electron'
import {
  buildPublishDraft,
  cancelPublish,
  forgetTarget,
  getTargetStatus,
  listEnabledPublishTargets,
  loginTarget,
  runPublish,
  testTarget
} from '../publish'
import type {
  PublishPrepareRequest,
  PublishRunRequest,
  PublishTarget,
  PublishTargetLoginResult,
  PublishTargetStatus,
  PublishTargetTestResult
} from '../../shared/publish'
import { logger } from '../logger'

export function registerPublishIpc(): void {
  ipcMain.handle('publish:list-targets', (): PublishTarget[] => listEnabledPublishTargets())

  ipcMain.handle('publish:test-target', async (_event, targetId: string): Promise<PublishTargetTestResult> => {
    logger.debug('ipc.publish', 'publish:test-target invoked', { targetId })
    try {
      return await testTarget(targetId)
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('publish:target-status', async (_event, targetId: string): Promise<PublishTargetStatus> => {
    try {
      return await getTargetStatus(targetId)
    } catch (err) {
      return { state: 'logged_out', message: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('publish:login-target', async (_event, targetId: string): Promise<PublishTargetLoginResult> => {
    logger.info('ipc.publish', 'publish:login-target invoked', { targetId })
    try {
      return await loginTarget(targetId)
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('publish:forget-target', async (_event, targetId: string): Promise<PublishTargetLoginResult> => {
    logger.info('ipc.publish', 'publish:forget-target invoked', { targetId })
    try {
      return await forgetTarget(targetId)
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('publish:prepare', async (_event, request: PublishPrepareRequest) => {
    const startedAt = Date.now()
    logger.debug('ipc.publish', 'publish:prepare invoked', {
      catalogNumber: request.catalogNumber,
      targetId: request.targetId
    })
    const draft = await buildPublishDraft(request)
    logger.debug('ipc.publish', 'publish:prepare returned', {
      platform: draft.platform,
      fields: draft.fields.length,
      warnings: draft.warnings.length,
      blockers: draft.blockers.length,
      durationMs: Date.now() - startedAt
    })
    return draft
  })

  ipcMain.handle('publish:run', async (_event, request: PublishRunRequest) => {
    logger.info('ipc.publish', 'publish:run invoked', {
      catalogNumber: request.catalogNumber,
      targetId: request.targetId
    })
    const outcome = await runPublish(request)
    logger.info('ipc.publish', 'publish:run finished', {
      catalogNumber: request.catalogNumber,
      status: outcome.status
    })
    return outcome
  })

  ipcMain.handle('publish:cancel', () => {
    logger.debug('ipc.publish', 'publish:cancel invoked')
    cancelPublish()
  })
}
