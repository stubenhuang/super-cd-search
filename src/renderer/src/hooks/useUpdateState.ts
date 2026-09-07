import { useCallback, useEffect, useState } from 'react'
import type { UpdateState } from '../../../shared/updater'

interface UseUpdateState {
  state: UpdateState | null
  check: () => Promise<UpdateState>
  download: () => Promise<UpdateState>
  install: () => Promise<void>
}

/**
 * Mirrors the main-process auto-update state into the renderer: the initial
 * snapshot is fetched once, then every `updater:state` push replaces it.
 */
export function useUpdateState(): UseUpdateState {
  const [state, setState] = useState<UpdateState | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.electronAPI
      .getUpdateState()
      .then(initial => {
        if (!cancelled) setState(initial)
      })
      .catch(() => {})

    const unsubscribe = window.electronAPI.receive('updater:state', (...args: unknown[]) => {
      const next = args[0] as UpdateState | undefined
      if (next) setState(next)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const check = useCallback(async () => {
    const next = await window.electronAPI.checkForUpdates()
    setState(next)
    return next
  }, [])

  const download = useCallback(async () => {
    const next = await window.electronAPI.downloadUpdate()
    setState(next)
    return next
  }, [])

  const install = useCallback(async () => {
    await window.electronAPI.installUpdate()
  }, [])

  return { state, check, download, install }
}
