import { uiText, useUiText } from '../../../uiText'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { DrawerDiscardDialog } from '../../../components/layout/DrawerDiscardDialog'
import { ResourceEditorFrame } from '../assets/components/ResourceEditorFrame'
import '../assets/components/resourceEditor.css'
import '../project/ProjectWorkbench/tabs/project-settings.css'
import { WorkspaceFilter } from '../../../components/layout/WorkspaceFilter'
import {
  Alert,
  Input,
  InputNumber,
  Switch,
  Checkbox,
  Tooltip,
  Button,
  Table,
  Tag,
  Space,
  Typography,
  Tree,
  Dropdown,
  ConfigProvider,
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
  UndoOutlined,
  InfoCircleOutlined,
  DeleteOutlined,
  MoreOutlined,
  SearchOutlined,
  DownOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import { PageToolbar, WorkspaceScrollPanel } from '../../../components'
import { ApiError, LlmService } from '../../../services/generated'
import './modelCapabilities.css'
import { ModelCapabilityVerifications, useCapabilityTests } from './ModelCapabilityVerifications'
import type {
  ModelRead,
  ModelCapabilityProfile_Input,
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
const defaultModelTheme = { components: { Select: { controlHeight: 36 } } }
const DEFAULT_MODEL_FIELD_BY_CATEGORY = {
  text: 'default_text_model_id',
  image: 'default_image_model_id',
  video: 'default_video_model_id',
} as const
type CapabilityProfile = ModelCapabilityProfile_Input
const MODALITIES = [['text', '文本'], ['image', '图像'], ['audio', '音频'], ['video', '视频']] as const
const TOKEN_LIMITS = [['context_window', '上下文窗口'], ['max_input_tokens', '最大输入'], ['max_output_tokens', '最大输出']] as const

function CapabilityReset({ defaults, loading, editing }: { defaults: CapabilityProfile; loading: boolean; editing: boolean }) {
  const form = Form.useFormInstance()
  const [previous, setPrevious] = useState<Partial<ModelFormValues> | null>(null)
  return <Space size={4}>
    {previous && <Button type="link" size="small" onClick={() => {
      form.setFieldValue('capability_profile', previous.capability_profile)
      form.setFieldValue('videoDurationRules', previous.videoDurationRules)
      setPrevious(null)
    }}>{uiText('撤销')}</Button>}
    <Tooltip title={uiText('恢复模型能力默认值')}><Button type="text" icon={<UndoOutlined />} aria-label={uiText('恢复模型能力默认值')} disabled={loading} onClick={() => {
      setPrevious(structuredClone({ capability_profile: form.getFieldValue('capability_profile'), videoDurationRules: form.getFieldValue('videoDurationRules') }))
      form.setFieldValue('capability_profile', editing ? structuredClone(defaults) : {})
      form.setFieldValue('videoDurationRules', undefined)
    }} /></Tooltip>
  </Space>
}

function ModelCapabilityFields({ defaults, model }: { defaults: CapabilityProfile; model: ModelRead | null }) {
  const form = Form.useFormInstance()
  const profile: CapabilityProfile = Form.useWatch('capability_profile', form) ?? {}
  const tools = profile.tool_calling ?? defaults.tool_calling
  const streaming = profile.native_streaming ?? defaults.native_streaming
  function field(key: Extract<keyof CapabilityProfile, keyof NonNullable<ModelRead['effective_capabilities']>>, label: string, reason?: string) {
    const hint = reason || (model?.capability_profile?.[key] && model.effective_capabilities?.[key] === false ? '当前对话接入无法使用此能力' : undefined)
    return <span key={key} className="inline-flex items-center gap-2">
      <Form.Item noStyle name={['capability_profile', key]} valuePropName="checked" getValueProps={value => ({ checked: !reason && (value ?? defaults[key] ?? false) })}>
        {key === 'tool_calling' ? <Switch size="small" aria-label={uiText(label)} /> : <Checkbox disabled={!!reason}>{uiText(label)}</Checkbox>}
      </Form.Item>
      {key === 'tool_calling' && uiText(label)}
      {(hint || key === 'video_inputs') && <Tooltip trigger={['hover', 'focus']} title={uiText(hint || '读取连续视频')}><InfoCircleOutlined tabIndex={0} aria-label={uiText(hint || '读取连续视频')} /></Tooltip>}
    </span>
  }
  function row(label: string, controls: ReactNode, action?: ReactNode) {
    return <div className="model-cap-row" role="group" aria-label={uiText(label)}>
      <span className="model-cap-label">{uiText(label)}</span><div className="model-cap-options">{controls}</div>{action}
    </div>
  }
  const modelId = model?.category === 'text' ? model.id : undefined
  const tests = useCapabilityTests(modelId)
  const probe = (group: 'input' | 'tools') => <ModelCapabilityVerifications modelId={modelId} tests={tests} group={group} profile={{ ...defaults, ...profile }} />
  return <div className="model-cap-fields">
    {row('输入模态', MODALITIES.map(([key,label]) => field(`${key}_inputs`,label)), probe('input'))}
    {row('输出模态', MODALITIES.map(([key,label]) => field(`${key}_outputs`,label)))}
    {row('工具调用', <>{field('tool_calling','函数调用（Function calling）')}<div className="model-cap-options w-full">
      {field('tool_results','工具结果回传', tools ? undefined : '请先开启函数调用')}
      {field('parallel_tool_calls','并行工具调用', tools ? undefined : '请先开启函数调用')}
      {field('streaming_tool_arguments','工具参数流式传输', !tools ? '请先开启函数调用' : !streaming ? '请先开启原生流式响应' : undefined)}
    </div></>,probe('tools'))}
    {row('结构化输出', <>{field('json_object','JSON 模式')}{field('json_schema','JSON Schema 约束输出')}</>)}
    {row('响应方式', <>{field('non_streaming','非流式响应')}{field('native_streaming','原生流式响应')}</>)}
    {row('结果返回',field('direct_result','直接返回结果'))}
    <div><span className="model-cap-subheading">{uiText('Token 限额')}</span><div className="model-cap-limits">{TOKEN_LIMITS.map(([key,label]) =>
      <Form.Item key={key} name={['capability_profile',key]} label={uiText(label)}
        getValueProps={value => { const tokens = value === undefined ? defaults[key] : value; return { value: tokens > 0 ? tokens / 1000 : null } }}
        normalize={value => value === null || value === undefined ? null : Math.round(value * 1000)}
        rules={[{ validator: async (_, value) => { if (value !== null && value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) throw new Error(uiText('请输入大于零的 Token 限额')) } }]}>
        <InputNumber precision={3} formatter={(value, info) => info.userTyping ? info.input : value === null || value === undefined || String(value) === '' ? '' : String(Number(value))} step={0.001} suffix="K tokens" placeholder={uiText('未指定')} className="w-full" />
      </Form.Item>)}</div>
      <p className="model-cap-note">{uiText('1 K = 1,000 tokens。留空表示未指定，实际限制以供应商为准。')}</p></div>
    {model?.storyboard_inspection_capabilities?.image_inputs && !model.storyboard_inspection_capabilities.video_inputs &&
      <p className="model-cap-note">{uiText('分镜检查可读取图片和视频静帧，当前接入无法读取连续视频。')}</p>}
  </div>
}

const IMAGE_MODES = [
  ['text_to_image', '文生图'],
  ['reference_image', '参考图生图'],
  ['edit', '图片编辑'],
] as const

function ImageCapabilityFields({ model, providerKey, defaults }: { model: ModelRead | null; providerKey?: string; defaults: CapabilityProfile }) {
  const modes = Form.useWatch(['capability_profile', 'image_modes'], Form.useFormInstance())
  return IMAGE_MODES.filter(([mode]) => mode === 'text_to_image' ||
    (providerKey === 'openai' ? mode === 'edit' : mode === 'reference_image')).map(([mode, label]) => {
    const effective = model?.effective_image_modes?.[mode]
    const enabled = modes?.[mode]?.supported ?? defaults.image_modes?.[mode]?.supported
    return (
      <fieldset key={mode} className="mb-4">
        <legend className="mb-2 text-sm">{uiText(label)}</legend>
        {effective && <p className="mb-2 text-xs">
          {uiText('当前接入可用')} · {uiText(effective.supported ? '支持' : '不支持')}
          {effective.sizes?.length ? ` · ${effective.sizes.join(', ')}` : ''}
        </p>}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(['supported', 'seed', 'watermark'] as const).map((key, index) => (
            <Form.Item key={key} name={['capability_profile', 'image_modes', mode, key]} hidden={key !== 'supported' && !enabled} valuePropName="checked"
              getValueProps={value => ({ checked: value ?? defaults.image_modes?.[mode]?.[key] ?? false })}
              label={uiText(['是否支持此操作', '随机种子', '水印'][index])}>
              <Switch size="small" />
            </Form.Item>
          ))}
          {(['sizes', 'ratios', 'resolution_profiles'] as const).map((key, index) => (
            <Form.Item key={key} name={['capability_profile', 'image_modes', mode, key]} hidden={!enabled}
              getValueProps={value => ({ value: value ?? defaults.image_modes?.[mode]?.[key] })}
              label={uiText(['尺寸', '宽高比', '分辨率档位'][index])}>
              <Select mode="tags" tokenSeparators={[',']} placeholder={uiText('未知')} />
            </Form.Item>
          ))}
          {(['max_outputs', 'max_reference_images'] as const).map((key, index) => (
            <Form.Item key={key} name={['capability_profile', 'image_modes', mode, key]} hidden={!enabled}
              getValueProps={value => ({ value: value ?? defaults.image_modes?.[mode]?.[key] })}
              label={uiText(['最大出图数', '最大参考图数'][index])}>
              <InputNumber min={index === 0 ? 1 : 0} max={index === 0 ? 10 : undefined} precision={0} className="w-full" />
            </Form.Item>
          ))}
        </div>
      </fieldset>
    )
  })
}

const VIDEO_MODES = [
  ['text_to_video', '文生视频'],
  ['first_frame', '首帧'],
  ['first_last_frames', '首尾帧'],
  ['key_frames', '关键帧'],
  ['subject_reference', '主体参考'],
] as const

function VideoCapabilityFields({ model, providerKey, defaults }: { model: ModelRead | null; providerKey?: string; defaults: CapabilityProfile }) {
  const modes = Form.useWatch(['capability_profile', 'video_modes'], Form.useFormInstance())
  return VIDEO_MODES.map(([mode, label]) => {
    const enabled = modes?.[mode]?.supported ?? defaults.video_modes?.[mode]?.supported
    return (<fieldset key={mode} className="mb-4">
      <legend className="mb-2 text-sm">{uiText(label)}</legend>
      {model?.effective_video_modes?.[mode] && <p className="mb-2 text-xs">
        {uiText('当前接入可用')} · {uiText(model.effective_video_modes[mode].supported ? '支持' : '不支持')}
      </p>}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {([
          ['supported', '是否支持此操作'],
          ['combine_subjects_and_frames', '组合主体与帧参考'],
          ['audio_reference_input', '音频参考输入'],
          ['native_audio_output', '原生音轨输出'],
          ['audio_switch', '音轨开关'],
        ] as const).map(([key, fieldLabel]) => (
          <Form.Item key={key} name={['capability_profile', 'video_modes', mode, key]} hidden={key !== 'supported' && !enabled} valuePropName="checked"
            getValueProps={value => ({ checked: value ?? defaults.video_modes?.[mode]?.[key] ?? false })} label={uiText(fieldLabel)}>
            <Switch size="small" />
          </Form.Item>
        ))}
        <Form.Item name={['capability_profile', 'video_modes', mode, 'ratios']} hidden={!enabled} getValueProps={value => ({ value: value ?? defaults.video_modes?.[mode]?.ratios })} label={uiText('宽高比')}>
          <Select mode="tags" tokenSeparators={[',']} placeholder={uiText('未知')} />
        </Form.Item>
        <Form.Item name={['capability_profile', 'video_modes', mode, 'reference_kinds']} hidden={!enabled} getValueProps={value => ({ value: value ?? defaults.video_modes?.[mode]?.reference_kinds })} label={uiText('参考素材类型')}>
          <Select mode="multiple" options={([
            ['image', '图片'], ['video', '视频'], ['audio', '音频'],
          ] as const).map(([value, item]) => ({ value, label: uiText(item) }))} />
        </Form.Item>
        <Form.Item name={['capability_profile', 'video_modes', mode, 'max_references']} hidden={!enabled} getValueProps={value => ({ value: value ?? defaults.video_modes?.[mode]?.max_references })} label={uiText('最大参考素材数')}>
          <InputNumber min={0} precision={0} className="w-full" />
        </Form.Item>
      </div>
      {providerKey === 'vidu' && <Form.Item hidden={!enabled} name={['videoDurationRules', mode]} label={uiText('按分辨率声明时长（JSON）')}
        rules={[{ validator: async (_, value?: string) => {
          if (!value?.trim()) return
          try {
            const rules: unknown = JSON.parse(value)
            if (!rules || typeof rules !== 'object' || Array.isArray(rules)) throw new Error()
          } catch {
            throw new Error(uiText('参数必须为 JSON 对象'))
          }
        } }]}>
        <Input.TextArea rows={2} placeholder='{"720p":{"min_seconds":5,"max_seconds":15},"1080p":[5,10]}' />
      </Form.Item>}
    </fieldset>)
  })
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
  capability_profile?: ModelCapabilityProfile_Input
  videoDurationRules?: Partial<Record<(typeof VIDEO_MODES)[number][0], string>>
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
  const [defaultModelsModalOpen, setDefaultModelsModalOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'updated' | 'name' | 'category'>('updated')
  const [categoryFilter, setCategoryFilter] = useState<ModelCategoryKey | null>(null)
  const [modelEditorOpen, setModelEditorOpen] = useState(false)
  const initialFields = useRef<Partial<ModelFormValues>>({})
  const pendingName = useRef('')
  const advanced = useRef<HTMLDetailsElement>(null)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [modelEditing, setModelEditing] = useState<ModelRead | null>(null)
  const editorTrigger = useRef<HTMLElement | null>(null)
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
    if (!defaultModelsModalOpen) return
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
  }, [defaultModelsModalOpen, defaultOptionsRevision])


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
  const selectedNames = Form.useWatch<string[]>('names', form)
  const editedName = Form.useWatch<string>('name', form)
  const categoryDefaults = (selectedFormCategory && selectedProviderSpec?.capability_defaults?.[selectedFormCategory]) || {}
  const currentName = modelEditing ? editedName : selectedNames?.[0]
  const catalogDefaults = formCatalog?.models?.find(item => item.name === currentName && item.category === selectedFormCategory)?.capability_profile
  const defaults = (!modelEditing && (selectedNames?.length ?? 0) > 1 ? categoryDefaults : catalogDefaults) ?? categoryDefaults
  const unsupportedProviderWarning = selectedFormProvider && selectedFormCategory
    && selectedProviderSpec && !supportedFormCategories.includes(selectedFormCategory)
    ? uiText("供应商「{{name}}」不支持「{{value2}}」类别，请调整供应商或类别。", { name: selectedFormProvider.name, value2: uiText(categoryLabelMap[selectedFormCategory]) })
    : null

  /** 新增模型使用当前供应商的目录，切换供应商后忽略旧请求。 */
  useEffect(() => {
    if (!modelEditorOpen || !selectedFormProviderId) return
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
  }, [modelEditorOpen, modelEditing, selectedFormProviderId])

  const closeModelEditor = () => {
    const trigger = editorTrigger.current
    editorTrigger.current = null
    pendingName.current = ''
    setDiscardOpen(false)
    setModelEditorOpen(false)
    setModelEditing(null)
    setFormCatalog(null)
    setFormCatalogLoading(false)
    form.resetFields()
    requestAnimationFrame(() => {
      if (!editorTrigger.current && trigger?.isConnected) trigger.focus({ preventScroll: true })
    })
  }

  const requestClose = () => {
    if (modelSaveInFlight.current) return
    const current = form.getFieldsValue(true) as ModelFormValues
    const baseline = initialFields.current
    const normalize = (value: unknown) => JSON.stringify(value ?? '')
    const changed = (Object.keys({ ...baseline, ...current }) as (keyof ModelFormValues)[]).some(field =>
      field === 'names'
        ? JSON.stringify(current.names ?? []) !== JSON.stringify(baseline.names ?? [])
        : normalize(current[field]) !== normalize(baseline[field]))
    if (changed || pendingName.current.trim()) setDiscardOpen(true)
    else closeModelEditor()
  }

  const handleSaveModel = async (values: ModelFormValues) => {
    if (modelSaveInFlight.current) return
    modelSaveInFlight.current = true
    setSavingModel(true)
    try {
      const params = values.params?.trim() ? JSON.parse(values.params) as Record<string, unknown> : {}
      let capabilities: CapabilityProfile | undefined = form.getFieldValue('capability_profile')
      if (values.category === 'video' && values.videoDurationRules) {
        const modes = { ...capabilities?.video_modes }
        for (const [mode] of VIDEO_MODES) {
          const text = values.videoDurationRules[mode]?.trim()
          if (values.videoDurationRules[mode] !== undefined) modes[mode] = {
            ...modes[mode], duration_by_resolution: text ? JSON.parse(text) : {},
          }
        }
        capabilities = { ...capabilities, video_modes: modes }
      }
      const capabilityProfile = JSON.parse(JSON.stringify(capabilities ?? {})) as CapabilityProfile
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
        const candidates: ProviderModelCandidate_Input[] = modelNames.map(name => {
          const candidate = catalogByName.get(name) ?? {
            name, category: values.category, description: values.description?.trim() || undefined, params,
          }
          const base = catalogByName.get(name)?.capability_profile ?? categoryDefaults
          const profile = { ...base, ...capabilityProfile }
          for (const [mode] of IMAGE_MODES) {
            if (base.image_modes?.[mode] || capabilityProfile.image_modes?.[mode]) {
              profile.image_modes = { ...profile.image_modes, [mode]: { ...base.image_modes?.[mode], ...capabilityProfile.image_modes?.[mode] } }
            }
          }
          for (const [mode] of VIDEO_MODES) {
            if (base.video_modes?.[mode] || capabilityProfile.video_modes?.[mode]) {
              profile.video_modes = { ...profile.video_modes, [mode]: { ...base.video_modes?.[mode], ...capabilityProfile.video_modes?.[mode] } }
            }
          }
          return { ...candidate, capability_profile: profile }
        })
        const response = await LlmService.importProviderModelsApiV1LlmProvidersProviderIdModelsImportPost({
          providerId: values.provider_id,
          requestBody: { models: candidates },
        })
        const createdCount = response.data?.created?.length ?? 0
        const skippedCount = response.data?.skipped?.length ?? 0
        message.success(uiText("已添加 {{createdCount}} 个模型{{value2}}", { createdCount, value2: skippedCount ? uiText("，跳过 {{count}} 个已存在模型", { count: skippedCount }) : '' }))
      }
      closeModelEditor()
      reload()
    } catch {
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

  const openModelEditor = (model?: ModelRead, copy = false) => {
    editorTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setModelEditing(copy ? null : model ?? null)
    setFormCatalog(null)
    form.resetFields()
    initialFields.current = model ? {
      ...(copy ? { names: [`${model.name}-复制`] } : { name: model.name }),
      category: model.category,
      provider_id: model.provider_id,
      description: model.description ?? '',
      params: JSON.stringify(model.params ?? {}, null, 2),
      capability_profile: model.capability_profile ?? undefined,
      videoDurationRules: model.category === 'video' ? Object.fromEntries(VIDEO_MODES.flatMap(([mode]) => {
        const rules = model.capability_profile?.video_modes?.[mode]?.duration_by_resolution
        return rules && Object.keys(rules).length ? [[mode, JSON.stringify(rules, null, 2)]] : []
      })) : undefined,
    } : {}
    form.setFieldsValue(initialFields.current)
    setModelEditorOpen(true)
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
        <Button type="link" className="management-name" title={name || uiText("未知名称")} aria-haspopup="dialog" onClick={() => openModelEditor(record)}>{name || uiText("未知名称")}</Button>
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
      title: uiText("操作"), key: 'action', width: 108,
      render: (_, record) => (
        <Space size={4}>
          <Button type="text" size="small" aria-haspopup="dialog" onClick={event => {
            event.currentTarget.focus()
            openModelEditor(record, true)
          }}>{uiText("复制")}</Button>
          <Dropdown trigger={['click']} menu={{ items: [{
            key: 'delete', label: uiText("删除"), danger: true, icon: <DeleteOutlined />,
            onClick: () => {
              setDeleteError('')
              setModelToDelete(record)
            },
          }] }}>
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
          <Button ref={defaultTrigger} aria-label={uiText("默认模型")} aria-haspopup="dialog" icon={<SettingOutlined />} onClick={() => {
            setDefaultOptionsLoading(true)
            setDefaultModelsModalOpen(true)
          }}>{uiText("默认模型")}</Button>
          {result && <span className="management-count">
            {result.total === undefined ? uiText("已加载 {{length}} 个模型", { length: result.models.length }) : uiText("共 {{total}} 个模型", { total: result.total })}
          </span>}
        </div>
        <Button className="management-primary" type="primary" icon={<PlusOutlined />} onClick={() => openModelEditor()}>
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
                    ? <Button onClick={() => openModelEditor()}>{uiText("添加第一个模型")}</Button>
                    : providerOptionsLoading
                      ? uiText("正在读取供应商")
                      : providerOptionsFailed ? uiText("供应商暂不可用，可在添加模型时重试") : uiText("请先添加供应商后再添加模型")}
              </Empty>
            ) }}
            size="small"
          />
        </div>}
      </WorkspaceScrollPanel>

      <Modal
        title={uiText("全局默认模型")}
        centered
        footer={null}
        focusTriggerAfterClose={false}
        open={defaultModelsModalOpen}
        keyboard={savingDefaultCategory === null}
        maskClosable={savingDefaultCategory === null}
        closable={savingDefaultCategory === null}
        onCancel={() => {
          if (!defaultSaveInFlight.current) setDefaultModelsModalOpen(false)
        }}
        afterOpenChange={open => {
          if (!open) requestAnimationFrame(() => defaultTrigger.current?.focus({ preventScroll: true }))
        }}
        width="min(480px, calc(100vw - 32px))"
      >
        <Typography.Paragraph type="secondary" className="text-[13px]">
          {uiText("生成时未指定模型，将使用以下默认值。修改后立即生效。")}
        </Typography.Paragraph>
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
            const label = uiText(category.label)
            const options = defaultOptions.filter(model => model.category === category.key).map(model => ({
              label: `${model.name} · ${getProviderName(model.provider_id)}`,
              value: model.id,
            }))
            if (defaultId && !options.some(option => option.value === defaultId)) {
              options.unshift({ label: uiText("已配置的模型 · 详情未知"), value: defaultId })
            }
            return (
              <div key={category.key}>
                <div className="mb-1.5 text-[13px] font-medium">{label}</div>
                <ConfigProvider theme={defaultModelTheme}>
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
                </ConfigProvider>
              </div>
            )
          })}
        </div>
      </Modal>

      {modelEditorOpen && <ResourceEditorFrame id="model-editor-drawer" className="settings-create-drawer" open drawer drawerWidth={720}
        title={modelEditing ? uiText("编辑模型") : uiText("添加模型")} backLabel={uiText("返回")} onClose={requestClose}
        actions={<Button type="primary" htmlType="submit" form="model-editor-form" loading={savingModel}>
          {modelEditing ? uiText("保存") : uiText("添加")}
        </Button>}>
        <DrawerDiscardDialog open={discardOpen} drawerId="model-editor-drawer"
          onContinue={() => setDiscardOpen(false)} onDiscard={closeModelEditor} />
        <Form id="model-editor-form" form={form} layout="vertical" className="app-settings-form project-settings-form"
          disabled={savingModel} onFinish={handleSaveModel} onFinishFailed={({ errorFields }) => {
            const first = errorFields[0]?.name
            if (!first) return
            if (first[0] === 'params' && advanced.current) advanced.current.open = true
            const control = document.getElementById(form.getFieldInstance(first)?.id ?? '')
              ?? form.getFieldInstance(first)?.nativeElement
            if (control instanceof HTMLElement) {
              let parent = control.closest('details')
              while (parent) {
                parent.open = true
                parent = parent.parentElement?.closest('details') ?? null
              }
            }
            requestAnimationFrame(() => {
              form.scrollToField(first)
              form.getFieldInstance(first)?.focus?.()
            })
          }}>
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
          <section className="project-settings-group">
            <h2>{uiText("基本信息")}</h2>
            <div className="project-settings-short-fields">
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
                    form.setFieldsValue({ category: undefined, names: [], videoDurationRules: undefined })
                    form.setFieldValue('capability_profile', {})
                  }}
                />
              </Form.Item>
              <Form.Item name="category" label={uiText("类别")} rules={[{ required: true, message: uiText("请选择类别") }]}>
                <Select
                  aria-label={uiText("类别")}
                  disabled={!selectedFormProviderId}
                  placeholder={selectedFormProviderId ? uiText("选择模型类别") : uiText("请先选择供应商")}
                  options={categorySelectOptions}
                  onChange={() => { form.setFieldValue('names', []); form.setFieldValue('capability_profile', {}); form.setFieldValue('videoDurationRules', undefined) }}
                />
              </Form.Item>
            </div>
            {modelEditing ? (
              <Form.Item name="name" label={uiText("模型名称")} rules={[{ required: true, message: uiText("请输入模型名称") }]}>
                <Input placeholder={uiText("例如：GPT-4")} />
              </Form.Item>
            ) : (
              <Form.Item name="names" label={uiText("模型名称")} rules={[{ required: true, message: uiText("请选择或输入至少一个模型名称") }]}>
                <Select
                  aria-label={uiText("模型名称")}
                  mode="tags"
                  onSearch={value => { pendingName.current = value }}
                  onBlur={() => { pendingName.current = '' }}
                  onChange={() => { pendingName.current = '' }}
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
            <Form.Item name="description" label={uiText("描述")}>
              <Input.TextArea rows={2} />
            </Form.Item>
            {!modelEditing && formCatalog?.models?.some(candidate => candidate.category === selectedFormCategory) &&
              <Typography.Text type="secondary">{uiText("描述和参数仅用于手动填写的模型。目录模型沿用目录中的值。")}</Typography.Text>}
          </section>
          <section className="project-settings-group">
            <details className="model-editor-disclosure" ref={advanced} open={Boolean(initialFields.current.params && initialFields.current.params !== '{}')}>
              <summary><h2>{uiText("高级参数")} <DownOutlined aria-hidden="true" /></h2></summary>
              <Form.Item name="params" label={uiText("参数（JSON）")} rules={[{
                validator: async (_, value?: string) => {
                  if (!value?.trim()) return
                  let parsed: unknown
                  try { parsed = JSON.parse(value) } catch { throw new Error(uiText("参数格式需为合法 JSON")) }
                  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
                    throw new Error(uiText("参数必须为 JSON 对象"))
                  }
                },
              }]}>
                <Input.TextArea rows={3} placeholder='{"max_tokens": 4096, "temperature": 0.7}' />
              </Form.Item>
            </details>
          </section>
          {selectedFormCategory && <section className="project-settings-group">
            <details className="model-editor-disclosure">
              <summary><h2>{uiText('模型能力')} <DownOutlined aria-hidden="true" /></h2></summary>
              <div className="model-cap-actions"><CapabilityReset key={JSON.stringify([selectedFormProviderId,selectedFormCategory,editedName,selectedNames])} defaults={defaults} loading={formCatalogLoading} editing={!!modelEditing} /></div>
              {selectedFormCategory === 'text' && <ModelCapabilityFields defaults={defaults} model={modelEditing} />}
              {selectedFormCategory === 'image' && <ImageCapabilityFields model={modelEditing} providerKey={selectedFormProvider?.provider_key} defaults={defaults} />}
              {selectedFormCategory === 'video' && <VideoCapabilityFields model={modelEditing} providerKey={selectedFormProvider?.provider_key} defaults={defaults} />}
              {(selectedFormCategory === 'image' || selectedFormCategory === 'video') && selectedFormProvider?.provider_key === 'vidu' &&
                <Form.Item name={['capability_profile', 'remote_cancel']} label={uiText('远端取消')}
                  valuePropName="checked" getValueProps={value => ({ checked: value ?? defaults.remote_cancel ?? false })}>
                  <Switch size="small" />
                </Form.Item>}
            </details>
          </section>}

          {modelEditing && <Typography.Text type="secondary">{uiText("创建人")} · {modelEditing.created_by || '—'}</Typography.Text>}
        </Form>
      </ResourceEditorFrame>}

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
