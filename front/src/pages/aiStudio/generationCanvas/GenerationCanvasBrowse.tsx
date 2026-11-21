import { useUiText } from '../../../uiText'
import { useLayoutEffect, useRef, useState } from 'react'
import { Select, Switch } from 'antd'
import { LeftOutlined, SearchOutlined } from '@ant-design/icons'
import { WorkbenchButton, WorkbenchIconButton } from '../../../components/workbench/WorkbenchButton'

export type CanvasDisplayFilter = { group: string; modality: string; problems: boolean }

/** 展示筛选不持有业务绑定或生成范围；使用工作台导航与筛选样式。 */
export function GenerationCanvasBrowse({ value, onChange }: { value: CanvasDisplayFilter; onChange: (next: CanvasDisplayFilter) => void }) {
  const uiText = useUiText()
  const preference = 'jellyfish:canvas-filters:generation'
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(preference) === 'collapsed' } catch { return false } })
  const root = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState(64)
  useLayoutEffect(() => {
    const toolbar = root.current?.closest('.generation-workbench')?.querySelector('.generation-workbench-header')
    if (!toolbar) return
    const measure = () => setTop(toolbar.getBoundingClientRect().bottom + 12)
    const observer = new ResizeObserver(measure)
    observer.observe(toolbar); measure()
    return () => observer.disconnect()
  }, [])
  const toggle = () => {
    setCollapsed(!collapsed)
    try { localStorage.setItem(preference, collapsed ? 'expanded' : 'collapsed') } catch { /* 会话内继续切换。 */ }
  }
  const filtered = !!value.group || !!value.modality || value.problems
  return <div ref={root} className="generation-browse" style={{ top }}>
    <nav className="canvas-breadcrumb" aria-label={uiText("生成画布位置")}><WorkbenchButton variant="quiet" aria-current="page">{uiText("总览")}</WorkbenchButton></nav>
    <aside className="canvas-filters" aria-label={uiText("画布筛选")} data-collapsed={collapsed}>
      <div hidden={collapsed} className="canvas-filter-fields">
        <Select aria-label={uiText("卡片分类")} value={value.group} onChange={group => onChange({ ...value, group })} options={[{ value: '', label: uiText("全部分类") }, ...['基础内容', '模型生成', '导演工具箱'].map(group => ({ value: group, label: uiText(group) }))]} />
        <Select aria-label={uiText("卡片模态")} value={value.modality} onChange={modality => onChange({ ...value, modality })} options={[{ value: '', label: uiText("全部模态") }, ...Object.entries({ text: '文本', image: '图片', video: '视频', audio: '音频' }).map(([key, label]) => ({ value: key, label: uiText(label) }))]} />
        <label>{uiText("高亮问题卡片")}<Switch aria-label={uiText("高亮问题卡片")} checked={value.problems} onChange={problems => onChange({ ...value, problems })} /></label>
      </div>
      <WorkbenchIconButton variant="quiet" label={collapsed ? uiText("展开筛选") : uiText("收起筛选")} icon={collapsed ? <SearchOutlined /> : <LeftOutlined />} aria-expanded={!collapsed} onClick={toggle} />
      {filtered && <span className="canvas-filter-active" role="status" aria-label={uiText("筛选已生效")} />}
    </aside>
  </div>
}
