import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

export function useIpcAction<TArgs extends unknown[], TResult>({
  actionFn,
  onResult,
  setLoading,
  onStart,
  onError,
  onSuccessToast,
  errorKey,
  t,
}: {
  actionFn: (...args: TArgs) => Promise<TResult>
  onResult?: (result: TResult) => void
  setLoading?: (v: boolean) => void
  onStart?: () => void
  onError?: (err: unknown) => void
  onSuccessToast?: string
  errorKey?: string
  t?: (key: string) => string
}): { execute: (...args: TArgs) => Promise<TResult | undefined>; loading: boolean } {
  const [internalLoading, setInternalLoading] = useState(false)
  const actionFnRef = useRef(actionFn)
  const onResultRef = useRef(onResult)
  const setLoadingRef = useRef(setLoading)
  const onStartRef = useRef(onStart)
  const onErrorRef = useRef(onError)
  const onSuccessToastRef = useRef(onSuccessToast)
  const errorKeyRef = useRef(errorKey)
  const tRef = useRef(t)

  useEffect(() => {
    actionFnRef.current = actionFn
  }, [actionFn])
  useEffect(() => {
    onResultRef.current = onResult
  }, [onResult])
  useEffect(() => {
    setLoadingRef.current = setLoading
  }, [setLoading])
  useEffect(() => {
    onStartRef.current = onStart
  }, [onStart])
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

  const execute = useCallback(async (...args: TArgs): Promise<TResult | undefined> => {
    const loader = setLoadingRef.current ?? setInternalLoading
    loader(true)
    onStartRef.current?.()
    try {
      const result = await actionFnRef.current(...args)
      onResultRef.current?.(result)
      if (onSuccessToastRef.current) {
        toast.success(onSuccessToastRef.current)
      }
      return result
    } catch (err: unknown) {
      console.error('IPC action failed:', err)
      onErrorRef.current?.(err)
      if (errorKeyRef.current && tRef.current) {
        toast.error(tRef.current(`${errorKeyRef.current}.actionFailedToast`), {
          description: tRef.current(`${errorKeyRef.current}.actionFailedDescription`),
        })
      }
      return undefined
    } finally {
      loader(false)
    }
  }, [])

  return { execute, loading: setLoading ? false : internalLoading }
}
