import { useCallback, useRef, useState } from 'react'
import { AssetEditPageBase } from '../../assets/components/AssetEditPageBase'
import { assetAdapters } from '../../assets/assetAdapters'
import './project-asset-detail.css'

const localList = '当前项目资源列表'

/** 在项目正文复用管理资产详情；列表组件不卸载，地址与分页状态不变。 */
export function useProjectAssetDetail(kind: keyof typeof assetAdapters, refresh: () => Promise<unknown>) {
  const [assetId, setAssetId] = useState<string>()
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  const origin = useRef<{ panel: HTMLElement | null; top: number; id?: string }>({ panel: null, top: 0 })
  const openDetail = (id: string) => {
    const trigger = document.activeElement as HTMLElement | null
    const panel = trigger?.closest<HTMLElement>('.project-workbench-content') ?? document.querySelector<HTMLElement>('.project-workbench-content')
    origin.current = { panel, top: panel?.scrollTop ?? 0, id }
    if (panel) panel.scrollTop = 0
    setAssetId(id)
  }
  const closeDetail = useCallback(async (to?: string) => {
    if (to && to !== localList) return
    await refreshRef.current()
    setAssetId(undefined)
    requestAnimationFrame(() => {
      const { panel, top, id } = origin.current
      if (!panel?.isConnected) return
      panel.scrollTop = top
      const trigger = id ? panel.querySelector<HTMLElement>(`[data-project-asset-id="${CSS.escape(id)}"]`) : null
      trigger?.focus({ preventScroll: true })
    })
  }, [])
  const detailView = assetId ? <div className="project-asset-detail-view">
    <AssetEditPageBase key={`${kind}:${assetId}`} {...assetAdapters[kind]} assetId={assetId}
      backTo={localList} onNavigate={closeDetail} />
  </div> : null
  return { openDetail, detailView }
}
