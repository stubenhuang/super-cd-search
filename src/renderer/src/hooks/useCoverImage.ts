import { useEffect, useRef, useState } from 'react'

interface UseCoverImageOptions {
  size?: number
  /** When true, defer loading until the element scrolls into view. */
  lazy?: boolean
}

/**
 * Unified cover-image loading: fetch via the main-process image service
 * (which dedupes by URL and persists to disk), expose base64 data URL plus
 * loading/error state. Reused by the result card and the detail modal.
 */
export function useCoverImage(
  url: string | null | undefined,
  options: UseCoverImageOptions = {}
): {
  containerRef: React.RefObject<HTMLDivElement | null>
  imageData: string | null
  error: boolean
  loaded: boolean
  onLoad: () => void
  onError: () => void
} {
  const { size = 160, lazy = false } = options
  const [imageData, setImageData] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setImageData(null)
    setError(false)
    setLoaded(false)

    if (!url) {
      setError(true)
      return
    }

    let cancelled = false
    const load = async () => {
      try {
        const data = await window.electronAPI.fetchImage(url, size)
        if (cancelled) return
        if (data) {
          setImageData(`data:${data.mimeType};base64,${data.base64}`)
        } else {
          setError(true)
        }
      } catch {
        if (!cancelled) setError(true)
      }
    }

    if (!lazy) {
      load()
      return () => { cancelled = true }
    }

    const container = containerRef.current
    if (!container || typeof IntersectionObserver === 'undefined') {
      load()
      return () => { cancelled = true }
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) {
        observer.disconnect()
        load()
      }
    }, { rootMargin: '300px' })
    observer.observe(container)

    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [url, size, lazy])

  return {
    containerRef,
    imageData,
    error,
    loaded,
    onLoad: () => setLoaded(true),
    onError: () => setError(true)
  }
}
