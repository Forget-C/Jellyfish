import { uiText, useUiText } from '../../../uiText'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { WorkspaceFilter } from '../../../components/layout/WorkspaceFilter'
import {
  Alert,
  Descriptions,
  Input,
  InputNumber,
  Button,
  Table,
  Tag,
  Space,
  Tree,
  Dropdown,
  Drawer,
  Modal,
  Form,
  Select,
  Skeleton,
  message,
  Empty,
} from 'antd'
import type { TableColumnsType } from 'antd'
import {
  PlusOutlined,
  DeleteOutlined,
  CopyOutlined,
  MoreOutlined,
  SearchOutlined,
  DownOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import { PageToolbar, WorkspaceScrollPanel } from '../../../components'
import { ApiError, LlmService } from '../../../services/generated'
import type {
  ModelRead,
  ModelCapabilityProfile,
  ModelCategoryKey,
  ProviderRead,
  ProviderSupportedRead,
  ProviderModelCandidate_Input,
  ProviderModelCatalogRead,
  ModelSettingsRead,
  ModelSettingsUpdate,
} from '../../../services/generated'
import {
  MODEL_CATEGORIES,
  categoryLabelMap,
  categoryColorMap,
  SORT_OPTIONS,
} from './constants'

const PAGE_SIZE = 20
const OPTIONS_PAGE_SIZE = 100
const DEFAULT_MODEL_FIELD_BY_CATEGORY = {
  text: 'default_text_model_id',
  image: 'default_image_model_id',
  video: 'default_video_model_id',
} as const
const MODEL_CAPABILITIES = [
  ['text_inputs', '文本输入'],
  ['image_inputs', '图片输入'],
  ['video_inputs', '连续视频输入'],
  ['audio_inputs', '音频输入'],
  ['text_outputs', '文本输出'],
  ['tool_calling', '工具调用'],
] as const
const DECLARATION_LABELS = {
  supported: '支持',
  unsupported: '不支持',
  unknown: '未知',
} as const

function ModelCapabilities({ model }: { model: ModelRead }) {
  return (
    <div className="w-full min-w-0">
      <table className="w-full table-fixed text-left text-xs" aria-label={uiText('模型能力')}>
        <thead>
          <tr className="border-b">
            <th className="py-2 font-medium" scope="col">{uiText('能力')}</th>
            <th className="py-2 font-medium" scope="col">{uiText('模型能力声明')}</th>
            <th className="py-2 font-medium" scope="col">{uiText('当前接入可用')}</th>
          </tr>
        </thead>
        <tbody>
          {MODEL_CAPABILITIES.map(([key, label]) => {
            const declaration = model.capability_profile?.[key]
            const availableIn = [
              ...(model.effective_capabilities?.[key] ? [uiText('文字对话')] : []),
              ...(model.storyboard_inspection_capabilities?.[key] ? [uiText('分镜检查')] : []),
            ]
            return (
              <tr key={key} className="border-b align-top">
                <th scope="row" className="break-words py-2 pr-2 font-normal">{uiText(label)}</th>
                <td className="break-words py-2 pr-2">
                  <span>{uiText(DECLARATION_LABELS[declaration?.declaration ?? 'unknown'])}</span>
                  {declaration?.source && <span className="block text-slate-600">{declaration.source}</span>}
                </td>
                <td className="break-words py-2">{availableIn.join(' · ') || '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {!!model.capability_profile?.max_input_tokens && (
        <p className="mt-2 text-xs">{uiText('上下文上限（tokens）')} {model.capability_profile.max_input_tokens}</p>
      )}
      {model.storyboard_inspection_capabilities?.image_inputs &&
        !model.storyboard_inspection_capabilities.video_inputs && (
          <p className="mt-2 text-xs">{uiText('分镜检查可读取图片和视频静帧，当前接入无法读取连续视频。')}</p>
        )}
    </div>
  )
}

function ModelCapabilityFields() {
  const options = Object.entries(DECLARATION_LABELS).map(([value, label]) => ({ value, label: uiText(label) }))
  return (
    <fieldset className="mb-4">
      <legend className="mb-2 text-sm">{uiText('模型能力声明')}</legend>
      {MODEL_CAPABILITIES.map(([key, label]) => (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" key={key}>
          <Form.Item name={['capability_profile', key, 'declaration']} label={uiText(label)}>
            <Select aria-label={uiText(label)} options={options} placeholder={uiText('未知')} />
          </Form.Item>
          <Form.Item name={['capability_profile', key, 'source']} label={uiText('声明来源')}>
            <Input
              aria-label={uiText('{{capability}}来源', { capability: uiText(label) })}
              maxLength={255}
            />
          </Form.Item>
        </div>
      ))}
      <Form.Item name={['capability_profile', 'max_input_tokens']} label={uiText('上下文上限（tokens）')}>
        <InputNumber min={1} precision={0} className="w-full" />
      </Form.Item>
    </fieldset>
  )
}

/** 选择器读取完整目录，独立于表格的搜索条件和当前页。 */
async function loadOptions<T>(
  getPage: (page: number) => Promise<{ data?: { items: T[]; pagination?: { total?: number } } | null }>,
): Promise<T[]> {
  const options: T[] = []
  for (let page = 1; ; page += 1) {
    const { data } = await getPage(page)
    if (!data || !Array.isArray(data.items)) throw new Error(uiText("目录读取失败"))
    options.push(...data.items)
    if (!data.items.length || options.length >= (data.pagination?.total ?? options.length)) return options
  }
}

/** 模型编辑表单的字段约束，确保提交数据与后端导入契约一致。 */
interface ModelFormValues {
  provider_id: string
  category: ModelCategoryKey
  name?: string
  names?: string[]
  description?: string
  params?: string
  capability_profile?: ModelCapabilityProfile
}

export default function ModelsTab({ header }: { header: ReactNode }) {
  useUiText()
  const [providers, setProviders] = useState<ProviderRead[]>([])
  const [supportedProviders, setSupportedProviders] = useState<ProviderSupportedRead[]>([])
  const [supportedProvidersFailed, setSupportedProvidersFailed] = useState(false)
  const [result, setResult] = useState<{ models: ModelRead[]; total?: number; page: number } | null>(null)
  const [page, setPage] = useState(1)
  const [revision, setRevision] = useState(0)
  const [loadFailed, setLoadFailed] = useState(false)
  const [modelSettings, setModelSettings] = useState<ModelSettingsRead | null>(null)
  const [modelSettingsLoading, setModelSettingsLoading] = useState(true)
  const [modelSettingsFailed, setModelSettingsFailed] = useState(false)
  const [modelSettingsRevision, setModelSettingsRevision] = useState(0)
  const [defaultOptions, setDefaultOptions] = useState<ModelRead[]>([])
  const [defaultOptionsLoading, setDefaultOptionsLoading] = useState(true)
  const [defaultOptionsFailed, setDefaultOptionsFailed] = useState(false)
  const [defaultOptionsRevision, setDefaultOptionsRevision] = useState(0)
  const defaultSaveInFlight = useRef(false)
  const defaultTrigger = useRef<HTMLButtonElement | null>(null)
  const [savingDefaultCategory, setSavingDefaultCategory] = useState<ModelCategoryKey | null>(null)
  const [defaultModelsDrawerOpen, setDefaultModelsDrawerOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'updated' | 'name' | 'category'>('updated')
  const [selectedModel, setSelectedModel] = useState<ModelRead | null>(null)
  const [detailPanelOpen, setDetailPanelOpen] = useState(false)
  const detailTrigger = useRef<HTMLElement | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<ModelCategoryKey | null>(null)
  const [modelModalOpen, setModelModalOpen] = useState(false)
  const [modelEditing, setModelEditing] = useState<ModelRead | null>(null)
  const [providerOptionsLoading, setProviderOptionsLoading] = useState(true)
  const [providerOptionsFailed, setProviderOptionsFailed] = useState(false)
  const [providerOptionsRevision, setProviderOptionsRevision] = useState(0)
  const [formCatalog, setFormCatalog] = useState<ProviderModelCatalogRead | null>(null)
  const [formCatalogLoading, setFormCatalogLoading] = useState(false)
  const [savingModel, setSavingModel] = useState(false)
  const modelSaveInFlight = useRef(false)
  const [modelToDelete, setModelToDelete] = useState<ModelRead | null>(null)
  const [deletingModel, setDeletingModel] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const deleteInFlight = useRef(false)
  const [form] = Form.useForm<ModelFormValues>()
  const selectedFormCategory = Form.useWatch<ModelCategoryKey | undefined>('category', form)
  const selectedFormProviderId = Form.useWatch<string | undefined>('provider_id', form)

  const reload = () => setRevision(value => value + 1)

  useEffect(() => {
    let active = true
    setLoading(true)
    setLoadFailed(false)
    const request = LlmService.listModelsApiV1LlmModelsGet({
      q: search.trim() || undefined,
      category: categoryFilter ?? undefined,
      order: sortBy === 'updated' ? 'updated_at' : sortBy,
      isDesc: true,
      page,
      pageSize: PAGE_SIZE,
    })
    void request.then(({ data }) => {
      if (!active) return
      if (!data || !Array.isArray(data.items)) {
        setLoadFailed(true)
        return
      }
      const total = data.pagination?.total
      setResult({
        models: data.items,
        total: Number.isSafeInteger(total) && total >= 0 ? total : undefined,
        page,
      })
    }).catch(() => {
      if (active) setLoadFailed(true)
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => {
      active = false
      request.cancel()
    }
  }, [categoryFilter, page, revision, search, sortBy])

  useEffect(() => {
    let active = true
    setProviderOptionsLoading(true)
    setProviderOptionsFailed(false)
    void loadOptions(page => LlmService.listProvidersApiV1LlmProvidersGet({ page, pageSize: OPTIONS_PAGE_SIZE }))
      .then(options => {
        if (active) setProviders(options)
      }).catch(() => {
        if (active) setProviderOptionsFailed(true)
      }).finally(() => {
        if (active) setProviderOptionsLoading(false)
      })
    return () => { active = false }
  }, [providerOptionsRevision])

  useEffect(() => {
    let active = true
    const request = LlmService.listSupportedProvidersApiV1LlmProvidersSupportedGet({})
    void request.then(({ data }) => {
      if (active) setSupportedProviders(data ?? [])
    }).catch(() => {
      if (active) setSupportedProvidersFailed(true)
    })
    return () => {
      active = false
      request.cancel()
    }
  }, [])

  useEffect(() => {
    let active = true
    setModelSettingsLoading(true)
    setModelSettingsFailed(false)
    const request = LlmService.getModelSettingsApiV1LlmModelSettingsGet()
    void request.then(({ data }) => {
      if (!active) return
      if (data) setModelSettings(data)
      else setModelSettingsFailed(true)
    }).catch(() => {
      if (active) setModelSettingsFailed(true)
    }).finally(() => {
      if (active) setModelSettingsLoading(false)
    })
    return () => {
      active = false
      request.cancel()
    }
  }, [modelSettingsRevision])

  useEffect(() => {
    if (!defaultModelsDrawerOpen) return
    let active = true
    setDefaultOptionsLoading(true)
    setDefaultOptionsFailed(false)
    void loadOptions(page => LlmService.listModelsApiV1LlmModelsGet({ page, pageSize: OPTIONS_PAGE_SIZE }))
      .then(options => {
        if (active) setDefaultOptions(options)
      }).catch(() => {
        if (active) setDefaultOptionsFailed(true)
      }).finally(() => {
        if (active) setDefaultOptionsLoading(false)
      })
    return () => { active = false }
  }, [defaultModelsDrawerOpen, defaultOptionsRevision])


  const renderDefaultModel = (model: ModelRead) => {
    const field = DEFAULT_MODEL_FIELD_BY_CATEGORY[model.category]
    const defaultId = modelSettings?.[field]
    if (defaultId === undefined) return uiText("未知")
    return defaultId === model.id ? <Tag color="blue">{uiText("默认")}</Tag> : '—'
  }


  /** 更新单一类别的默认模型，不影响 API 超时和日志级别等运行参数。 */
  const updateDefaultModel = async (category: ModelCategoryKey, modelId?: string) => {
    if (defaultSaveInFlight.current) return
    defaultSaveInFlight.current = true
    const field = DEFAULT_MODEL_FIELD_BY_CATEGORY[category]
    setSavingDefaultCategory(category)
    try {
      const response = await LlmService.updateModelSettingsApiV1LlmModelSettingsPut({
        requestBody: { [field]: modelId ?? null } as ModelSettingsUpdate,
      })
      if (!response.data) throw new Error(uiText("默认模型设置响应缺失"))
      setModelSettings(response.data)
      message.success(uiText("{{value1}}默认模型已更新", { value1: uiText(categoryLabelMap[category]) }))
    } catch {
      message.error(uiText("更新默认模型失败"))
    } finally {
      defaultSaveInFlight.current = false
      setSavingDefaultCategory(null)
    }
  }

  const providerSelectOptions = useMemo(
    () => providers.map(provider => ({ label: `${provider.name}（${supportedProviders.find(spec => spec.key === provider.provider_key)?.display_name ?? provider.provider_key}）`, value: provider.id })),
    [providers, supportedProviders],
  )
  const getProviderName = (id: string) => providerSelectOptions.find(option => option.value === id)?.label ?? uiText("未知")
  const selectedFormProvider = providers.find(provider => provider.id === selectedFormProviderId)
  const selectedProviderSpec = selectedFormProvider && supportedProviders.find(
    spec => spec.key === selectedFormProvider.provider_key,
  )
  const supportedFormCategories = selectedProviderSpec?.supported_categories ?? []
  const categorySelectOptions = MODEL_CATEGORIES
    .filter(category => !supportedFormCategories.length || supportedFormCategories.includes(category.key))
    .map(category => ({ label: uiText(category.label), value: category.key }))
  const unsupportedProviderWarning = selectedFormProvider && selectedFormCategory
    && selectedProviderSpec && !supportedFormCategories.includes(selectedFormCategory)
    ? uiText("供应商「{{name}}」不支持「{{value2}}」类别，请调整供应商或类别。", { name: selectedFormProvider.name, value2: uiText(categoryLabelMap[selectedFormCategory]) })
    : null

  /** 新增模型使用当前供应商的目录，切换供应商后忽略旧请求。 */
  useEffect(() => {
    if (!modelModalOpen || modelEditing || !selectedFormProviderId) return
    let active = true
    setFormCatalog(null)
    setFormCatalogLoading(true)
    const request = LlmService.getProviderModelCatalogApiV1LlmProvidersProviderIdModelsCatalogGet({
      providerId: selectedFormProviderId,
    })
    void request.then(({ data }) => {
      if (active) setFormCatalog(data ?? null)
    }).catch(error => {
      if (!active) return
      const reason = error instanceof ApiError ? error.body?.message : undefined
      if (typeof reason === 'string' && reason.startsWith('Provider api_key is empty')) message.error(uiText("请先为此配置填写 API Key"))
      else if (typeof reason === 'string' && reason.startsWith('Provider api_secret is empty')) message.error(uiText("请先为此配置填写 API Secret"))
      else message.error(uiText("获取模型列表失败，仍可手动填写模型名称"))
    }).finally(() => {
      if (active) setFormCatalogLoading(false)
    })
    return () => {
      active = false
      request.cancel()
    }
  }, [modelModalOpen, modelEditing, selectedFormProviderId])

  const handleSaveModel = async () => {
    if (modelSaveInFlight.current) return
    modelSaveInFlight.current = true
    setSavingModel(true)
    try {
      const values = await form.validateFields()
      let params: Record<string, unknown> = {}
      try {
        if (values.params && String(values.params).trim())
          params = JSON.parse(String(values.params))
      } catch {
        message.error(uiText("参数格式需为合法 JSON"))
        return
      }
      const capabilities = values.capability_profile
      const hasCapabilities = capabilities && (
        typeof capabilities.max_input_tokens === 'number' || MODEL_CAPABILITIES.some(([key]) => {
          const capability = capabilities[key]
          return capability?.declaration !== undefined || !!capability?.source
        })
      )
      const capabilityProfile = hasCapabilities ? capabilities : undefined
      if (modelEditing) {
        if (!values.name?.trim()) {
          message.error(uiText("请输入模型名称"))
          return
        }
        await LlmService.updateModelApiV1LlmModelsModelIdPatch({
          modelId: modelEditing.id,
          requestBody: {
            name: values.name.trim(),
            category: values.category,
            provider_id: values.provider_id,
            description: values.description ?? null,
            params,
            capability_profile: capabilityProfile ?? null,
          },
        })
        message.success(uiText("模型已更新"))
      } else {
        const modelNames = [...new Set((values.names ?? []).map((name) => name.trim()).filter(Boolean))]
        if (!modelNames.length) {
          message.warning(uiText("请至少选择或填写一个模型名称"))
          return
        }
        const catalogByName = new Map(
          (formCatalog?.models ?? [])
            .filter((candidate) => candidate.category === values.category)
            .map((candidate) => [candidate.name, candidate]),
        )
        const candidates: ProviderModelCandidate_Input[] = modelNames.map((name) => ({
          ...(catalogByName.get(name) ?? {
            name,
            category: values.category,
            description: values.description?.trim() || undefined,
            params,
          }),
          ...(capabilityProfile ? { capability_profile: capabilityProfile } : {}),
        }))
        const response = await LlmService.importProviderModelsApiV1LlmProvidersProviderIdModelsImportPost({
          providerId: values.provider_id,
          requestBody: { models: candidates },
        })
        const createdCount = response.data?.created?.length ?? 0
        const skippedCount = response.data?.skipped?.length ?? 0
        message.success(uiText("已添加 {{createdCount}} 个模型{{value2}}", { createdCount, value2: skippedCount ? `，跳过 ${skippedCount} 个已存在模型` : '' }))
      }
      setModelModalOpen(false)
      setModelEditing(null)
      form.resetFields()
      reload()
    } catch (e) {
      if (e && typeof e === 'object' && 'errorFields' in e) return
      message.error(modelEditing ? uiText("保存失败") : uiText("添加模型失败"))
    } finally {
      modelSaveInFlight.current = false
      setSavingModel(false)
    }
  }

  const modelDefaultCategories = modelToDelete
    ? MODEL_CATEGORIES.filter(category => modelSettings?.[DEFAULT_MODEL_FIELD_BY_CATEGORY[category.key]] === modelToDelete.id)
    : []
  const defaultFieldsKnown = MODEL_CATEGORIES.every(category => modelSettings?.[DEFAULT_MODEL_FIELD_BY_CATEGORY[category.key]] !== undefined)

  const handleDeleteModel = async () => {
    if (!modelToDelete || deleteInFlight.current) return
    deleteInFlight.current = true
    setDeletingModel(true)
    setDeleteError('')
    try {
      await LlmService.deleteModelApiV1LlmModelsModelIdDelete({ modelId: modelToDelete.id })
      message.success(uiText("模型已删除"))
      setModelToDelete(null)
      setResult(previous => {
        if (!previous || !previous.models.some(model => model.id === modelToDelete.id)) return previous
        return {
          ...previous,
          models: previous.models.filter(model => model.id !== modelToDelete.id),
          total: previous.total === undefined ? undefined : Math.max(0, previous.total - 1),
        }
      })
      setModelSettingsRevision(value => value + 1)
      if (result?.page === page && page > 1 && result.models.length === 1) setPage(page - 1)
      else reload()
    } catch (error) {
      const detail: unknown = error instanceof ApiError ? error.body?.detail ?? error.body?.message : undefined
      setDeleteError(typeof detail === 'string' && detail.trim() ? detail : uiText("删除模型失败，请重试"))
    } finally {
      deleteInFlight.current = false
      setDeletingModel(false)
    }
  }

  const openModelModal = (m?: ModelRead) => {
    setModelEditing(m ?? null)
    form.resetFields()
    if (m) {
      form.setFieldsValue({
        name: m.name,
        category: m.category,
        provider_id: m.provider_id,
        description: m.description,
        params: JSON.stringify(m.params ?? {}, null, 2),
        capability_profile: m.capability_profile,
      })
    } else {
      setFormCatalog(null)
    }
    setModelModalOpen(true)
  }

  /** 基于已有模型打开「添加模型」浮窗，预填字段，名称追加「-复制」。 */
  const openCopyModelModal = (source: ModelRead) => {
    setModelEditing(null)
    setFormCatalog(null)
    form.resetFields()
    form.setFieldsValue({
      names: [`${source.name}-复制`],
      category: source.category,
      provider_id: source.provider_id,
      description: source.description ?? '',
      params: JSON.stringify(source.params ?? {}, null, 2),
      capability_profile: source.capability_profile,
    })
    setModelModalOpen(true)
  }

  const changeSearch = (value: string) => {
    setSearch(value)
    setPage(1)
  }

  const changeCategory = (value: ModelCategoryKey | null) => {
    setCategoryFilter(value)
    setPage(1)
  }

  const hasFilters = Boolean(search.trim() || categoryFilter)
  const modelColumns: TableColumnsType<ModelRead> = [
    {
      title: uiText("名称"), dataIndex: 'name', key: 'name', width: '24%',
      render: (name: string, record) => (
        <Button type="link" className="management-name" title={name || uiText("未知名称")} onClick={event => {
          detailTrigger.current = event.currentTarget
          setSelectedModel(record)
          setDetailPanelOpen(true)
        }}>{name || uiText("未知名称")}</Button>
      ),
    },
    {
      title: uiText("类别"), dataIndex: 'category', key: 'category', width: 102,
      render: (category: ModelCategoryKey) => categoryLabelMap[category]
        ? <Tag color={categoryColorMap[category]}>{uiText(categoryLabelMap[category])}</Tag>
        : uiText("未知"),
    },
    {
      title: uiText("关联供应商"), dataIndex: 'provider_id', key: 'provider_id', width: '16%', ellipsis: true,
      render: (id: string) => getProviderName(id),
    },
    { title: uiText("默认标记"), key: 'default', width: 86, render: (_, model) => renderDefaultModel(model) },
    { title: uiText("简述"), dataIndex: 'description', key: 'description', ellipsis: true, render: (description?: string) => description || '—' },
    {
      title: uiText("操作"), key: 'action', width: 224,
      render: (_, record) => (
        <Space size={4}>
          <Button type="text" size="small" aria-label={uiText("编辑 {{name}}", { name: record.name })} onClick={() => openModelModal(record)}>{uiText("编辑")}</Button>
          <Button type="text" size="small" disabled>{uiText("测试（暂未接入）")}</Button>
          <Dropdown trigger={['click']} menu={{ items: [
            { key: 'copy', label: uiText("复制"), icon: <CopyOutlined />, onClick: () => openCopyModelModal(record) },
            {
              key: 'delete', label: uiText("删除"), danger: true, icon: <DeleteOutlined />,
              onClick: () => {
                setDeleteError('')
                setModelToDelete(record)
              },
            },
          ] }}>
            <Button type="text" size="small" icon={<MoreOutlined />} aria-label={uiText("{{name}}的更多操作", { name: record.name })} />
          </Dropdown>
        </Space>
      ),
    },
  ]

  return (
    <>
      {header}
      <PageToolbar className="management-toolbar">
        <div className="management-tools">
          <Input
            aria-label={uiText("搜索模型")}
            prefix={<SearchOutlined />}
            placeholder={uiText("搜索名称或描述")}
            allowClear
            value={search}
            onChange={event => changeSearch(event.target.value)}
          />
          <WorkspaceFilter title={uiText("筛选")}>
            <Tree
              selectedKeys={categoryFilter ? [categoryFilter] : []}
              treeData={MODEL_CATEGORIES.map(category => ({ key: category.key, title: uiText(category.label), isLeaf: true }))}
              blockNode
              onSelect={([key]) => changeCategory(key ? (key as ModelCategoryKey) : null)}
              className="py-2"
            />
          </WorkspaceFilter>
          {categoryFilter && <Tag color="blue">{uiText(categoryLabelMap[categoryFilter])}</Tag>}
          <Dropdown trigger={['click']} menu={{
            selectable: true,
            selectedKeys: [sortBy],
            items: SORT_OPTIONS.map(option => ({
              key: option.value, label: uiText(option.label),
              onClick: () => {
                setSortBy(option.value as typeof sortBy)
                setPage(1)
              },
            })),
          }}>
            <Button icon={<DownOutlined />}>{uiText("排序：{{label}}", { label: uiText(SORT_OPTIONS.find(option => option.value === sortBy)?.label ?? '') })}</Button>
          </Dropdown>
          <Button ref={defaultTrigger} aria-label={uiText("默认模型")} icon={<SettingOutlined />} onClick={() => {
            setDefaultOptionsLoading(true)
            setDefaultModelsDrawerOpen(true)
          }}>{uiText("默认模型")}</Button>
          {result && <span className="management-count">
            {result.total === undefined ? uiText("已加载 {{length}} 个模型", { length: result.models.length }) : uiText("共 {{total}} 个模型", { total: result.total })}
          </span>}
        </div>
        <Button className="management-primary" type="primary" icon={<PlusOutlined />} onClick={() => openModelModal()}>
          {uiText("添加模型")}
        </Button>
      </PageToolbar>
      <WorkspaceScrollPanel className="management-panel">
        {loadFailed && <Alert
          type="error"
          showIcon
          message={result ? uiText("刷新模型失败，仍显示上次结果") : uiText("加载模型失败")}
          action={<Button size="small" onClick={reload}>{uiText("重试")}</Button>}
        />}
        {loading && !result && <div className="management-surface" role="status" aria-label={uiText("正在加载模型")}>
          <Skeleton active paragraph={{ rows: 4 }} />
        </div>}
        {result && <div className="management-surface">
          <Table<ModelRead>
            className="management-table"
            rowKey="id"
            loading={loading}
            columns={modelColumns}
            dataSource={result.models}
            scroll={{ x: 790 }}
            pagination={result.total === undefined ? false : {
              current: loadFailed ? result.page : page,
              pageSize: PAGE_SIZE,
              total: result.total,
              showSizeChanger: false,
              hideOnSinglePage: true,
              onChange: setPage,
            }}
            locale={{ emptyText: loading || loadFailed ? null : (
              <Empty description={hasFilters ? uiText("无匹配结果") : uiText("暂无模型")}>
                {hasFilters
                  ? <Button onClick={() => { changeSearch(''); changeCategory(null) }}>{uiText("清除筛选")}</Button>
                  : providers.length > 0
                    ? <Button onClick={() => openModelModal()}>{uiText("添加第一个模型")}</Button>
                    : providerOptionsLoading
                      ? uiText("正在读取供应商")
                      : providerOptionsFailed ? uiText("供应商暂不可用，可在添加模型时重试") : uiText("请先添加供应商后再添加模型")}
              </Empty>
            ) }}
            size="small"
          />
        </div>}
      </WorkspaceScrollPanel>

      <Drawer
        className="app-detail-drawer"
        title={<h2 className="m-0 text-base font-semibold">{uiText("模型详情")}</h2>}
        open={detailPanelOpen}
        placement="right"
        width="min(100vw, 480px)"
        onClose={() => setDetailPanelOpen(false)}
        afterOpenChange={open => {
          if (!open) {
            setSelectedModel(null)
            requestAnimationFrame(() => detailTrigger.current?.focus({ preventScroll: true }))
          }
        }}
      >
        {selectedModel && <Descriptions className="management-details" column={1} layout="vertical" size="small" items={[
          { key: 'name', label: uiText("名称"), children: selectedModel.name || uiText("未知") },
          { key: 'category', label: uiText("类别"), children: uiText(categoryLabelMap[selectedModel.category] ?? '未知') },
          { key: 'provider', label: uiText("关联供应商"), children: getProviderName(selectedModel.provider_id) },
          { key: 'default', label: uiText("默认标记"), children: renderDefaultModel(selectedModel) },
          { key: 'description', label: uiText("完整描述"), children: <span className="whitespace-pre-wrap">{selectedModel.description || '—'}</span> },
          { key: 'created', label: uiText("创建人"), children: selectedModel.created_by || '—' },
          { key: 'capabilities', label: uiText('模型能力'), children: <ModelCapabilities model={selectedModel} /> },
          { key: 'params', label: uiText("参数（JSON）"), children: (selectedModel.params === undefined || selectedModel.params === null) ? '—' : (
            <pre className="w-full min-w-0 max-w-full overflow-x-auto whitespace-pre rounded-md bg-slate-50 p-3 text-xs" tabIndex={0} aria-label={uiText("完整参数 JSON")}>{JSON.stringify(selectedModel.params, null, 2)}</pre>
          ) },
        ]} />}
      </Drawer>

      <Drawer
        className="app-detail-drawer"
        title={<h2 className="m-0 text-base font-semibold">{uiText("全局默认模型")}</h2>}
        placement="right"
        open={defaultModelsDrawerOpen}
        keyboard={savingDefaultCategory === null}
        maskClosable={savingDefaultCategory === null}
        closable={savingDefaultCategory === null}
        onClose={() => {
          if (!defaultSaveInFlight.current) setDefaultModelsDrawerOpen(false)
        }}
        afterOpenChange={open => {
          if (!open) requestAnimationFrame(() => defaultTrigger.current?.focus({ preventScroll: true }))
        }}
        width="min(100vw, 400px)"
      >
        <Alert
          type="info"
          showIcon
          className="mb-5"
          message={uiText("默认模型用于未显式指定模型的生成请求；修改会立即生效。")}
        />
        <div className="space-y-4">
          {modelSettingsFailed && <Alert
            type="error"
            showIcon
            message={uiText("默认模型设置读取失败")}
            action={<Button size="small" onClick={() => setModelSettingsRevision(value => value + 1)}>{uiText("重试")}</Button>}
          />}
          {defaultOptionsFailed && <Alert
            type="error"
            showIcon
            message={uiText("默认模型选项读取失败")}
            action={<Button size="small" onClick={() => setDefaultOptionsRevision(value => value + 1)}>{uiText("重试")}</Button>}
          />}
          {MODEL_CATEGORIES.map(category => {
            const defaultId = modelSettings?.[DEFAULT_MODEL_FIELD_BY_CATEGORY[category.key]]
            const label = uiText("默认{{label}}", { label: uiText(category.label) })
            const options = defaultOptions.filter(model => model.category === category.key).map(model => ({
              label: `${model.name} · ${getProviderName(model.provider_id)}`,
              value: model.id,
            }))
            if (defaultId && !options.some(option => option.value === defaultId)) {
              options.unshift({ label: uiText("已配置的模型 · 详情未知"), value: defaultId })
            }
            return (
              <div key={category.key}>
                <div className="mb-1.5 text-sm font-medium text-gray-700">{label}</div>
                <Select<string | null>
                  aria-label={label}
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  className="w-full"
                  value={defaultId ?? null}
                  placeholder={defaultId === undefined ? uiText("未知") : uiText("选择{{label}}", { label })}
                  loading={modelSettingsLoading || defaultOptionsLoading || savingDefaultCategory === category.key}
                  disabled={modelSettingsLoading || defaultOptionsLoading || modelSettingsFailed || defaultOptionsFailed || savingDefaultCategory !== null}
                  options={options}
                  onChange={modelId => void updateDefaultModel(category.key, modelId ?? undefined)}
                />
              </div>
            )
          })}
        </div>
      </Drawer>

      <Modal
        title={modelEditing ? uiText("编辑模型") : uiText("添加模型")}
        open={modelModalOpen}
        maskClosable={false}
        keyboard={!savingModel}
        closable={!savingModel}
        confirmLoading={savingModel}
        cancelButtonProps={{ disabled: savingModel }}
        onCancel={() => {
          if (modelSaveInFlight.current) return
          setModelModalOpen(false)
          setModelEditing(null)
          form.resetFields()
        }}
        onOk={() => void handleSaveModel()}
        width={560}
        destroyOnClose
      >
        <Form form={form} layout="vertical" className="pt-2">
          {providerOptionsFailed && <Alert
            showIcon
            type="warning"
            className="mb-4"
            message={uiText("供应商选项读取失败")}
            action={<Button size="small" onClick={() => setProviderOptionsRevision(value => value + 1)}>{uiText("重试")}</Button>}
          />}
          {supportedProvidersFailed && <Alert
            showIcon
            type="warning"
            className="mb-4"
            message={uiText("未能读取供应商支持的类别，保存时仍会校验")}
          />}
          <Form.Item
            name="provider_id"
            label={uiText("供应商")}
            rules={[{ required: true, message: uiText("请选择供应商") }]}
          >
            <Select
              aria-label={uiText("供应商")}
              loading={providerOptionsLoading}
              placeholder={uiText("选择供应商（请先添加供应商）")}
              options={providerSelectOptions}
              notFoundContent={providerOptionsLoading ? uiText("加载中…") : providerOptionsFailed ? uiText("读取失败") : uiText("暂无供应商")}
              onChange={() => {
                setFormCatalog(null)
                form.setFieldsValue({ category: undefined, names: [] })
              }}
            />
          </Form.Item>
          <Form.Item name="category" label={uiText("类别")} rules={[{ required: true, message: uiText("请选择类别") }]}>
            <Select
              aria-label={uiText("类别")}
              disabled={!selectedFormProviderId}
              placeholder={selectedFormProviderId ? uiText("选择模型类别") : uiText("请先选择供应商")}
              options={categorySelectOptions}
              onChange={() => form.setFieldsValue({ names: [] })}
            />
          </Form.Item>
          {modelEditing ? (
            <Form.Item name="name" label={uiText("模型名称")} rules={[{ required: true, message: uiText("请输入模型名称") }]}>
              <Input placeholder={uiText("例如：GPT-4")} />
            </Form.Item>
          ) : (
            <Form.Item name="names" label={uiText("模型名称")} rules={[{ required: true, message: uiText("请选择或输入至少一个模型名称") }]}>
              <Select
                aria-label={uiText("模型名称")}
                mode="tags"
                tokenSeparators={[',', '，']}
                loading={formCatalogLoading}
                disabled={!selectedFormCategory}
                placeholder={selectedFormCategory ? uiText("可多选目录模型，或直接输入模型名称后回车") : uiText("请先选择供应商和类别")}
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
              message={formCatalog.source === 'provider_api' ? uiText("模型名称来自供应商 API，也可手动输入。") : uiText("供应商未提供模型列表 API，已加载官方目录；仍可手动输入。")}
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
          <Form.Item name="params" label={uiText("参数（JSON）")}>
            <Input.TextArea rows={3} placeholder='{"max_tokens": 4096, "temperature": 0.7}' />
          </Form.Item>
          <ModelCapabilityFields />
          <Form.Item name="description" label={uiText("描述")}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={uiText("删除模型")}
        open={modelToDelete !== null}
        okText={uiText("删除")}
        okType="danger"
        confirmLoading={deletingModel}
        cancelButtonProps={{ disabled: deletingModel }}
        keyboard={!deletingModel}
        closable={!deletingModel}
        maskClosable={false}
        onCancel={() => {
          if (!deleteInFlight.current) setModelToDelete(null)
        }}
        onOk={() => void handleDeleteModel()}
      >
        <p className="break-words">{uiText("确定删除「")}{modelToDelete?.name || uiText("未知名称")}{uiText("」？删除后无法恢复，引用该模型的配置可能无法继续使用。")}</p>
        {modelDefaultCategories.length > 0 && (
          <p>{uiText("同时清除")}{modelDefaultCategories.map(category => uiText(category.label)).join(uiText('、'))}{uiText("的全局默认模型配置。")}</p>
        )}
        {!defaultFieldsKnown && <p>{uiText("如果该模型被设为全局默认模型，对应配置也会被清除。")}</p>}
        {deleteError && <Alert type="error" showIcon message={deleteError} />}
      </Modal>
    </>
  )
}
