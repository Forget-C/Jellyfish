import { useEffect, useRef } from 'react'
import { StudioEntitiesService } from '../../../services/generated'
import { ResourceSelectionDrawer } from '../assets/components/ResourceSelectionDrawer'
import { apiErrorMessage } from '../../../services/apiErrorMessage'

export function ObjectAssociationEditor({ projectId, kind, objectName, sameName, assetId, disabled, onSave, open, onClose }: {
  projectId: string; kind: 'character' | 'scene' | 'prop'; objectName: string; sameName: boolean
  open: boolean; onClose: () => void; assetId?: string | null; disabled: boolean
  onSave: (id: string) => Promise<boolean>
}) {
  const importedId = useRef<string>()
  useEffect(() => { if (open) importedId.current = undefined }, [open])
  if (!open) return null
  return <ResourceSelectionDrawer mode={sameName ? 'same-name' : 'select'} projectId={projectId} kind={kind} objectName={objectName}
    assetId={assetId} disabled={disabled} onClose={onClose} onConfirm={async (choice, name, requestId) => {
      try {
        if (choice.source === 'library' && !importedId.current) {
          await StudioEntitiesService.createImageSourceEntityApiV1StudioEntitiesEntityTypeImageSourcePost({ entityType: kind,
            requestBody: { id: requestId, name, project_id: projectId, source_id: choice.id } })
          importedId.current = requestId
        }
        const complete = await onSave(importedId.current ?? choice.id)
        return { complete, created: !!importedId.current, error: importedId.current ? '资源已导入，选用未完成。重试将使用已创建的副本，不会重复导入。' : '选用未完成，请核对后重试。' }
      } catch (cause) { return { complete: false, created: !!importedId.current, error: apiErrorMessage(cause) } }
    }} />
}
