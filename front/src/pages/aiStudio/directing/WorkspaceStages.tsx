import { Button, Space, Tabs, Typography } from 'antd'
import type { TabsProps } from 'antd'
import { workspaceStages, workspaceView, workspaceViews } from './workspaceNavigation'

/** 三阶段主导航与阶段内工具共用旧 view，已打开的编辑面板保持挂载。 */
export function WorkspaceStages({ view, onChange, items }: { view: string | null; onChange: (view: string) => void; items: TabsProps['items'] }) {
  const current = workspaceView(view)
  const stage = workspaceViews[current].stage
  return <section aria-label="场次制作流程">
    <Tabs className="workspace-stage-tabs" activeKey={stage} onChange={onChange} onTabClick={key => { if (key === stage && current !== stage) onChange(key) }} items={workspaceStages.map(item => ({
      key: item.key,
      label: <Space direction="vertical" size={0}><span>{item.title}</span><Typography.Text type="secondary">{item.output}</Typography.Text></Space>,
    }))} />
    <Tabs activeKey={current} items={items} renderTabBar={() => <Space wrap style={{ marginBottom: 16 }} aria-label="本阶段工具">
      {Object.entries(workspaceViews).filter(([key, item]) => item.stage === stage || key === 'ledger').map(([key, item]) => <Button key={key} aria-current={key === current ? 'page' : undefined} type="text" style={key === current ? { background: 'var(--ant-color-fill-secondary, #f0f0f0)', fontWeight: 600 } : undefined} onClick={() => onChange(key)}>{item.title}</Button>)}
    </Space>} />
  </section>
}
