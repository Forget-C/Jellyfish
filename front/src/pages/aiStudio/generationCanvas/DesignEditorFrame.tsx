import { createContext, useState, type ReactNode } from 'react'
import { ConfigProvider, Dropdown, Tabs } from 'antd'
import { MoreOutlined } from '@ant-design/icons'
import { WorkbenchIconButton } from '../directing/ui/WorkbenchButton'

export const DesignEditorActive = createContext(true)

/** 设计与参考分区保持挂载；浏览不改变采用关系或字段保存方式。 */
export function DesignEditorFrame({ children, references, onDuplicate, disabled }: { children: ReactNode; references: ReactNode; onDuplicate?: () => void; disabled?: boolean }) {
  const [tab, setTab] = useState('design')
  return <div className="design-editor-frame">
    <ConfigProvider componentDisabled={false}><Tabs activeKey={tab} onChange={setTab} tabBarExtraContent={onDuplicate && <Dropdown menu={{ items: [{ key: 'duplicate', label: '复制为独立摄影方案', disabled }], onClick: onDuplicate }}><WorkbenchIconButton label="设计更多操作" icon={<MoreOutlined />} variant="quiet" /></Dropdown>} items={[{ key: 'design', label: '设计参数' }, { key: 'references', label: '参考与关联' }]} /></ConfigProvider>
    <div hidden={tab !== 'design'}><DesignEditorActive.Provider value={tab === 'design'}>{children}</DesignEditorActive.Provider></div>
    <div hidden={tab !== 'references'} className="design-editor-references">{references}</div>
  </div>
}
