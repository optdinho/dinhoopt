import type { ClipInfo, ClipMergeResult, ClipTrimResult, EnhanceOption } from '@shared/types'
import { type RefObject, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useClipEncodeProgress } from './useClipEncodeProgress'

interface UseClipExportFlowParams {
  clip: ClipInfo | undefined
  startSec: number
  endSec: number
  effectiveDuration: number
  enhance: EnhanceOption
  sharpness: number
  mergeClips: string[]
  mountedRef: RefObject<boolean>
  onSave: () => void
}

/**
 * Trim/merge/re-encode export flow for the clip editor modal.
 *
 * Owns the export-side state (running flags, encode progress subscription,
 * cancel error) and the handlers that drive it. The trim range, enhance and
 * sharpness inputs stay owned by the modal and are passed in, so state
 * identity is single-sourced — nothing here is duplicated upstream.
 */
export function useClipExportFlow({
  clip,
  startSec,
  endSec,
  effectiveDuration,
  enhance,
  sharpness,
  mergeClips,
  mountedRef,
  onSave,
}: UseClipExportFlowParams) {
  const { t } = useTranslation('clips')
  const [trimming, setTrimming] = useState(false)
  const [merging, setMerging] = useState(false)
  const [reEncode, setReEncode] = useState(false)
  const encodeProgress = useClipEncodeProgress()
  const [encodeCancelError, setEncodeCancelError] = useState<string | null>(null)

  // At least one quality improvement selected for the "Improve quality" button.
  // Sharpness alone still requires a re-encode to be applied.
  const qualityEnhancementSelected = reEncode || sharpness > 0

  const runExport = async (useReEncode: boolean, successKey: string) => {
    if (endSec <= startSec || startSec < 0 || endSec > effectiveDuration) {
      toast.error(t('invalidTrimRange'))
      return
    }
    setTrimming(true)
    setEncodeCancelError(null)
    encodeProgress.start({ kind: 'trim', clipPath: clip!.path })
    try {
      const result: ClipTrimResult = await window.dinho.clipsTrimClip(
        clip!.path,
        startSec,
        endSec,
        useReEncode,
        enhance,
        sharpness,
      )
      if (result.success) {
        toast.success(t(successKey))
        if (mountedRef.current) onSave()
      } else if (result.cancelled) {
        toast.info(t('trimCancelled'))
      } else {
        toast.error(result.error || t('trimFailed'))
      }
    } catch {
      toast.error(t('trimFailed'))
    } finally {
      if (mountedRef.current) {
        setTrimming(false)
        encodeProgress.stop()
      }
    }
  }

  const handleCancelEncode = async () => {
    const result = await encodeProgress.cancel()
    if (mountedRef.current) setEncodeCancelError(result?.success ? null : t('encodeCancelFailed'))
  }

  const handleTrim = () => runExport(qualityEnhancementSelected, 'trimSuccess')

  const handleImproveQuality = () => runExport(true, 'improveQualitySuccess')

  const handleMerge = async () => {
    if (mergeClips.length < 2) {
      toast.error(t('needTwoClips'))
      return
    }
    setMerging(true)
    setEncodeCancelError(null)
    encodeProgress.start({ kind: 'merge', clipPaths: mergeClips })
    try {
      const result: ClipMergeResult = await window.dinho.clipsMergeClips(mergeClips, enhance, sharpness)
      if (result.success) {
        toast.success(t('mergeSuccess'))
        if (mountedRef.current) onSave()
      } else if (result.cancelled) {
        toast.info(t('mergeCancelled'))
      } else {
        toast.error(result.error || t('mergeFailed'))
      }
    } catch {
      toast.error(t('mergeFailed'))
    } finally {
      if (mountedRef.current) {
        setMerging(false)
        encodeProgress.stop()
      }
    }
  }

  return {
    trimming,
    merging,
    reEncode,
    setReEncode,
    encodeProgress,
    encodeCancelError,
    qualityEnhancementSelected,
    handleTrim,
    handleImproveQuality,
    handleMerge,
    handleCancelEncode,
  }
}
