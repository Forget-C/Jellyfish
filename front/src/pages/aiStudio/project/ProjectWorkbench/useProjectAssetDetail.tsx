import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AssetEditPageBase } from '../../assets/components/AssetEditPageBase'
import { assetAdapters } from '../../assets/assetAdapters'
import { ProjectContentToolbar } from './ProjectContentToolbar'
import './project-asset-detail.css'

const renderToolbar = (children: ReactNode) => <ProjectContentToolbar>{children}</ProjectContentToolbar>

const localList = '当前项目资源列表'

/** 在项目正文复用管理资产详情；列表组件不卸载，地址与分页状态不变。 */
export function useProjectAssetDetail(kind: keyof typeof assetAdapters, refresh: () => Promise<unknown>, listReady: boolean) {
  const [assetId, setAssetId] = useState<string>()
  const [returning, setReturning] = useState(false)
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  const origin = useRef<{ panel: HTMLElement | null; top: number; id?: string }>({ panel: null, top: 0 })
  const openDetail = (id: string) => {
    const trigger = document.activeElement as HTMLElement | null
    const panel = trigger?.closest<HTMLElement>('.project-resource-scroll') ?? document.querySelector<HTMLElement>('.project-resource-scroll')
    origin.current = { panel, top: panel?.scrollTop ?? 0, id }
    if (panel) panel.scrollTop = 0
    setAssetId(id)
  }
  const closeDetail = useCallback(async (to?: string) => {
    if (to && to !== localList) return
    await refreshRef.current()
    setAssetId(undefined)
    setReturning(true)
  }, [])
  useEffect(() => {
    if (!returning || !listReady) return
    const frame = requestAnimationFrame(() => {
      const { panel, top, id } = origin.current
      if (panel?.isConnected) panel.scrollTop = top
      const trigger = id ? panel?.querySelector<HTMLElement>(`[data-project-asset-id="${CSS.escape(id)}"]`) : null
      const search = document.querySelector<HTMLElement>('[data-project-resource-search]')
      const target = trigger ?? search
      target?.focus({ preventScroll: !!trigger })
      setReturning(false)
    })
    return () => cancelAnimationFrame(frame)
  }, [listReady, returning])
  const detailView = assetId ? <div className="project-asset-detail-view">
    <AssetEditPageBase key={`${kind}:${assetId}`} {...assetAdapters[kind]} assetId={assetId}
      renderToolbar={renderToolbar} backTo={localList} onNavigate={closeDetail} />
  </div> : null
  return { openDetail, detailView }
}
