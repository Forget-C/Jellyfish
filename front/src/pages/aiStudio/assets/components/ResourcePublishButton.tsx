import { useState } from 'react'
import { Button } from 'antd'
import { ResourceEditorDrawer, resourceAssetUrl, type ResourceKind } from './ResourceEditorDrawer'

/** 项目卡片提供明确入库入口，成功后只提供独立副本的查看入口。 */
export function ResourcePublishButton({ kind, asset, projectId, onSaved }: {
  kind: ResourceKind; asset: { id: string; project_id?: string | null; library_copy_id?: string | null }
  projectId?: string; onSaved: () => void | Promise<unknown>
}) {
  const [open, setOpen] = useState(false)
  const [copyId, setCopyId] = useState<string>()
  if (!projectId || asset.project_id !== projectId) return null
  const target = copyId ?? asset.library_copy_id
  return <>
    {target ? <Button type="link" size="small" target="_blank" rel="noopener noreferrer"
      href={resourceAssetUrl(kind === 'character' ? 'actor' : kind, target)}>查看库中资产</Button>
      : <Button size="small" onClick={() => setOpen(true)}>进入资产库</Button>}
    {open && <ResourceEditorDrawer open kind={kind} assetId={asset.id} projectId={projectId} initialPage="publish"
      onClose={() => setOpen(false)} onSaved={async resource => { if (resource.library_copy_id) setCopyId(resource.library_copy_id); await onSaved() }} />}
  </>
}
