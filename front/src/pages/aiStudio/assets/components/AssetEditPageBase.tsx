import { useWorkspaceDraft } from '../../directing/WorkspaceDrafts'
import { usePageTitle } from '../../../../layouts/pageTitle'
import { AssetReferencePicker } from './AssetReferencePicker'
import { AssetDossierImage, AssetDossierSection } from './AssetDossier'
import './assetDossier.css'
import { AssetFactsFields, ASSET_FIELDS, pickAssetFacts, previewAssetDescription, type AssetFacts, type AssetFieldName, type StructuredAssetType } from './AssetFactsFields'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  Card,
  Col,
  Empty,
  Image,
  Input,
  InputNumber,
  Modal,
  Row,
  Space,
  Select,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd'
import { ArrowLeftOutlined, CloseCircleOutlined, EditOutlined, ReloadOutlined } from '@ant-design/icons'
import { FilmService, ScriptProcessingService } from '../../../../services/generated'
import type { TaskOutputHistoryRead, AssetPromptAudit, AssetFieldSuggestion, AssetImagePromptRenderBody, TaskStatus } from '../../../../services/generated'
import { buildFileDownloadUrl } from '../utils'
import { DisplayImageCard } from './DisplayImageCard'
import { ProjectVisualStyleAndStyleFields } from '../../project/ProjectVisualStyleAndStyleFields'
import { useProjectStyleOptions } from '../../project/useProjectStyleOptions'
import { defaultTaskActionErrorMessage, executeAsyncTaskCreate, executeTaskCancel, notifyExistingTask } from '../../components/taskActionHelpers'
import { handleTaskResultSafely } from '../../components/taskResultHelpers'
import { useRelationTaskNotification } from '../../components/taskNotificationHelpers'
import { useTaskPageContext } from '../../components/taskPageContext'
import { TASK_COPY } from '../../components/taskCopy'
import { useLocation } from 'react-router-dom'
import {
  CHARACTER_PORTRAIT_ANALYSIS_RELATION_TYPE,
  COSTUME_INFO_ANALYSIS_RELATION_TYPE,
  PROP_INFO_ANALYSIS_RELATION_TYPE,
  SCENE_INFO_ANALYSIS_RELATION_TYPE,
  type RelationTaskState,
  toRelationTaskStateFromStatusRead,
  useCancelableRelationTask,
} from '../../project/ProjectWorkbench/relationTasks'

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

export type AssetUpdate = AssetFacts & {
  name: string
  description?: string
  tags?: string[]
  view_count?: number
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

export type BaseAsset = AssetFacts & {
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
}

export type AssetEditPageBaseProps<TAsset extends BaseAsset, TImage extends BaseAssetImage> = {
  assetId?: string
  missingAssetIdText: string
  assetDisplayName: string
  backTo: string
  embedded?: boolean
  relationType: string
  getAsset: (assetId: string) => Promise<TAsset | null>
  updateAsset: (assetId: string, payload: AssetUpdate) => Promise<TAsset | null>
  listImages: (assetId: string) => Promise<TImage[]>
  createImageSlot: (assetId: string, angle: AssetViewAngle) => Promise<void>
  updateImage: (assetId: string, imageId: number, payload: { file_id: string; width?: number | null; height?: number | null; format?: string | null }) => Promise<void>
  renderPrompt: (assetId: string, imageId: number, options?: AssetImagePromptRenderBody) => Promise<{ prompt: string; images: string[]; audit?: AssetPromptAudit }>
  createGenerationTask: (assetId: string, imageId: number, payload: { prompt: string; images: string[]; saveAsCandidate?: boolean; audit?: AssetPromptAudit }) => Promise<string | null>
  onNavigate: (to: string, replace?: boolean) => void
}

type HistoryCandidate<TImage extends BaseAssetImage> = {
  id: string
  file_id: string
  view_angle?: AssetViewAngle
  width?: number | null
  height?: number | null
  format?: string | null
  source: 'task-output' | 'image'
  originalImage?: TImage
}

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function isTerminalStatus(status: TaskStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}

function getSmartDetectRelationType(relationType: string): string | null {
  if (relationType === 'actor_image' || relationType === 'character_image') return CHARACTER_PORTRAIT_ANALYSIS_RELATION_TYPE
  if (relationType === 'scene_image') return SCENE_INFO_ANALYSIS_RELATION_TYPE
  if (relationType === 'prop_image') return PROP_INFO_ANALYSIS_RELATION_TYPE
  if (relationType === 'costume_image') return COSTUME_INFO_ANALYSIS_RELATION_TYPE
  return null
}

function getAssetNavigateRelationType(relationType: string): string | null {
  if (relationType === 'actor_image') return 'actor'
  if (relationType === 'character_image') return 'character'
  if (relationType === 'scene_image') return 'scene'
  if (relationType === 'prop_image') return 'prop'
  if (relationType === 'costume_image') return 'costume'
  return null
}

/** 共用资产档案编辑与图片管理，按资产类别填充属性，保留生成、检测和历史采用流程。 */
export function AssetEditPageBase<TAsset extends BaseAsset, TImage extends BaseAssetImage>({
  assetId,
  missingAssetIdText,
  assetDisplayName,
  backTo,
  embedded = false,
  relationType,
  getAsset,
  updateAsset,
  listImages,
  createImageSlot,
  updateImage,
  renderPrompt,
  createGenerationTask,
  onNavigate,
}: AssetEditPageBaseProps<TAsset, TImage>) {
  const { options: projectStyleOptions, defaultVisualStyle, getDefaultStyle } = useProjectStyleOptions()
  const taskCopy = TASK_COPY.smartDetect
  const location = useLocation()
  const [loading, setLoading] = useState(true)
  const [asset, setAsset] = useState<TAsset | null>(null)
  usePageTitle(asset?.id === assetId ? asset?.name : undefined, !embedded)
  const [images, setImages] = useState<TImage[]>([])
  const [selectedAngle, setSelectedAngle] = useState<AssetViewAngle | null>(null)
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false)

  const [formName, setFormName] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formFacts, setFormFacts] = useState<AssetFacts>({})
  const structuredType = relationType === 'character_image' ? null : relationType.replace('_image', '') as StructuredAssetType
  const [formTags, setFormTags] = useState('')
  const [formViewCount, setFormViewCount] = useState(1)
  const [formVisualStyle, setFormVisualStyle] = useState<'现实' | '动漫'>(defaultVisualStyle as '现实' | '动漫')
  const [formStyle, setFormStyle] = useState<string>(getDefaultStyle(defaultVisualStyle))
  const [savingBase, setSavingBase] = useState(false)

  // 保存状态和生成入口使用同一份差异判断，包含标签、视角数量及默认风格。
  const savedVisualStyle = asset?.visual_style ?? defaultVisualStyle
  const hasUnsavedChanges = Boolean(asset && (
    formName !== asset.name
    || formDesc !== (structuredType ? asset.supplementary_info ?? '' : asset.description ?? '')
    || (structuredType && (
      JSON.stringify(formFacts) !== JSON.stringify(pickAssetFacts(structuredType, asset))
      || JSON.stringify(normalizeTags(formTags)) !== JSON.stringify(asset.tags ?? [])
      || formViewCount !== clampViewCount(asset.view_count)
    ))
    || formVisualStyle !== savedVisualStyle
    || formStyle !== (asset.style ?? getDefaultStyle(savedVisualStyle))
  ))

  useEffect(() => {
    setSelectedAngle(null)
    setImagePreviewOpen(false)
  }, [assetId])

  const [smartDetectLoading, setSmartDetectLoading] = useState(false)
  const [smartDetectOpen, setSmartDetectOpen] = useState(false)
  const [smartDetectIssues, setSmartDetectIssues] = useState<string[]>([])
  const [smartDetectSuggestions, setSmartDetectSuggestions] = useState<AssetFieldSuggestion[]>([])
  const [smartDetectBaseline, setSmartDetectBaseline] = useState<string | null>(null)
  const currentFactsSnapshot = JSON.stringify({ name: formName, facts: formFacts, supplement: formDesc })

  const [generatingByImageId, setGeneratingByImageId] = useState<Record<number, boolean>>({})
  const [generationTask, setGenerationTask] = useState<RelationTaskState | null>(null)
  const [generationSettledTask, setGenerationSettledTask] = useState<RelationTaskState | null>(null)

  const [promptPreviewOpen, setPromptPreviewOpen] = useState(false)
  const [promptPreviewLoading, setPromptPreviewLoading] = useState(false)
  const [promptPreviewImage, setPromptPreviewImage] = useState<TImage | null>(null)
  const [promptPreviewDraft, setPromptPreviewDraft] = useState('')
  const [promptAudit, setPromptAudit] = useState<AssetPromptAudit | undefined>()
  const [promptPreviewRefFileIds, setPromptPreviewRefFileIds] = useState<string[]>([])
  const [promptOptions, setPromptOptions] = useState<AssetImagePromptRenderBody>({})
  const [promptNeedsRefresh, setPromptNeedsRefresh] = useState(false)


  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyCandidates, setHistoryCandidates] = useState<HistoryCandidate<TImage>[]>([])
  const [editingSlotImage, setEditingSlotImage] = useState<TImage | null>(null)
  const [adoptingImageId, setAdoptingImageId] = useState<string | null>(null)
  const smartDetectRelationType = useMemo(() => getSmartDetectRelationType(relationType), [relationType])
  const smartDetectRelationEntityId = useMemo(
    () => (assetId && smartDetectRelationType ? `${relationType}:${assetId}` : null),
    [assetId, relationType, smartDetectRelationType],
  )
  const assetNavigateRelationType = useMemo(
    () => getAssetNavigateRelationType(relationType),
    [relationType],
  )
  const applySmartDetectResult = useCallback(async (taskId: string) => {
    await handleTaskResultSafely(taskId, {
      readErrorMessage: '读取智能检测结果失败',
      failedFallbackMessage: '智能检测失败',
      onSucceeded: (resultValue) => {
        const result = resultValue as Record<string, any>
        const issues = Array.isArray(result.issues)
          ? result.issues.filter((it: unknown): it is string => typeof it === 'string' && it.trim().length > 0)
          : []
        const suggestions = Array.isArray(result.suggestions) ? result.suggestions as AssetFieldSuggestion[] : []
        setSmartDetectIssues(issues)
        setSmartDetectSuggestions(suggestions)
        setSmartDetectOpen(true)
        if (issues.length > 0) message.warning(`发现 ${issues.length} 项可能缺失信息`)
        else message.success('未发现缺失信息')
      },
      onFailed: (errorMessage) => {
        message.error(errorMessage)
      },
      onReadError: () => {
        message.error('读取智能检测结果失败')
      },
    })
  }, [])
  const { task: smartDetectTask, settledTask: smartDetectSettledTask, trackTaskData: trackSmartDetectTaskData, applyCancelData: applySmartDetectCancelData } = useCancelableRelationTask({
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

  /** 使用接口确认的资产同步表单，保存后不立即重读，避免旧读结果覆盖已保存内容。 */
  const applyAsset = useCallback((nextAsset: TAsset) => {
    setAsset(nextAsset)
    setFormName(nextAsset.name)
    setFormDesc(structuredType ? nextAsset.supplementary_info ?? '' : nextAsset.description ?? '')
    setFormFacts(structuredType ? pickAssetFacts(structuredType, nextAsset) : {})
    setFormTags((nextAsset.tags ?? []).join(', '))
    {
      const nextVisual = (nextAsset.visual_style ?? defaultVisualStyle) as '现实' | '动漫'
      setFormVisualStyle(nextVisual)
      setFormStyle((nextAsset.style as string | undefined) ?? getDefaultStyle(nextVisual))
    }

    setFormViewCount(clampViewCount(nextAsset.view_count))
  }, [structuredType, defaultVisualStyle, getDefaultStyle])

  /** 加载资产和已有视角，初始化档案表单及图片区域。 */
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

      applyAsset(nextAsset)
      const targetCount = clampViewCount(nextAsset.view_count)

      const imageRows = embedded ? await listImages(assetId) : await ensureImageSlots(targetCount)
      setImages(imageRows)
    } catch {
      message.error(`加载${assetDisplayName}资产失败`)
    } finally {
      setLoading(false)
    }
  }, [assetId, assetDisplayName, backTo, applyAsset, ensureImageSlots, getAsset, onNavigate, embedded, listImages])

  useEffect(() => {
    void loadData()
  }, [loadData])

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
  const selectedSlot = slotItems.find((slot) => slot.angle === selectedAngle)
    ?? slotItems.find((slot) => slot.imageUrl)
    ?? slotItems[0]

  /** 保存整份资产档案并补齐新增视角，用服务端返回值确认字段和保存状态。 */
  const handleSaveBaseInfo = async () => {
    if (!assetId || !asset) return false
    if (!formName.trim()) {
      message.warning('请输入名称')
      return false
    }

    setSavingBase(true)
    try {
      const nextViewCount = Math.max(minViewCount, clampViewCount(formViewCount))
      const payload: AssetUpdate = {
        name: formName.trim(),
        ...(structuredType ? { ...formFacts, supplementary_info: formDesc.trim() } : { description: formDesc.trim() }),
        ...(structuredType ? { tags: normalizeTags(formTags), view_count: nextViewCount } : {}),
        visual_style: formVisualStyle,
        style: formStyle,
      }
      const nextAsset = await updateAsset(assetId, payload)
      if (!nextAsset) throw new Error('保存响应缺少资产数据')
      applyAsset(nextAsset)
      setImages(await ensureImageSlots(nextViewCount))
      message.success('资产已保存')
      return true
    } catch {
      message.error('保存失败')
      return false
    } finally {
      setSavingBase(false)
    }
  }

  useWorkspaceDraft({ name: `${assetDisplayName}资产档案`, dirty: embedded && hasUnsavedChanges, busy: embedded && (savingBase || smartDetectBusy), save: handleSaveBaseInfo, discard: () => { if (asset) applyAsset(asset) } })
  const returnFromAsset = () => {
    if (savingBase || smartDetectBusy) return
    if (embedded && hasUnsavedChanges) {
      Modal.confirm({ title: '资产档案有未保存的修改', content: '本场设计仍保留。请保存资产后返回，或取消并继续编辑。', okText: '保存并返回本场资产', cancelText: '继续编辑', onOk: async () => { if (!await handleSaveBaseInfo()) throw new Error('资产未保存'); onNavigate(backTo) } })
    } else onNavigate(backTo)
  }

  const handleSmartDetectMissing = async () => {
    if (!assetId) return
    if (!smartDetectRelationEntityId) return

    const description = structuredType ? previewAssetDescription(structuredType, formFacts, formDesc) : formDesc.trim()
    if (!description) {
      if (relationType === 'actor_image') message.warning('请先输入演员描述再进行智能检测')
      else if (relationType === 'scene_image') message.warning('请先输入场景描述再进行智能检测')
      else if (relationType === 'prop_image') message.warning('请先输入道具描述再进行智能检测')
      else if (relationType === 'costume_image') message.warning('请先输入服装描述再进行智能检测')
      return
    }

    if (notifyExistingTask(smartDetectTask, {
      cancellingMessage: taskCopy.cancellingMessage,
      runningMessage: taskCopy.runningMessage,
    })) {
      return
    }

    setSmartDetectBaseline(currentFactsSnapshot)
    setSmartDetectLoading(true)
    try {
      const request = () => {
        if (relationType === 'actor_image') {
          const character_context = asset?.name ? `角色名：${formName}\n演员标签：${formTags}` : `演员标签：${formTags}`
          return ScriptProcessingService.analyzeCharacterPortraitAsyncApiV1ScriptProcessingAnalyzeCharacterPortraitAsyncPost({
            requestBody: {
              relation_entity_id: smartDetectRelationEntityId,
              character_description: description,
              character_context: (character_context || '').trim() || null,
            },
          })
        }
        if (relationType === 'scene_image') {
          const scene_context = asset?.name ? `场景名：${formName}\n标签：${formTags}` : `标签：${formTags}`
          return ScriptProcessingService.analyzeSceneInfoAsyncApiV1ScriptProcessingAnalyzeSceneInfoAsyncPost({
            requestBody: {
              relation_entity_id: smartDetectRelationEntityId,
              scene_description: description,
              scene_context: (scene_context || '').trim() || null,
            },
          })
        }
        if (relationType === 'prop_image') {
          const prop_context = asset?.name ? `道具名：${formName}\n标签：${formTags}` : `标签：${formTags}`
          return ScriptProcessingService.analyzePropInfoAsyncApiV1ScriptProcessingAnalyzePropInfoAsyncPost({
            requestBody: {
              relation_entity_id: smartDetectRelationEntityId,
              prop_description: description,
              prop_context: (prop_context || '').trim() || null,
            },
          })
        }
        const costume_context = asset?.name ? `服装名：${formName}\n标签：${formTags}` : `标签：${formTags}`
        return ScriptProcessingService.analyzeCostumeInfoAsyncApiV1ScriptProcessingAnalyzeCostumeInfoAsyncPost({
          requestBody: {
            relation_entity_id: smartDetectRelationEntityId,
            costume_description: description,
            costume_context: (costume_context || '').trim() || null,
          },
        })
      }

      await executeAsyncTaskCreate({
        request,
        trackTaskData: trackSmartDetectTaskData,
        startedMessage: taskCopy.startedMessage,
        reusedMessage: taskCopy.reusedMessage,
        fallbackErrorMessage: '智能检测失败',
        getErrorMessage: (error, fallbackMessage) => {
          const maybeAny = error as { response?: { status?: number }; status?: number }
          const status = maybeAny?.response?.status ?? maybeAny?.status
          if (status === 404) {
            return '接口未找到：请运行 `pnpm run openapi:update` 生成客户端代码后重试'
          }
          return defaultTaskActionErrorMessage(error, fallbackMessage)
        },
      })
    } catch {
      // executeAsyncTaskCreate 已统一处理错误提示
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
  useRelationTaskNotification({
    task: generationTask,
    settledTask: generationSettledTask,
    title: TASK_COPY.imageGeneration.title,
    sourceLabel: formName?.trim() ? `${assetDisplayName}：${formName.trim()}` : `${assetDisplayName}编辑页`,
    runningDescription: TASK_COPY.imageGeneration.runningDescription,
    cancellingDescription: TASK_COPY.imageGeneration.cancellingDescription,
    successDescription: TASK_COPY.imageGeneration.successDescription,
    cancelledDescription: TASK_COPY.imageGeneration.cancelledDescription,
    failedDescription: TASK_COPY.imageGeneration.failedDescription,
    onCancel:
      generationTask?.taskId
        ? () =>
            void executeTaskCancel({
              taskId: generationTask.taskId,
              reason: `用户在${assetDisplayName}资产编辑页取消图片生成任务`,
              applyCancelData: (data) => {
                setGenerationTask((current) =>
                  current
                    ? {
                        ...current,
                        taskId: data?.task_id || current.taskId,
                        status: (data?.status ?? current.status) as TaskStatus,
                        cancelRequested: data?.cancel_requested ?? true,
                      }
                    : current,
                )
                return null
              },
              cancelledImmediatelyMessage: TASK_COPY.imageGeneration.cancelledImmediatelyMessage,
              cancelRequestedMessage: TASK_COPY.imageGeneration.cancelRequestedMessage,
              fallbackErrorMessage: '取消图片生成任务失败',
            })
        : null,
    onNavigate: () => onNavigate(location.pathname),
  })

  /** 渲染当前设置并冻结预览输入；提交不再重新选择参考图。 */
  const refreshPromptPreview = async (image: TImage, options: AssetImagePromptRenderBody) => {
    if (!assetId) return
    setPromptPreviewLoading(true)
    setPromptNeedsRefresh(true)
    try {
      const rendered = await renderPrompt(assetId, image.id, options)
      setPromptPreviewDraft(rendered.prompt)
      setPromptAudit(rendered.audit)
      setPromptPreviewRefFileIds(rendered.images)
      setPromptNeedsRefresh(false)
    } catch {
      message.error('获取提示词失败，请检查资产设定和模板')
    } finally {
      setPromptPreviewLoading(false)
    }
  }

  /** 打开槽位预览，每次从已保存的资产和推荐参考图开始。 */
  const openPromptPreview = async (image: TImage) => {
    if (!assetId) return
    if (hasUnsavedChanges) {
      message.warning('请先保存资产设定，再预览生成提示词')
      return
    }
    setPromptPreviewOpen(true)
    setPromptPreviewImage(image)
    setPromptOptions({})
    setPromptPreviewDraft('')
    setPromptPreviewRefFileIds([])
    await refreshPromptPreview(image, {})
  }

  const confirmGenerateWithPrompt = async () => {
    if (!assetId || !promptPreviewImage || promptNeedsRefresh || promptPreviewLoading) return
    const prompt = (promptPreviewDraft || '').trim()
    if (!prompt) {
      message.warning('请输入提示词')
      return
    }

    setGeneratingByImageId((prev) => ({ ...prev, [promptPreviewImage.id]: true }))
    try {
      const taskId = await createGenerationTask(assetId, promptPreviewImage.id, { prompt, images: promptPreviewRefFileIds, saveAsCandidate: promptOptions.mode === 'edit', audit: promptAudit })
      if (!taskId) {
        message.error('生成任务创建失败：缺少任务 ID')
        return
      }
      setGenerationTask({
        taskId,
        status: 'queued',
        progress: 0,
        cancelRequested: false,
      })
      setGenerationSettledTask(null)

      let finalStatus: TaskStatus = 'queued'
      let finalTaskState: RelationTaskState | null = null
      for (let i = 0; i < 30; i += 1) {
        await sleep(2000)
        const statusRes = await FilmService.getTaskStatusApiV1FilmTasksTaskIdStatusGet({ taskId })
        const status = statusRes.data?.status
        if (!status) continue
        finalStatus = status
        if (statusRes.data) {
          finalTaskState = toRelationTaskStateFromStatusRead(statusRes.data)
          setGenerationTask(finalTaskState)
        }
        if (isTerminalStatus(status)) break
      }
      if (finalTaskState && isTerminalStatus(finalTaskState.status)) {
        setGenerationTask(null)
        setGenerationSettledTask(finalTaskState)
      }

      if (finalStatus === 'succeeded') {
        setPromptPreviewOpen(false)
        setPromptPreviewImage(null)
        await loadData()
      } else if (finalStatus !== 'failed' && finalStatus !== 'cancelled') {
        message.warning('生成任务仍在执行，请稍后刷新')
      }
    } catch {
      message.error('发起生成失败')
    } finally {
      setGeneratingByImageId((prev) => ({ ...prev, [promptPreviewImage.id]: false }))
    }
  }

  const openHistoryModal = async (targetImage: TImage) => {
    setEditingSlotImage(targetImage)
    setHistoryOpen(true)
    setHistoryLoading(true)

    try {
      const outputs: TaskOutputHistoryRead[] = []
      let cursor: string | null = null
      do {
        const response = await FilmService.listTaskOutputsApiV1FilmTasksOutputsGet({
          targetType: `${relationType}_slot`, targetId: String(targetImage.id), cursor,
        })
        if (!response.data) throw new Error('图片历史响应缺少数据')
        outputs.push(...response.data.items)
        cursor = response.data.next_cursor ?? null
      } while (cursor)
      const imagesByFileId = new Map<string, TImage>()
      images.forEach((img) => {
        if (img.file_id) {
          imagesByFileId.set(img.file_id, img)
        }
      })

      const seenFileIds = new Set<string>()
      const taskOutputCandidates: HistoryCandidate<TImage>[] = outputs
        .filter((link) => Boolean(link.file_id))
        .map((link) => {
          const fileId = String(link.file_id)
          const matchedImage = imagesByFileId.get(fileId)
          return {
            id: `${link.task_id}:${link.ordinal}`,
            file_id: fileId,
            view_angle: matchedImage?.view_angle ?? targetImage.view_angle,
            width: matchedImage?.width ?? null,
            height: matchedImage?.height ?? null,
            format: matchedImage?.format ?? null,
            source: 'task-output' as const,
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

      setHistoryCandidates(taskOutputCandidates.length > 0 ? taskOutputCandidates : fallbackCandidates)
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

  if (!assetId) {
    return (
      <Card>
        <Empty description={missingAssetIdText} />
      </Card>
    )
  }

  return (
    <div className="asset-dossier">
      <div className="asset-dossier-toolbar">
        <Button type="text" aria-label={embedded ? '返回本场资产' : undefined} icon={<ArrowLeftOutlined />} disabled={savingBase || smartDetectBusy} onClick={returnFromAsset}>
          {embedded ? '返回本场资产' : `返回${assetDisplayName}资产`}
        </Button>
        <div className="asset-dossier-toolbar-actions">
          {embedded && !images.length && <Button disabled={loading || hasUnsavedChanges || savingBase} onClick={async () => { setSavingBase(true); try { setImages(await ensureImageSlots(clampViewCount(formViewCount))) } catch { message.error('图片视角准备失败，可重试') } finally { setSavingBase(false) } }}>准备图片视角</Button>}
          <span className={hasUnsavedChanges ? 'text-sm text-amber-600' : 'text-sm text-gray-500'} role="status">
            {loading ? '加载中' : hasUnsavedChanges ? '有未保存的修改' : '已保存'}
          </span>
          <Button icon={<ReloadOutlined />} onClick={() => void loadData()} loading={loading}
            disabled={savingBase || smartDetectBusy || hasUnsavedChanges}>
            刷新
          </Button>
          <Button type="primary" onClick={() => void handleSaveBaseInfo()} loading={savingBase}
            disabled={loading || smartDetectBusy || !hasUnsavedChanges}>
            保存资产
          </Button>
        </div>
      </div>

      <div className="asset-dossier-body">
        <div className="asset-dossier-sheet">
          {loading ? (
            <div className="py-8 text-center"><Spin /></div>
          ) : (
            <>
              <div className="asset-dossier-overview" data-asset-type={structuredType ?? 'character'}>
                <div className="min-w-0">
                  <div className="text-sm text-gray-500">{assetDisplayName}档案</div>
                  <h1 className="asset-dossier-name">{asset?.name || `${assetDisplayName}资产`}</h1>
                  <div className="space-y-4">
                    <div className="asset-dossier-fields">
                      <label className="block min-w-0 text-sm text-gray-600">
                        名称
                        <Input className="mt-1" value={formName} onChange={(e) => setFormName(e.target.value)}
                          disabled={smartDetectBusy || savingBase} />
                      </label>
                      {structuredType ? (
                        <label className="block min-w-0 text-sm text-gray-600">
                          标签
                          <Input className="mt-1" placeholder="多个标签用逗号分隔" value={formTags}
                            onChange={(e) => setFormTags(e.target.value)} disabled={smartDetectBusy || savingBase} />
                        </label>
                      ) : null}
                    </div>
                    {structuredType ? <AssetFactsFields type={structuredType} section="overview" value={formFacts}
                      onChange={setFormFacts} supplementaryInfo={formDesc} disabled={smartDetectBusy || savingBase} /> : null}
                  </div>
                  {asset?.id ? (
                    <details className="mt-4 text-xs text-gray-500">
                      <summary className="cursor-pointer">资产编号</summary>
                      <Typography.Text className="break-all" type="secondary" copyable>{asset.id}</Typography.Text>
                    </details>
                  ) : null}
                </div>
                <figure className="m-0 min-w-0">
                  <div className="asset-dossier-cover">
                    <AssetDossierImage src={selectedSlot?.imageUrl}
                      alt={`${asset?.name ?? assetDisplayName} · ${ANGLE_LABEL_MAP[selectedSlot?.angle ?? 'FRONT']}`} preview />
                  </div>
                  <figcaption className="mt-2 text-center text-sm text-gray-500">
                    {ANGLE_LABEL_MAP[selectedSlot?.angle ?? 'FRONT']} · {selectedSlot?.imageUrl ? '点击图片放大' : '等待生成'}
                  </figcaption>
                </figure>
              </div>

              <AssetDossierSection title={structuredType === 'actor' ? '外貌设定' : `${assetDisplayName}设定`}>
                <div className="space-y-4">
                  {structuredType ? <AssetFactsFields type={structuredType} section="details" value={formFacts}
                    onChange={setFormFacts} supplementaryInfo={formDesc} disabled={smartDetectBusy || savingBase} /> : null}
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                      <label htmlFor="asset-dossier-description" className="text-gray-600 text-sm">
                        {structuredType ? '补充描述' : '角色描述'}
                      </label>
                      {structuredType ? (
                        <div className="flex flex-wrap gap-2">
                          <Button size="small" onClick={() => void handleSmartDetectMissing()}
                            loading={smartDetectLoading} disabled={loading || savingBase || !!smartDetectTask}>
                            {smartDetectTask ? '检测中' : '智能检测'}
                          </Button>
                          {smartDetectTask ? (
                            <Button size="small" danger icon={<CloseCircleOutlined />} disabled={smartDetectTask.cancelRequested}
                              onClick={() => void handleCancelSmartDetectTask()}>
                              {smartDetectTask.cancelRequested ? '正在取消' : '取消检测'}
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <Input.TextArea id="asset-dossier-description" autoSize={{ minRows: 2, maxRows: 8 }} value={formDesc}
                      maxLength={structuredType ? 8000 : undefined} onChange={(e) => setFormDesc(e.target.value)}
                      disabled={smartDetectBusy || savingBase} />
                  </div>
                  {structuredType ? (
                    <details className="text-sm text-gray-500">
                      <summary className="cursor-pointer">完整描述预览</summary>
                      <div className="whitespace-pre-wrap break-words mt-2">
                        {previewAssetDescription(structuredType, formFacts, formDesc) || '尚未填写设定'}
                      </div>
                    </details>
                  ) : null}
                </div>
              </AssetDossierSection>

              <AssetDossierSection title="生成风格">
                <ProjectVisualStyleAndStyleFields layout="horizontal" disabled={smartDetectBusy || savingBase}
                  visual_style={formVisualStyle} style={formStyle} options={projectStyleOptions}
                  onChange={(next) => {
                    setFormVisualStyle(next.visual_style)
                    setFormStyle(next.style)
                  }} />
              </AssetDossierSection>

              <AssetDossierSection title="多视角图片">
                <div className="space-y-4">
                  {structuredType ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <label htmlFor="asset-dossier-view-count" className="text-sm text-gray-600">视角数</label>
                      <InputNumber id="asset-dossier-view-count" min={minViewCount} max={MAX_VIEW_COUNT} precision={0}
                        value={formViewCount} onChange={(v) => setFormViewCount(v ?? minViewCount)}
                        disabled={smartDetectBusy || savingBase} />
                      <span className="text-xs text-gray-500">仅可增加，最多 {MAX_VIEW_COUNT} 个；保存后生效</span>
                    </div>
                  ) : null}
                  <div className="asset-dossier-view-list" aria-label="图片视角">
                    {slotItems.map((slot) => (
                      <button type="button" key={slot.angle} className="asset-dossier-view"
                        aria-label={`切换到${ANGLE_LABEL_MAP[slot.angle]}视角`}
                        aria-pressed={slot.angle === selectedSlot?.angle} onClick={() => setSelectedAngle(slot.angle)}>
                        <span className="asset-dossier-view-image">
                          <AssetDossierImage src={slot.imageUrl} alt={ANGLE_LABEL_MAP[slot.angle]} />
                        </span>
                        {ANGLE_LABEL_MAP[slot.angle]}{!slot.image ? ' · 待保存' : ''}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-gray-600 mr-1">当前：{ANGLE_LABEL_MAP[selectedSlot?.angle ?? 'FRONT']}</span>
                    <Button disabled={!selectedSlot?.imageUrl} onClick={() => setImagePreviewOpen(true)}>查看大图</Button>
                    <Button disabled={!selectedSlot?.image || savingBase || smartDetectBusy}
                      loading={Boolean(selectedSlot?.image && generatingByImageId[selectedSlot.image.id])}
                      onClick={() => selectedSlot?.image && void openPromptPreview(selectedSlot.image)}>
                      {selectedSlot?.imageUrl ? '重新生成' : '生成图片'}
                    </Button>
                    <Button icon={<EditOutlined />} disabled={!selectedSlot?.image || savingBase || hasUnsavedChanges}
                      onClick={() => selectedSlot?.image && void openHistoryModal(selectedSlot.image)}>
                      编辑图片
                    </Button>
                  </div>
                  {hasUnsavedChanges ? <div className="text-sm text-amber-600">请先保存资产，再生成或采用图片。</div> : null}
                </div>
              </AssetDossierSection>
            </>
          )}
        </div>
      </div>

      <Modal title={`${asset?.name ?? assetDisplayName} · ${ANGLE_LABEL_MAP[selectedSlot?.angle ?? 'FRONT']}`}
        open={imagePreviewOpen} onCancel={() => setImagePreviewOpen(false)} footer={null} width={960}>
        <div className="asset-dossier-preview">
          <AssetDossierImage src={selectedSlot?.imageUrl} alt={ANGLE_LABEL_MAP[selectedSlot?.angle ?? 'FRONT']} />
        </div>
      </Modal>

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
            {historyCandidates.map((candidate) => (
              <Col xs={24} sm={12} md={8} key={candidate.id}>
                <DisplayImageCard
                  title={candidate.view_angle ? `角度：${ANGLE_LABEL_MAP[candidate.view_angle] ?? candidate.view_angle}` : candidate.source === 'task-output' ? '任务产物' : `图片 ${candidate.id}`}
                  imageUrl={buildFileDownloadUrl(candidate.file_id)}
                  imageAlt={candidate.id}
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
        okButtonProps={{ disabled: promptNeedsRefresh || promptPreviewLoading || !promptPreviewDraft.trim() }}
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
            <div className="space-y-3">
              <div className="text-sm text-gray-600">调整本次展示方式</div>
              <Select value={promptOptions.mode ?? 'generate'} options={[{ value: 'generate', label: '生成资产图' }, { value: 'edit', label: '局部修改（结果保留为候选）' }]}
                onChange={(mode) => { setPromptOptions((current) => ({ ...current, mode, references: undefined })); setPromptNeedsRefresh(true) }} />
              {promptOptions.mode === 'edit' ? <div className="text-sm text-gray-500">使用当前槽位图片修改。生成后请到图片历史中查看并明确采用。</div> : null}
              {([
                ['framing_instruction', '构图'], ['background_instruction', '背景'],
                ['lighting_instruction', '灯光'], ['visible_detail_instruction', '细节强调'],
                ['negative_prompt', '排除内容'], ['additional_instruction', '本次附加要求'],
                ['edit_instruction', '修改对象与目标效果'], ['preserve_instruction', '保持不变的内容'],
              ] as const).filter(([key]) => promptOptions.mode === 'edit' || !['edit_instruction', 'preserve_instruction'].includes(key)).map(([key, label]) => (
                <label key={key} className="block text-sm text-gray-600">
                  {label}
                  <Input.TextArea autoSize={{ minRows: 1, maxRows: 3 }} value={promptOptions[key] ?? ''}
                    placeholder="留空使用已保存的展示设置" maxLength={key === 'additional_instruction' ? 4000 : 2000}
                    onChange={(event) => {
                      setPromptOptions((current) => ({ ...current, [key]: event.target.value || undefined }))
                      setPromptNeedsRefresh(true)
                    }} />
                </label>
              ))}
              <AssetReferencePicker value={promptOptions.references} onChange={(references) => { setPromptOptions((current) => ({ ...current, references })); setPromptNeedsRefresh(true) }} />
              <Space>
                <Button type="primary" onClick={() => promptPreviewImage && void refreshPromptPreview(promptPreviewImage, promptOptions)}>更新预览</Button>
              </Space>
              {promptNeedsRefresh ? <div className="text-sm text-amber-600">展示要求已修改，请更新预览后生成。</div> : null}
            </div>
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
              <div className="text-xs text-gray-500 mb-2">最终提示词（只读；通过展示要求调整）</div>
              <Input.TextArea
                rows={10}
                value={promptPreviewDraft}
                readOnly
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
                <div className="text-sm text-gray-600">发现 {smartDetectIssues.length} 项可能缺失信息（请比较下方字段建议）：</div>
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

            {smartDetectBaseline !== currentFactsSnapshot ? (
              <div className="text-sm text-amber-600">
                资产设定已变化或本次分析来自恢复的任务，请先核对当前值与建议。
                <Button size="small" onClick={() => setSmartDetectBaseline(currentFactsSnapshot)}>已重新比较当前设定</Button>
              </div>
            ) : null}
            {smartDetectSuggestions.map((suggestion) => {
              const field = structuredType ? ASSET_FIELDS[structuredType].find((item) => item.key === suggestion.field) : undefined
              const supplementary = suggestion.field === 'supplementary_info'
              if (!field && !supplementary) return null
              const current = supplementary ? formDesc : formFacts[suggestion.field as AssetFieldName] ?? ''
              return (
                <Card key={suggestion.field} size="small" title={field?.label ?? '补充信息'}>
                  <Tag color={suggestion.source === 'explicit' ? 'blue' : 'orange'}>{suggestion.source === 'explicit' ? '原文提取' : 'AI 推断，需确认'}</Tag>
                  <div className="text-sm whitespace-pre-wrap mt-2">当前：{current || '未填写'}</div>
                  <div className="text-sm whitespace-pre-wrap mt-2">建议：{suggestion.value}</div>
                  {suggestion.evidence ? <div className="text-xs text-gray-500 mt-2">原文依据：{suggestion.evidence}</div> : null}
                  <Button className="mt-2" size="small" disabled={smartDetectBaseline !== currentFactsSnapshot || current === suggestion.value}
                    onClick={() => {
                      const facts = supplementary ? formFacts : { ...formFacts, [suggestion.field]: suggestion.value }
                      const supplement = supplementary ? suggestion.value : formDesc
                      setFormFacts(facts)
                      setFormDesc(supplement)
                      setSmartDetectBaseline(JSON.stringify({ name: formName, facts, supplement }))
                      message.success('已采用到表单，保存后生效')
                    }}>明确采用此项</Button>
                </Card>
              )
            })}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setSmartDetectOpen(false)}>关闭</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
