/**
 * A promise mutex: `acquire()` resolves with a `release` function that only
 * happens once everyone queued before it has finished.
 *
 * Used to serialize access to a single shared browser page — the search
 * channel's page and every publishing target's page are each driven by several
 * concurrent callers (platform queries in a batch, a login flow and a publish
 * run at the same time).
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
