import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Dropdown, Empty, Input, Modal, Radio, Skeleton, Space, Table, Tag, Tree, message } from 'antd'
import type { TableColumnsType } from 'antd'
import { ArrowRightOutlined, DeleteOutlined, DownOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, StarFilled, ThunderboltOutlined } from '@ant-design/icons'
import { Link, useNavigate } from 'react-router-dom'
import { PageToolbar, WorkspaceLayout, WorkspaceScrollPanel } from '../../../components/layout/PageLayout'
import { WorkspaceFilter } from '../../../components/layout/WorkspaceFilter'
import api from '../../../services/aiStudioApi'
import type { Agent, AgentTypeKey } from '../../../mocks/data'

const AGENT_TYPES: { key: AgentTypeKey; label: string; color: string }[] = [
  { key: 'plot', label: '剧情提取', color: 'blue' },
  { key: 'character', label: '角色提取', color: 'green' },
  { key: 'scene', label: '场景提取', color: 'orange' },
  { key: 'prop', label: '道具提取', color: 'purple' },
  { key: 'other', label: '其他类型', color: 'default' },
]
const typeLabelMap = Object.fromEntries(AGENT_TYPES.map(type => [type.key, type.label]))
const typeColorMap = Object.fromEntries(AGENT_TYPES.map(type => [type.key, type.color]))

export default function AgentManagement() {
  const navigate = useNavigate()
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const listEpoch = useRef(0)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<AgentTypeKey | null>(null)
  const [sortBy, setSortBy] = useState<'updated' | 'name'>('updated')
  const [batchMode, setBatchMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [mutating, setMutating] = useState(false)
  const mutationRef = useRef(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createType, setCreateType] = useState<AgentTypeKey>('plot')
  const [createDesc, setCreateDesc] = useState('')
  const [createLoading, setCreateLoading] = useState(false)
  const createRef = useRef(false)

  const load = async () => {
    const epoch = ++listEpoch.current
    setLoading(true)
    try {
      const list = await api.agents.list()
      if (epoch !== listEpoch.current) return
      if (!Array.isArray(list)) throw new Error('Invalid Agent list response')
      setAgents(list)
      setLoaded(true)
      setLoadError(false)
      setSelectedIds(ids => ids.filter(id => list.some(agent => agent.id === id)))
    } catch {
      if (epoch === listEpoch.current) setLoadError(true)
    } finally {
      if (epoch === listEpoch.current) setLoading(false)
    }
  }
  useEffect(() => {
    void load()
    return () => { listEpoch.current += 1 }
  }, [])

  const filteredList = useMemo(() => {
    const query = search.trim().toLowerCase()
    const list = agents.filter(agent => (!typeFilter || agent.type === typeFilter) && (!query ||
      [agent.name, typeLabelMap[agent.type], agent.description, agent.createdBy].some(value => value?.toLowerCase().includes(query))))
    return list.sort((a, b) => sortBy === 'name' ? a.name.localeCompare(b.name)
      : (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0))
  }, [agents, search, typeFilter, sortBy])
  const treeData = AGENT_TYPES.map(type => ({
    key: type.key,
    title: `${type.label}${loaded ? ` (${agents.filter(agent => agent.type === type.key).length})` : ''}`,
    isLeaf: true,
  }))
  const clearFilters = () => { setSearch(''); setTypeFilter(null); setPage(1) }

  const handleSetDefault = (agent: Agent) => {
    Modal.confirm({
      title: '设为默认',
      content: `将「${agent.name}」设为默认，替换当前${typeLabelMap[agent.type] ?? agent.type}类型的默认 Agent。`,
      okText: '设为默认',
      cancelText: '取消',
      onOk: async () => {
        if (mutationRef.current) return
        mutationRef.current = true
        setMutating(true)
        try {
          await api.agents.update(agent.id, { isDefault: true })
          listEpoch.current += 1
          setAgents(list => list.map(item => item.type === agent.type ? { ...item, isDefault: item.id === agent.id } : item))
          message.success('已设为默认')
          await load()
        } catch (error) {
          message.error('设置失败，请重试')
          throw error
        } finally {
          mutationRef.current = false
          setMutating(false)
        }
      },
    })
  }

  const handleDelete = (targets: Agent[]) => {
    const remaining = new Set(targets.map(agent => agent.id))
    const confirmationContent = () => <div>
      <p>确定删除以下 {remaining.size} 个 Agent？此操作无法撤销。</p>
      <ul style={{ maxHeight: 200, overflowY: 'auto', paddingInlineStart: 20 }}>{targets.filter(agent => remaining.has(agent.id)).map(agent => <li key={agent.id}>{agent.name}</li>)}</ul>
    </div>
    const confirmation = Modal.confirm({
      title: targets.length === 1 ? '删除 Agent' : '批量删除 Agent',
      content: confirmationContent(),
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        if (mutationRef.current) return
        mutationRef.current = true
        setMutating(true)
        try {
          for (const id of remaining) {
            await api.agents.delete(id)
            listEpoch.current += 1
            setLoading(false)
            remaining.delete(id)
            setAgents(list => list.filter(agent => agent.id !== id))
            setSelectedIds(ids => ids.filter(selected => selected !== id))
          }
          message.success('已删除')
          await load()
        } catch (error) {
          confirmation.update({ content: confirmationContent() })
          message.error('删除未完成，已保留未删除对象，请重试')
          throw error
        } finally {
          mutationRef.current = false
          setMutating(false)
        }
      },
    })
  }

  const handleCreate = async () => {
    if (createRef.current) return
    if (!createName.trim()) { message.warning('请输入 Agent 名称'); return }
    createRef.current = true
    setCreateLoading(true)
    try {
      const created = await api.agents.create({ name: createName.trim(), type: createType, description: createDesc.trim() })
      message.success('创建成功')
      setCreateModalOpen(false)
      setCreateName('')
      setCreateDesc('')
      navigate(`/agents/${encodeURIComponent(created.id)}/edit`)
    } catch {
      message.error('创建失败，请重试')
    } finally {
      createRef.current = false
      setCreateLoading(false)
    }
  }

  const columns: TableColumnsType<Agent> = [
    { title: '名称', dataIndex: 'name', width: 230, ellipsis: true, render: (name: string, agent) =>
      <Link to={`/agents/${encodeURIComponent(agent.id)}/edit`} title={name} style={{ color: 'var(--app-accent)', fontSize: 14, fontWeight: 650 }}>{name} <ArrowRightOutlined aria-hidden /></Link> },
    { title: '类型', dataIndex: 'type', width: 120, render: (type: AgentTypeKey) => <Tag bordered={false} color={typeColorMap[type] ?? 'default'}>{typeLabelMap[type] ?? type}</Tag> },
    { title: '默认', dataIndex: 'isDefault', width: 80, render: (value: boolean) => value ? <span><StarFilled style={{ color: '#b57913' }} aria-hidden /> 默认</span> : '—' },
    { title: '简介', dataIndex: 'description', ellipsis: true, render: (description: string) => <span title={description}>{description || '—'}</span> },
    { title: '更新时间', dataIndex: 'updatedAt', width: 150, render: (value: string) => value || '—' },
    { title: '操作', key: 'actions', width: 150, render: (_, agent) => <Space size={4}>
      <Button type="link" size="small" icon={<ThunderboltOutlined aria-hidden />} onClick={() => navigate(`/agents/${encodeURIComponent(agent.id)}/edit?test=1`)}>测试</Button>
      <Dropdown trigger={['click']} menu={{ items: [
        { key: 'default', label: agent.isDefault ? '已设为默认' : '设为默认', disabled: agent.isDefault || mutating, onClick: () => handleSetDefault(agent) },
        { key: 'copy', label: '复制（暂未接入）', disabled: true },
        { key: 'export', label: '导出（暂未接入）', disabled: true },
        { type: 'divider' },
        { key: 'delete', label: '删除', danger: true, disabled: mutating, onClick: () => handleDelete([agent]) },
      ] }}><Button size="small" type="text" aria-label={`更多操作：${agent.name}`} disabled={mutating}>更多<DownOutlined aria-hidden /></Button></Dropdown>
    </Space> },
  ]

  return <WorkspaceLayout className="management-page">
    <PageToolbar title="Agent 管理" className="management-toolbar">
      <span className="management-count" role="status">{loaded ? `已加载 ${agents.length} 项` : loading ? '读取中…' : '数量未知'}</span>
      <div className="management-tools">
        <Input aria-label="搜索 Agent" placeholder="按名称/类型/创建者搜索" prefix={<SearchOutlined />} allowClear value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} />
        <WorkspaceFilter title="类型筛选">
          <Tree selectedKeys={typeFilter ? [typeFilter] : []} treeData={treeData} blockNode
            onSelect={([key]) => { setTypeFilter(key ? key as AgentTypeKey : null); setPage(1) }} />
          <Button type="link" onClick={() => { setTypeFilter(null); setPage(1) }}>清除类型筛选</Button>
        </WorkspaceFilter>
        <Dropdown trigger={['click']} menu={{ selectable: true, selectedKeys: [sortBy], items: [
          { key: 'updated', label: '最近更新', onClick: () => { setSortBy('updated'); setPage(1) } },
          { key: 'name', label: '名称排序', onClick: () => { setSortBy('name'); setPage(1) } },
          { type: 'divider' },
          { key: 'batch', label: batchMode ? '退出批量管理' : '批量管理', disabled: mutating, onClick: () => { setBatchMode(!batchMode); setSelectedIds([]) } },
        ] }}><Button>排序与管理<DownOutlined aria-hidden /></Button></Dropdown>
        <Button icon={<ReloadOutlined />} aria-label="刷新 Agent" loading={loading} onClick={() => void load()} />
      </div>
      <Button className="management-primary" type="primary" icon={<PlusOutlined aria-hidden />} onClick={() => setCreateModalOpen(true)}>创建新 Agent</Button>
    </PageToolbar>
    <WorkspaceScrollPanel className="management-panel">
      {loadError && <Alert type="error" showIcon message={loaded ? '刷新 Agent 列表失败，已保留原有数据与筛选' : '无法读取 Agent 列表'} action={<Button size="small" loading={loading} onClick={() => void load()}>重试</Button>} />}
      {batchMode && <Space wrap style={{ marginBottom: 12 }}>
        <span>已选 {selectedIds.length} 项</span>
        <Button danger icon={<DeleteOutlined aria-hidden />} disabled={!selectedIds.length || mutating} onClick={() => handleDelete(agents.filter(agent => selectedIds.includes(agent.id)))}>批量删除</Button>
        <Button disabled={mutating} onClick={() => { setBatchMode(false); setSelectedIds([]) }}>退出批量管理</Button>
      </Space>}
      {!loaded && loading ? <div className="management-surface" aria-label="正在加载 Agent"><Skeleton active paragraph={{ rows: 6 }} /></div>
        : loaded && <div className="management-surface">
          <Table<Agent> className="management-table" rowKey="id" columns={columns} dataSource={filteredList} loading={loading} size="small" scroll={{ x: 960 }}
            pagination={{ current: page, pageSize, showSizeChanger: true, onChange: (next, size) => { setPage(next); setPageSize(size) } }}
            rowSelection={batchMode ? { selectedRowKeys: selectedIds, preserveSelectedRowKeys: true, onChange: keys => setSelectedIds(keys.map(String)), getCheckboxProps: agent => ({ disabled: mutating, 'aria-label': `选择 ${agent.name}` }) } : undefined}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={search.trim() || typeFilter ? '无匹配结果' : '暂无 Agent'}>
              {search.trim() || typeFilter ? <Button onClick={clearFilters}>清除筛选</Button> : <Button type="primary" onClick={() => setCreateModalOpen(true)}>创建第一个 Agent</Button>}
            </Empty> }} />
        </div>}
    </WorkspaceScrollPanel>
    <Modal title="创建新 Agent" open={createModalOpen} onCancel={() => { if (!createLoading) setCreateModalOpen(false) }} onOk={() => void handleCreate()}
      confirmLoading={createLoading} cancelButtonProps={{ disabled: createLoading }} okText="创建" cancelText="取消" width={480}>
      <div className="space-y-4 pt-2">
        <div><label htmlFor="agent-create-name" className="block text-sm text-gray-600 mb-1">名称</label>
          <Input id="agent-create-name" value={createName} onChange={event => setCreateName(event.target.value)} /></div>
        <div><span id="agent-create-type-label" className="block text-sm text-gray-600 mb-1">类型</span>
          <Radio.Group aria-labelledby="agent-create-type-label" value={createType} onChange={event => setCreateType(event.target.value)} options={AGENT_TYPES.map(type => ({ value: type.key, label: type.label }))} /></div>
        <div><label htmlFor="agent-create-description" className="block text-sm text-gray-600 mb-1">描述（选填）</label>
          <Input.TextArea id="agent-create-description" rows={3} value={createDesc} onChange={event => setCreateDesc(event.target.value)} /></div>
      </div>
    </Modal>
  </WorkspaceLayout>
}
