import type { ChildProcess } from 'child_process'
import { spawn } from 'child_process'

/**
 * Terminate a real-Chrome process, including its child processes.
 *
 * `proc.kill('SIGKILL')` alone is not enough on Windows: a SIGKILL only stops
 * the browser process itself and leaves every renderer/network child process
 * alive, so a "closed" Chrome keeps running (and keeps the profile locked) for
 * the rest of the session. `taskkill /T /F` kills the whole tree instead.
 *
 * Never rejects: a process that already exited is the normal case here, because
 * this always runs right after `browser.close()`.
 */
export async function killChromeProcess(proc: ChildProcess): Promise<void> {
  if (!proc.pid) return

  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      try {
        const killer = spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' })
        killer.once('exit', () => resolve())
        killer.once('error', () => resolve())
      } catch {
        resolve()
      }
    })
    return
  }

  try {
    proc.kill('SIGKILL')
  } catch {
    // Already exited.
  }
}
