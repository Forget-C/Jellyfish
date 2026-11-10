import { useEffect, useState } from 'react'
import { StudioFilesService } from '../../../services/generated'

/** 查询固定来源的对象可用性，供溯源和主动选帧使用。 */
export function useVideoSourceStatus(fileId?: string) {
  const [check, setCheck] = useState<{ id: string; available: boolean }>()
  useEffect(() => {
    if (!fileId) return
    const request = StudioFilesService.getFileStorageInfoApiApiV1StudioFilesFileIdStorageInfoGet({ fileId })
    let active = true
    void request.then(response => { if (active) setCheck({ id: fileId, available: !!response.data }) })
      .catch(() => { if (active) setCheck({ id: fileId, available: false }) })
    return () => { active = false; request.cancel() }
  }, [fileId])
  if (!fileId || check?.id !== fileId) return 'pending'
  return check.available ? 'available' : 'unavailable'
}
