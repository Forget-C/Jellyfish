import { useEffect, useState } from 'react'
import { StudioDirectingService } from '../../../services/generated'
import type { AssetSummary } from '../../../services/generated'
import { directingError } from './common'
import { WorkbenchButton } from './ui/WorkbenchButton'

/** 只用当前项目资产核对场所名称；失败时保留关联 ID，允许原位重读。 */
export function DirectorLocationSummary({ projectId, assetId }: { projectId: string; assetId?: string | null }) {
  const [assets, setAssets] = useState<AssetSummary[]>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setAssets(undefined); setError('')
    void StudioDirectingService.directingAssets({ projectId }).then(result => {
      if (!result.data) throw new Error('资产列表尚未核实')
      if (active) setAssets(result.data)
    }).catch(cause => { if (active) setError(directingError(cause)) })
    return () => { active = false }
  }, [projectId, attempt])
  const asset = assets?.find(item => item.id === assetId && item.kind === 'scene')
  return <div className="design-compact-summary">
    <div className="design-compact-fields"><p><span>本场场所</span><strong>{!assetId ? '未关联项目场所' : error ? `读取失败 · 保留关联 ${assetId}` : !assets ? `正在核对 · ${assetId}` : asset?.name || `关联对象缺失 · ${assetId}`}</strong></p></div>
    <div className="design-compact-status"><span>{assetId ? '全场适用' : '未关联'}</span>{error && <WorkbenchButton variant="quiet" onClick={() => setAttempt(value => value + 1)}>重试读取资产</WorkbenchButton>}</div>
  </div>
}
