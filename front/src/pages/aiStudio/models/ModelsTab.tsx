import { useEffect, useState, useMemo } from 'react'
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
  SettingOutlined,
} from '@ant-design/icons'
import { LlmService } from '../../../services/generated/services/LlmService'
import type {
  ModelRead,
  ModelCategoryKey,
  ProviderRead,
  ProviderSupportedRead,
  ProviderModelCandidate,
  ProviderModelCatalogRead,
  ModelSettingsRead,
  ModelSettingsUpdate,
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
  const [modelSettings, setModelSettings] = useState<ModelSettingsRead | null>(null)
  const [modelSettingsLoading, setModelSettingsLoading] = useState(true)
  const [savingDefaultCategory, setSavingDefaultCategory] = useState<ModelCategoryKey | null>(null)
  const [defaultModelsDrawerOpen, setDefaultModelsDrawerOpen] = useState(false)
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
  const [formCatalog, setFormCatalog] = useState<ProviderModelCatalogRead | null>(null)
  const [formCatalogLoading, setFormCatalogLoading] = useState(false)
  const [importingModels, setImportingModels] = useState(false)
  const [form] = Form.useForm()
  const selectedFormCategory = Form.useWatch<ModelCategoryKey | undefined>('category', form)
  const selectedFormProviderId = Form.useWatch<string | undefined>('provider_id', form)
  const { lg } = Grid.useBreakpoint()
  const isLargeScreen = lg ?? false

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

  /** 读取全局默认模型；默认路由仍由 model_settings 作为唯一事实来源。 */
  const loadModelSettings = async () => {
    setModelSettingsLoading(true)
    try {
      const response = await LlmService.getModelSettingsApiV1LlmModelSettingsGet()
      setModelSettings(response.data ?? null)
    } catch {
      message.error('加载默认模型失败')
    } finally {
      setModelSettingsLoading(false)
    }
  }

  useEffect(() => {
    void loadModelSettings()
  }, [])

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

  const defaultModelFieldByCategory: Record<ModelCategoryKey, keyof ModelSettingsUpdate> = {
    text: 'default_text_model_id',
    image: 'default_image_model_id',
    video: 'default_video_model_id',
  }
  const configuredDefaultCount = MODEL_CATEGORIES.filter(
    (category) => Boolean(modelSettings?.[defaultModelFieldByCategory[category.key]]),
  ).length

  /** 更新单一类别的默认模型，不影响 API 超时和日志级别等运行参数。 */
  const updateDefaultModel = async (category: ModelCategoryKey, modelId?: string) => {
    const field = defaultModelFieldByCategory[category]
    setSavingDefaultCategory(category)
    try {
      const response = await LlmService.updateModelSettingsApiV1LlmModelSettingsPut({
        requestBody: { [field]: modelId ?? null } as ModelSettingsUpdate,
      })
      setModelSettings(response.data ?? null)
      message.success(`${categoryLabelMap[category]}默认模型已更新`)
    } catch {
      message.error('更新默认模型失败')
    } finally {
      setSavingDefaultCategory(null)
    }
  }

  const resolveProviderSpec = (providerName: string) =>
    supportedProviders.find(
      (spec) => spec.display_name === providerName || (spec.aliases?.length && spec.aliases.includes(providerName)),
    )

  const providerSelectOptions = useMemo(
    () => providers.map((provider) => ({ label: provider.name, value: provider.id })),
    [providers],
  )
  const selectedFormProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedFormProviderId),
    [providers, selectedFormProviderId],
  )
  const supportedFormCategories = useMemo(() => {
    const spec = selectedFormProvider ? resolveProviderSpec(selectedFormProvider.name) : null
    if (!spec) return []
    return spec.supported_categories
  }, [selectedFormProvider, supportedProviders])
  const categorySelectOptions = useMemo(
    () => MODEL_CATEGORIES
      .filter((category) => !supportedFormCategories.length || supportedFormCategories.includes(category.key))
      .map((category) => ({ label: category.label, value: category.key })),
    [supportedFormCategories],
  )
  const unsupportedProviderWarning = useMemo(() => {
    if (!selectedFormProvider || !selectedFormCategory) return null
    const spec = resolveProviderSpec(selectedFormProvider.name)
    if (!spec || spec.supported_categories.includes(selectedFormCategory)) return null
    const categoryLabel = categoryLabelMap[selectedFormCategory]
    return `供应商「${selectedFormProvider.name}」不支持「${categoryLabel}」类别，请调整供应商或类别。`
  }, [selectedFormCategory, selectedFormProvider, supportedProviders])

  useEffect(() => {
    if (modelEditing || !selectedFormProviderId) return
    void loadFormCatalog(selectedFormProviderId)
  }, [modelEditing, selectedFormProviderId])

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
        const modelNames = [...new Set((values.names ?? []).map((name: string) => name.trim()).filter(Boolean))]
        if (!modelNames.length) {
          message.warning('请至少选择或填写一个模型名称')
          return
        }
        const catalogByName = new Map(
          (formCatalog?.models ?? [])
            .filter((candidate) => candidate.category === values.category)
            .map((candidate) => [candidate.name, candidate]),
        )
        const candidates: ProviderModelCandidate[] = modelNames.map((name) => catalogByName.get(name) ?? ({
          name,
          category: values.category,
          description: values.description?.trim() || undefined,
          params,
        }))
        setImportingModels(true)
        const response = await LlmService.importProviderModelsApiV1LlmProvidersProviderIdModelsImportPost({
          providerId: values.provider_id,
          requestBody: { models: candidates },
        })
        const createdCount = response.data?.created?.length ?? 0
        const skippedCount = response.data?.skipped?.length ?? 0
        message.success(`已添加 ${createdCount} 个模型${skippedCount ? `，跳过 ${skippedCount} 个已存在模型` : ''}`)
      }
      setModelModalOpen(false)
      setModelEditing(null)
      form.resetFields()
      void load()
    } catch (e) {
      if (e && typeof e === 'object' && 'errorFields' in e) return
      message.error(modelEditing ? '保存失败' : '添加模型失败')
    }
    setImportingModels(false)
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
      setFormCatalog(null)
    }
    setModelModalOpen(true)
  }

  /** 在添加表单中读取供应商目录；密钥仅在后端用于出站请求。 */
  const loadFormCatalog = async (providerId: string) => {
    setFormCatalogLoading(true)
    try {
      const response = await LlmService.getProviderModelCatalogApiV1LlmProvidersProviderIdModelsCatalogGet({
        providerId,
      })
      setFormCatalog(response.data ?? null)
    } catch {
      setFormCatalog(null)
      message.error('获取模型列表失败，仍可手动填写模型名称')
    } finally {
      setFormCatalogLoading(false)
    }
  }

  /** 基于已有模型打开「添加模型」浮窗，预填字段，名称追加「-复制」。 */
  const openCopyModelModal = (source: ModelRead) => {
    setModelEditing(null)
    form.resetFields()
    form.setFieldsValue({
      names: [`${source.name}-复制`],
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
              onClick={(e) => {
                e.stopPropagation()
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
          <Button icon={<SettingOutlined />} onClick={() => setDefaultModelsDrawerOpen(true)}>
            默认模型 {configuredDefaultCount}/3
          </Button>
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
                    <Button key="test" type="text" size="small" icon={<ThunderboltOutlined />}>
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
                <Button icon={<ThunderboltOutlined />}>快速测试</Button>
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
                <Button icon={<ThunderboltOutlined />}>快速测试</Button>
              </Space>
            </div>
          </Drawer>
        )}
      </Layout>

      <Drawer
        title="全局默认模型"
        placement="right"
        open={defaultModelsDrawerOpen}
        onClose={() => setDefaultModelsDrawerOpen(false)}
        width={400}
      >
        <Alert
          type="info"
          showIcon
          className="mb-5"
          message="默认模型用于未显式指定模型的生成请求；修改会立即生效。"
        />
        <div className="space-y-4">
          {MODEL_CATEGORIES.map((category) => {
            const field = defaultModelFieldByCategory[category.key]
            const categoryModels = models.filter((model) => model.category === category.key)
            return (
              <div key={category.key}>
                <div className="mb-1.5 text-sm font-medium text-gray-700">默认{category.label}</div>
                <Select
                  allowClear
                  className="w-full"
                  value={modelSettings?.[field] ?? undefined}
                  placeholder={`选择默认${category.label}`}
                  loading={modelSettingsLoading || savingDefaultCategory === category.key}
                  options={categoryModels.map((model) => ({
                    label: `${model.name} · ${getProviderName(model.provider_id)}`,
                    value: model.id,
                  }))}
                  onChange={(modelId) => void updateDefaultModel(category.key, modelId)}
                />
              </div>
            )
          })}
        </div>
      </Drawer>

      <Modal
        title={modelEditing ? '编辑模型' : '添加模型'}
        open={modelModalOpen}
        onCancel={() => {
          setModelModalOpen(false)
          setModelEditing(null)
          form.resetFields()
        }}
        onOk={() => void handleSaveModel()}
        okButtonProps={{ loading: importingModels }}
        width={560}
        destroyOnClose
      >
        <Form form={form} layout="vertical" className="pt-2">
          <Form.Item
            name="provider_id"
            label="供应商"
            rules={[{ required: true, message: '请选择供应商' }]}
          >
            <Select
              loading={providerOptionsLoading}
              placeholder="选择供应商（请先添加供应商）"
              options={providerSelectOptions}
              notFoundContent={providerOptionsLoading ? '加载中…' : '暂无供应商'}
              onChange={() => form.setFieldsValue({ category: undefined, names: [] })}
            />
          </Form.Item>
          <Form.Item name="category" label="类别" rules={[{ required: true, message: '请选择类别' }]}>
            <Select
              disabled={!selectedFormProviderId}
              placeholder={selectedFormProviderId ? '选择模型类别' : '请先选择供应商'}
              options={categorySelectOptions}
              onChange={() => form.setFieldsValue({ names: [] })}
            />
          </Form.Item>
          {modelEditing ? (
            <Form.Item name="name" label="模型名称" rules={[{ required: true, message: '请输入模型名称' }]}>
              <Input placeholder="例如：GPT-4" />
            </Form.Item>
          ) : (
            <Form.Item name="names" label="模型名称" rules={[{ required: true, message: '请选择或输入至少一个模型名称' }]}>
              <Select
                mode="tags"
                tokenSeparators={[',', '，']}
                loading={formCatalogLoading}
                disabled={!selectedFormCategory}
                placeholder={selectedFormCategory ? '可多选目录模型，或直接输入模型名称后回车' : '请先选择供应商和类别'}
                options={(formCatalog?.models ?? [])
                  .filter((candidate) => candidate.category === selectedFormCategory)
                  .map((candidate) => ({
                    value: candidate.name,
                    label: candidate.description ? `${candidate.name} · ${candidate.description}` : candidate.name,
                  }))}
              />
            </Form.Item>
          )}
          {!modelEditing && formCatalog && (
            <Alert
              type="info"
              showIcon
              className="mb-4"
              message={formCatalog.source === 'provider_api' ? '模型名称来自供应商 API，也可手动输入。' : '供应商未提供模型列表 API，已加载官方目录；仍可手动输入。'}
            />
          )}
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
