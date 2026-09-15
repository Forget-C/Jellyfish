import { useState, type ReactNode } from 'react'
import { Button, Drawer, Grid } from 'antd'
import { MenuOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons'

/** 管理页的同一组筛选：桌面侧栏可收起，窄屏从明确入口打开抽屉。 */
export function WorkspaceSidebar({ title, children }: { title: string; children: ReactNode }) {
  const { lg } = Grid.useBreakpoint()
  const [collapsed, setCollapsed] = useState(false)
  const [open, setOpen] = useState(false)
  if (!lg) return <>
    <div className="app-sidebar-toggle"><Button icon={<MenuOutlined />} onClick={() => setOpen(true)}>{title}</Button></div>
    <Drawer className="app-sidebar-drawer" title={title} placement="left" width={272} open={open} onClose={() => setOpen(false)}>{children}</Drawer>
  </>
  return <aside className="app-management-sidebar" style={{ width: collapsed ? 48 : 208 }} aria-label={title}>
    <div className="app-sidebar-heading">
      {!collapsed && <span>{title}</span>}
      <Button type="text" aria-label={`${collapsed ? '展开' : '收起'}${title}`} icon={collapsed ? <RightOutlined /> : <LeftOutlined />} onClick={() => setCollapsed(value => !value)} />
    </div>
    {!collapsed && children}
  </aside>
}
