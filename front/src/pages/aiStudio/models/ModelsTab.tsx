import { useEffect, useState, useMemo, useRef } from 'react'
import {
  Alert,
  Layout,
  Input,
  Button,
  Table,
  Tag,
  Space,
  Tree,
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
  Collapse,
} from 'antd'
import type { TableColumnsType } from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CopyOutlined,
  MenuOutlined,
  AppstoreOutlined,
  UnorderedListOutlined,
  DownOutlined,
  RightOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { LlmService } from '../../../services/generated/services/LlmService'
import { ApiError, CancelError } from '../../../services/generated'
import type {
  ModelRead,
  ModelCategoryKey,
  ModelVerifyRead,
  ProviderRead,
  ProviderSupportedRead,
} from '../../../services/generated'
import {
  MODEL_CATEGORIES,
  TABLE_ACTION_BTN_EDIT_CLASS,
  TABLE_ACTION_BTN_MORE_CLASS,
  TABLE_ACTION_BTN_TEST_CLASS,
  categoryLabelMap,
  categoryColorMap,
  SORT_OPTIONS,
} from './constants'

export default function ModelsTab() {
  const [providers, setProviders] = useState<ProviderRead[]>([])
  const [supportedProviders, setSupportedProviders] = useState<ProviderSupportedRead[]>([])
  const [models, setModels] = useState<ModelRead[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'updated' | 'name' | 'category'>('updated')
  const [viewMode, setViewMode] = useState<'table' | 'card'>('table')
  const [selectedModel, setSelectedModel] = useState<ModelRead | null>(null)
  const [detailPanelOpen, setDetailPanelOpen] = useState(false)
  const [treeCollapsed, setTreeCollapsed] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<ModelCategoryKey | null>(null)
  const [modelModalOpen, setModelModalOpen] = useState(false)
  const [modelEditing, setModelEditing] = useState<ModelRead | null>(null)
  const [providerOptionsLoading, setProviderOptionsLoading] = useState(true)
  const [verifyModalOpen, setVerifyModalOpen] = useState(false)
  const [verifyResult, setVerifyResult] = useState<ModelVerifyRead | null>(null)
  const [verifyLoading, setVerifyLoading] = useState(false)
  const [verifyingId, setVerifyingId] = useState<string | null>(null)
  const verifyPromiseRef = useRef<ReturnType<
    typeof LlmService.verifyLlmModelApiV1LlmModelsModelIdVerifyPost
  > | null>(null)
  const [form] = Form.useForm()
  const selectedFormCategory = Form.useWatch<ModelCategoryKey | undefined>('category', form)
  const { lg } = Grid.useBreakpoint()
  const isLargeScreen = lg ?? false

  useEffect(() => {
    return () => {
      verifyPromiseRef.current?.cancel()
    }
  }, [])

  /** 对已保存模型发起同步配置验证；重复点击忽略；卸载时取消进行中的请求。 */
  const handleVerifyModel = (record: ModelRead, e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (verifyLoading) return
    setVerifyLoading(true)
    setVerifyingId(record.id)
    const p = LlmService.verifyLlmModelApiV1LlmModelsModelIdVerifyPost({ modelId: record.id })
    verifyPromiseRef.current = p
    void p
      .then((res) => {
        const payload = res.data
        if (!payload) {
          message.error('未返回验证结果')
          return
        }
        setVerifyResult(payload)
        setVerifyModalOpen(true)
        if (payload.ok) {
          message.success(payload.message || '验证通过')
        } else {
          message.warning(payload.message || '验证未通过')
        }
      })
      .catch((err: unknown) => {
        if (err instanceof CancelError) return
        if (err instanceof ApiError) {
          const b = err.body as { message?: string } | undefined
          message.error(b?.message ?? err.message)
          return
        }
        message.error('验证请求失败')
      })
      .finally(() => {
        setVerifyLoading(false)
        setVerifyingId(null)
        verifyPromiseRef.current = null
      })
  }

  const load = async () => {
    setLoading(true)
    try {
      const [provRes, modelsRes, supportedRes] = await Promise.all([
        LlmService.listProvidersApiV1LlmProvidersGet({ page: 1, pageSize: 100 }),
        LlmService.listModelsApiV1LlmModelsGet({
          q: search.trim() || undefined,
          order: sortBy === 'name' ? 'name' : sortBy === 'category' ? 'category' : 'updated_at',
          isDesc: true,
          page: 1,
          pageSize: 100,
        }),
        LlmService.listSupportedProvidersApiV1LlmProvidersSupportedGet({}),
      ])
      setProviders(provRes.data?.items ?? [])
      setModels(modelsRes.data?.items ?? [])
      setSupportedProviders(supportedRes.data ?? [])
    } catch {
      message.error('加载失败')
    } finally {
      setLoading(false)
      setProviderOptionsLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [search, sortBy])

  const modelList = useMemo(() => {
    let list = models
    if (categoryFilter) list = list.filter((m) => m.category === categoryFilter)
    return list
  }, [models, categoryFilter])

  const categoryCounts = useMemo(() => {
    const c: Record<string, number> = {}
    MODEL_CATEGORIES.forEach((cat) => {
      c[cat.key] = models.filter((m) => m.category === cat.key).length
    })
    return c
  }, [models])

  const treeData = useMemo(
    () =>
      MODEL_CATEGORIES.map((c) => ({
        key: c.key,
        title: `${c.label} (${categoryCounts[c.key] ?? 0})`,
        isLeaf: true,
      })),
    [categoryCounts]
  )

  const getProviderName = (id: string) => providers.find((p) => p.id === id)?.name ?? id

  const resolveProviderSpec = (providerName: string) =>
    supportedProviders.find(
      (spec) => spec.display_name === providerName || (spec.aliases?.length && spec.aliases.includes(providerName)),
    )

  /** 判断供应商是否可用于当前类别；自定义供应商不在内置能力表中，配置阶段允许关联。 */
  const canUseProviderForCategory = (provider: ProviderRead, category: ModelCategoryKey | undefined) => {
    if (!category) return true
    const spec = resolveProviderSpec(provider.name)
    return !spec || (spec.supported_categories?.includes(category) ?? false)
  }

  /** 生成模型表单的供应商选项，并把自定义供应商显式标识出来。 */
  const providerToOption = (provider: ProviderRead) => {
    const spec = resolveProviderSpec(provider.name)
    return {
      label: spec ? provider.name : `${provider.name}（自定义）`,
      value: provider.id,
    }
  }

  const filteredProviderOptions = useMemo(() => {
    if (!selectedFormCategory) return providers.map(providerToOption)
    return providers
      .filter((provider) => canUseProviderForCategory(provider, selectedFormCategory))
      .map(providerToOption)
  }, [providers, selectedFormCategory, supportedProviders])

  const editingUnsupportedProviderOption = useMemo(() => {
    if (!modelEditing) return null
    const provider = providers.find((p) => p.id === modelEditing.provider_id)
    if (!provider) return null
    const alreadyInOptions = filteredProviderOptions.some((opt) => opt.value === provider.id)
    if (alreadyInOptions) return null
    return {
      label: `${provider.name}（历史/当前不支持所选类别）`,
      value: provider.id,
    }
  }, [filteredProviderOptions, modelEditing, providers])

  const providerSelectOptions = useMemo(
    () =>
      editingUnsupportedProviderOption
        ? [editingUnsupportedProviderOption, ...filteredProviderOptions]
        : filteredProviderOptions,
    [editingUnsupportedProviderOption, filteredProviderOptions],
  )
  const unsupportedProviderWarning = useMemo(() => {
    if (!editingUnsupportedProviderOption || !selectedFormCategory) return null
    const provider = providers.find((p) => p.id === editingUnsupportedProviderOption.value)
    if (!provider) return null
    const categoryLabel = categoryLabelMap[selectedFormCategory]
    return `当前模型绑定供应商「${provider.name}」不支持「${categoryLabel}」类别，保存前建议切换到支持该类别的供应商。`
  }, [editingUnsupportedProviderOption, providers, selectedFormCategory])

  useEffect(() => {
    if (!selectedFormCategory) return
    const providerId = form.getFieldValue('provider_id') as string | undefined
    if (!providerId) return
    const stillSupported = filteredProviderOptions.some((opt) => opt.value === providerId)
    const keepHistoricalEditingProvider = modelEditing?.provider_id === providerId
    if (!stillSupported && !keepHistoricalEditingProvider) {
      form.setFieldsValue({ provider_id: undefined })
      message.warning('当前供应商不支持所选模型类别，请重新选择')
    }
  }, [filteredProviderOptions, form, modelEditing, selectedFormCategory])

  const handleSaveModel = async () => {
    try {
      const values = await form.validateFields()
      let params: Record<string, unknown> = {}
      try {
        if (values.params && String(values.params).trim())
          params = JSON.parse(String(values.params))
      } catch {
        message.error('参数格式需为合法 JSON')
        return
      }
      if (modelEditing) {
        await LlmService.updateModelApiV1LlmModelsModelIdPatch({
          modelId: modelEditing.id,
          requestBody: {
            name: values.name,
            category: values.category,
            provider_id: values.provider_id,
            description: values.description ?? null,
            params,
          },
        })
        message.success('模型已更新')
      } else {
        if (!values.provider_id) {
          message.warning('请先添加供应商后再添加模型')
          return
        }
        const modelId =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `model_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
        await LlmService.createModelApiV1LlmModelsPost({
          requestBody: {
            id: modelId,
            name: values.name,
            category: values.category,
            provider_id: values.provider_id,
            description: values.description,
            params,
          },
        })
        message.success('模型已添加')
      }
      setModelModalOpen(false)
      setModelEditing(null)
      form.resetFields()
      void load()
    } catch (e) {
      if (e && typeof e === 'object' && 'errorFields' in e) return
      message.error('保存失败')
    }
  }

  const handleDeleteModel = (m: ModelRead) => {
    Modal.confirm({
      title: '删除模型',
      content: `确定删除「${m.name}」？`,
      okText: '删除',
      okType: 'danger',
      onOk: async () => {
        await LlmService.deleteModelApiV1LlmModelsModelIdDelete({ modelId: m.id })
        message.success('已删除')
        if (selectedModel?.id === m.id) setSelectedModel(null)
        void load()
      },
    })
  }

  const openModelModal = (m?: ModelRead) => {
    setModelEditing(m ?? null)
    if (m) {
      form.setFieldsValue({
        name: m.name,
        category: m.category,
        provider_id: m.provider_id,
        description: m.description,
        params: JSON.stringify(m.params ?? {}, null, 2),
      })
    } else {
      form.resetFields()
      form.setFieldsValue({ category: 'text' })
    }
    setModelModalOpen(true)
  }

  /** 基于已有模型打开「添加模型」浮窗，预填字段，名称追加「-复制」。 */
  const openCopyModelModal = (source: ModelRead) => {
    setModelEditing(null)
    form.resetFields()
    form.setFieldsValue({
      name: `${source.name}-复制`,
      category: source.category,
      provider_id: source.provider_id,
      description: source.description ?? '',
      params: JSON.stringify(source.params ?? {}, null, 2),
    })
    setModelModalOpen(true)
  }

  const modelColumns: TableColumnsType<ModelRead> = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      render: (n) => <Space>{n}</Space>,
    },
    {
      title: '类别',
      dataIndex: 'category',
      key: 'category',
      width: 100,
      render: (c: ModelCategoryKey) => (
        <Tag color={categoryColorMap[c]}>{categoryLabelMap[c]}</Tag>
      ),
    },
    {
      title: '关联供应商',
      dataIndex: 'provider_id',
      key: 'provider_id',
      width: 120,
      render: (id: string) => getProviderName(id),
    },
    {
      title: '参数',
      dataIndex: 'params',
      key: 'params',
      ellipsis: true,
      render: (p: Record<string, unknown>) => (
        <Tooltip title={JSON.stringify(p)}>
          <span>
            {p && Object.keys(p).length ? JSON.stringify(p).slice(0, 30) + '…' : '—'}
          </span>
        </Tooltip>
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
      title: '创建人',
      dataIndex: 'created_by',
      key: 'created_by',
      width: 100,
      render: (c: string) => c || '—',
    },
    {
      title: '操作',
      key: 'action',
      width: 112,
      fixed: 'right',
      align: 'center',
      render: (_, record) => (
        <Space size={4} className="flex-nowrap justify-center">
          <Tooltip title="编辑">
            <Button
              type="text"
              size="small"
              className={TABLE_ACTION_BTN_EDIT_CLASS}
              icon={<EditOutlined />}
              onClick={(e) => {
                e.stopPropagation()
                openModelModal(record)
              }}
            />
          </Tooltip>
          <Tooltip title="测试生成">
            <Button
              type="text"
              size="small"
              className={TABLE_ACTION_BTN_TEST_CLASS}
              icon={<ThunderboltOutlined />}
              loading={verifyLoading && verifyingId === record.id}
              onClick={(e) => {
                handleVerifyModel(record, e)
              }}
            />
          </Tooltip>
          <Dropdown
            menu={{
              items: [
                {
                  key: 'copy',
                  label: '复制',
                  icon: <CopyOutlined />,
                  onClick: ({ domEvent }) => {
                    domEvent.stopPropagation()
                    openCopyModelModal(record)
                  },
                },
                {
                  key: 'delete',
                  label: '删除',
                  danger: true,
                  icon: <DeleteOutlined />,
                  onClick: ({ domEvent }) => {
                    domEvent.stopPropagation()
                    handleDeleteModel(record)
                  },
                },
              ],
            }}
            trigger={['click']}
          >
            <Tooltip title="更多">
              <Button
                type="text"
                size="small"
                className={TABLE_ACTION_BTN_MORE_CLASS}
                icon={<MenuOutlined />}
                onClick={(e) => e.stopPropagation()}
              />
            </Tooltip>
          </Dropdown>
        </Space>
      ),
    },
  ]

  return (
    <>
      <div className="flex-shrink-0 px-4 py-2 border-b border-gray-100 bg-white flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-gray-600 text-sm">共 {models.length} 个模型</span>
        </div>
        <Space wrap>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openModelModal()}>
            添加模型
          </Button>
          <Input
            placeholder="搜索名称/类型"
            allowClear
            className="w-48"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Dropdown
            menu={{
              items: SORT_OPTIONS.map((o) => ({
                key: o.value,
                label: o.label,
                onClick: () => setSortBy(o.value as 'updated' | 'name' | 'category'),
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
              <Tree
                selectedKeys={categoryFilter ? [categoryFilter] : []}
                treeData={treeData}
                showLine
                blockNode
                onSelect={([key]) => setCategoryFilter(key ? (key as ModelCategoryKey) : null)}
                className="py-2"
              />
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

          {modelList.length === 0 ? (
            <Card>
              <Empty
                description={
                  models.length === 0 ? '暂无模型，请先添加供应商再添加模型' : '无匹配结果'
                }
              >
                {providers.length > 0 && models.length === 0 && (
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => openModelModal()}>
                    添加第一个模型
                  </Button>
                )}
              </Empty>
            </Card>
          ) : viewMode === 'table' ? (
            <Card>
              <Table<ModelRead>
                rowKey="id"
                loading={loading}
                columns={modelColumns}
                dataSource={modelList}
                scroll={{ x: 1024 }}
                pagination={{ pageSize: 20 }}
                onRow={(record) => ({
                  onClick: () => {
                    setSelectedModel(record)
                    setDetailPanelOpen(true)
                  },
                  style: { cursor: 'pointer' },
                })}
                size="small"
              />
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {modelList.map((m) => (
                <Card
                  key={m.id}
                  hoverable
                  className="cursor-pointer"
                  style={{ minHeight: 220 }}
                  onClick={() => {
                    setSelectedModel(m)
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
                        openModelModal(m)
                      }}
                    >
                      编辑
                    </Button>,
                    <Button
                      key="test"
                      type="text"
                      size="small"
                      icon={<ThunderboltOutlined />}
                      loading={verifyLoading && verifyingId === m.id}
                      onClick={(e) => {
                        handleVerifyModel(m, e)
                      }}
                    >
                      测试生成
                    </Button>,
                    <Dropdown
                      key="more"
                      menu={{
                        items: [
                          {
                            key: 'copy',
                            label: '复制',
                            icon: <CopyOutlined />,
                            onClick: ({ domEvent }) => {
                              domEvent.stopPropagation()
                              openCopyModelModal(m)
                            },
                          },
                          {
                            key: 'delete',
                            label: '删除',
                            danger: true,
                            icon: <DeleteOutlined />,
                            onClick: ({ domEvent }) => {
                              domEvent.stopPropagation()
                              handleDeleteModel(m)
                            },
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
                  <div className="flex items-center gap-2 mb-2">
                    <Tag color={categoryColorMap[m.category]}>{categoryLabelMap[m.category]}</Tag>
                  </div>
                  <div className="font-medium mb-1">{m.name}</div>
                  <div className="text-gray-500 text-sm mb-1">
                    供应商：{getProviderName(m.provider_id)}
                  </div>
                  <div className="text-gray-500 text-sm line-clamp-2 mb-2">{m.description || '—'}</div>
                  {m.created_by && (
                    <span className="text-xs text-gray-400">创建：{m.created_by}</span>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>

        {selectedModel && isLargeScreen && (
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
                  setSelectedModel(null)
                }}
              >
                收起
              </Button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <div className="text-sm text-gray-500 mb-1">名称</div>
                <div className="font-medium">{selectedModel.name}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500 mb-1">类别</div>
                <Tag color={categoryColorMap[selectedModel.category]}>
                  {categoryLabelMap[selectedModel.category]}
                </Tag>
              </div>
              <div>
                <div className="text-sm text-gray-500 mb-1">关联供应商</div>
                <div>{getProviderName(selectedModel.provider_id)}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500 mb-1">描述</div>
                <div className="text-gray-700 text-sm">{selectedModel.description || '—'}</div>
              </div>
              <Space>
                <Button
                  type="primary"
                  icon={<EditOutlined />}
                  onClick={() => openModelModal(selectedModel)}
                >
                  编辑
                </Button>
                <Button
                  icon={<ThunderboltOutlined />}
                  loading={verifyLoading && verifyingId === selectedModel.id}
                  onClick={() => handleVerifyModel(selectedModel)}
                >
                  快速测试
                </Button>
              </Space>
            </div>
          </div>
        )}

        {selectedModel && !isLargeScreen && (
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
                <div className="font-medium">{selectedModel.name}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500 mb-1">类别</div>
                <Tag color={categoryColorMap[selectedModel.category]}>
                  {categoryLabelMap[selectedModel.category]}
                </Tag>
              </div>
              <Space>
                <Button
                  type="primary"
                  icon={<EditOutlined />}
                  onClick={() => openModelModal(selectedModel)}
                >
                  编辑
                </Button>
                <Button
                  icon={<ThunderboltOutlined />}
                  loading={verifyLoading && verifyingId === selectedModel.id}
                  onClick={() => handleVerifyModel(selectedModel)}
                >
                  快速测试
                </Button>
              </Space>
            </div>
          </Drawer>
        )}
      </Layout>

      <Modal
        title="模型配置验证"
        open={verifyModalOpen}
        onCancel={() => {
          setVerifyModalOpen(false)
          setVerifyResult(null)
        }}
        footer={
          <Button
            type="primary"
            onClick={() => {
              setVerifyModalOpen(false)
              setVerifyResult(null)
            }}
          >
            关闭
          </Button>
        }
        width={520}
        destroyOnClose
      >
        {verifyResult ? (
          <div className="space-y-3">
            <Alert type={verifyResult.ok ? 'success' : 'warning'} showIcon message={verifyResult.message} />
            <div className="text-sm text-gray-500">耗时 {verifyResult.elapsed_ms} ms · 类别 {verifyResult.category}</div>
            {verifyResult.detail && Object.keys(verifyResult.detail).length > 0 ? (
              <Collapse
                bordered={false}
                items={[
                  {
                    key: 'detail',
                    label: '详情（已脱敏，不含密钥）',
                    children: (
                      <pre className="text-xs bg-gray-50 p-2 rounded overflow-auto max-h-64 whitespace-pre-wrap break-all">
                        {JSON.stringify(verifyResult.detail, null, 2)}
                      </pre>
                    ),
                  },
                ]}
              />
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        title={modelEditing ? '编辑模型' : '添加模型'}
        open={modelModalOpen}
        onCancel={() => {
          setModelModalOpen(false)
          setModelEditing(null)
          form.resetFields()
        }}
        onOk={() => void handleSaveModel()}
        width={560}
        destroyOnClose
      >
        <Form form={form} layout="vertical" className="pt-2">
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input placeholder="例如：GPT-4" />
          </Form.Item>
          <Form.Item name="category" label="类别" rules={[{ required: true }]}>
            <Select options={MODEL_CATEGORIES.map((c) => ({ label: c.label, value: c.key }))} />
          </Form.Item>
          <Form.Item
            name="provider_id"
            label="关联供应商"
            rules={[{ required: true, message: '请选择供应商' }]}
          >
            <Select
              loading={providerOptionsLoading}
              placeholder={
                selectedFormCategory
                  ? `选择支持${categoryLabelMap[selectedFormCategory]}的供应商或自定义供应商`
                  : '选择供应商（请先添加供应商）'
              }
              options={providerSelectOptions}
              notFoundContent={
                providerOptionsLoading
                  ? '加载中…'
                  : selectedFormCategory
                    ? '暂无支持该类别的内置供应商或自定义供应商'
                    : '暂无供应商'
              }
            />
          </Form.Item>
          {unsupportedProviderWarning && (
            <Alert
              type="warning"
              showIcon
              className="mb-4"
              message={unsupportedProviderWarning}
            />
          )}
          <Form.Item name="params" label="参数（JSON）">
            <Input.TextArea rows={3} placeholder='{"max_tokens": 4096, "temperature": 0.7}' />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
