import { useState } from 'react'
import { Layout, Tabs } from 'antd'
import ProvidersTab from './ProvidersTab'
import ModelsTab from './ModelsTab'
import ModelChatPlaygroundTab from './ModelChatPlaygroundTab'
import SettingsTab from './SettingsTab'

export default function ModelManagement() {
  const [activeTab, setActiveTab] = useState<string>('providers')

  return (
    <Layout className="h-full flex flex-col" style={{ minHeight: 0 }}>
      <div className="flex-shrink-0 px-4 py-3 border-b border-gray-200 bg-white space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold text-gray-800">模型管理</span>
        </div>
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          size="small"
          items={[
            { key: 'providers', label: '供应商' },
            { key: 'models', label: '模型' },
            { key: 'chat', label: '试聊' },
            { key: 'settings', label: '设置' },
          ]}
        />
      </div>

      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {activeTab === 'providers' && <ProvidersTab />}
        {activeTab === 'models' && <ModelsTab />}
        {activeTab === 'chat' && <ModelChatPlaygroundTab />}
        {activeTab === 'settings' && <SettingsTab />}
      </div>
    </Layout>
  )
}
