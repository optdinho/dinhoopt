import { useEffect } from 'react'

export function useProgressListener<T>(
  subscribe: (cb: (data: T) => void) => () => void,
  handler: (data: T) => void
): void {
  useEffect(() => {
    const cleanup = subscribe(handler)
    return cleanup
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}
