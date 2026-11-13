import { Alert } from 'antd'
import { useParams } from 'react-router-dom'
import { ResourceEditorDrawer, type ResourceKind } from './ResourceEditorDrawer'

type Props = {
  assetId?: string
  missingAssetIdText: string
  relationType: string
  backTo: string
  onNavigate: (to: string, replace?: boolean) => void
}

/** 现有详情路由与工作台入口统一复用对象抽屉。 */
export function AssetEditPageBase(props: Props) {
  const { projectId } = useParams<{ projectId: string }>()
  if (!props.assetId) return <Alert type="error" message={props.missingAssetIdText} />
  const kind = props.relationType.replace(/_image$/, '') as ResourceKind
  return <ResourceEditorDrawer open kind={kind} assetId={props.assetId} projectId={projectId}
    onClose={() => props.onNavigate(props.backTo)} />
}
