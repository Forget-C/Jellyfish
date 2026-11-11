import { useCallback } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AssetEditPageBase } from './components/AssetEditPageBase'
import { assetAdapters } from './assetAdapters'
import { decodeAssetEditReturnTo } from '../project/ProjectWorkbench/utils/workbenchAssetReturnTo'

export default function ActorAssetEditPage() {
  const navigate = useNavigate()
  const onNavigate = useCallback((to: string, replace?: boolean) => navigate(to, replace ? { replace: true } : undefined), [navigate])
  const [searchParams] = useSearchParams()
  const { actorImageId } = useParams<{ actorImageId: string }>()
  const adapter = assetAdapters.actor
  const backTo = decodeAssetEditReturnTo(searchParams.get('returnTo'), adapter.backTo)

  return (
    <AssetEditPageBase<any, any>
      key={actorImageId}
      assetId={actorImageId}
      onNavigate={onNavigate}
      {...adapter}
      backTo={backTo}
    />
  )
}




