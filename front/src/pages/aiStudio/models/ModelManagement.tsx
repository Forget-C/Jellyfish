import { useRef, useState } from 'react'
import { Layout, Tabs } from 'antd'
import ProvidersTab from './ProvidersTab'
import ModelsTab from './ModelsTab'
import SettingsTab from './SettingsTab'
import { PageToolbar } from '../../../components'

export default function ModelManagement() {
  const [activeTab, setActiveTab] = useState<string>('providers')
  const headerRef = useRef<HTMLDivElement>(null)
  const header = <div ref={headerRef} className="flex-shrink-0">
    <PageToolbar title="模型管理" />
    <Tabs
      className="app-page-tabs"
      activeKey={activeTab}
      onChange={key => {
        setActiveTab(key)
        // 页签在各分栏内容右侧重新挂载后，继续保留用户的键盘位置。
        requestAnimationFrame(() => headerRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus())
      }}
      size="small"
      items={[
        { key: 'providers', label: '供应商' },
        { key: 'models', label: '模型' },
        { key: 'settings', label: '运行设置' },
      ]}
    />
  </div>

  return (
    <Layout className="h-full flex flex-col" style={{ minHeight: 0 }}>
      {activeTab === 'providers' && <ProvidersTab header={header} />}
      {activeTab === 'models' && <ModelsTab header={header} />}
      {activeTab === 'settings' && <>{header}<div className="flex-1 flex flex-col min-h-0 overflow-hidden"><SettingsTab /></div></>}
    </Layout>
  )
}
