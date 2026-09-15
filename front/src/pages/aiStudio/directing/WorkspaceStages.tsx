import { Button, Dropdown, Tabs } from 'antd'
import type { TabsProps } from 'antd'
import { workspaceStages, workspaceView, workspaceViews } from './workspaceNavigation'

/** 三阶段固定在控制栏之上；辅助工具保留旧 view 和已打开编辑器的挂载。 */
export function WorkspaceStages({ view, onChange, items, onContext }: { view: string | null; onChange: (view: string) => void; items: TabsProps['items']; onContext?: (key: string) => void }) {
  const current = workspaceView(view)
  const stage = workspaceViews[current].stage
  return <section className="sequence-stages" aria-label="场次制作流程">
    <Tabs className="workspace-stage-tabs" activeKey={stage} onChange={onChange} onTabClick={key => { if (key === stage && current !== stage) onChange(key) }} tabBarExtraContent={stage !== 'design' && <Dropdown trigger={['click']} menu={{ selectedKeys: [current], items: [...Object.entries(workspaceViews).filter(([key, item]) => item.stage === stage || key === 'ledger').map(([key, item]) => ({ key, label: item.title, onClick: () => onChange(key) })), { type: 'divider' }, ...[['help', '当前进展'], ['source', '本场原文'], ['history', '版本与历史'], ['refresh', '刷新状态']].map(([key, label]) => ({ key, label, onClick: () => onContext?.(key) }))] }}><Button type="text"><span className="stage-tool-label">阶段工具</span>⌄</Button></Dropdown>} items={workspaceStages.map(item => ({ key: item.key, label: <span>{item.title}</span> }))} />
    <Tabs className="sequence-view-panels" activeKey={current} items={items} renderTabBar={() => <></>} />
  </section>
}
