/**
 * A promise mutex: `acquire()` resolves with a `release` function that only
 * happens once everyone queued before it has finished.
 *
 * Used to serialize access to a single shared browser page — every publishing
 * target's page is driven by several concurrent callers (a login flow and a
 * publish run at the same time).
 */
export interface Mutex {
  acquire(): Promise<() => void>
}

export function createMutex(): Mutex {
  let tail: Promise<void> = Promise.resolve()

  return {
    async acquire(): Promise<() => void> {
      let release!: () => void
      const previous = tail
      tail = new Promise<void>((resolve) => {
        release = resolve
      })
      await previous
      return release
    }
  }
}
