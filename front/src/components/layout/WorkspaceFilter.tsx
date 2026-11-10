import { useState, type ReactNode } from 'react'
import { Button, Drawer } from 'antd'
import { FilterOutlined } from '@ant-design/icons'

/** 工作台筛选由内容区工具栏打开，常驻侧栏留给领域导航。 */
export function WorkspaceFilter({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return <>
    <Button icon={<FilterOutlined />} aria-label={title} aria-expanded={open} onClick={() => setOpen(true)}>{title}</Button>
    <Drawer className="app-sidebar-drawer" title={title} placement="right" width="min(320px, 100vw)"
      open={open} onClose={() => setOpen(false)}>{children}</Drawer>
  </>
}
