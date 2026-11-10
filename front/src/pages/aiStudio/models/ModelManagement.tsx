import { useRef, useState } from 'react'
import { Tabs } from 'antd'
import ProvidersTab from './ProvidersTab'
import ModelsTab from './ModelsTab'
import SettingsTab from './SettingsTab'
import { PageToolbar, WorkspaceLayout } from '../../../components'

export default function ModelManagement() {
  const [activeTab, setActiveTab] = useState<string>('providers')
  const headerRef = useRef<HTMLDivElement>(null)
  const selectTab = (key: string) => {
    setActiveTab(key)
    // 页签在各分栏内容右侧重新挂载后，继续保留用户的键盘位置。
    requestAnimationFrame(() => headerRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus())
  }
  const header = <div ref={headerRef} className="management-model-header">
    <PageToolbar title="模型管理" className="management-heading">
      <Tabs
        className="management-tabs"
        activeKey={activeTab}
        onChange={selectTab}
        size="small"
        items={[
          { key: 'providers', label: '供应商' },
          { key: 'models', label: '模型' },
          { key: 'settings', label: '运行设置' },
        ]}
      />
    </PageToolbar>
  </div>

  return (
    <WorkspaceLayout className="management-page">
      {activeTab === 'providers' && <ProvidersTab header={header} />}
      {activeTab === 'models' && <ModelsTab header={header} />}
      {activeTab === 'settings' && <>{header}<SettingsTab onOpenModels={() => selectTab('models')} /></>}
    </WorkspaceLayout>
  )
}
