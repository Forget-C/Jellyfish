import { createContext, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { ArrowLeftOutlined, ArrowRightOutlined, FilterOutlined, LeftOutlined } from '@ant-design/icons'
import { WorkbenchIconButton } from './ui/WorkbenchButton'
import { useGraphBrowse } from './useGraphBrowse'

export const CanvasBrowseContext = createContext<{
  kind: string; history: HTMLElement | null; breadcrumb: HTMLElement | null; filters: HTMLElement | null; actions: HTMLElement | null; notices: HTMLElement | null
} | null>(null)

/** 导航、位置与筛选各有固定宿主；筛选显隐仅是设备偏好，不修改浏览历史或画布几何。 */
export function CanvasBrowse({ storageKey, label, children, filters, filtered = false, actions, notice }: {
  storageKey: string; label: string; children: ReactNode; filters?: ReactNode; filtered?: boolean; actions?: ReactNode; notice?: ReactNode
}) {
  const hosts = useContext(CanvasBrowseContext)
  const navigate = useNavigate()
  const { canBrowse } = useGraphBrowse(storageKey)
  const preference = `jellyfish:canvas-filters:${hosts?.kind || label}`
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(preference) === 'collapsed' } catch { return false }
  })
  const toggle = () => {
    setCollapsed(!collapsed)
    try { localStorage.setItem(preference, collapsed ? 'expanded' : 'collapsed') } catch { /* 会话内仍可切换。 */ }
  }
  const render = (content: ReactNode, host?: HTMLElement | null) => hosts ? host && createPortal(content, host) : content
  return <>
    {render(<nav className="canvas-browse-history" aria-label="画布浏览历史">
      <WorkbenchIconButton label="后退" variant="quiet" icon={<ArrowLeftOutlined />} disabled={!canBrowse(-1)} onClick={() => navigate(-1)} />
      <WorkbenchIconButton label="前进" variant="quiet" icon={<ArrowRightOutlined />} disabled={!canBrowse(1)} onClick={() => navigate(1)} />
    </nav>, hosts?.history)}
    {render(<nav className="canvas-breadcrumb" aria-label={label} data-graph-navigation>{children}</nav>, hosts?.breadcrumb)}
    {filters && render(<aside className="canvas-filters" aria-label="画布筛选" data-collapsed={collapsed}>
      <header><WorkbenchIconButton label={collapsed ? '展开筛选' : '收起筛选'} icon={collapsed ? <FilterOutlined /> : <LeftOutlined />} aria-expanded={!collapsed} onClick={toggle} />
        {filtered && <span role="status">筛选中</span>}</header>
      <div hidden={collapsed} className="canvas-filter-fields">{filters}</div>
    </aside>, hosts?.filters)}
    {actions && render(actions, hosts?.actions)}
    {notice && render(notice, hosts?.notices)}
  </>
}
