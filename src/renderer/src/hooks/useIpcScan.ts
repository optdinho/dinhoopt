import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import logger from '../lib/renderer-logger'

export function useIpcScan<TResult>({
  scanFn,
  onResult,
  setLoading,
  resetState,
  onError,
  onSuccessToast,
  errorKey,
  t,
}: {
  scanFn: () => Promise<TResult>
  onResult: (result: TResult) => void
  setLoading?: (v: boolean) => void
  resetState?: () => void
  onError?: (err: unknown) => void
  onSuccessToast?: string
  errorKey?: string
  t?: (key: string) => string
}): { scan: () => Promise<void>; loading: boolean } {
  const [internalLoading, setInternalLoading] = useState(false)
  const scanFnRef = useRef(scanFn)
  const onResultRef = useRef(onResult)
  const setLoadingRef = useRef(setLoading)
  const resetStateRef = useRef(resetState)
  const onErrorRef = useRef(onError)
  const onSuccessToastRef = useRef(onSuccessToast)
  const errorKeyRef = useRef(errorKey)
  const tRef = useRef(t)

  useEffect(() => {
    scanFnRef.current = scanFn
  }, [scanFn])
  useEffect(() => {
    onResultRef.current = onResult
  }, [onResult])
  useEffect(() => {
    setLoadingRef.current = setLoading
  }, [setLoading])
  useEffect(() => {
    resetStateRef.current = resetState
  }, [resetState])
  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])
  useEffect(() => {
    onSuccessToastRef.current = onSuccessToast
  }, [onSuccessToast])
  useEffect(() => {
    errorKeyRef.current = errorKey
  }, [errorKey])
  useEffect(() => {
    tRef.current = t
  }, [t])

  const scan = useCallback(async () => {
    const loader = setLoadingRef.current ?? setInternalLoading
    loader(true)
    resetStateRef.current?.()
    try {
      const result = await scanFnRef.current()
      onResultRef.current(result)
      if (onSuccessToastRef.current) {
        toast.success(onSuccessToastRef.current)
      }
    } catch (err) {
      logger.error('useIpcScan', 'IPC scan failed', err)
      onErrorRef.current?.(err)
      if (errorKeyRef.current && tRef.current) {
        toast.error(tRef.current(`${errorKeyRef.current}.scanFailedToast`), {
          description: tRef.current(`${errorKeyRef.current}.scanFailedDescription`),
        })
      }
    } finally {
      loader(false)
    }
  }, [])

  return { scan, loading: setLoading ? false : internalLoading }
}
