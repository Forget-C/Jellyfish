import { useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AssetEditPageBase } from '../../assets/components/AssetEditPageBase'
import { assetAdapters } from '../../assets/assetAdapters'

export default function RoleDetailPage() {
  const navigate = useNavigate()
  const onNavigate = useCallback((to: string, replace?: boolean) => navigate(to, replace ? { replace: true } : undefined), [navigate])
  const { projectId, characterId } = useParams<{ projectId: string; characterId: string }>()
  const adapter = assetAdapters.character

  if (!characterId) {
    return null
  }

  return (
    <AssetEditPageBase
      key={characterId}
      assetId={characterId}
      {...adapter}
      backTo={projectId ? `/projects/${projectId}?tab=roles` : adapter.backTo}
      onNavigate={onNavigate}
    />
  )
}
