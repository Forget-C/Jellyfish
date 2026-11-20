import { useCallback } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AssetEditPageBase } from './components/AssetEditPageBase'
import { assetAdapters } from './assetAdapters'
import { decodeAssetEditReturnTo } from '../project/ProjectWorkbench/utils/workbenchAssetReturnTo'

export default function SceneAssetEditPage() {
  const navigate = useNavigate()
  const onNavigate = useCallback((to: string, replace?: boolean) => navigate(to, replace ? { replace: true } : undefined), [navigate])
  const [searchParams] = useSearchParams()
  const { sceneId } = useParams<{ sceneId: string }>()
  const adapter = assetAdapters.scene
  const backTo = decodeAssetEditReturnTo(searchParams.get('returnTo'), adapter.backTo)

  return (
    <AssetEditPageBase
      key={sceneId}
      assetId={sceneId}
      onNavigate={onNavigate}
      {...adapter}
      backTo={backTo}
    />
  )
}

