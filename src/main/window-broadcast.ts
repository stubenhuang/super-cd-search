import { BrowserWindow } from 'electron'

/**
 * Send one IPC payload to every live renderer window.
 *
 * Used by all the push channels (query progress, publish progress, enrichment
 * progress, the LAN remote-control channels) so a window that is being torn
 * down is skipped in exactly one place instead of in every emitter.
 */
export function broadcastToWindows(channel: string, payload?: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      // Keep the payload-less form a single-argument send: some channels carry
      // no data at all, and listeners/test spies see the arity.
      if (payload === undefined) window.webContents.send(channel)
      else window.webContents.send(channel, payload)
    }
  }
}
