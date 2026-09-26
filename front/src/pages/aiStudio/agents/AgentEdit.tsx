import React, { useEffect, useState } from 'react'
import {
  Layout,
  Button,
  Input,
  Select,
  Space,
  Tabs,
  InputNumber,
  Slider,
  message,
} from 'antd'
import {
  ArrowLeftOutlined,
  SaveOutlined,
  ThunderboltOutlined,
  HistoryOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../../../services/aiStudioApi'
import type { Agent, AgentTypeKey } from '../../../mocks/data'

const AGENT_TYPES: { value: AgentTypeKey; label: string }[] = [
  { value: 'plot', label: '剧情提取' },
  { value: 'character', label: '角色提取' },
  { value: 'scene', label: '场景提取' },
  { value: 'prop', label: '道具提取' },
  { value: 'other', label: '其他类型' },
]

export default function AgentEdit() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [agent, setAgent] = useState<Agent | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [editName, setEditName] = useState('')
  const [editType, setEditType] = useState<AgentTypeKey>('plot')
  const [editDesc, setEditDesc] = useState('')
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [testInput, setTestInput] = useState('')
  const [testOutput, setTestOutput] = useState('')
  const [testLogs, setTestLogs] = useState<string[]>([])
  const [testPanelCollapsed, setTestPanelCollapsed] = useState(false)
  const [promptDraft, setPromptDraft] = useState('')
  const [temperature, setTemperature] = useState(0.7)
  const [topP, setTopP] = useState(0.9)
  const [testTab, setTestTab] = useState<'output' | 'history'>('output')

  const load = async () => {
    if (!id) return
    setLoading(true)
    try {
      const a = await api.agents.get(id)
      setAgent(a)
      setEditName(a.name)
      setEditType(a.type)
      setEditDesc(a.description)
      setPromptDraft('从以下剧本中提取主线剧情，输出结构化 JSON。')
    } catch {
      message.error('加载 Agent 失败')
      navigate('/agents')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [id])

  const handleSave = async () => {
    if (!id) return
    setSaving(true)
    try {
      await api.agents.update(id, {
        name: editName.trim(),
        type: editType,
        description: editDesc.trim(),
      })
      message.success('保存成功')
      setAgent((prev) => (prev ? { ...prev, name: editName, type: editType, description: editDesc } : null))
    } catch {
      message.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleRunTest = async () => {
    setTesting(true)
    setTestLogs([])
    setTestOutput('')
    try {
      setTestLogs((l) => [...l, '[INFO] 开始执行...', '[INFO] 调用 LLM 节点...'])
      await new Promise((r) => setTimeout(r, 1200))
      setTestLogs((l) => [...l, '[OK] 提取完成'])
      setTestOutput(
        JSON.stringify(
          {
            plot_points: ['开场：出租屋争吵', '发展：身份证丢失', '高潮：雨夜寻找'],
            summary: '基于剧本提取的主线剧情摘要。',
          },
          null,
          2
        )
      )
    } catch {
      setTestLogs((l) => [...l, '[ERROR] 执行失败'])
      message.error('测试执行失败')
    } finally {
      setTesting(false)
    }
  }

  // 简易工作流占位节点（后续可替换为 React Flow）
  const workflowNodes = [
    { id: 'start', label: '开始', type: 'start' },
    { id: 'llm1', label: 'LLM 提取', type: 'llm' },
    { id: 'end', label: '结束', type: 'end' },
  ]

  if (loading || !agent) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        {loading ? '加载中...' : null}
      </div>
    )
  }

  return (
    <Layout className="h-full flex flex-col" style={{ minHeight: 0 }}>
      {/* 顶部工具栏 */}
      <div className="flex-shrink-0 flex flex-wrap items-center gap-2 px-4 py-2 border-b border-gray-200 bg-white">
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/agents')}>
          返回列表
        </Button>
        <Input
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          className="font-medium w-48"
          placeholder="Agent 名称"
        />
        <Select
          value={editType}
          onChange={setEditType}
          options={AGENT_TYPES}
          style={{ width: 140 }}
        />
        <Space className="ml-auto">
          <Button icon={<HistoryOutlined />}>版本管理</Button>
          <Button icon={<ThunderboltOutlined />} loading={testing} onClick={() => void handleRunTest()}>
            测试
          </Button>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void handleSave()}>
            保存
          </Button>
        </Space>
      </div>

      {/* 双栏：工作流 + 属性 */}
      <Layout className="flex-1 min-h-0 flex-row overflow-hidden">
        {/* 左侧：工作流编辑器占位 */}
        <div className="flex-1 min-w-0 overflow-auto p-4 bg-gray-50 border-r border-gray-200">
          <div className="text-sm text-gray-500 mb-2">工作流编排（可接入 React Flow）</div>
          <div className="relative rounded-lg border-2 border-dashed border-gray-300 bg-white p-6 min-h-[320px]">
            <div className="flex flex-col items-center gap-4">
              {workflowNodes.map((node, i) => (
                <React.Fragment key={node.id}>
                  <div
                    className={`px-4 py-2 rounded-lg border-2 cursor-pointer transition-colors ${
                      selectedNodeId === node.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-300 bg-white hover:border-gray-400'
                    }`}
                    onClick={() => setSelectedNodeId(selectedNodeId === node.id ? null : node.id)}
                  >
                    <span className="font-medium">{node.label}</span>
                    {/* 审计 §4.6 模式 3：`({node.type})` 是英文节点类型码（`start` / `llm` / `end`），
                        左侧中文标签已经说明是什么节点了 —— 按审计口径去掉，不另造说法。 */}
                  </div>
                  {i < workflowNodes.length - 1 && (
                    <div className="w-0.5 h-6 bg-gray-300" />
                  )}
                </React.Fragment>
              ))}
            </div>
            <div className="absolute bottom-3 right-3 flex gap-2">
              <Button size="small" icon={<PlusOutlined />}>
                添加节点
              </Button>
            </div>
          </div>
        </div>

        {/* 右侧：节点属性配置 */}
        <div className="w-96 flex-shrink-0 overflow-auto border-l border-gray-200 bg-white">
          <div className="p-4 border-b border-gray-100 font-medium flex items-center gap-2">
            <SettingOutlined />
            节点属性
          </div>
          <div className="p-4 space-y-4">
            {selectedNodeId ? (
              <>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">提示词</label>
                  <Input.TextArea
                    rows={6}
                    value={promptDraft}
                    onChange={(e) => setPromptDraft(e.target.value)}
                    placeholder="输入系统提示词..."
                    className="font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">温度 (Temperature)</label>
                  <Slider min={0} max={2} step={0.1} value={temperature} onChange={setTemperature} />
                  <span className="text-xs text-gray-400">{temperature}</span>
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Top-P</label>
                  <Slider min={0} max={1} step={0.05} value={topP} onChange={setTopP} />
                  <span className="text-xs text-gray-400">{topP}</span>
                </div>
                {agent.type === 'plot' && (
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">主线保留阈值</label>
                    <InputNumber min={0} max={1} step={0.1} defaultValue={0.5} className="w-full" />
                  </div>
                )}
                {agent.type === 'character' && (
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">角色数量上限</label>
                    <InputNumber min={1} max={100} defaultValue={20} className="w-full" />
                  </div>
                )}
              </>
            ) : (
              <div className="text-gray-500 text-sm">在左侧点击节点以编辑属性</div>
            )}
          </div>
        </div>
      </Layout>

      {/* 底部测试区 */}
      <div
        className="flex-shrink-0 border-t border-gray-200 bg-white flex flex-col"
        style={{ height: testPanelCollapsed ? 48 : 280 }}
      >
        <div
          className="flex items-center justify-between px-4 py-2 border-b border-gray-100 cursor-pointer"
          onClick={() => setTestPanelCollapsed(!testPanelCollapsed)}
        >
          <Space>
            <PlayCircleOutlined />
            <span className="font-medium">测试区</span>
          </Space>
          <Button type="text" size="small">
            {testPanelCollapsed ? '展开' : '收起'}
          </Button>
        </div>
        {!testPanelCollapsed && (
          <div className="flex-1 min-h-0 flex overflow-hidden">
            <div className="w-1/2 flex flex-col border-r border-gray-100 p-3">
              <div className="text-sm text-gray-500 mb-1">输入（剧本片段 / JSON）</div>
              <Input.TextArea
                placeholder="粘贴剧本或测试数据..."
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
                className="flex-1 font-mono text-sm resize-none"
                rows={6}
              />
              <Button type="primary" icon={<ThunderboltOutlined />} loading={testing} className="mt-2" onClick={() => void handleRunTest()}>
                运行
              </Button>
            </div>
            <div className="w-1/2 flex flex-col overflow-hidden p-3">
              <Tabs
                activeKey={testTab}
                onChange={(k) => setTestTab(k as 'output' | 'history')}
                size="small"
                items={[
                  { key: 'output', label: '输出' },
                  { key: 'history', label: '历史记录' },
                ]}
              />
              {testTab === 'output' && (
                <>
                  <div className="text-xs text-gray-500 mb-1 overflow-auto flex-1 font-mono whitespace-pre-wrap bg-gray-50 p-2 rounded">
                    {testLogs.length > 0 && (
                      <div className="mb-2 text-gray-600">
                        {testLogs.map((line, i) => (
                          <div key={i}>{line}</div>
                        ))}
                      </div>
                    )}
                    {testOutput || '运行后在此显示结果'}
                  </div>
                </>
              )}
              {testTab === 'history' && (
                <div className="text-gray-500 text-sm flex-1 overflow-auto">暂无历史测试记录</div>
              )}
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}
