import { BrowserWindow } from 'electron'

export type PublishChangeKind = 'changed' | 'finished'

type PublishChangeListener = (kind: PublishChangeKind) => void

/**
 * Subscribers are the SSE connections served to phones; the LAN server routes
 * push a frame whenever a change is announced here.
 */
const listeners = new Set<PublishChangeListener>()

export function subscribePublishChanges(listener: PublishChangeListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Fan out a publish-batch change: connected phones get an SSE frame and the
 * desktop windows get the `library:publish-updated` IPC to refresh the table.
 */
export function notifyPublishChanged(kind: PublishChangeKind = 'changed'): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('library:publish-updated')
    }
  }
  notifyPublishObservers(kind)
}

/**
 * Ping only the phone observers. Used for library CRUD that changes the
 * live-joined fields a phone is looking at, without reloading the desktop
 * table (which would churn during batch-search auto-saves).
 */
export function notifyPublishObservers(kind: PublishChangeKind = 'changed'): void {
  for (const listener of [...listeners]) {
    try {
      listener(kind)
    } catch {
      // A dead connection cleans itself up via its own close handler.
    }
  }
}
