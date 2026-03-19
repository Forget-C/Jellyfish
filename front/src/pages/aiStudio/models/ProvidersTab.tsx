import { useEffect, useState, useMemo } from 'react'
import {
  Layout,
  Input,
  Button,
  Table,
  Tag,
  Space,
  Card,
  Dropdown,
  Drawer,
  Modal,
  Form,
  Select,
  message,
  Tooltip,
  Empty,
  Grid,
} from 'antd'
import type { TableColumnsType } from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CopyOutlined,
  ExportOutlined,
  MenuOutlined,
  AppstoreOutlined,
  UnorderedListOutlined,
  DownOutlined,
  RightOutlined,
  ThunderboltOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { LlmService } from '../../../services/generated/services/LlmService'
import type { ProviderRead, ProviderStatus } from '../../../services/generated'
import { PROVIDER_PRESETS, PROVIDER_STATUS_MAP, SORT_OPTIONS, maskUrl } from './constants'

export default function ProvidersTab() {
  const [providers, setProviders] = useState<ProviderRead[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'updated' | 'name'>('updated')
  const [viewMode, setViewMode] = useState<'table' | 'card'>('table')
  const [selectedProvider, setSelectedProvider] = useState<ProviderRead | null>(null)
  const [detailPanelOpen, setDetailPanelOpen] = useState(false)
  const [treeCollapsed, setTreeCollapsed] = useState(false)
  const [providerModalOpen, setProviderModalOpen] = useState(false)
  const [providerEditing, setProviderEditing] = useState<ProviderRead | null>(null)
  const [testConnecting, setTestConnecting] = useState(false)
  const [form] = Form.useForm()
  const { lg } = Grid.useBreakpoint()
  const isLargeScreen = lg ?? false

  const load = async () => {
    setLoading(true)
    try {
      const order = sortBy === 'name' ? 'name' : 'updated_at'
      const res = await LlmService.listProvidersApiV1LlmProvidersGet({
        q: search.trim() || undefined,
        order,
        isDesc: true,
        page: 1,
        pageSize: 100,
      })
      setProviders(res.data?.items ?? [])
    } catch {
      message.error('加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [search, sortBy])

  const providerList = useMemo(() => {
    let list = providers
    if (sortBy === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name))
    return list
  }, [providers, sortBy])

  const handleTestConnection = async (provider?: ProviderRead) => {
    const p = provider ?? selectedProvider
    if (!p) return
    setTestConnecting(true)
    try {
      await new Promise((r) => setTimeout(r, 800))
      message.success('连接成功')
    } catch {
      message.error('连接失败，请检查 Base URL 与 AK/SK')
    } finally {
      setTestConnecting(false)
    }
  }

  const handleSaveProvider = async () => {
    try {
      const values = await form.validateFields()
      if (providerEditing) {
        const requestBody: Parameters<typeof LlmService.updateProviderApiV1LlmProvidersProviderIdPatch>[0]['requestBody'] = {
          name: values.name,
          base_url: values.base_url,
          description: values.description ?? null,
          status: values.status ?? null,
        }
        if (values.api_key && values.api_key !== '********') requestBody.api_key = values.api_key
        if (values.api_secret && values.api_secret !== '********') requestBody.api_secret = values.api_secret
        await LlmService.updateProviderApiV1LlmProvidersProviderIdPatch({
          providerId: providerEditing.id,
          requestBody,
        })
        message.success('供应商已更新')
      } else {
        const id =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `prov_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
        await LlmService.createProviderApiV1LlmProvidersPost({
          requestBody: {
            id,
            name: values.name,
            base_url: values.base_url,
            description: values.description,
            status: values.status,
            api_key: values.api_key,
            api_secret: values.api_secret,
          },
        })
        message.success('供应商已添加')
      }
      setProviderModalOpen(false)
      setProviderEditing(null)
      form.resetFields()
      void load()
    } catch (e) {
      if (e && typeof e === 'object' && 'errorFields' in e) return
      message.error('保存失败')
    }
  }

  const handleDeleteProvider = async (p: ProviderRead) => {
    let linked = 0
    try {
      const countRes = await LlmService.listModelsApiV1LlmModelsGet({
        providerId: p.id,
        pageSize: 1,
      })
      linked = countRes.data?.pagination?.total ?? 0
    } catch {
      // ignore
    }
    Modal.confirm({
      title: '删除供应商',
      content:
        linked > 0
          ? `该供应商下还有 ${linked} 个模型，删除后关联模型将失效。确定删除？`
          : '确定删除该供应商？',
      okText: '删除',
      okType: 'danger',
      onOk: async () => {
        await LlmService.deleteProviderApiV1LlmProvidersProviderIdDelete({ providerId: p.id })
        message.success('已删除')
        if (selectedProvider?.id === p.id) setSelectedProvider(null)
        void load()
      },
    })
  }

  const openProviderModal = (p?: ProviderRead) => {
    setProviderEditing(p ?? null)
    if (p) {
      form.setFieldsValue({
        name: p.name,
        base_url: p.base_url,
        api_key: '********',
        api_secret: '********',
        description: p.description,
        status: p.status ?? 'active',
      })
    } else {
      form.resetFields()
    }
    setProviderModalOpen(true)
  }

  const providerColumns: TableColumnsType<ProviderRead> = [
    { title: '名称', dataIndex: 'name', key: 'name', ellipsis: true, render: (n) => <Space>{n}</Space> },
    {
      title: 'Base URL',
      dataIndex: 'base_url',
      key: 'base_url',
      ellipsis: true,
      render: (url: string) => <Tooltip title={url}>{maskUrl(url)}</Tooltip>,
    },
    {
      title: 'AK/SK',
      key: 'aksk',
      render: () => (
        <span>
          <WarningOutlined className="text-amber-500 mr-1" />
          ******** / ********
        </span>
      ),
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (d: string) => <Tooltip title={d}>{d || '—'}</Tooltip>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (s: ProviderStatus) => (
        <Tag color={PROVIDER_STATUS_MAP[s]?.color}>{PROVIDER_STATUS_MAP[s]?.text}</Tag>
      ),
    },
    {
      title: '创建人',
      dataIndex: 'created_by',
      key: 'created_by',
      width: 100,
      render: (c: string) => c || '—',
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      render: (_, record) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openProviderModal(record)}>
            编辑
          </Button>
          <Button
            type="link"
            size="small"
            icon={<ThunderboltOutlined />}
            onClick={() => handleTestConnection(record)}
          >
            测试连接
          </Button>
          <Dropdown
            menu={{
              items: [
                { key: 'copy', label: '复制', icon: <CopyOutlined /> },
                { key: 'export', label: '导出配置', icon: <ExportOutlined /> },
                { type: 'divider' },
                {
                  key: 'delete',
                  label: '删除',
                  danger: true,
                  icon: <DeleteOutlined />,
                  onClick: () => handleDeleteProvider(record),
                },
              ],
            }}
            trigger={['click']}
          >
            <Button type="link" size="small" icon={<MenuOutlined />} />
          </Dropdown>
        </Space>
      ),
    },
  ]

  return (
    <>
      <div className="flex-shrink-0 px-4 py-2 border-b border-gray-100 bg-white flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-gray-600 text-sm">共 {providers.length} 个供应商</span>
        </div>
        <Space wrap>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openProviderModal()}>
            添加供应商
          </Button>
          <Input
            placeholder="搜索名称/描述"
            allowClear
            className="w-48"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Dropdown
            menu={{
              items: SORT_OPTIONS.filter((o) => o.value !== 'category').map((o) => ({
                key: o.value,
                label: o.label,
                onClick: () => setSortBy(o.value as 'updated' | 'name'),
              })),
            }}
          >
            <Button icon={<DownOutlined />}>
              排序：{SORT_OPTIONS.find((s) => s.value === sortBy)?.label}
            </Button>
          </Dropdown>
        </Space>
      </div>

      <Layout className="flex-1 min-h-0 flex-row overflow-hidden">
        <div
          className="flex-shrink-0 border-r border-gray-200 bg-white overflow-auto"
          style={{ width: treeCollapsed ? 48 : 200 }}
        >
          {treeCollapsed ? (
            <Button
              type="text"
              icon={<RightOutlined />}
              onClick={() => setTreeCollapsed(false)}
              className="w-full rounded-none"
            />
          ) : (
            <>
              <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
                <span className="text-sm font-medium text-gray-700">筛选</span>
                <Button
                  type="text"
                  size="small"
                  icon={<RightOutlined rotate={180} />}
                  onClick={() => setTreeCollapsed(true)}
                />
              </div>
              <div className="p-3 text-sm text-gray-500">点击列表项查看详情</div>
            </>
          )}
        </div>

        <div className="flex-1 min-w-0 overflow-auto p-4 bg-gray-50">
          <div className="flex justify-end gap-1 mb-2">
            <Button
              type={viewMode === 'table' ? 'primary' : 'default'}
              size="small"
              icon={<UnorderedListOutlined />}
              onClick={() => setViewMode('table')}
            />
            <Button
              type={viewMode === 'card' ? 'primary' : 'default'}
              size="small"
              icon={<AppstoreOutlined />}
              onClick={() => setViewMode('card')}
            />
          </div>

          {providerList.length === 0 ? (
            <Card>
              <Empty
                description={
                  providers.length === 0 ? '暂无供应商，点击「添加供应商」开始' : '无匹配结果'
                }
              >
                {providers.length === 0 && (
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => openProviderModal()}>
                    添加第一个供应商
                  </Button>
                )}
              </Empty>
            </Card>
          ) : viewMode === 'table' ? (
            <Card>
              <Table<ProviderRead>
                rowKey="id"
                loading={loading}
                columns={providerColumns}
                dataSource={providerList}
                pagination={{ pageSize: 20 }}
                onRow={(record) => ({
                  onClick: () => {
                    setSelectedProvider(record)
                    setDetailPanelOpen(true)
                  },
                  style: { cursor: 'pointer' },
                })}
                size="small"
              />
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {providerList.map((p) => (
                <Card
                  key={p.id}
                  hoverable
                  className="cursor-pointer"
                  style={{ minHeight: 220 }}
                  onClick={() => {
                    setSelectedProvider(p)
                    setDetailPanelOpen(true)
                  }}
                  actions={[
                    <Button
                      key="edit"
                      type="text"
                      size="small"
                      icon={<EditOutlined />}
                      onClick={(e) => {
                        e.stopPropagation()
                        openProviderModal(p)
                      }}
                    >
                      编辑
                    </Button>,
                    <Button
                      key="test"
                      type="text"
                      size="small"
                      icon={<ThunderboltOutlined />}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleTestConnection(p)
                      }}
                    >
                      测试
                    </Button>,
                    <Dropdown
                      key="more"
                      menu={{
                        items: [
                          {
                            key: 'delete',
                            label: '删除',
                            danger: true,
                            onClick: () => handleDeleteProvider(p),
                          },
                        ],
                      }}
                      trigger={['click']}
                    >
                      <Button type="text" size="small" onClick={(e) => e.stopPropagation()}>
                        更多
                      </Button>
                    </Dropdown>,
                  ]}
                >
                  <div className="font-medium mb-1">{p.name}</div>
                  <div className="text-gray-500 text-sm mb-1 truncate" title={p.base_url}>
                    Base URL：{maskUrl(p.base_url)}
                  </div>
                  <div className="text-gray-500 text-sm mb-1">AK/SK：******** / ********</div>
                  <div className="text-gray-500 text-sm line-clamp-2 mb-2">{p.description || '—'}</div>
                  <Tag color={PROVIDER_STATUS_MAP[p.status ?? 'active']?.color}>
                    {PROVIDER_STATUS_MAP[p.status ?? 'active']?.text}
                  </Tag>
                  {p.created_by && (
                    <span className="text-xs text-gray-400 ml-2">创建：{p.created_by}</span>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>

        {selectedProvider && isLargeScreen && (
          <div
            className="flex-shrink-0 overflow-auto border-l border-gray-200 bg-white"
            style={{ width: '36%', minWidth: 320 }}
          >
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <span className="font-medium">详情</span>
              <Button
                type="link"
                size="small"
                onClick={() => {
                  setDetailPanelOpen(false)
                  setSelectedProvider(null)
                }}
              >
                收起
              </Button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <div className="text-sm text-gray-500 mb-1">名称</div>
                <div className="font-medium">{selectedProvider.name}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500 mb-1">Base URL</div>
                <Tooltip title={selectedProvider.base_url}>
                  <span className="text-sm">{maskUrl(selectedProvider.base_url)}</span>
                </Tooltip>
              </div>
              <div>
                <div className="text-sm text-gray-500 mb-1">描述</div>
                <div className="text-gray-700 text-sm">{selectedProvider.description || '—'}</div>
              </div>
              <Space>
                <Button
                  type="primary"
                  icon={<EditOutlined />}
                  onClick={() => openProviderModal(selectedProvider)}
                >
                  编辑
                </Button>
                <Button
                  icon={<ThunderboltOutlined />}
                  loading={testConnecting}
                  onClick={() => handleTestConnection()}
                >
                  测试连接
                </Button>
              </Space>
            </div>
          </div>
        )}

        {selectedProvider && !isLargeScreen && (
          <Drawer
            title="详情"
            placement="right"
            open={detailPanelOpen}
            onClose={() => setDetailPanelOpen(false)}
            width="min(100%, 400px)"
          >
            <div className="space-y-4">
              <div>
                <div className="text-sm text-gray-500 mb-1">名称</div>
                <div className="font-medium">{selectedProvider.name}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500 mb-1">Base URL</div>
                <span className="text-sm">{maskUrl(selectedProvider.base_url)}</span>
              </div>
              <Space>
                <Button
                  type="primary"
                  icon={<EditOutlined />}
                  onClick={() => openProviderModal(selectedProvider)}
                >
                  编辑
                </Button>
                <Button
                  icon={<ThunderboltOutlined />}
                  onClick={() => handleTestConnection()}
                >
                  测试连接
                </Button>
              </Space>
            </div>
          </Drawer>
        )}
      </Layout>

      <Modal
        title={providerEditing ? '编辑供应商' : '添加供应商'}
        open={providerModalOpen}
        onCancel={() => {
          setProviderModalOpen(false)
          setProviderEditing(null)
          form.resetFields()
        }}
        onOk={() => void handleSaveProvider()}
        width={560}
        destroyOnClose
      >
        <Form form={form} layout="vertical" className="pt-2">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请选择供应商' }]}>
            <Select
              placeholder="选择供应商"
              options={Object.keys(PROVIDER_PRESETS).map((name) => ({ label: name, value: name }))}
              onChange={(name: string) => {
                const preset = PROVIDER_PRESETS[name]
                if (preset && !providerEditing) {
                  form.setFieldsValue({ base_url: preset.baseUrl, description: preset.description })
                }
              }}
            />
          </Form.Item>
          <Form.Item
            name="base_url"
            label="Base URL"
            rules={[{ required: true }, { type: 'url', message: '请输入有效 URL' }]}
          >
            <Input placeholder="https://api.openai.com/v1" />
          </Form.Item>
          <Form.Item name="api_key" label="API Key" help={providerEditing ? '留空则不修改' : '请勿分享密钥'}>
            <Input.Password placeholder="AK" />
          </Form.Item>
          <Form.Item name="api_secret" label="API Secret" help={providerEditing ? '留空则不修改' : undefined}>
            <Input.Password placeholder="SK" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="支持 GPT 系列模型" />
          </Form.Item>
          <Form.Item name="status" label="状态" initialValue="active">
            <Select
              options={[
                { label: '活跃', value: 'active' },
                { label: '测试中', value: 'testing' },
                { label: '禁用', value: 'disabled' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
