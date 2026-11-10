import { useEffect, useRef, useState } from 'react'
import { StudioFilesService, type FileRead } from '../../../../services/generated'

type UploadFailure<T> = { target: T; file: File; message: string; retryable: boolean }

/** 已上传文件始终归资料库，只有当前编辑面板能接收它作为临时参考。 */
export function useExperimentReferenceUpload<T>(onUploaded: (file: FileRead) => void, failureMessage: string) {
  const [uploading, setUploading] = useState(false)
  const [uploaded, setUploaded] = useState<string>()
  const [uploadError, setUploadError] = useState<UploadFailure<T>>()
  const panelEpoch = useRef(0)
  const pending = useRef(false)

  useEffect(() => () => { panelEpoch.current += 1 }, [])

  const clearFeedback = () => {
    setUploaded(undefined)
    setUploadError(undefined)
  }

  const resetUpload = () => {
    panelEpoch.current += 1
    pending.current = false
    setUploading(false)
    clearFeedback()
  }

  const uploadFile = async (file: File, target: T, select: (saved: FileRead) => void, validationError?: string) => {
    if (pending.current) return
    clearFeedback()
    if (validationError) {
      setUploadError({ target, file, message: validationError, retryable: false })
      return
    }

    const epoch = panelEpoch.current
    pending.current = true
    setUploading(true)
    try {
      const response = await StudioFilesService.uploadFileApiApiV1StudioFilesUploadPost({ formData: { file: file as unknown as string } })
      const saved = response.data
      if (!saved) throw new Error('上传未返回文件信息')
      onUploaded(saved)
      if (panelEpoch.current !== epoch) return
      select(saved)
      setUploaded(saved.name)
    } catch {
      if (panelEpoch.current === epoch) setUploadError({ target, file, message: failureMessage, retryable: true })
    } finally {
      if (panelEpoch.current === epoch) {
        pending.current = false
        setUploading(false)
      }
    }
  }

  return { uploading, uploaded, uploadError, clearFeedback, resetUpload, uploadFile, isUploadPending: () => pending.current }
}
