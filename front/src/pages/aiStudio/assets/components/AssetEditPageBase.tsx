import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
  Collapse,
  Empty,
  Image,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
  Upload,
  message,
} from 'antd'
import {
  ArrowLeftOutlined,
  CloseCircleOutlined,
  EditOutlined,
  ReloadOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { ScriptProcessingService, StudioFilesService, StudioProjectsService } from '../../../../services/generated'
import {
  adoptGeneratedImage,
  getAssetImagePrompts,
  previewImagePrompts,
  saveAssetImagePrompts,
  setEntityImagePrimary,
  submitImagePlan,
  type ImagePromptPreviewResult,
} from '../../../../services/llmPipelineApi'
import { listTaskLinksNormalized } from '../../../../services/filmTaskLinks'
import { buildFileDownloadUrl, isLocalAssetAddress } from '../utils'
import { describeAssetDescription, stripAssetNamePrefix } from '../assetDescriptionCopy'
/* 中文化出口一律用共享管道（审计 §7.1-4：枚举映射全仓一份）：
   - `labelFor(ASSET_TYPE, …)`：资产类型原值 → 中文（本页运行时曾显示「资产类型：scene」）；
   - `showUserError`：后端原文只进「技术详情」，主区只出中文结论（审计 §7.1-5）。 */
import { ASSET_TYPE, labelFor } from '../../components/enumLabels'
import { showUserConclusion, showUserError, toUserFacingText } from '../../components/userFacingMessage'
import { maskInternalIds } from '../../components/maskInternalIds'
// 结果类型口径（前端唯一一份）：按类型取词/取标签，避免场景、道具被说成「参考图」
import {
  BATCH_REFERENCE_FLOW_LABEL,
  resultArtifactCopy,
  supportsBatchReference,
  type ImageAssetType,
} from '../../project/ProjectWorkbench/components/assetResultKind.ts'
// 「生成依据」（默认收起）与提示词质量：与项目工作台**用同两份纯逻辑模块**，不各写一套
import { AssetGenerationBasisPanel } from '../../project/ProjectWorkbench/components/AssetGenerationBasisPanel'
import { PromptQualityAlert } from '../../project/ProjectWorkbench/components/PromptQualityAlert'
import {
  describePromptSaveFailure,
  resolvePromptQuality,
} from '../../project/ProjectWorkbench/components/assetPromptQuality.ts'
import {
  PROMPT_REQUEST_SUPPORT_NONE,
  buildPromptRequestExtras,
  describePromptRequestDelivery,
  type PromptRequestFieldSupport,
} from '../../project/ProjectWorkbench/components/assetPromptRequestContract.ts'
import { fetchPromptRequestSupport } from '../../project/ProjectWorkbench/components/assetProductionApi'
import {
  buildGlobalAssetWriteConfirmation,
  describeAssetScopeCopy,
  isGlobalAssetType,
} from '../../project/ProjectWorkbench/components/assetWriteScope.ts'
import { buildRequestStructureText } from '../../project/ProjectWorkbench/components/assetGenerationBasis.ts'
import {
  ASSET_OUTCOME_LABEL,
  ASSET_OUTCOME_TAG_COLOR,
  buildResultRowTechnicalFields,
  describeResultRowAddress,
  normalizeAssetResultRow,
  summarizeAssetResults,
} from '../assetResultSummary'
/* 「技术详情」折叠壳**全仓只有一份**（审计 §9 第 2 项）：第三层内容一律走它，
   不许在 assets/** 里自建第二套 <details> 或「技术详情」标签。 */
import { TechnicalDetailSection } from '../../project/ProjectWorkbench/components/workbench/TechnicalDetailCollapse'
import { DisplayImageCard } from './DisplayImageCard'
import { ProjectVisualStyleAndStyleFields } from '../../project/ProjectVisualStyleAndStyleFields'
import { useProjectStyleOptions } from '../../project/useProjectStyleOptions'
import { executeTaskCancel, readRawErrorMessage } from '../../components/taskActionHelpers'
import { handleTaskResultSafely } from '../../components/taskResultHelpers'
import { useRelationTaskNotification } from '../../components/taskNotificationHelpers'
import { useTaskPageContext } from '../../components/taskPageContext'
import { TASK_COPY } from '../../components/taskCopy'
import { useLocation } from 'react-router-dom'
import { classifyGenerationFailure, failureText } from '../../components/generationGate'
import { useGenerationDraft } from '../../hooks/useGenerationDraft'
import {
  CHARACTER_PORTRAIT_ANALYSIS_RELATION_TYPE,
  COSTUME_INFO_ANALYSIS_RELATION_TYPE,
  PROP_INFO_ANALYSIS_RELATION_TYPE,
  SCENE_INFO_ANALYSIS_RELATION_TYPE,
  useCancelableRelationTask,
} from '../../project/ProjectWorkbench/chapterDivisionTasks'

const MAX_VIEW_COUNT = 4
// 与后端 `AssetViewAngle`（backend/app/models/studio.py）一致的枚举值
export type AssetViewAngle =
  | 'FRONT'
  | 'LEFT'
  | 'RIGHT'
  | 'BACK'
  | 'THREE_QUARTER'
  | 'TOP'
  | 'DETAIL'

export type AssetUpdate = {
  name: string
  description: string
  tags: string[]
  view_count: number
  visual_style: '现实' | '动漫'
  style?: string
}

const DEFAULT_ANGLES: AssetViewAngle[] = ['FRONT', 'LEFT', 'RIGHT', 'BACK']

const ANGLE_LABEL_MAP: Record<AssetViewAngle, string> = {
  FRONT: '正面',
  LEFT: '左侧',
  RIGHT: '右侧',
  BACK: '背面',
  THREE_QUARTER: '3/4 侧面',
  TOP: '俯视',
  DETAIL: '细节',
}

export type BaseAsset = {
  id: string
  name: string
  description?: string
  tags?: string[]
  view_count?: number
  visual_style?: '现实' | '动漫'
  style?: string
}

export type BaseAssetImage = {
  id: number
  view_angle?: AssetViewAngle
  file_id?: string | null
  width?: number | null
  height?: number | null
  format?: string | null
  /** 定版主图标记（`PATCH /studio/entities/{type}/{id}/images/{image_id}`，同一资产下唯一） */
  is_primary?: boolean
}

export type AssetEditPageBaseProps<TAsset extends BaseAsset, TImage extends BaseAssetImage> = {
  assetId?: string
  missingAssetIdText: string
  assetDisplayName: string
  backTo: string
  relationType: string
  getAsset: (assetId: string) => Promise<TAsset | null>
  updateAsset: (assetId: string, payload: AssetUpdate) => Promise<TAsset | null>
  listImages: (assetId: string) => Promise<TImage[]>
  createImageSlot: (assetId: string, angle: AssetViewAngle) => Promise<void>
  updateImage: (assetId: string, imageId: number, payload: { file_id: string; width?: number | null; height?: number | null; format?: string | null }) => Promise<void>
  renderPrompt: (assetId: string, imageId: number) => Promise<{ prompt: string; images: string[] }>
  onNavigate: (to: string, replace?: boolean) => void
}

type HistoryCandidate<TImage extends BaseAssetImage> = {
  id: string
  file_id: string
  view_angle?: AssetViewAngle
  width?: number | null
  height?: number | null
  format?: string | null
  source: 'task-link' | 'image'
  originalImage?: TImage
}

/** 资产编辑页当前对应的实体类型（同时是 `llmPipelineApi` 里的 entity/asset_type 取值）。 */
export type AssetEntityType = 'character' | 'scene' | 'prop' | 'costume' | 'actor'

const ENTITY_TYPE_BY_RELATION: Record<string, AssetEntityType> = {
  actor_image: 'actor',
  character_image: 'character',
  scene_image: 'scene',
  prop_image: 'prop',
  costume_image: 'costume',
}

/**
 * 出图服务 V0（`image_pipeline`）只接受 character/scene/prop：
 * 后端 `external_image_client.SERVICE_ASSET_TYPES` 明确不含 costume/actor，
 * 传过去会被 400 拒绝，所以这两种资产的批量出图按钮直接禁用。
 */
const IMAGE_SERVICE_ASSET_TYPES: AssetEntityType[] = ['character', 'scene', 'prop']

function supportsImageServiceAssetType(entityType: AssetEntityType | null): boolean {
  return !!entityType && IMAGE_SERVICE_ASSET_TYPES.includes(entityType)
}

/* 出图结果口径 → Tag 颜色 / 演练徽标等，统一在 `../assetResultSummary` 里，
   llmPipeline 页复用同一套口径，这里不再重复定义。 */

type ReferenceBatchSubmitResult = Awaited<ReturnType<typeof submitImagePlan>>

function normalizeTags(input: string): string[] {
  return input
    .split(/[,，\n]/g)
    .map((t) => t.trim())
    .filter(Boolean)
}

function clampViewCount(value?: number | null): number {
  const next = Number.isFinite(value as number) ? Number(value) : 1
  return Math.max(1, Math.min(MAX_VIEW_COUNT, Math.trunc(next)))
}

function getSmartDetectRelationType(relationType: string): string | null {
  if (relationType === 'actor_image' || relationType === 'character_image') return CHARACTER_PORTRAIT_ANALYSIS_RELATION_TYPE
  if (relationType === 'scene_image') return SCENE_INFO_ANALYSIS_RELATION_TYPE
  if (relationType === 'prop_image') return PROP_INFO_ANALYSIS_RELATION_TYPE
  if (relationType === 'costume_image') return COSTUME_INFO_ANALYSIS_RELATION_TYPE
  return null
}

function getAssetNavigateRelationType(relationType: string): AssetEntityType | null {
  return ENTITY_TYPE_BY_RELATION[relationType] ?? null
}

/** 项目 ID 兜底来源：资产本身 / 查询参数 / 路径 / returnTo 参数（从项目工作台跳来时）。 */
function resolveProjectIdFromLocation(pathname: string, search: string): string {
  const searchParams = new URLSearchParams(search)
  const fromQuery = (searchParams.get('projectId') ?? '').trim()
  if (fromQuery) return fromQuery

  const fromPath = /^\/projects\/([^/?#]+)/.exec(pathname)
  if (fromPath?.[1]) return decodeURIComponent(fromPath[1])

  const returnTo = (searchParams.get('returnTo') ?? '').trim()
  const fromReturnTo = /^\/projects\/([^/?#]+)/.exec(returnTo)
  if (fromReturnTo?.[1]) return decodeURIComponent(fromReturnTo[1])

  return ''
}

export function AssetEditPageBase<TAsset extends BaseAsset, TImage extends BaseAssetImage>({
  assetId,
  missingAssetIdText,
  assetDisplayName,
  backTo,
  relationType,
  getAsset,
  updateAsset,
  listImages,
  createImageSlot,
  updateImage,
  renderPrompt,
  onNavigate,
}: AssetEditPageBaseProps<TAsset, TImage>) {
  const { options: projectStyleOptions, defaultVisualStyle, getDefaultStyle } = useProjectStyleOptions()
  const taskCopy = TASK_COPY.smartDetect
  const location = useLocation()
  const [loading, setLoading] = useState(true)
  const [asset, setAsset] = useState<TAsset | null>(null)
  const [images, setImages] = useState<TImage[]>([])

  const [formName, setFormName] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formTags, setFormTags] = useState('')
  const [formViewCount, setFormViewCount] = useState(1)
  const [formVisualStyle, setFormVisualStyle] = useState<'现实' | '动漫'>(defaultVisualStyle as '现实' | '动漫')
  const [formStyle, setFormStyle] = useState<string>(getDefaultStyle(defaultVisualStyle))
  const [savingBase, setSavingBase] = useState(false)

  const [smartDetectLoading, setSmartDetectLoading] = useState(false)
  const [smartDetectOpen, setSmartDetectOpen] = useState(false)
  const [smartDetectIssues, setSmartDetectIssues] = useState<string[]>([])
  const [smartDetectOptimizedDesc, setSmartDetectOptimizedDesc] = useState('')

  const [generatingByImageId, setGeneratingByImageId] = useState<Record<number, boolean>>({})

  const [promptPreviewOpen, setPromptPreviewOpen] = useState(false)
  const [promptPreviewLoading, setPromptPreviewLoading] = useState(false)
  const [promptPreviewImage, setPromptPreviewImage] = useState<TImage | null>(null)
  const promptDraft = useGenerationDraft<
    { prompt: string },
    { imageId: number | null; images: string[] },
    { prompt: string; images: string[] },
    /** 提交结果：P3 内联出图会连地址一起回来，便于立刻采纳/设版 */
    {
      taskId: string | null
      url: string
      dryRun: boolean
      status: string
      message: string
      /** 原始结果行：`ok` / `outcome` / `detail.error_message` 等字段一律留着，
       *  交给 `assetResultSummary` 做防御性归一化（新字段有就用，没有就回退）。 */
      row: unknown
      /** 本次响应的汇总对象（可能同时含新旧字段），用于「成功 X / 失败 Y」 */
      roundSummary: unknown
    }
  >({
    initialBase: { prompt: '' },
    initialContext: { imageId: null, images: [] },
    derive: async ({ base, context }) => {
      if (!assetId || !context.imageId) {
        throw new Error('asset image slot is required')
      }
      const result = await renderPrompt(assetId, context.imageId)
      return {
        prompt: (base.prompt || '').trim() || (result.prompt ?? ''),
        images: Array.isArray(result.images) ? result.images.filter(Boolean) : [],
      }
    },
    submit: async ({ context, derived }) => {
      if (!assetId || !context.imageId) {
        throw new Error('asset image slot is required')
      }
      if (!supportsImageServiceAssetType(assetNavigateRelationType)) {
        throw new Error('出图服务只支持角色/场景/道具；演员/服装请用别的通道（本页已禁用该按钮）')
      }
      // 优先用「本次动作显式选定的项目」，其次用页面解析出来的作用域。
      // 为什么不能只读 state：用户在选择项目弹窗里选完立刻恢复出图时，React 的
      // resolvedProjectId 可能还没重新渲染，读旧值会再次弹出选择框。
      const projectId = (activeGenerateProjectIdRef.current || resolvedProjectId).trim()
      if (!projectId) {
        throw new Error('还不知道这个资产属于哪个项目：请从项目工作台进入本页，或先选择项目')
      }
      // 为什么改走 P3 直提端点：老的 `/studio/image-tasks/...` 只建一条 Celery 任务行，
      // 本机没有 broker/worker（且 DRY_RUN 下建行前就被守卫拦住），表现为"点了生成没反应"。
      // P3 端点在同进程内联执行并等到结果，拿到地址后就能让用户采纳/设版。
      const data = await submitImagePlan({
        project_id: projectId,
        asset_type: assetNavigateRelationType as 'character' | 'scene' | 'prop',
        stage: 'character_sheet',
        asset_ids: [assetId],
        prompt_overrides: [{ asset_id: assetId, prompt: (derived.prompt || '').trim() }],
        use_primary_reference: false,
        aspect_ratio: '16:9',
        image_model: 'image2',
        wait_seconds: 120,
      })
      const row = data?.results?.[0]
      return {
        taskId: row?.service_task_id ?? null,
        url: row ? adoptableUrl(row) : '',
        dryRun: Boolean(data?.summary?.dry_run),
        status: row?.status ?? '',
        message: row?.message ?? '',
        // 原始行与汇总都带上：页面要如实显示 partial_failed（图片已生成但 OSS 上传失败），
        // 不能只靠 status 一个字符串，也不能丢掉 detail.error_message。
        row: row ?? null,
        roundSummary: data?.summary ?? null,
      }
    },
  })
  const promptPreviewDraft = promptDraft.base.prompt
  const promptPreviewRefFileIds = promptDraft.context.images

  /**
   * 从第 3 步「生成」入口进来时（`?generate=1`）自动打开该资产的出图确认弹窗。
   * 只在图片加载完成后触发一次，避免与用户手动操作打架。
   */
  const autoGenerateHandledRef = useRef(false)
  useEffect(() => {
    if (autoGenerateHandledRef.current) return
    const params = new URLSearchParams(location.search)
    if (params.get('generate') !== '1') return
    if (loading || images.length === 0) return
    autoGenerateHandledRef.current = true
    const preferred = images.find((item) => item.is_primary) ?? images[0]
    if (preferred) void openPromptPreview(preferred)
    // openPromptPreview / images 每次渲染都是新引用，这里只用「是否已处理」把关
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images, loading, location.search])

  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyCandidates, setHistoryCandidates] = useState<HistoryCandidate<TImage>[]>([])
  const [editingSlotImage, setEditingSlotImage] = useState<TImage | null>(null)
  const [adoptingImageId, setAdoptingImageId] = useState<string | null>(null)

  // 九槽位图片提示词（LLM 预览 → 合并保存到资产 image_prompts）
  const [imagePromptOpen, setImagePromptOpen] = useState(false)
  const [imagePromptLoading, setImagePromptLoading] = useState(false)
  const [imagePromptSaving, setImagePromptSaving] = useState(false)
  const [imagePromptResult, setImagePromptResult] = useState<ImagePromptPreviewResult | null>(null)
  /** 请求字段能力（只读接口清单得到；读不到就一个额外字段都不发） */
  const [promptRequestSupport, setPromptRequestSupport] = useState<PromptRequestFieldSupport>(PROMPT_REQUEST_SUPPORT_NONE)
  /** ④ 本次真的发出去的请求结构（脱敏后展示在「生成依据」里） */
  const [imagePromptRequestStructure, setImagePromptRequestStructure] = useState('')
  const [imagePromptDraftByCategory, setImagePromptDraftByCategory] = useState<Record<string, string>>({})
  const [savedPromptMap, setSavedPromptMap] = useState<Record<string, string>>({})

  // 定版主图
  const [settingPrimaryImageId, setSettingPrimaryImageId] = useState<number | null>(null)

  /** 上传本地图片写入槽位时，正在上传的槽位 id（同一时刻只允许一个）。 */
  const [uploadingImageId, setUploadingImageId] = useState<number | null>(null)

  // 按定版图片批量出图（人物 = 参考图；场景 / 道具 / 服装用各自的图名）
  const [referenceBatchLoading, setReferenceBatchLoading] = useState(false)
  const [referenceBatchOpen, setReferenceBatchOpen] = useState(false)
  /** 单张生成的结果（P3 内联出图返回的地址），用于"采纳 / 采纳并设版"。
   *  这里同时保留原始结果行与汇总：`partial_failed` 这类「图片已生成但 OSS 上传失败」的结果
   *  必须能显示真实失败原因，而不是被当成绿色成功。 */
  const [singleGenResult, setSingleGenResult] = useState<{
    url: string
    prompt: string
    status: string
    message: string
    row: unknown
    roundSummary: unknown
  } | null>(null)
  const [singleGenAdopting, setSingleGenAdopting] = useState<'' | 'slot' | 'primary'>('')
  const [referenceBatchResult, setReferenceBatchResult] = useState<ReferenceBatchSubmitResult | null>(null)
  // 断点③：把生成结果采纳进资产槽位（落库，刷新后仍在）
  const [adoptingKey, setAdoptingKey] = useState<string | null>(null)
  const [manualProjectId, setManualProjectId] = useState('')
  const [projectIdModalOpen, setProjectIdModalOpen] = useState(false)
  const [projectIdDraft, setProjectIdDraft] = useState('')

  const smartDetectRelationType = useMemo(() => getSmartDetectRelationType(relationType), [relationType])
  const smartDetectRelationEntityId = useMemo(
    () => (assetId && smartDetectRelationType ? `${relationType}:${assetId}` : null),
    [assetId, relationType, smartDetectRelationType],
  )
  const assetNavigateRelationType = useMemo(
    () => getAssetNavigateRelationType(relationType),
    [relationType],
  )
  /**
   * 当前项目 ID：角色读资产自身的 `project_id`；场景/道具/服装/演员的读模型不带该字段，
   * 因此退回 URL（`?projectId=`、`/projects/<id>/...` 路径、工作台带过来的 `returnTo`），
   * 最后才是用户手动补填。
   */
  const resolvedProjectId = useMemo(() => {
    const assetProjectId = String(
      ((asset ?? null) as unknown as { project_id?: string | null } | null)?.project_id ?? '',
    ).trim()
    if (assetProjectId) return assetProjectId
    const fromLocation = resolveProjectIdFromLocation(location.pathname, location.search)
    if (fromLocation) return fromLocation
    return manualProjectId.trim()
  }, [asset, location.pathname, location.search, manualProjectId])
  const applySmartDetectResultValue = useCallback((resultValue: unknown) => {
    const result = (resultValue ?? {}) as Record<string, unknown>
    const issues = Array.isArray(result.issues)
      ? result.issues.filter((it: unknown): it is string => typeof it === 'string' && it.trim().length > 0)
      : []
    const optimizedDesc = String(result.optimized_description ?? '').trim()
    setSmartDetectIssues(issues)
    setSmartDetectOptimizedDesc(optimizedDesc)
    setSmartDetectOpen(true)
    if (issues.length > 0) message.warning(`发现 ${issues.length} 项可能缺失信息`)
    else message.success('未发现缺失信息')
  }, [])
  const applySmartDetectResult = useCallback(async (taskId: string) => {
    await handleTaskResultSafely(taskId, {
      readErrorMessage: '读取智能检测结果失败',
      failedFallbackMessage: '智能检测失败',
      onSucceeded: (resultValue) => {
        applySmartDetectResultValue(resultValue)
      },
      onFailed: (errorMessage) => {
        /* 审计 §4.6 模式 6：任务结果里的 `data.error` 是后端原文。
           主区只出中文结论，原文经掩码后进「技术详情」（`showUserError` 的固定契约）。 */
        void showUserError(errorMessage, '智能检测失败', '智能检测')
      },
      onReadError: () => {
        message.error('读取智能检测结果失败')
      },
    })
  }, [applySmartDetectResultValue])
  const { task: smartDetectTask, settledTask: smartDetectSettledTask, applyCancelData: applySmartDetectCancelData } = useCancelableRelationTask({
    enabled: !!assetId && !!smartDetectRelationType && !!smartDetectRelationEntityId,
    relationType: smartDetectRelationType || '',
    relationEntityId: smartDetectRelationEntityId,
    onTaskSettled: applySmartDetectResult,
  })
  useTaskPageContext(
    [
      smartDetectRelationType && smartDetectRelationEntityId
        ? {
            relationType: smartDetectRelationType,
            relationEntityId: smartDetectRelationEntityId,
          }
        : null,
      assetNavigateRelationType && assetId
        ? {
            relationType: assetNavigateRelationType,
            relationEntityId: assetId,
          }
        : null,
    ],
  )
  const smartDetectBusy = smartDetectLoading || !!smartDetectTask

  const ensureImageSlots = useCallback(async (targetViewCount: number) => {
    if (!assetId) return []

    let current = await listImages(assetId)

    const byAngle = new Map<AssetViewAngle, TImage>()
    current.forEach((img) => {
      if (img.view_angle && !byAngle.has(img.view_angle)) {
        byAngle.set(img.view_angle, img)
      }
    })

    const requiredAngles = DEFAULT_ANGLES.slice(0, targetViewCount)
    let created = false

    for (const angle of requiredAngles) {
      if (!byAngle.get(angle)) {
        await createImageSlot(assetId, angle)
        created = true
      }
    }

    if (created) {
      current = await listImages(assetId)
    }

    return current
  }, [assetId, createImageSlot, listImages])

  const loadData = useCallback(async () => {
    if (!assetId) return

    setLoading(true)
    try {
      const nextAsset = await getAsset(assetId)
      if (!nextAsset) {
        message.error(`未找到${assetDisplayName}资产`)
        onNavigate(backTo, true)
        return
      }

      setAsset(nextAsset)
      setFormName(nextAsset.name)
      setFormDesc(nextAsset.description ?? '')
      setFormTags((nextAsset.tags ?? []).join(', '))
      {
        const nextVisual = (nextAsset.visual_style ?? defaultVisualStyle) as '现实' | '动漫'
        setFormVisualStyle(nextVisual)
        setFormStyle((nextAsset.style as string | undefined) ?? getDefaultStyle(nextVisual))
      }

      const targetCount = clampViewCount(nextAsset.view_count)
      setFormViewCount(targetCount)

      const imageRows = await ensureImageSlots(targetCount)
      setImages(imageRows)
    } catch {
      message.error(`加载${assetDisplayName}资产失败`)
    } finally {
      setLoading(false)
    }
  }, [assetId, assetDisplayName, backTo, defaultVisualStyle, ensureImageSlots, getAsset, getDefaultStyle, onNavigate])

  useEffect(() => {
    void loadData()
  }, [loadData])

  /** 请求字段能力（只读接口清单，不触发生成）：决定项目风格/资产身份这次能不能随请求送出去。 */
  useEffect(() => {
    let cancelled = false
    void fetchPromptRequestSupport().then((support) => {
      if (!cancelled) setPromptRequestSupport(support)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const slotItems = useMemo(() => {
    const count = clampViewCount(formViewCount)
    const byAngle = new Map<AssetViewAngle, TImage>()
    images.forEach((img) => {
      if (img.view_angle) byAngle.set(img.view_angle, img)
    })

    return DEFAULT_ANGLES.slice(0, count).map((angle) => {
      const image = byAngle.get(angle) ?? null
      return {
        angle,
        image,
        imageUrl: buildFileDownloadUrl(image?.file_id),
      }
    })
  }, [formViewCount, images])

  const minViewCount = useMemo(() => clampViewCount(asset?.view_count), [asset?.view_count])

  const handleSaveBaseInfo = async () => {
    if (!assetId || !asset) return
    if (!formName.trim()) {
      message.warning('请输入名称')
      return
    }

    setSavingBase(true)
    try {
      const nextViewCount = Math.max(minViewCount, clampViewCount(formViewCount))
      const payload: AssetUpdate = {
        name: formName.trim(),
        description: formDesc.trim(),
        tags: normalizeTags(formTags),
        view_count: nextViewCount,
        visual_style: formVisualStyle,
        style: formStyle,
      }
      const nextAsset = await updateAsset(assetId, payload)
      if (nextAsset) setAsset(nextAsset)
      message.success('基础信息已保存')
      await loadData()
    } catch {
      message.error('保存失败')
    } finally {
      setSavingBase(false)
    }
  }

  const handleSmartDetectMissing = async () => {
    if (!assetId) return
    if (!smartDetectRelationEntityId) return

    const description = (formDesc || '').trim()
    if (!description) {
      if (relationType === 'actor_image') message.warning('请先输入演员描述再进行智能检测')
      else if (relationType === 'scene_image') message.warning('请先输入场景描述再进行智能检测')
      else if (relationType === 'prop_image') message.warning('请先输入道具描述再进行智能检测')
      else if (relationType === 'costume_image') message.warning('请先输入服装描述再进行智能检测')
      return
    }

    setSmartDetectLoading(true)
    message.info('已开始智能检测：同步调用大模型，通常需要 10~120 秒，请保持页面打开')
    try {
      // 同步接口在请求内直接跑完 LLM，不写任务表；本环境没有 Celery worker / Redis，
      // 所以不再走 `-async` 变体（那个只会写一条永远不会被执行的任务）。
      const request = () => {
        if (relationType === 'actor_image') {
          const character_context = asset?.name ? `角色名：${formName}\n演员标签：${formTags}` : `演员标签：${formTags}`
          return ScriptProcessingService.analyzeCharacterPortraitApiV1ScriptProcessingAnalyzeCharacterPortraitPost({
            requestBody: {
              relation_entity_id: smartDetectRelationEntityId,
              character_description: description,
              character_context: (character_context || '').trim() || null,
            },
          })
        }
        if (relationType === 'scene_image') {
          const scene_context = asset?.name ? `场景名：${formName}\n标签：${formTags}` : `标签：${formTags}`
          return ScriptProcessingService.analyzeSceneInfoApiV1ScriptProcessingAnalyzeSceneInfoPost({
            requestBody: {
              relation_entity_id: smartDetectRelationEntityId,
              scene_description: description,
              scene_context: (scene_context || '').trim() || null,
            },
          })
        }
        if (relationType === 'prop_image') {
          const prop_context = asset?.name ? `道具名：${formName}\n标签：${formTags}` : `标签：${formTags}`
          return ScriptProcessingService.analyzePropInfoApiV1ScriptProcessingAnalyzePropInfoPost({
            requestBody: {
              relation_entity_id: smartDetectRelationEntityId,
              prop_description: description,
              prop_context: (prop_context || '').trim() || null,
            },
          })
        }
        const costume_context = asset?.name ? `服装名：${formName}\n标签：${formTags}` : `标签：${formTags}`
        return ScriptProcessingService.analyzeCostumeInfoApiV1ScriptProcessingAnalyzeCostumeInfoPost({
          requestBody: {
            relation_entity_id: smartDetectRelationEntityId,
            costume_description: description,
            costume_context: (costume_context || '').trim() || null,
          },
        })
      }

      const response = await request()
      const result = response.data
      if (!result) {
        message.error('智能检测未返回结果')
        return
      }
      applySmartDetectResultValue(result)
    } catch (error) {
      const maybeAny = error as { response?: { status?: number }; status?: number }
      const status = maybeAny?.response?.status ?? maybeAny?.status
      if (status === 404) {
        // 审计 §4.6 模式 4：原来这里把开发命令（`pnpm run openapi:update`）给终端用户看。
        message.error('页面与服务端版本不一致，请刷新页面后重试；若仍然失败，请联系管理员')
      } else {
        void showUserError(error, '智能检测失败', '智能检测')
      }
    } finally {
      setSmartDetectLoading(false)
    }
  }

  const handleCancelSmartDetectTask = async () => {
    if (!smartDetectTask?.taskId) return
    try {
      await executeTaskCancel({
        taskId: smartDetectTask.taskId,
        reason: `用户在${assetDisplayName}资产编辑页取消智能检测任务`,
        applyCancelData: applySmartDetectCancelData,
        cancelledImmediatelyMessage: taskCopy.cancelledImmediatelyMessage,
        cancelRequestedMessage: taskCopy.cancelRequestedMessage,
        fallbackErrorMessage: '取消智能检测任务失败',
      })
    } catch {
      // executeTaskCancel 已统一处理错误提示
    }
  }

  useRelationTaskNotification({
    task: smartDetectTask,
    settledTask: smartDetectSettledTask,
    title: taskCopy.title,
    sourceLabel: formName?.trim() ? `${assetDisplayName}：${formName.trim()}` : `${assetDisplayName}编辑页`,
    runningDescription: taskCopy.runningDescription,
    cancellingDescription: taskCopy.cancellingDescription,
    successDescription: taskCopy.successDescription,
    cancelledDescription: taskCopy.cancelledDescription,
    failedDescription: taskCopy.failedDescription,
    onCancel: smartDetectTask ? () => void handleCancelSmartDetectTask() : null,
    onNavigate: () => onNavigate(location.pathname),
  })
  const openPromptPreview = async (image: TImage, projectIdOverride?: string) => {
    // 缺项目作用域时，先让用户选项目；选中后带着**显式 id** 回到这里继续，
    // 不会因为 state 还没刷新而重复弹选择框。
    if (
      !requireProjectScope(
        (picked) => openPromptPreview(image, picked),
        '出图需要项目作用域：请先在弹窗里选择项目',
      )
    ) {
      return
    }
    // 明确记住本次出图使用的项目：单张生成必须显式使用它。
    activeGenerateProjectIdRef.current = (projectIdOverride || resolvedProjectId).trim()
    if (!assetId) return

    try {
      setPromptPreviewOpen(true)
      setPromptPreviewLoading(true)
      setPromptPreviewImage(image)
      const nextContext = { imageId: image.id, images: [] }
      promptDraft.hydrate({
        base: { prompt: '' },
        context: nextContext,
      })
      const derived = await promptDraft.deriveNow({
        base: { prompt: '' },
        context: nextContext,
      })
      if (derived) {
        promptDraft.hydrate({
          base: { prompt: derived.prompt },
          context: { imageId: image.id, images: derived.images },
          derived,
        })
      }
    } catch {
      message.error('获取提示词失败')
    } finally {
      setPromptPreviewLoading(false)
    }
  }

  const confirmGenerateWithPrompt = async () => {
    if (!assetId || !promptPreviewImage) return
    const prompt = (promptPreviewDraft || '').trim()
    if (!prompt) {
      message.warning('请输入提示词')
      return
    }

    setGeneratingByImageId((prev) => ({ ...prev, [promptPreviewImage.id]: true }))
    try {
      // P3 端点同进程内联执行：这里**直接拿到结果**（不再靠轮询一个永远不会被执行的任务行）
      const submitted = await promptDraft.submitNow()
      if (submitted?.dryRun) {
        message.info('演练模式：没有真实出图，因此没有可采纳的图片。')
        return
      }
      const url = String(submitted?.url ?? '').trim()
      // 出图结果一律走同一套口径：`partial_failed`（图片已生成、但出图服务的 OSS 上传失败）
      // 既不是成功也不能被吞掉，必须带着真实原因和「成功 X / 失败 Y」显示出来。
      const roundSummary = summarizeAssetResults(submitted?.row ? [submitted.row] : [], {
        summary: submitted?.roundSummary,
        dryRun: submitted?.dryRun,
      })
      if (!url && !roundSummary.hasFailure) {
        /* 审计 §4.6 模式 2/3：原来这里拼「后端返回状态：<枚举原值>」并把后端 message 直渲。
           现在主区给产品自己写的中文结论，后端原文经掩码后进「技术详情」。 */
        void showUserError(submitted?.message, '出图没有返回可用的图片地址，请稍后重试', '单张出图')
        return
      }
      setSingleGenResult({
        url,
        prompt,
        status: String(submitted?.status ?? ''),
        message: String(submitted?.message ?? ''),
        row: submitted?.row ?? null,
        roundSummary: submitted?.roundSummary ?? null,
      })
      setPromptPreviewOpen(false)
      setPromptPreviewImage(null)
      if (!url) {
        // 部分失败 / 失败：只弹一句 toast 会让用户看不到原因和计数，
        // 所以这里仍然打开结果弹窗（采纳按钮会被禁用），提示用户去看详情。
        message.warning('本次出图没有拿到可采纳的图片地址，真实原因见弹出的结果窗口。')
      }
    } catch (error) {
      /* 真实原因照原样显示：缺项目 / 演练模式拦住 / 参数缺失 / 服务错误都能一眼看出。
         主区的这句由 `generationStatusCore.failureText` 产出（内部已过脱敏管道），
         后端原文另经掩码后进「技术详情」（审计 §4.6 模式 6）。 */
      const failure = classifyGenerationFailure(error, 'image')
      void showUserConclusion('error', failureText(failure), readRawErrorMessage(error), '单张出图')
    } finally {
      setGeneratingByImageId((prev) => ({ ...prev, [promptPreviewImage.id]: false }))
    }
  }

  /**
   * 后端「不静默替换定版」的前端预判：这次采纳会不会顶掉一张**已绑图**的定版图。
   *
   * 与后端同一口径（`is_primary` **且** 已绑图才算定版图）：
   * - `setPrimary=true`：只要该资产已有定版图就必须确认——目标槽位要么本身就是它，
   *   要么设版会把它的定版身份顶掉，两种情况后端都会 409；
   * - 不设版：只有目标槽位**就是**那张定版图时才需要确认（否则等于把定版图静默换掉）。
   *
   * 这里只用来决定「先弹确认框」，真正的判定仍在后端（前端判错也只是多/少一次提示，
   * 后端该拦还是拦）。
   */
  const adoptionNeedsPrimaryConfirmation = (
    targetImageId: number | null | undefined,
    setPrimary: boolean,
  ): boolean => {
    const primaryWithFile = images.filter((img) => img.is_primary === true && !!img.file_id)
    if (primaryWithFile.length === 0) return false
    if (setPrimary) return true
    return primaryWithFile.some((img) => img.id === targetImageId)
  }

  const confirmPrimaryReplaceThen = (reason: string, onOk: () => Promise<void>) => {
    Modal.confirm({
      title: '该资产已有定版图，确认替换？',
      okText: '确认替换定版',
      cancelText: '取消',
      width: 520,
      content: (
        <div className="text-xs leading-5">
          <div>{reason}</div>
          <div>原来的定版图不会被删除，仍留在该资产里，随时可以再切回来。</div>
          <div>替换定版本身不产生出图费用。</div>
        </div>
      ),
      onOk,
    })
  }

  /** 采纳生成结果到资产图片槽位；`asPrimary` 决定是否同时设为定版（同一资产下唯一）。 */
  const adoptSingleGenResult = async (asPrimary: boolean) => {
    if (!assetId || !singleGenResult || !assetNavigateRelationType) return
    const targetImageId = promptPreviewImage?.id ?? null
    if (adoptionNeedsPrimaryConfirmation(targetImageId, asPrimary)) {
      confirmPrimaryReplaceThen(
        '这次采纳会顶掉现有的定版图（无论设不设版，都不允许静默替换）。',
        () => doAdoptSingleGenResult(asPrimary, true),
      )
      return
    }
    await doAdoptSingleGenResult(asPrimary, false)
  }

  const doAdoptSingleGenResult = async (asPrimary: boolean, confirmReplacePrimary: boolean) => {
    if (!assetId || !singleGenResult || !assetNavigateRelationType) return
    setSingleGenAdopting(asPrimary ? 'primary' : 'slot')
    try {
      await adoptGeneratedImage({
        entity_type: assetNavigateRelationType,
        entity_id: assetId,
        url: singleGenResult.url,
        image_id: promptPreviewImage?.id,
        set_primary: asPrimary,
        name: `${formName || asset?.name || assetId} 生成图`,
        ...(confirmReplacePrimary ? { confirm_replace_primary: true } : {}),
      })
      message.success(
        asPrimary
          ? '已采纳并设为定版（刷新后仍在，后续出图会以这张定版图片为准）'
          : '已采纳到该角度（刷新后仍在）',
      )
      setSingleGenResult(null)
      await loadData()
    } catch (error) {
      void showUserError(error, '采纳失败', '采纳结果')
    } finally {
      setSingleGenAdopting('')
    }
  }

  const openHistoryModal = async (targetImage: TImage) => {
    setEditingSlotImage(targetImage)
    setHistoryOpen(true)
    setHistoryLoading(true)

    try {
      const links = await listTaskLinksNormalized({
        resourceType: 'image',
        relationType,
        relationEntityId: String(targetImage.id),
      })
      const imagesByFileId = new Map<string, TImage>()
      images.forEach((img) => {
        if (img.file_id) {
          imagesByFileId.set(img.file_id, img)
        }
      })

      const seenFileIds = new Set<string>()
      const taskLinkCandidates: HistoryCandidate<TImage>[] = links
        .filter((link) => Boolean(link.file_id))
        .map((link) => {
          const fileId = String(link.file_id)
          const matchedImage = imagesByFileId.get(fileId)
          return {
            id: `task-link-${link.id}`,
            file_id: fileId,
            view_angle: matchedImage?.view_angle ?? targetImage.view_angle,
            width: matchedImage?.width ?? null,
            height: matchedImage?.height ?? null,
            format: matchedImage?.format ?? null,
            source: 'task-link' as const,
            originalImage: matchedImage,
          }
        })
        .filter((candidate) => {
          if (seenFileIds.has(candidate.file_id)) return false
          seenFileIds.add(candidate.file_id)
          return true
        })

      const fallbackCandidates: HistoryCandidate<TImage>[] = images
        .filter((img) => img.file_id && img.id !== targetImage.id && !seenFileIds.has(String(img.file_id)))
        .map((img) => ({
          id: `image-${img.id}`,
          file_id: String(img.file_id),
          view_angle: img.view_angle,
          width: img.width ?? null,
          height: img.height ?? null,
          format: img.format ?? null,
          source: 'image' as const,
          originalImage: img,
        }))

      setHistoryCandidates(taskLinkCandidates.length > 0 ? taskLinkCandidates : fallbackCandidates)
    } catch {
      message.error('加载历史生成图片失败')
      setHistoryCandidates([])
    } finally {
      setHistoryLoading(false)
    }
  }

  const handleAdoptHistoryImage = async (candidate: HistoryCandidate<TImage>) => {
    if (!assetId || !editingSlotImage || !candidate.file_id) return

    setAdoptingImageId(candidate.id)
    try {
      await updateImage(assetId, editingSlotImage.id, {
        file_id: candidate.file_id,
        width: candidate.width ?? null,
        height: candidate.height ?? null,
        format: candidate.format ?? null,
      })
      message.success('角度图片已更新')
      setHistoryOpen(false)
      setEditingSlotImage(null)
      await loadData()
    } catch {
      message.error('更新角度图片失败')
    } finally {
      setAdoptingImageId(null)
    }
  }

  /** T2：调用 LLM 九槽位图片提示词预览（只读，不写库），已保存的类别用于预填。 */
  const loadImagePromptPreview = async () => {
    if (!assetId) return
    const name = (formName || asset?.name || '').trim()
    const profile = (formDesc || asset?.description || '').trim()
    const shotText = [name, profile].filter(Boolean).join('\n')
    if (!shotText) {
      message.warning('请先填写名称或描述，再生成图片提示词')
      return
    }

    setImagePromptOpen(true)
    setImagePromptLoading(true)
    try {
      const saved = getAssetImagePrompts(asset)
      setSavedPromptMap(saved)
      // 该资产的身份（后端声明了 asset_id 一类的字段时才会发出去）：让后端能装配它的资料与剧本片段
      const extras = buildPromptRequestExtras({
        support: promptRequestSupport,
        assetId,
        assetType: assetNavigateRelationType ?? '',
        styleHint: formStyle.trim(),
      })
      const requestBody: Record<string, unknown> = {
        shot_text: shotText,
        project_id: resolvedProjectId || undefined,
        entity_profiles: [{ name, entity_type: assetNavigateRelationType ?? 'character', profile }],
        style_hint: formStyle.trim() || undefined,
        ...extras,
      }
      // ④ 脱敏请求结构：原样记下"这次真的发出去的是什么"
      setImagePromptRequestStructure(buildRequestStructureText(requestBody))
      const data = await previewImagePrompts(requestBody as Parameters<typeof previewImagePrompts>[0])
      setImagePromptResult(data)
      const nextDraft: Record<string, string> = {}
      ;(data?.slots ?? []).forEach((slot) => {
        const alreadySaved = String(saved[slot.category] ?? '').trim()
        nextDraft[slot.category] = alreadySaved || slot.prompt
      })
      setImagePromptDraftByCategory(nextDraft)
    } catch (error) {
      void showUserError(error, '生成图片提示词失败', '生成图片提示词')
    } finally {
      setImagePromptLoading(false)
    }
  }

  /**
   * 角度类别原值 → 中文名。
   *
   * 后端给的中文标签优先；**未登记时给中文兜底，绝不回显类别原值**
   * （`MAP[k] ?? k` 是本项目反复踩的模式 3 兜底坑）。
   */
  const angleDisplayName = (category: string): string => {
    const hit = (imagePromptResult?.slots ?? []).find((slot) => slot.category === category)
    return String(hit?.label ?? '').trim() || '该角度'
  }

  /** T2：把确认后的槽位提示词合并写入资产 `image_prompts`（不覆盖其它已保存类别）。 */
  const handleSaveImagePrompts = async () => {
    if (!assetId || !assetNavigateRelationType) return

    const edited: Record<string, string> = {}
    const blocked: string[] = []
    Object.entries(imagePromptDraftByCategory).forEach(([category, value]) => {
      const text = String(value ?? '').trim()
      if (!text) return
      // 判定不可用的槽位**不许存进资产**（否则它会被出图当成可用提示词）
      const verdict = resolvePromptQuality({ prompt: text, assetName: asset?.name || formName || '' })
      if (verdict.status === 'unusable') {
        /* 审计 §4.6 模式 2/3：原来这里把后端类别原值（`scene_image_front`）直接拼进提示。
           主区用中文角度名；类别原值仍在上面的「技术详情」里可查。 */
        blocked.push(`${angleDisplayName(category)}：${verdict.reason}`)
        return
      }
      edited[category] = text
    })
    if (Object.keys(edited).length === 0) {
      message.warning(
        blocked.length > 0
          ? `没有可保存的提示词：有 ${blocked.length} 个角度判定不可用，先按提示补好再保存。`
          : '没有可保存的提示词',
      )
      return
    }

    setImagePromptSaving(true)
    try {
      let currentSaved = getAssetImagePrompts(asset)
      try {
        const fresh = await getAsset(assetId)
        if (fresh) currentSaved = getAssetImagePrompts(fresh)
      } catch {
        // 读不到最新资产时退回页面已加载的 image_prompts
      }
      const merged = { ...currentSaved, ...edited }
      /**
       * 写入范围确认（用户口径）：
       *   - 全局资产（场景/道具/服装）：**一律**先确认"这会写回全局资产库"，并列出差异；
       *   - 角色（项目内资产）：只在会替换已有内容时确认。
       * 已有提示词默认不动：要覆盖必须**显式确认**（与后端 409 image_prompt_replace_required 同口径）。
       */
      const writeScope = buildGlobalAssetWriteConfirmation({
        assetType: assetNavigateRelationType ?? '',
        assetName: asset?.name || formName || '',
        existing: currentSaved,
        incoming: merged,
      })
      const replacedSlots = writeScope.replacedSlots
      const write = async (confirmReplace: boolean) => {
        await saveAssetImagePrompts(
          assetNavigateRelationType,
          assetId,
          merged,
          confirmReplace ? { confirm_replace_image_prompt: true } : {},
        )
        setSavedPromptMap(merged)
        setImagePromptOpen(false)
        message.success(
          blocked.length > 0
            ? `已保存 ${Object.keys(edited).length} 个角度提示词；另有 ${blocked.length} 个角度判定不可用，未保存`
            : `已保存 ${Object.keys(edited).length} 个角度提示词`,
        )
        if (blocked.length > 0) {
          // 说清被拦下的是哪些、为什么（不静默丢弃）
          blocked.slice(0, 3).forEach((item) => message.warning(item))
        }
        await loadData()
      }
      if (writeScope.required) {
        Modal.confirm({
          title: writeScope.title,
          width: 620,
          okText: writeScope.okText,
          cancelText: writeScope.cancelText,
          content: (
            <ul className="list-disc pl-5 text-xs leading-5">
              {writeScope.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ),
          onOk: () => write(replacedSlots.length > 0),
        })
        return
      }
      await write(false)
    } catch (error) {
      // 后端的结构化中文错误优先原样展示（409 要显式确认 / 422 质量拦截）
      const failure = describePromptSaveFailure(error)
      message.error(failure.fix ? `${failure.message}（${failure.fix}）` : failure.message)
    } finally {
      setImagePromptSaving(false)
    }
  }

  /** T3：设为定版（后端会自动清掉同一资产其它行的 is_primary）。
   *
   * 后端**不静默替换定版**：该资产已有定版图（`is_primary` 且已绑图）时，直接设版会返回
   * 结构化 409。所以这里先按既有口径问一次「确认替换」，用户点确认后才把
   * `confirm_replace_primary=true` 发出去。
   */
  const handleSetPrimaryImage = async (image: TImage) => {
    if (!assetId || !assetNavigateRelationType) return

    const existingPrimary = images.find((item) => item.is_primary === true && item.id !== image.id)
    if (existingPrimary) {
      Modal.confirm({
        title: '该资产已有定版图，确认替换？',
        okText: '确认替换定版',
        cancelText: '取消',
        width: 520,
        content: (
          <div className="text-xs leading-5">
            <div>替换后，原来的定版图不再作为「定版」；它仍留在该资产里，随时可以再切回来。</div>
            <div>后续出图会以新的定版图片为准，镜头一致性也以它为准。</div>
            <div>替换定版本身不产生出图费用。</div>
          </div>
        ),
        onOk: () => doSetPrimaryImage(image, true),
      })
      return
    }
    await doSetPrimaryImage(image, false)
  }

  const doSetPrimaryImage = async (image: TImage, confirmReplacePrimary: boolean) => {
    if (!assetId || !assetNavigateRelationType) return

    setSettingPrimaryImageId(image.id)
    try {
      await setEntityImagePrimary(
        assetNavigateRelationType,
        assetId,
        image.id,
        true,
        confirmReplacePrimary,
      )
      message.success('已设为定版')
      await loadData()
    } catch (error) {
      void showUserError(error, '设为定版失败', '设为定版')
    } finally {
      setSettingPrimaryImageId(null)
    }
  }

  /**
   * 上传本地图片文件，写入该角度槽位的 `file_id`（走 `POST /studio/files/upload`）。
   *
   * 为什么需要它：资产图片此前**只有**「AI 生成 → 采纳」这一条入口，缺图时无法用
   * 手头已有的图把槽位补上（第 3 步「上传测试图片并设为定版」在页面上无处可点）。
   * 上传与「设为定版」保持两个独立动作：上传只写槽位 file_id，定版仍由
   * `handleSetPrimaryImage` 显式触发，避免上传即隐式改定版。
   */
  const handleUploadImage = async (target: TImage, file: File) => {
    if (!assetId) return
    if (!/\.(jpe?g|png|webp|gif)$/i.test(file.name)) {
      message.error('请上传图片文件（jpg / jpeg / png / webp / gif）')
      return
    }
    setUploadingImageId(target.id)
    try {
      const res = await StudioFilesService.uploadFileApiApiV1StudioFilesUploadPost({
        formData: { file: file as unknown as string },
        name: file.name.replace(/\.[^.]+$/, ''),
      })
      const created = res.data as unknown as { id?: string } | undefined
      const fileId = String(created?.id ?? '').trim()
      if (!fileId) {
        message.error('上传成功但没有拿到文件编号，请刷新后重试')
        return
      }
      await updateImage(assetId, target.id, { file_id: fileId, format: 'png' })
      message.success('已上传并写入该角度')
      await loadData()
    } catch (error) {
      void showUserError(error, '图片上传失败', '上传图片')
    } finally {
      setUploadingImageId(null)
    }
  }

  /** T4：用定版图片提交批量出图（受 DRY_RUN 守卫，本页不落库）。**只对人物开放**。 */
  const runReferenceBatch = async (projectId: string) => {
    if (!assetId) return
    const assetType = assetNavigateRelationType
    if (assetType !== 'character' && assetType !== 'scene' && assetType !== 'prop') {
      message.warning('出图服务 V0 只支持角色/场景/道具，当前资产类型无法用定版图片批量出图')
      return
    }

    setReferenceBatchLoading(true)
    try {
      const data = await submitImagePlan({
        project_id: projectId,
        asset_type: assetType,
        stage: 'reference_batch',
        asset_ids: [assetId],
        use_primary_reference: true,
        aspect_ratio: '16:9',
        image_model: 'image2',
      })
      setReferenceBatchResult(data)
      setReferenceBatchOpen(true)
    } catch (error) {
      void showUserError(error, '提交批量出图失败', '批量出图')
    } finally {
      setReferenceBatchLoading(false)
    }
  }

  const handleSubmitReferenceBatch = async () => {
    if (!assetId) return
    if (!referenceBatchAllowed) return
    const projectId = resolvedProjectId.trim()
    if (!projectId) {
      // 场景/道具/服装的读模型没有 project_id，从资产库直接打开时也拿不到 URL 线索
      requireProjectScope(
        (picked) => runReferenceBatch(picked),
        '批量出图需要先知道这个资产属于哪个项目：请先选择项目',
      )
      return
    }
    await runReferenceBatch(projectId)
  }

  /**
   * 可选项目列表：给「缺少项目作用域」时用**选择**代替手填项目 ID。
   *
   * 为什么要改：原来这里是一个纯文本输入框，要求用户自己去地址栏抄 `<项目 ID>`，
   * 填错或留空就变成一个没有信息量的失败（曾经显示成 status=unknown）。
   * 现在直接列项目让用户选。
   */
  const [projectOptions, setProjectOptions] = useState<{ label: string; value: string }[]>([])
  const [projectOptionsLoading, setProjectOptionsLoading] = useState(false)

  /**
   * 拉取可选项目（**分页取全量**：后端单页上限 100，旧项目可能在第 2 页之后）。
   * 只取第一页会让「比第一页更旧的项目」根本选不到。
   */
  const loadProjectOptions = useCallback(async () => {
    setProjectOptionsLoading(true)
    try {
      const options: { label: string; value: string }[] = []
      let page = 1
      let maxPage = 1
      do {
        const res = await StudioProjectsService.listProjectsApiV1StudioProjectsGet({ page, pageSize: 100 })
        const items = res.data?.items ?? []
        options.push(...items.map((item) => ({ label: item.name, value: item.id })))
        const reported = res.data?.pagination?.max_page
        maxPage = typeof reported === 'number' && reported > 0 ? reported : 1
        page += 1
      } while (page <= maxPage && options.length < 1000)
      setProjectOptions(options)
    } catch {
      setProjectOptions([])
    } finally {
      setProjectOptionsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (projectIdModalOpen && projectOptions.length === 0) void loadProjectOptions()
  }, [projectIdModalOpen, loadProjectOptions, projectOptions.length])

  /**
   * 当前项目的**名称**（审计 §4.6 模式 1：主区显示项目名，不显示项目 UUID）。
   *
   * 只有在「已经知道项目、但还不知道它叫什么」时才去读一次项目列表（只读 GET）；
   * 用 ref 保证只尝试一次 —— 读不到就维持「名称待读取」，绝不因为读不到而反复请求，
   * 也绝不退回显示编号。
   */
  const projectNameLookupRef = useRef(false)
  useEffect(() => {
    if (projectNameLookupRef.current) return
    if (!resolvedProjectId.trim()) return
    projectNameLookupRef.current = true
    if (projectOptions.length === 0) void loadProjectOptions()
  }, [resolvedProjectId, projectOptions.length, loadProjectOptions])

  const resolvedProjectName = useMemo(() => {
    const id = resolvedProjectId.trim()
    if (!id) return ''
    const hit = projectOptions.find((option) => option.value === id)
    return String(hit?.label ?? '').trim()
  }, [projectOptions, resolvedProjectId])

  /** 任意项目编号 → 项目名（取不到时给中文占位，**绝不回落显示编号**）。 */
  const projectDisplayName = useCallback(
    (projectId?: string | null): string => {
      const id = String(projectId ?? '').trim()
      if (!id) return ''
      const hit = projectOptions.find((option) => option.value === id)
      return String(hit?.label ?? '').trim() || '已选定（名称待读取）'
    },
    [projectOptions],
  )

  /**
   * 记住「是哪个动作触发了选项目」。
   *
   * 只有在用户从某个具体生成动作（单张生成 / 批量出图）触发时才会被赋值；
   * 从页面顶部条主动选择项目时它是 null —— 那种情况下选中项目只应该
   * 「设置作用域并让生成按钮可用」，**不允许顺手发起一次批量出图**。
   */
  const pendingProjectActionRef = useRef<((projectId: string) => Promise<void> | void) | null>(null)

  /** 本次单张生成显式使用的项目作用域（提交时优先读它）。 */
  const activeGenerateProjectIdRef = useRef('')

  const handleConfirmProjectId = async () => {
    const next = projectIdDraft.trim()
    if (!next) {
      message.warning('请先选择项目')
      return
    }
    // 同步更新：不依赖 React state 刷新，紧接着恢复的动作也能拿到正确的项目
    activeGenerateProjectIdRef.current = next
    setManualProjectId(next)
    setProjectIdModalOpen(false)

    const action = pendingProjectActionRef.current
    pendingProjectActionRef.current = null
    if (action) {
      // 从具体生成动作触发：只恢复那一个动作
      await action(next)
      return
    }
    message.success('已选择项目，出图按钮现在可用')
  }

  /**
   * 缺项目作用域时的统一入口。
   *
   * `action` 是「选中项目后要继续的那个动作」，只会被恢复一次；
   * 不传 action 表示用户只是要设置作用域（例如点页面顶部的「在这里选择项目」），
   * 这种情况选中后不触发任何生成。
   */
  const requireProjectScope = (
    action: ((projectId: string) => Promise<void> | void) | null,
    reason: string,
  ): boolean => {
    const current = (activeGenerateProjectIdRef.current || resolvedProjectId).trim()
    if (current) return true
    pendingProjectActionRef.current = action
    setProjectIdDraft(activeGenerateProjectIdRef.current || '')
    setProjectIdModalOpen(true)
    message.warning(reason)
    return false
  }

  const imagePromptDryRun = imagePromptResult?.meta?.dry_run === true
  const imagePromptDryRunReason = String(imagePromptResult?.meta?.dry_run_reason ?? '').trim()
  const imagePromptWarnings = imagePromptResult?.warnings ?? []
  const imagePromptSlots = imagePromptResult?.slots ?? []
  const imagePromptSavedOnlyCategories = Object.keys(savedPromptMap).filter(
    (category) => !imagePromptSlots.some((slot) => slot.category === category),
  )
  /**
   * 本次生成依据的原始回包（默认收起的「生成依据」面板读它）。
   *
   * 后端还没返回这些字段时面板如实显示「本次未提供生成依据」——**不编造**。
   */
  const imagePromptBasisPayload = imagePromptResult ?? null
  /** 采纳结果里可用的图片地址（DRY_RUN 占位地址不算）。 */
  const adoptableUrl = (row: ReferenceBatchSubmitResult['results'][number]): string => {
    const candidate = (row.oss_url || row.image_url || '').trim()
    if (!candidate) return ''
    if (!/^https?:\/\//i.test(candidate)) return ''
    if (candidate.includes('dry-run.invalid')) return '' // 演练占位，后端也会拒
    return candidate
  }

  const handleAdoptResult = async (row: ReferenceBatchSubmitResult['results'][number]) => {
    const url = adoptableUrl(row)
    if (!assetId || !url || !assetNavigateRelationType) return
    // 这条路径**会设版**（set_primary=true），所以只要资产已有定版图，后端就要求显式确认。
    if (adoptionNeedsPrimaryConfirmation(null, true)) {
      confirmPrimaryReplaceThen(
        '这次采纳会把现有定版图换成这张新结果（不会再静默替换）。',
        () => doAdoptResult(row, url, true),
      )
      return
    }
    await doAdoptResult(row, url, false)
  }

  const doAdoptResult = async (
    row: ReferenceBatchSubmitResult['results'][number],
    url: string,
    confirmReplacePrimary: boolean,
  ) => {
    if (!assetId || !assetNavigateRelationType) return
    const key = `${row.source_asset_id}_${row.service_task_id}`
    setAdoptingKey(key)
    try {
      await adoptGeneratedImage({
        entity_type: assetNavigateRelationType,
        entity_id: assetId,
        url,
        set_primary: true,
        name: `${formName || asset?.name || assetId} 生成图`,
        ...(confirmReplacePrimary ? { confirm_replace_primary: true } : {}),
      })
      message.success('已采纳到资产并设为定版，刷新后仍在')
      await loadData()
    } catch (error) {
      void showUserError(error, '采纳失败', '采纳结果')
    } finally {
      setAdoptingKey(null)
    }
  }

  const referenceBatchResults = referenceBatchResult?.results ?? []
  const referenceBatchWarnings = referenceBatchResult?.warnings ?? []
  const referenceBatchDryRun = referenceBatchResults.some((row) => row.dry_run)

  /**
   * 单张生成结果的统一口径（成功 X / 失败 Y、真实失败原因、下一步、Alert 类型）。
   *
   * `partial_failed`（图片已生成、但出图服务 OSS 上传失败）在这里被归到失败档，
   * 绝不会再拿到 `type="success"`。
   * `row` 缺失时用页面已存的字段兜底造一行，保证不会退化成「没有出图结果」。
   */
  const singleGenSummary = useMemo(
    () =>
      summarizeAssetResults(
        singleGenResult
          ? [
              singleGenResult.row ?? {
                status: singleGenResult.status,
                message: singleGenResult.message,
                url: singleGenResult.url,
              },
            ]
          : [],
        { summary: singleGenResult?.roundSummary },
      ),
    [singleGenResult],
  )

  /**
   * 单张结果的**第三层**字段（内部编号 / 完整图片地址 / 原始状态值）。
   *
   * 审计 §5.5-C 同一口径：主区不给地址（原来这一格是 `break-all` 直渲完整地址），
   * 地址与内部编号只进默认收起的「技术详情」。
   */
  const singleGenTechnicalFields = useMemo(
    () =>
      singleGenResult?.row
        ? buildResultRowTechnicalFields(normalizeAssetResultRow(singleGenResult.row))
        : [],
    [singleGenResult],
  )

  /**
   * 单张结果弹窗的行文案：除计数 / 原因 / 下一步之外，成功时补一句「采纳会做什么」，
   * 免得用户在成功场景下看不到采纳说明。
   */
  const singleGenAlertLines = useMemo(() => {
    const adoptHint =
      '采纳会把图片下载入库并写进该资产的图片（刷新后仍在）；设为定版后，后续出图会以这张定版图片为准，镜头也会读到它。'
    if (singleGenSummary.detailLines.length === 0) return [adoptHint]
    return singleGenSummary.allSucceeded ? [...singleGenSummary.detailLines, adoptHint] : singleGenSummary.detailLines
  }, [singleGenSummary])

  /**
   * 批量出图结果的统一口径。新字段（`ok_count` / `failed_count` / `oss_ready_count` /
   * 归一化 `outcome`）有就用；没有就逐级回退到旧形状（`by_status` → `oss_ready` →
   * `results` 逐行 → `total`），任何一种形状都不会白屏。
   */
  const referenceBatchSummary = useMemo(
    () =>
      summarizeAssetResults(referenceBatchResult?.results ?? [], {
        summary: referenceBatchResult?.summary,
        payload: referenceBatchResult,
        dryRun: (referenceBatchResult?.results ?? []).some((row) => row.dry_run),
      }),
    [referenceBatchResult],
  )

  /**
   * 「按定版图片批量出图」的准入。
   *
   * 两层条件缺一不可：
   *   1. 出图服务本身支持该类型（character / scene / prop）；
   *   2. **「按定版图片批量出图」只对人物开放**（后端 `batch_reference_allowed`）——
   *      场景 / 道具走到这条路时后端会**明确忽略**已有图片，只按提示词生成；
   *      按钮还叫"用定版图批量出图"就等于骗人，所以这里直接按类型禁用并说明。
   */
  const referenceBatchSupported = supportsImageServiceAssetType(assetNavigateRelationType)
  const referenceBatchAllowed = referenceBatchSupported && supportsBatchReference(assetNavigateRelationType as ImageAssetType)
  const assetCopy = resultArtifactCopy((assetNavigateRelationType ?? 'character') as ImageAssetType)
  const hasPrimaryImage = images.some((img) => img.is_primary === true)
  const referenceBatchTooltip = referenceBatchAllowed
    ? `用该资产已设为定版的图片提交批量出图，生成${assetCopy.label}（演练模式下不会真的提交）`
    : assetNavigateRelationType === 'costume'
      ? `当前版本的出图服务不支持服装；${BATCH_REFERENCE_FLOW_LABEL}也只对人物开放，服装设定图请手工上传或生成`
      : `${BATCH_REFERENCE_FLOW_LABEL}只对人物开放：${assetCopy.noun}会按提示词直接生成，不会带上已有图片${referenceBatchSupported ? '（本页的常规出图入口仍可用）' : ''}`

  if (!assetId) {
    return (
      <Card>
        <Empty description={missingAssetIdText} />
      </Card>
    )
  }

  return (
    <div className="space-y-4 h-full overflow-auto">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Space>
            <Button icon={<ArrowLeftOutlined />} onClick={() => onNavigate(backTo)}>
              返回{assetDisplayName}资产
            </Button>
            <Typography.Title level={5} style={{ margin: 0 }}>
              {assetDisplayName}资产编辑
            </Typography.Title>
          </Space>
          <Button icon={<ReloadOutlined />} onClick={() => void loadData()} loading={loading}>
            刷新
          </Button>
        </div>
      </Card>

      {/* 第三层（默认收起）：内部编号与原始枚举值。
          审计 §4.6 模式 1/3 —— 资产标题旁的 `{asset.id}`、角度卡上的 `ID {slot.image.id}`、
          「资产类型：scene」「项目作用域：<UUID>」都属这一层。
          信息一条都没删，只是不再摆在主区（主区给「已出图」「项目名」这类结论）。 */}
      <TechnicalDetailSection
        testId="asset-identity-technical-detail"
        hint="这一页涉及的内部编号与原始取值，只用于核对与排查问题。"
      >
        <div className="space-y-0.5">
          <div>资产编号：{asset?.id ?? assetId ?? '未提供'}</div>
          <div>资产原名：{asset?.name ?? '未提供'}</div>
          <div>资产类型（原始取值）：{assetNavigateRelationType ?? '未识别'}</div>
          <div>所属项目编号：{resolvedProjectId || '未识别'}</div>
          {slotItems.some((slot) => slot.image) ? (
            <div>
              已出图角度的图片编号：
              {slotItems
                .filter((slot) => slot.image)
                .map((slot) => `${ANGLE_LABEL_MAP[slot.angle]}：${slot.image?.id ?? ''}`)
                .join('；')}
            </div>
          ) : null}
        </div>
      </TechnicalDetailSection>

      <Collapse
        defaultActiveKey={['base', 'views']}
        items={[
          {
            key: 'base',
            label: '基础信息展示',
            children: loading ? (
              <div className="py-8 text-center">
                <Spin />
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <div className="text-gray-600 text-sm mb-1">名称</div>
                  {/* 审计 §4.6 模式 1（数据侧）：`SCENE_` / `CHAR_` 这类系统前缀在展示层剥离，
                      输入框里编辑的仍是原值（保存不会因此改名 —— 数据变更不属文案治理）。 */}
                  <Input
                    value={stripAssetNamePrefix(formName)}
                    onChange={(e) => setFormName(e.target.value)}
                    disabled={smartDetectBusy || savingBase}
                  />
                </div>
                <div>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="text-gray-600 text-sm">描述</div>
                      {relationType === 'actor_image' ||
                      relationType === 'scene_image' ||
                      relationType === 'prop_image' ||
                      relationType === 'costume_image' ? (
                        <>
                          <Tooltip title="同步调用大模型分析缺失信息，通常需要 10~120 秒，期间请勿关闭页面">
                            <Button
                              type="primary"
                              size="small"
                              onClick={() => void handleSmartDetectMissing()}
                              loading={smartDetectLoading}
                              disabled={Boolean(loading) || smartDetectLoading}
                            >
                              {smartDetectLoading ? '检测中…' : '智能检测'}
                            </Button>
                          </Tooltip>
                          {smartDetectTask ? (
                            <Button
                              size="small"
                              danger
                              icon={<CloseCircleOutlined />}
                              disabled={smartDetectTask.cancelRequested}
                              onClick={() => void handleCancelSmartDetectTask()}
                            >
                              {smartDetectTask.cancelRequested ? '正在取消' : '取消检测'}
                            </Button>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  {/* 审计 §4.6 模式 2：后端按剧本自动生成的描述含英文字段名（运行时实测
                      `已根据该资产出现的 \`segments\`、\`shots\` …生成`）。展示层转述成中文；
                      保存仍按输入框内容（未编辑时就是原值）。原文见下方「技术详情」。 */}
                  <Input.TextArea
                    rows={4}
                    value={describeAssetDescription(formDesc)}
                    onChange={(e) => setFormDesc(e.target.value)}
                    disabled={smartDetectBusy || savingBase}
                  />
                  {asset?.description && describeAssetDescription(asset.description) !== asset.description ? (
                    <TechnicalDetailSection
                      className="mt-2"
                      testId="asset-description-technical-detail"
                      hint="这段描述同时带回了系统内部的原始写法，只用于核对。"
                    >
                      <div className="whitespace-pre-wrap">{asset.description}</div>
                    </TechnicalDetailSection>
                  ) : null}
                </div>
                <div>
                  <div className="text-gray-600 text-sm mb-1">标签（逗号分隔）</div>
                  <Input value={formTags} onChange={(e) => setFormTags(e.target.value)} disabled={smartDetectBusy || savingBase} />
                </div>
                <div>
                  <div className="text-gray-600 text-sm mb-1">镜头数（仅可增加，最大 4）</div>
                  <InputNumber
                    min={minViewCount}
                    max={4}
                    precision={0}
                    value={formViewCount}
                    onChange={(v) => setFormViewCount(v ?? minViewCount)}
                    disabled={smartDetectBusy || savingBase}
                  />
                </div>
                <div>
                  <div className="text-gray-600 text-sm mb-1">视觉风格</div>
                  <ProjectVisualStyleAndStyleFields
                    disabled={smartDetectBusy || savingBase}
                    visual_style={formVisualStyle}
                    style={formStyle}
                    options={projectStyleOptions}
                    onChange={(next) => {
                      setFormVisualStyle(next.visual_style)
                      setFormStyle(next.style)
                    }}
                  />
                </div>
                <Button type="primary" onClick={() => void handleSaveBaseInfo()} loading={savingBase || smartDetectLoading}>
                  保存基础信息
                </Button>
              </div>
            ),
          },
          {
            key: 'views',
            label: '多镜头图片',
            children: (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Space wrap>
                    <Tooltip title="调用大模型生成九个角度的图片提示词；真实调用可能需要 10~120 秒，期间请勿关闭页面">
                      <Button
                        size="small"
                        icon={<RobotOutlined />}
                        loading={imagePromptLoading}
                        onClick={() => void loadImagePromptPreview()}
                      >
                        AI 生成图片提示词
                      </Button>
                    </Tooltip>
                    <Tooltip title={referenceBatchTooltip}>
                      <span className="inline-block">
                        <Button
                          size="small"
                          type="primary"
                          ghost
                          disabled={!referenceBatchAllowed || referenceBatchLoading}
                          loading={referenceBatchLoading}
                          onClick={() => void handleSubmitReferenceBatch()}
                        >
                          {`用定版${assetCopy.noun}批量出图`}
                        </Button>
                      </span>
                    </Tooltip>
                  </Space>
                  <div className="text-xs text-gray-500">
                    <span>
                      {assetNavigateRelationType
                        ? `资产类型：${labelFor(ASSET_TYPE, assetNavigateRelationType)}`
                        : '资产类型：未知'}
                    </span>
                    <span className="ml-3">
                      {resolvedProjectId
                        ? `所属项目：${resolvedProjectName || '已选定（名称待读取）'}`
                        : '所属项目：未识别'}
                    </span>
                    {referenceBatchAllowed && !hasPrimaryImage ? (
                      <span className="ml-3 text-orange-500">未设置定版（会退回用正面视角的图片）</span>
                    ) : null}
                  </div>
                </div>
                {referenceBatchSupported && !resolvedProjectId ? (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="还不知道这个资产属于哪个项目，暂时不能出图"
                    description={
                      <span className="text-xs">
                        请从「项目工作台 → 第 2 步 资产准备」进入本页，或
                        <Button
                          type="link"
                          size="small"
                          className="!px-1"
                          onClick={() => {
                            // 只设置作用域，不发起任何生成
                            requireProjectScope(null, '请选择项目以启用出图')
                          }}
                        >
                          在这里选择项目
                        </Button>
                        。
                      </span>
                    }
                  />
                ) : null}
                <div className="text-xs text-gray-400">
                  图片提示词按角度类别合并保存在该资产上；批量出图结果本页不落库，
                  请在对应角度卡片点「编辑」→ 选择历史生成图片 →「选中并更新当前角度」采纳。
                </div>
                <Row gutter={[16, 16]}>
                  {slotItems.map((slot) => (
                    <Col xs={24} sm={12} lg={8} xl={6} key={slot.angle}>
                      <DisplayImageCard
                        title={`照片角度：${ANGLE_LABEL_MAP[slot.angle]}`}
                        imageUrl={slot.imageUrl}
                        /* `alt` 也是用户能听到/看到的文案（无障碍通道），不写枚举原值 */
                        imageAlt={ANGLE_LABEL_MAP[slot.angle]}
                        placeholder="暂无图片"
                        hoverable={false}
                        imageHeightClassName="h-44"
                        extra={
                          slot.image ? (
                            <Space size={4}>
                              {slot.image.is_primary ? <Tag color="gold">定版</Tag> : null}
                              {/* 审计 §4.6 模式 1：原来这里直渲 `ID {slot.image.id}`。
                                  主区给「已出图」这个结论，图片编号收进上面的「技术详情」。
                                  另按审计 §4.6 模式 4 的建议，地址只在本机可用时如实说明。 */}
                              <Tag color="blue">已出图</Tag>
                              {isLocalAssetAddress(slot.imageUrl) ? (
                                <Tag color="orange">长期地址未就绪</Tag>
                              ) : null}
                            </Space>
                          ) : null
                        }
                        footer={
                          <div className="flex flex-wrap items-center gap-2">
                            <Tooltip
                              title={
                                resolvedProjectId
                                  ? undefined
                                  : '还不知道这个资产属于哪个项目：请从项目工作台第 2 步「资产准备」进入，或在页面顶部选择项目'
                              }
                            >
                              <span>
                                <Button
                                  type="primary"
                                  size="small"
                                  disabled={!slot.image || !resolvedProjectId}
                                  loading={Boolean(slot.image && generatingByImageId[slot.image.id])}
                                  onClick={() => slot.image && void openPromptPreview(slot.image)}
                                >
                                  生成
                                </Button>
                              </span>
                            </Tooltip>
                            <Button
                              size="small"
                              icon={<EditOutlined />}
                              disabled={!slot.image}
                              onClick={() => slot.image && void openHistoryModal(slot.image)}
                            >
                              编辑
                            </Button>
                            {slot.image ? (
                              <Tooltip title="上传手头已有的图片文件，直接写入该角度（不触发生图、不消耗额度）">
                                <Upload
                                  showUploadList={false}
                                  accept=".jpg,.jpeg,.png,.webp,.gif,image/*"
                                  beforeUpload={(file) => {
                                    void handleUploadImage(slot.image as TImage, file as unknown as File)
                                    return false
                                  }}
                                >
                                  <Button
                                    size="small"
                                    icon={<UploadOutlined />}
                                    loading={uploadingImageId === slot.image.id}
                                    disabled={uploadingImageId !== null && uploadingImageId !== slot.image.id}
                                  >
                                    上传
                                  </Button>
                                </Upload>
                              </Tooltip>
                            ) : null}
                            {slot.image ? (
                              <Tooltip title={slot.image.is_primary ? '该图片已是当前定版' : '设为定版后，「用定版图片批量出图」会优先使用它'}>
                                <span className="inline-block">
                                  <Button
                                    size="small"
                                    icon={<SafetyCertificateOutlined />}
                                    disabled={slot.image.is_primary === true || settingPrimaryImageId !== null}
                                    loading={settingPrimaryImageId === slot.image.id}
                                    onClick={() => slot.image && void handleSetPrimaryImage(slot.image)}
                                  >
                                    设为定版
                                  </Button>
                                </span>
                              </Tooltip>
                            ) : null}
                          </div>
                        }
                      />
                    </Col>
                  ))}
                </Row>
              </div>
            ),
          },
        ]}
      />

      <Modal
        title="历史生成图片"
        open={historyOpen}
        onCancel={() => {
          setHistoryOpen(false)
          setEditingSlotImage(null)
        }}
        footer={null}
        width={960}
      >
        {historyLoading ? (
          <div className="py-8 text-center">
            <Spin />
          </div>
        ) : historyCandidates.length === 0 ? (
          <Empty description="暂无可用历史图片" />
        ) : (
          <Row gutter={[16, 16]}>
            {historyCandidates.map((candidate, candidateIndex) => (
              <Col xs={24} sm={12} md={8} key={candidate.id}>
                <DisplayImageCard
                  /* 审计 §4.6 模式 1：原来兜底标题是 `图片 ${candidate.id}`（数字 ID 直渲）。
                     现在按序号说「第 N 张」，数字 ID 只出现在画面外层（不是文案）。 */
                  title={
                    candidate.view_angle
                      ? `角度：${ANGLE_LABEL_MAP[candidate.view_angle] ?? '其他角度'}`
                      : candidate.source === 'task-link'
                        ? '任务产物'
                        : `历史生成图（第 ${candidateIndex + 1} 张）`
                  }
                  imageUrl={buildFileDownloadUrl(candidate.file_id)}
                  imageAlt="历史生成图片"
                  placeholder="无缩略图"
                  hoverable={false}
                  imageHeightClassName="h-44"
                  footer={
                    <Button
                      className="mt-2"
                      type="primary"
                      size="small"
                      block
                      disabled={!candidate.file_id}
                      loading={adoptingImageId === candidate.id}
                      onClick={() => void handleAdoptHistoryImage(candidate)}
                    >
                      选中并更新当前角度
                    </Button>
                  }
                />
              </Col>
            ))}
          </Row>
        )}
      </Modal>

      <Modal
        title="提示词内容预览"
        open={promptPreviewOpen}
        onCancel={() => {
          setPromptPreviewOpen(false)
          setPromptPreviewImage(null)
        }}
        okText="生成"
        cancelText="取消"
        confirmLoading={Boolean(promptPreviewImage && generatingByImageId[promptPreviewImage.id])}
        onOk={() => void confirmGenerateWithPrompt()}
        destroyOnClose
        width={900}
      >
        {promptPreviewLoading ? (
          <div className="py-8 text-center">
            <Spin />
          </div>
        ) : (
          <div className="space-y-3">
            {/*
              确认弹窗必须写清「这一张会出到哪个项目 / 哪个资产」。
              收口要求：从全局资产库选完项目再发起单张生成时，用户要能在这里
              看到刚选中的项目作用域，而不是只靠页面顶部那行小字。
            */}
            <Alert
              type={resolvedProjectId || activeGenerateProjectIdRef.current ? 'info' : 'warning'}
              showIcon
              message={
                <span className="text-xs">
                  出图目标：项目{' '}
                  <Typography.Text code>
                    {projectDisplayName(activeGenerateProjectIdRef.current || resolvedProjectId) ||
                      '（未设置，提交前必须先选择项目）'}
                  </Typography.Text>
                  {assetNavigateRelationType
                    ? ` · ${labelFor(ASSET_TYPE, assetNavigateRelationType)}：${formName || asset?.name || '该资产'}`
                    : ''}
                </span>
              }
            />
            <div>
              <div className="text-xs text-gray-500 mb-2">关联图片（参考图）</div>
              {promptPreviewRefFileIds.length === 0 ? (
                <div className="text-xs text-gray-400">暂无关联图片</div>
              ) : (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  <Image.PreviewGroup>
                    {promptPreviewRefFileIds.map((fid) => (
                      <Image
                        key={fid}
                        width={72}
                        height={72}
                        style={{ objectFit: 'cover', borderRadius: 8 }}
                        src={buildFileDownloadUrl(fid)}
                      />
                    ))}
                  </Image.PreviewGroup>
                </div>
              )}
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-2">提示词（可编辑）</div>
              <Input.TextArea
                rows={10}
                value={promptPreviewDraft}
                onChange={(e) => promptDraft.setBase({ prompt: e.target.value })}
                placeholder="请输入提示词…"
              />
            </div>
          </div>
        )}
      </Modal>

      <Modal
        title="智能检测：缺失信息"
        open={smartDetectOpen}
        onCancel={() => setSmartDetectOpen(false)}
        footer={null}
        destroyOnClose
        width={880}
      >
        {smartDetectLoading ? (
          <div className="py-8 text-center">
            <Spin />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              {smartDetectIssues.length === 0 ? (
                <div className="text-sm text-gray-600">未发现缺失信息。</div>
              ) : (
                <div className="text-sm text-gray-600">发现 {smartDetectIssues.length} 项可能缺失信息（建议参考下面优化后的描述）：</div>
              )}
              {smartDetectIssues.length > 0 ? (
                <div className="space-y-2">
                  {smartDetectIssues.map((it, idx) => (
                    <div key={`${idx}_${it}`} className="text-sm text-gray-800">
                      {idx + 1}. {it}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div>
              <div className="text-xs text-gray-500 mb-2">优化后的描述（可直接填入）</div>
              <Input.TextArea rows={6} value={smartDetectOptimizedDesc} readOnly />
            </div>

            <div className="flex justify-end gap-2">
              <Button
                onClick={() => {
                  const next = smartDetectOptimizedDesc.trim()
                  if (!next) {
                    message.warning('未返回有效的优化描述')
                    return
                  }
                  setFormDesc(next)
                  setSmartDetectOpen(false)
                  message.success('已填入描述')
                }}
                disabled={!smartDetectOptimizedDesc.trim()}
              >
                填入描述
              </Button>
              <Button onClick={() => setSmartDetectOpen(false)}>关闭</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        title="AI 生成图片提示词（九个角度）"
        open={imagePromptOpen}
        onCancel={() => setImagePromptOpen(false)}
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button loading={imagePromptLoading} disabled={imagePromptSaving} onClick={() => void loadImagePromptPreview()}>
              重新生成
            </Button>
            <Space>
              <Button disabled={imagePromptSaving} onClick={() => setImagePromptOpen(false)}>
                取消
              </Button>
              <Button
                type="primary"
                loading={imagePromptSaving}
                disabled={imagePromptLoading || Object.keys(imagePromptDraftByCategory).length === 0}
                onClick={() => void handleSaveImagePrompts()}
              >
                保存到资产
              </Button>
            </Space>
          </div>
        }
        destroyOnClose
        width={960}
      >
        {imagePromptLoading ? (
          <div className="py-8 text-center">
            <Spin />
          </div>
        ) : (
          <div className="space-y-4">
            {imagePromptDryRun ? (
              <Alert
                type="warning"
                showIcon
                message="当前是演练模式：以下提示词由占位逻辑拼装，没有真实调用大模型"
                description={
                  /* 审计 §4.6 模式 6：「拦截原因」是内部口径（守门逻辑的位置），
                     用户只需要知道「这是演练，没有真实调用」；后端给的原因经脱敏后另置一行。 */
                  <div className="space-y-1">
                    <div>演练关闭后这里显示的才是模型真实生成的内容，请勿把占位内容当作最终结果使用。</div>
                    {imagePromptDryRunReason ? (
                      <div className="text-[11px] text-gray-500">{toUserFacingText(imagePromptDryRunReason, '服务端没有给出更多说明')}</div>
                    ) : null}
                  </div>
                }
              />
            ) : null}
            {imagePromptWarnings.length > 0 ? (
              <Alert
                type="info"
                showIcon
                message={`提示（${imagePromptWarnings.length}）`}
                description={
                  <ul className="pl-4 list-disc space-y-1">
                    {/* 审计 §4.6 模式 6：后端 warnings 先掩内部标识再上屏 */}
                    {imagePromptWarnings.map((warning, idx) => (
                      <li key={`${idx}_${warning}`}>{maskInternalIds(warning)}</li>
                    ))}
                  </ul>
                }
              />
            ) : null}
            <div className="text-xs text-gray-500">
              已保存过的类别会用已保存内容预填（下面标了「已保存」）；点「保存到资产」时会按类别合并写入
              该资产的已保存提示词，不会丢掉未出现在本次结果里的类别。
            </div>
            {/* 生成依据（默认收起）：本次生成实际用到了哪些资料；字段没上线时如实说明 */}
            <AssetGenerationBasisPanel
              payload={imagePromptBasisPayload}
              extras={{
                requestStructure: imagePromptRequestStructure,
                finalPrompt: String(imagePromptDraftByCategory[assetNavigateRelationType ? `${assetNavigateRelationType}_image_front` : ''] ?? ''),
                globalAsset: isGlobalAssetType(assetNavigateRelationType),
              }}
              caption={`针对「${asset?.name || formName || '该资产'}」`}
            />
            {isGlobalAssetType(assetNavigateRelationType) ? (
              <div className="text-[11px] text-gray-500">{describeAssetScopeCopy(assetNavigateRelationType).writeStatement}</div>
            ) : null}
            <div className="text-[11px] text-gray-500">
              {describePromptRequestDelivery(promptRequestSupport, false)}
            </div>
            {imagePromptSavedOnlyCategories.length > 0 ? (
              <div className="text-xs text-gray-500">
                另有已保存但本次未生成的类别（保存时保留原值）：
                {imagePromptSavedOnlyCategories.map((category) => (
                  <Tag key={category} className="ml-1">
                    {category}
                  </Tag>
                ))}
              </div>
            ) : null}
            {imagePromptSlots.length === 0 ? (
              <Empty description="没有返回任何角度" />
            ) : (
              imagePromptSlots.map((slot) => (
                <div key={slot.category} className="rounded-md border border-gray-200 p-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* 审计 §4.6 模式 2：原来这里既显示中文标签、又在旁边把后端类别原值
                        （`scene_image_front` 这类）打了一遍。主区只留中文标签，
                        原始取值与分层结构的字段名一起收进下面的「技术详情」。 */}
                    <Tag color="blue">{slot.label || '未命名角度'}</Tag>
                    {slot.entity_name ? <Tag>主体：{slot.entity_name}</Tag> : null}
                    {savedPromptMap[slot.category] ? <Tag color="green">已保存</Tag> : null}
                  </div>
                  {/*
                    质量如实呈现：这一条提示词不可用时给真实原因与怎么修，
                    **不显示成"提示词已就绪"**，并且保存时会被拦下（见 handleSaveImagePrompts）。
                  */}
                  {(() => {
                    const verdict = resolvePromptQuality({
                      prompt: imagePromptDraftByCategory[slot.category] ?? slot.prompt,
                      assetName: asset?.name || formName || '',
                      // 后端本轮的正式判定就在槽位上（savable + quality_issues），整个槽位交给它读
                      serverQuality: slot ?? imagePromptResult?.quality ?? null,
                      serverWarnings: slot.warnings,
                    })
                    return verdict.status === 'usable' ? null : <PromptQualityAlert verdict={verdict} />
                  })()}
                  <Input.TextArea
                    rows={4}
                    value={imagePromptDraftByCategory[slot.category] ?? slot.prompt}
                    onChange={(e) =>
                      setImagePromptDraftByCategory((prev) => ({ ...prev, [slot.category]: e.target.value }))
                    }
                  />
                  <TechnicalDetailSection
                    testId="image-prompt-slot-technical-detail"
                    className="bg-white"
                    hint="这个角度的原始取值与提示词分层结构，只用于排查问题时对照。"
                  >
                    <div>
                      <span className="text-slate-500">角度原始取值：</span>
                      <span className="font-mono">{slot.category}</span>
                    </div>
                    {Object.keys(slot.layers ?? {}).length > 0 ? (
                      <div className="space-y-1">
                        <div className="text-slate-500">提示词分层（原始结构）</div>
                        {Object.entries(slot.layers).map(([layerKey, layerValue]) => (
                          <div key={layerKey} className="text-xs text-gray-600">
                            <span className="text-slate-500">{layerKey}：</span>
                            {layerValue}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </TechnicalDetailSection>
                  {slot.negative_prompt ? (
                    <div className="text-xs text-gray-500">负面提示词：{slot.negative_prompt}</div>
                  ) : null}
                  {slot.warnings && slot.warnings.length > 0 ? (
                    <div className="space-y-1">
                      {/* 审计 §4.6 模式 6：后端逐条 warnings 先掩内部标识再上屏 */}
                      {slot.warnings.map((warning, idx) => (
                        <div key={`${slot.category}_${idx}`} className="text-xs text-red-500">
                          {maskInternalIds(warning)}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        )}
      </Modal>

      {/* 单张生成结果：出图是内联执行的，拿到地址后由用户决定"采纳到槽位 / 采纳并设为定版"。
          不自动写库：用户要求「结果可采纳、可设定版」，采纳这一步必须是显式动作。 */}
      <Modal
        title="生成结果"
        open={Boolean(singleGenResult)}
        onCancel={() => setSingleGenResult(null)}
        footer={
          <Space>
            <Button onClick={() => setSingleGenResult(null)}>关闭</Button>
            {/* 没有可采纳地址（失败 / partial_failed）时禁用采纳，避免点了才发现没图 */}
            <Tooltip
              title={
                singleGenResult?.url
                  ? '把这张图下载入库并写进该资产的图片'
                  : '这条结果没有可采纳的图片地址，无法采纳入库'
              }
            >
              <Button
                disabled={!singleGenResult?.url}
                loading={singleGenAdopting === 'slot'}
                onClick={() => void adoptSingleGenResult(false)}
              >
                采纳到该角度
              </Button>
            </Tooltip>
            <Tooltip
              title={
                singleGenResult?.url
                  ? '采纳的同时设为定版（后续出图会以这张定版图片为准）'
                  : '这条结果没有可采纳的图片地址，无法采纳入库'
              }
            >
              <Button
                type="primary"
                disabled={!singleGenResult?.url}
                loading={singleGenAdopting === 'primary'}
                onClick={() => void adoptSingleGenResult(true)}
              >
                采纳并设为定版
              </Button>
            </Tooltip>
          </Space>
        }
        destroyOnClose
        width={720}
      >
        <div className="space-y-3">
          {/*
            这里以前是无条件 `type="success"`：出图服务在上游图片已生成、但它自己 OSS 上传失败时
            返回 `partial_failed`，页面照样显示绿色「出图完成」，还把真实错误消息丢了 ——
            用户以为成功了，其实图根本没进 OSS、采纳不了。
            现在类型、标题、计数（成功 X / 失败 Y）、真实原因、下一步全部由
            `summarizeAssetResults` 决定：部分失败 = warning，全失败 = error，绝不给绿色。
          */}
          <Alert
            type={singleGenSummary.alertType}
            showIcon
            message={
              /* 审计 §6.3 / §5.5-B5：这里原来拼「后端状态：succeeded/partial_failed」，
                 枚举原值直渲。主区只留 summarizeAssetResults 给出的中文结论，
                 原始值改由下方的「技术详情」块展示。 */
              singleGenSummary.title
            }
            description={
              <div className="space-y-1">
                {singleGenAlertLines.map((line, idx) => (
                  <div
                    key={`${idx}_${line}`}
                    className={
                      singleGenSummary.hasFailure && line.startsWith('失败原因：') ? 'text-red-600' : undefined
                    }
                  >
                    {line}
                  </div>
                ))}
                {singleGenSummary.hasFailure && singleGenResult?.url ? (
                  <div className="text-red-600">
                    注意：这条结果有图片地址、但没有成功记录，采纳前请先确认这张图是不是已经长期保存的那张。
                  </div>
                ) : null}
              </div>
            }
          />
          {singleGenSummary.hasFailure && !singleGenSummary.hasUpstreamError ? (
            <Alert
              type="warning"
              showIcon
              message="服务端没有给出失败原因"
              description="可稍后重试这一项；若持续失败，请联系管理员。"
            />
          ) : null}
          {singleGenResult?.url ? (
            <img src={singleGenResult.url} alt="" style={{ width: '100%', borderRadius: 8, border: '1px solid #e2e8f0' }} />
          ) : (
            <Alert
              type="info"
              showIcon
              message="没有可采纳的图片地址"
              description="没有拿到可以采纳的图片地址。如果图其实已经生成、只是没保存成功，按上面的提示稍后重试即可；持续失败请联系管理员。"
            />
          )}
          {/* 审计 §4.6 模式 4：原来这里 `break-all` 直渲完整图片地址。
              图片已经在上面的 <img> 里给用户看了，地址本身只留「技术详情」。 */}
          <TechnicalDetailSection testId="single-gen-technical-detail">
            <div>
              <span className="text-slate-500">图片地址：</span>
              <span className="font-mono break-all">{singleGenResult?.url || '未返回'}</span>
            </div>
            {singleGenTechnicalFields.map((field) => (
              <div key={field.label}>
                <span className="text-slate-500">{field.label}：</span>
                <span className="font-mono break-all">{field.value}</span>
              </div>
            ))}
          </TechnicalDetailSection>
          <div className="rounded bg-slate-50 px-3 py-2 text-[11px] leading-5 text-gray-600">
            <div className="font-medium">本次使用的提示词</div>
            <div className="whitespace-pre-wrap">{singleGenResult?.prompt}</div>
          </div>
        </div>
      </Modal>

      <Modal
        title="按定版图片批量出图结果"
        open={referenceBatchOpen}
        onCancel={() => setReferenceBatchOpen(false)}
        footer={<Button onClick={() => setReferenceBatchOpen(false)}>关闭</Button>}
        destroyOnClose
        width={880}
      >
        <div className="space-y-4">
          {/* 审计 §6.1（任务号一律进技术详情）+ §5.5-C：原来主区这一行直接打着
              `阶段：reference_batch` / `资产：{UUID}` / `项目：{UUID}` / `守卫状态：{后端原值}`，
              四个都是第三层内容（内部编码 / 内部 ID / 后端原始状态值）。
              现在整行收进默认收起的「技术详情」——**信息一条都没删**，只是不再摆在主区。 */}
          <TechnicalDetailSection testId="reference-batch-technical-detail">
            <div className="space-y-0.5">
              <div>提交类型代码：reference_batch</div>
              <div>资产编号：{assetId ?? '未提供'}</div>
              <div>项目编号：{referenceBatchResult?.project_id ?? '未提供'}</div>
              <div>演练开关原始状态：{referenceBatchResult?.guard_status || '未提供'}</div>
              <div>汇总计数来源：{referenceBatchSummary.countSource}</div>
            </div>
          </TechnicalDetailSection>
          {/*
            结果汇总：以前只显示「共 N 个提交结果」，既看不出成功几条 / 失败几条，
            也把 `partial_failed`（上游图片已生成、OSS 上传失败）混在列表里当正常状态。
            现在按统一口径给出「成功 X / 失败 Y」和真实失败原因；样式随口径变化，
            部分失败 = warning、全失败 = error，绝不给绿色成功。
          */}
          {referenceBatchSummary.total > 0 || referenceBatchSummary.hasFailure ? (
            <Alert
              type={referenceBatchSummary.alertType}
              showIcon
              message={referenceBatchSummary.title}
              description={
                referenceBatchSummary.detailLines.length > 0 ? (
                  <div className="space-y-1">
                    {referenceBatchSummary.detailLines.map((line, idx) => (
                      <div
                        key={`${idx}_${line}`}
                        className={
                          referenceBatchSummary.hasFailure && line.startsWith('失败原因：')
                            ? 'text-red-600'
                            : undefined
                        }
                      >
                        {line}
                      </div>
                    ))}
                  </div>
                ) : undefined
              }
            />
          ) : null}
          {referenceBatchSummary.countsKnown && referenceBatchSummary.total > 0 ? (
            <div className="text-sm">
              <span className="font-medium">成功 {referenceBatchSummary.okCount} 条</span>
              <span className="mx-2 text-gray-300">/</span>
              <span className="font-medium">失败 {referenceBatchSummary.failedCount} 条</span>
              <span className="ml-3 text-xs text-gray-500">
                （共 {referenceBatchSummary.total} 条，其中 {referenceBatchSummary.ossReadyCount} 条已保存为长期图片）
              </span>
              {referenceBatchSummary.mismatchNote ? (
                <div className="text-xs text-orange-600">{referenceBatchSummary.mismatchNote}</div>
              ) : null}
            </div>
          ) : null}
          {referenceBatchDryRun ? (
            <Alert
              type="warning"
              showIcon
              message="当前是演练模式：没有真的提交出图"
              description="所以下面的结果只是占位内容，不会产生真实图片，也没有上传长期存储。关闭演练模式后才会真正出图。"
            />
          ) : null}
          {referenceBatchWarnings.length > 0 ? (
            <Alert
              type="info"
              showIcon
              message={`警告（${referenceBatchWarnings.length}）`}
              description={
                <ul className="pl-4 list-disc space-y-1">
                  {/* 审计 §4.6 模式 6：后端 warnings 先掩内部标识再上屏 */}
                  {referenceBatchWarnings.map((warning, idx) => (
                    <li key={`${idx}_${warning}`}>{maskInternalIds(warning)}</li>
                  ))}
                </ul>
              }
            />
          ) : null}
          {referenceBatchResults.length === 0 ? (
            <Empty description="没有返回任何提交结果" />
          ) : (
            <div className="space-y-3">
              <div className="text-sm text-gray-600">
                共 {referenceBatchResults.length} 个提交结果
                {referenceBatchSummary.countsText ? `（${referenceBatchSummary.countsText}）` : ''}：
              </div>
              {referenceBatchResults.map((row) => {
                // 逐行也走同一套归一化：partial_failed 在这里同样不是绿色，
                // 而且会尽量把 detail.error_message 里的真实原因显示出来。
                const normalized = normalizeAssetResultRow(row as unknown)
                /* 审计 §5.5-C：这一行原来把四种泄漏挤在一起 ——
                   模式 1 `{row.source_asset_id}`、模式 2 字面标签 `oss_url：`、
                   模式 3 `DRY_RUN 下为空，未上传 OSS`、模式 4 完整 OSS 地址同时作
                   链接文本与 href。现在：主区只留**中文结论 + 动作**（「查看图片」），
                   地址与内部编号全部交给下面默认收起的「技术详情」（第三层）。 */
                const addressView = describeResultRowAddress(normalized)
                const technicalFields = buildResultRowTechnicalFields(normalized)
                return (
                  <div
                    key={`${row.source_asset_id}_${row.service_task_id}`}
                    className="rounded-md border border-gray-200 p-3 space-y-1 text-sm"
                  >
                    <div>
                      本次结果：
                      {/* 审计 §6.3 / §5.5-B5：原来直渲 `normalized.rawStatus`（succeeded / partial_failed
                          / dry_run 原值）。主区一律用 ASSET_OUTCOME_LABEL 的中文口径；
                          原始 status 与任务号一起挪到下面默认收起的「技术详情」里。 */}
                      <Tag color={ASSET_OUTCOME_TAG_COLOR[normalized.outcome]}>
                        {ASSET_OUTCOME_LABEL[normalized.outcome]}
                      </Tag>
                      {normalized.outcome === 'partial_failed' ? (
                        <span className="text-xs text-orange-600">
                          部分失败：图片已生成，但没能保存成长期图片，暂时不能采纳
                        </span>
                      ) : null}
                    </div>
                    <div>
                      图片长期地址：
                      <span className="text-gray-600">{addressView.text}</span>
                      {addressView.link ? (
                        <a
                          className="ml-2"
                          href={addressView.link.href}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {addressView.link.text}
                        </a>
                      ) : null}
                    </div>
                    {normalized.errorText ? (
                      <div className={normalized.isFailure ? 'text-xs text-red-500' : 'text-xs text-gray-500'}>
                        {normalized.isFailure ? `失败原因：${normalized.errorText}` : normalized.errorText}
                      </div>
                    ) : null}
                    <div className="pt-1">
                      <Tooltip
                        title={
                          adoptableUrl(row)
                            ? '下载入库并写入该资产的图片（同时设为定版）'
                            : normalized.isFailure
                              ? '这条结果没有可采纳的图片地址（没有成功保存到长期存储），无法采纳入库'
                              : '演练模式下没有真实图片地址，无法采纳'
                        }
                      >
                        <Button
                          size="small"
                          type="primary"
                          disabled={!adoptableUrl(row)}
                          loading={adoptingKey === `${row.source_asset_id}_${row.service_task_id}`}
                          onClick={() => void handleAdoptResult(row)}
                        >
                          采纳到资产
                        </Button>
                      </Tooltip>
                    </div>
                    {technicalFields.length > 0 ? (
                      <TechnicalDetailSection
                        className="mt-2"
                        testId="reference-batch-row-technical-detail"
                        hint="这一条的原始编号与图片地址（含存储位置），只用于排查问题时对照。"
                      >
                        {technicalFields.map((field) => (
                          <div key={field.label}>
                            <span className="text-slate-500">{field.label}：</span>
                            <span className="font-mono break-all">{field.value}</span>
                          </div>
                        ))}
                      </TechnicalDetailSection>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
          <Alert
            type="info"
            showIcon
            message="出图结果需要人工采纳才落库"
            description="点上面的「采纳到资产」会下载入库、写入该资产的图片并设为定版（刷新后仍在）。也可以对目标角度点「编辑」→ 选择历史生成图片 →「选中并更新当前角度」。"
          />
        </div>
      </Modal>

      <Modal
        title="出图前需要先选一个项目"
        open={projectIdModalOpen}
        onCancel={() => {
          pendingProjectActionRef.current = null
          setProjectIdModalOpen(false)
        }}
        onOk={() => void handleConfirmProjectId()}
        okText="用这个项目继续"
        cancelText="取消"
        confirmLoading={referenceBatchLoading}
        destroyOnClose
      >
        <div className="space-y-3">
          <div className="text-sm text-gray-600">
            这一页还不知道这个资产属于哪个项目，所以暂时不能出图。出图必须先知道项目，
            才能定位到要生成的那张图。推荐做法是从「项目工作台 → 第 2 步 资产准备」进入本页；
            也可以在这里直接选一个项目。
          </div>
          <Select
            showSearch
            allowClear
            loading={projectOptionsLoading}
            value={projectIdDraft || undefined}
            onChange={(value) => setProjectIdDraft(value ?? '')}
            placeholder="选择项目"
            optionFilterProp="label"
            options={projectOptions}
            style={{ width: '100%' }}
            notFoundContent={projectOptionsLoading ? '加载中…' : '没有可选项目'}
          />
          {projectOptions.length === 0 && !projectOptionsLoading ? (
            <div className="text-xs text-gray-400">
              没有读到任何项目；也可以从项目工作台的地址里找到项目。
            </div>
          ) : null}
        </div>
      </Modal>
    </div>
  )
}
