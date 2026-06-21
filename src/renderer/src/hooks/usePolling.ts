import { useCallback, useEffect, useRef, useState } from 'react'

export function usePolling<T>(
  fetcher: () => Promise<T>,
  interval: number,
): { data: T | undefined; error: boolean; loading: boolean; refresh: () => void } {
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  const fetcherRef = useRef(fetcher)
  const mountedRef = useRef(true)
  fetcherRef.current = fetcher

  const fetchData = useCallback(() => {
    mountedRef.current = true
    fetcherRef.current()
      .then((result) => {
        if (!mountedRef.current) return
        setData(result)
        setError(false)
      })
      .catch(() => {
        if (!mountedRef.current) return
        setError(true)
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false)
      })
  }, [])

  useEffect(() => {
    mountedRef.current = true
    setLoading(true)
    fetchData()

    const iv = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchData()
      }
    }, interval)

    return () => {
      mountedRef.current = false
      clearInterval(iv)
    }
  }, [interval, fetchData])

  const refresh = useCallback(() => {
    setLoading(true)
    fetchData()
  }, [fetchData])

  return { data, error, loading, refresh }
}
