import { useCallback } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AssetEditPageBase } from './components/AssetEditPageBase'
import { assetAdapters } from './assetAdapters'
import { decodeAssetEditReturnTo } from '../project/ProjectWorkbench/utils/workbenchAssetReturnTo'

export default function PropAssetEditPage() {
  const navigate = useNavigate()
  const onNavigate = useCallback((to: string, replace?: boolean) => navigate(to, replace ? { replace: true } : undefined), [navigate])
  const [searchParams] = useSearchParams()
  const { propId } = useParams<{ propId: string }>()
  const adapter = assetAdapters.prop
  const backTo = decodeAssetEditReturnTo(searchParams.get('returnTo'), adapter.backTo)

  return (
    <AssetEditPageBase
      key={propId}
      assetId={propId}
      onNavigate={onNavigate}
      {...adapter}
      backTo={backTo}
    />
  )
}

