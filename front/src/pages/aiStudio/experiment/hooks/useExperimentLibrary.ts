import { useCallback, useEffect, useState } from 'react'
import { StudioFilesService, type FileRead } from '../../../../services/generated'

/** 资料库与已采用参考分开；列表返回时保留期间上传的文件。 */
export function useExperimentLibrary(kind: 'image' | 'video') {
  const [files, setFiles] = useState<FileRead[]>([])
  const [libraryState, setLibraryState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const loadLibrary = useCallback(async () => {
    setLibraryState('loading')
    try {
      const response = await StudioFilesService.listFilesApiApiV1StudioFilesGet({ page: 1, pageSize: 100, order: 'updated_at', isDesc: true })
      const media = (response.data?.items ?? []).filter(file => file.type === 'image' || kind === 'video' && file.type === 'video')
      setFiles(current => [...new Map([...media, ...current].map(file => [file.id, file])).values()])
      setLibraryState('ready')
    } catch {
      setLibraryState('failed')
    }
  }, [kind])
  useEffect(() => { void loadLibrary() }, [loadLibrary])
  const onUploaded = useCallback((file: FileRead) => {
    setFiles(current => [file, ...current.filter(item => item.id !== file.id)])
  }, [])
  return { files, libraryState, loadLibrary, onUploaded }
}
