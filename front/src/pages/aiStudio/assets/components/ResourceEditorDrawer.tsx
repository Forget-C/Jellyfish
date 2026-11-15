import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { InputRef } from 'antd'
import { Alert, Button, Collapse, Input, Image, Checkbox, Tag, Space, Tabs, Modal, Select } from 'antd'
import { LlmService, FilmService, StudioProjectsService, StudioEntitiesService, StudioGenerationPromptsService, type AssetViewAngle, type DraftAssetPromptRenderBody, type RenderedPromptSnapshot, type AssetPromptReference, type AssetImagePromptRenderBody, type TaskOutputHistoryRead } from '../../../../services/generated'
import { StudioEntitiesApi } from '../../../../services/studioEntities'
import { ProjectVisualStyleAndStyleFields } from '../../project/ProjectVisualStyleAndStyleFields'
import { useProjectStyleOptions } from '../../project/useProjectStyleOptions'
import { AssetDetailLeaveGuard } from './AssetDetailLeaveGuard'
import { ASSET_FIELDS, OVERVIEW_FIELDS, AssetFactsFields, pickAssetFacts, type AssetFacts } from './AssetFactsFields'
import { ResourceReferencePage } from './ResourceReferencePage'
import { buildFileDownloadUrl } from '../utils'
import { readResourceImages } from '../resourceImages'
import { assetAdapters } from '../assetAdapters'
import { useWorkspaceDraft, useWorkspaceDraftStatus } from '../../directing/WorkspaceDrafts'
import { directingError } from '../../directing/common'
import { ResourceAnalysis } from './ResourceAnalysis'
import { useTaskUiStore } from '../../components/taskUiStore'
import { ResourceImage } from './ResourceImage'
import { ResourceEditorFrame } from './ResourceEditorFrame'
import { AssetGenerationDialog } from './AssetGenerationDialog'
import { AssetFields, AssetPictures, AssetDetailLayout, CharacterFields } from './AssetDetailPanels'
import './resourceEditor.css'

export type ResourceKind = 'actor' | 'character' | 'scene' | 'prop' | 'costume'
const angles = [{ value: 'FRONT', label: '正面' }, { value: 'LEFT', label: '侧面' }, { value: 'TOP', label: '俯视' }, { value: 'BACK', label: '背面' }] as const
type Angle = AssetViewAngle
const labels: Record<ResourceKind, string> = { actor: '演员', character: '角色', scene: '场景', prop: '道具', costume: '服装' }
const displayFields = [
  ['framing_instruction', '构图'], ['background_instruction', '背景'], ['lighting_instruction', '灯光'],
  ['visible_detail_instruction', '细节强调'], ['negative_prompt', '排除内容'],
] as const

type Picture = { id: number; file_id?: string | null; view_angle?: string; is_primary?: boolean; is_view_default?: boolean }
type GenerationState = { taskId?: string; status: string; error?: string; slotId?: number; candidate?: boolean; originalFile?: string }
export type Resource = AssetFacts & { id: string; name: string; description?: string; references?: AssetPromptReference[]; project_id?: string | null; source_character_id?: string | null; library_copy_id?: string | null; origin?: string; source_kind?: string | null; source_id?: string | null }
type Props = {
  inline?: boolean; renderToolbar?: (children: ReactNode) => ReactNode
  open: boolean; kind: ResourceKind; projectId?: string; assetId?: string; initialPage?: 'editor' | 'publish'
  seed?: { name?: string; description?: string; visual_style?: '现实' | '动漫'; style?: string }
  onClose: () => void; onSaved?: (resource: Resource) => void | Promise<void>
}

/** 新建和详情共用对象草稿，生成设置只保留在本次打开的编辑器内。 */
export function ResourceEditorDrawer({ open, kind, projectId, assetId, seed, onClose, onSaved, initialPage = 'editor', inline, renderToolbar }: Props) {
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches)
  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)')
    const changed = () => setMobile(query.matches)
    query.addEventListener('change', changed)
    return () => query.removeEventListener('change', changed)
  }, [])
  const { options, defaultVisualStyle, getDefaultStyle } = useProjectStyleOptions()
  const [loadFailed, setLoadFailed] = useState(false)
  const [loadRetry, setLoadRetry] = useState(0)
  const initialOptions = useRef({ seed, defaultVisualStyle, getDefaultStyle })
  initialOptions.current = { seed, defaultVisualStyle, getDefaultStyle }
  const serverTasks = useTaskUiStore(state => state.serverItems)
  const [resource, setResource] = useState<Resource>()
  const imageBased = !!resource?.origin && resource.origin !== 'created'
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [facts, setFacts] = useState<AssetFacts>({})
  const [visualStyle, setVisualStyle] = useState<'现实' | '动漫'>('现实')
  const [style, setStyle] = useState('真人都市')
  const nameInput = useRef<InputRef>(null)
  const sectionScroll = useRef<Record<string, number>>({})
  const [section, setSection] = useState('settings')
  const [page, setPage] = useState<'editor' | 'generation' | 'references' | 'adopt' | 'publish'>(initialPage)
  const isDrawer = !assetId || initialPage === 'publish' && page === 'publish'
  const drawerId = useId()
  const fullDetail = !!assetId && !inline && initialPage === 'editor'
  const [detailCompact, setDetailCompact] = useState(() => window.matchMedia('(max-width:1199px), (max-height:739px)').matches)
  useEffect(() => {
    if (!fullDetail || !open || page === 'publish') return
    const body = document.getElementById(drawerId)?.querySelector<HTMLElement>('.resource-editor-body')
    if (!body) return
    const container = body.closest<HTMLElement>('.project-workbench-content')
    const update = () => {
      if (container) {
        const available = Math.max(0, container.getBoundingClientRect().bottom - body.getBoundingClientRect().top - parseFloat(getComputedStyle(container).paddingBottom))
        body.style.height = `${available}px`
        setDetailCompact(container.clientWidth < 960 || available < 600)
      } else setDetailCompact(window.innerWidth < 1200 || window.innerHeight < 740)
    }
    const observer = new ResizeObserver(update)
    observer.observe(container ?? document.documentElement)
    const toolbar = document.querySelector('.project-content-toolbar')
    if (toolbar) observer.observe(toolbar)
    window.addEventListener('resize', update); update()
    return () => { observer.disconnect(); window.removeEventListener('resize', update); body.style.height = '' }
  }, [fullDetail, open, drawerId, assetId, kind, page])
  const [imageModels, setImageModels] = useState<{id:string;name:string}[]>([])
  const [selectedModel, setSelectedModel] = useState<string>()
  const [modelsFailed, setModelsFailed] = useState(false)
  const [references, setReferences] = useState<AssetPromptReference[]>([])
  const [purpose, setPurpose] = useState<'subject' | 'costume' | 'prop'>('subject')
  const [pickerReturn, setPickerReturn] = useState<'editor' | 'generation'>('editor')
  const [publishName, setPublishName] = useState('')
  const [adoptionIndex, setAdoptionIndex] = useState<number>()
  const [generation, setGeneration] = useState<AssetImagePromptRenderBody>({})
  const acceptedAngles = useRef(new Set<Angle>())
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const [readonlyOpen, setReadonlyOpen] = useState(false)
  const normalGenerationConfig = useRef<AssetImagePromptRenderBody>({})
  const [editingGeneration, setEditingGeneration] = useState<AssetImagePromptRenderBody>({})
  const [editingAngles, setEditingAngles] = useState<Angle[]>(['FRONT'])
  useEffect(() => { if (fullDetail && editingGeneration.mode !== 'edit') normalGenerationConfig.current = editingGeneration }, [fullDetail, editingGeneration])
  const loadEpoch = useRef(0)
  const [selectedAngles, setSelectedAngles] = useState<Angle[]>(['FRONT'])
  const [modelName, setModelName] = useState('读取中')
  const [modelRetry, setModelRetry] = useState(0)
  const [showPreview, setShowPreview] = useState(false)
  const [previews, setPreviews] = useState<Partial<Record<Angle, RenderedPromptSnapshot>>>({})
  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [previewRetry, setPreviewRetry] = useState(0)
  const [editingImage, setEditingImage] = useState<Picture>()
  const [candidates, setCandidates] = useState<{ fileId: string; angle: Angle; originalFile?: string }[]>([])
  const [images, setImages] = useState<Picture[]>([])
  const [imageError, setImageError] = useState('')
  const [browsingAngle, setBrowsingAngle] = useState('FRONT')
  const [tasks, setTasks] = useState<Partial<Record<Angle, GenerationState>>>({})
  const [generating, setGenerating] = useState(false)
  const generationLock = useRef(false)
  const savedResource = useRef<Resource>()
  const [baseline, setBaseline] = useState('')
  const [analysisBusy, setAnalysisBusy] = useState(false)
  const [analysisCancelling, setAnalysisCancelling] = useState(false)
  const analysisCancel = useRef<() => Promise<boolean>>(async () => false)
  const onAnalysisState = useCallback((state: { busy: boolean; cancelling: boolean; cancel: () => Promise<boolean> }) => {
    setAnalysisBusy(state.busy); setAnalysisCancelling(state.cancelling); analysisCancel.current = state.cancel
  }, [])
  const [busy, setBusy] = useState(false)
  const [followupPending, setFollowupPending] = useState(false)
  const [error, setError] = useState('')
  const [closeRequested, setCloseRequested] = useState(false)
  const lock = useRef(false)
  const draftId = useRef(crypto.randomUUID())
  const title = resource?.name ?? (assetId ? `${labels[kind]}详情` : `新建${labels[kind]}`)
  // 当前 rc-drawer 版本不透传 aria-label，给实际 dialog 补齐可访问名称。
  useEffect(() => { document.getElementById(drawerId)?.setAttribute('aria-label', title) }, [drawerId, title])
  const payload = useMemo(() => imageBased ? { name: name.trim() } : ({ name: name.trim(), ...(kind === 'character' ? { description } : { ...facts, supplementary_info: description }),
    visual_style: visualStyle, style, references }), [name, description, facts, visualStyle, style, kind, references, imageBased])
  useEffect(() => {
    if (!open || page !== 'generation' || !showPreview) return
    let active = true
    setPreviewBusy(true); setPreviewError('')
    const timer = window.setTimeout(() => {
      const requested = editingGeneration.mode === 'edit' && editingImage ? [editingImage.view_angle as Angle] : editingAngles.length ? editingAngles : ['FRONT'] as Angle[]
      void Promise.all(requested.map(async angle => {
        const response = await StudioGenerationPromptsService.renderDraftAssetImagePromptApiV1StudioGenerationPromptsAssetsDraftRenderPost({ requestBody: {
          ...editingGeneration, asset_type: kind, view_angle: angle,
          ...(editingGeneration.mode === 'edit' && editingImage ? { image_id: editingImage.id } : {}),
          resource: { id: resource?.id ?? draftId.current, ...payload, ...((resource ? resource.project_id : projectId) ? { project_id: resource ? resource.project_id : projectId } : {}) } as DraftAssetPromptRenderBody['resource'],
        } })
        if (!response.data) throw new Error('预览结果缺失')
        return [angle, response.data] as const
      })).then(entries => { if (active) setPreviews(Object.fromEntries(entries)) })
        .catch(() => { if (active) setPreviewError('预览更新失败，输入已保留；生成时会重新校验最新输入') })
        .finally(() => { if (active) setPreviewBusy(false) })
    }, 300)
    return () => { active = false; window.clearTimeout(timer) }
  }, [open, page, showPreview, payload, editingGeneration, editingAngles, editingImage, previewRetry, kind, projectId, resource])
  const readOnly = !!resource?.source_character_id || !!projectId && !!resource && resource.project_id !== projectId
  useEffect(() => {
    if (!open || page !== 'generation') return
    let active = true
    setModelName('读取中')
    void LlmService.getModelSettingsApiV1LlmModelSettingsGet().then(async response => {
      const id = response.data?.default_image_model_id
      if (!id) { if (active) setModelName('尚未配置'); return }
      const model = await LlmService.getModelApiV1LlmModelsModelIdGet({ modelId: id })
      if (active) setModelName(model.data?.name ?? '模型名称不可用')
    }).catch(() => { if (active) setModelName('读取失败') })
    return () => { active = false }
  }, [open, page, modelRetry])
  useEffect(() => {
    if (!fullDetail || !open) return
    let active = true
    setSelectedModel(undefined); setImageModels([]); setModelsFailed(false)
    void Promise.all([LlmService.getModelSettingsApiV1LlmModelSettingsGet(), LlmService.listModelsApiV1LlmModelsGet({ category: 'image', page: 1, pageSize: 100 })])
      .then(([settings, models]) => { if (active) { setImageModels(models.data?.items ?? []); setSelectedModel(settings.data?.default_image_model_id ?? undefined) } })
      .catch(() => { if (active) setModelsFailed(true) })
    return () => { active = false }
  }, [fullDetail, open, projectId, kind, assetId, modelRetry])
  const serialized = JSON.stringify(payload)
  const dirty = !!baseline && serialized !== baseline

  useEffect(() => {
    if (!open) return
    let active = true
    const epoch = ++loadEpoch.current
    const { seed, defaultVisualStyle, getDefaultStyle } = initialOptions.current
    setBusy(true); lock.current = true; setLoadFailed(false); setFollowupPending(false)
    draftId.current = crypto.randomUUID()
    normalGenerationConfig.current = {}
    acceptedAngles.current.clear()
    setAnalysisOpen(false)
    setBaseline(''); setName(''); setDescription(''); setFacts({}); setReferences([]);
    setResource(undefined); savedResource.current = undefined; setImages([]); setCandidates([]); setEditingImage(undefined); setTasks({}); setGeneration({}); setEditingGeneration({}); setEditingAngles(['FRONT']); setShowPreview(false); setSelectedAngles(['FRONT']); setPage(initialPage); setError(''); setCloseRequested(false)
    const initialVisual = seed?.visual_style ?? defaultVisualStyle as '现实' | '动漫'
    const initial = { name: seed?.name ?? '', description: seed?.description ?? '', visualStyle: initialVisual,
      style: seed?.style ?? getDefaultStyle(initialVisual), facts: {} as AssetFacts, references: [] as AssetPromptReference[] }
    const load = async () => {
      if (projectId) {
        try {
          const response = await StudioProjectsService.getProjectApiV1StudioProjectsProjectIdGet({ projectId })
          if (response.data) {
            initial.visualStyle = seed?.visual_style ?? response.data.visual_style ?? initial.visualStyle
            initial.style = seed?.style ?? response.data.style
          }
        } catch { /* 项目默认值不可读时保留可编辑的当前默认值，保存仍会验证项目。 */ }
      }
      if (assetId) {
        const response = await StudioEntitiesApi.get(kind, assetId)
        if (!active) return
        const value = response.data as Resource & { visual_style: '现实' | '动漫'; style: string }
        setResource(value); savedResource.current = value
        initial.references = value.references ?? []
        initial.name = value.name; initial.description = String(kind === 'character' ? value.description ?? '' : value.supplementary_info ?? '')
        if (!value.origin || value.origin === 'created') { initial.visualStyle = value.visual_style; initial.style = value.style }
        initial.facts = kind === 'character' ? {} : pickAssetFacts(kind, value)
      }
      if (!active) return
      setReferences(initial.references)
      setPublishName(initial.name)
      setName(initial.name); setDescription(initial.description); setFacts(initial.facts)
      setVisualStyle(initial.visualStyle); setStyle(initial.style)
      setBaseline(JSON.stringify(assetId && savedResource.current?.origin && savedResource.current.origin !== 'created' ? { name: initial.name.trim() } : { name: initial.name.trim(), ...(kind === 'character' ? { description: initial.description }
        : { ...initial.facts, supplementary_info: initial.description }), visual_style: initial.visualStyle, style: initial.style, references: initial.references }))
    }
    void load().catch(() => { if (active) { setLoadFailed(true); setError('读取对象失败，输入已保留，请重试') } })
      .finally(() => { if (active) { setBusy(false); lock.current = false } })
    return () => { active = false; loadEpoch.current = epoch + 1 }
  }, [open, assetId, kind, initialPage, projectId, loadRetry])

  const save = async (adoptReference?: AssetPromptReference) => {
    if (lock.current || loadFailed || readOnly || analysisBusy) return false
    if (!payload.name) { setSection('settings'); setError('请输入名称'); requestAnimationFrame(() => nameInput.current?.focus()); return false }
    lock.current = true; setBusy(true); setError('')
    try {
      let response
      if (resource) response = await StudioEntitiesApi.update(kind, resource.id, payload)
      else {
        try { response = await StudioEntitiesApi.create(kind, { id: draftId.current, ...payload,
          ...(projectId ? { project_id: projectId } : {}), ...(adoptReference ? { adopt_reference: adoptReference } : {}) }) }
        catch (cause) {
          let existing
          try { existing = await StudioEntitiesApi.get(kind, draftId.current) } catch { throw cause }
          if (!existing.data || (existing.data.project_id ?? undefined) !== projectId) throw cause
          response = await StudioEntitiesApi.update(kind, draftId.current, payload)
          if (adoptReference) await StudioEntitiesService.adoptEntityReferenceMainApiV1StudioEntitiesEntityTypeEntityIdAdoptReferenceMainPost({
            entityType: kind, entityId: draftId.current, requestBody: { reference: adoptReference },
          })
        }
      }
      if (resource && adoptReference) {
        await StudioEntitiesService.adoptEntityReferenceMainApiV1StudioEntitiesEntityTypeEntityIdAdoptReferenceMainPost({
          entityType: kind, entityId: resource.id, requestBody: { reference: adoptReference },
        })
        await reloadImages(resource.id)
      }
      if (!response.data) throw new Error('对象保存失败')
      const next = response.data as Resource
      setResource(next); savedResource.current = next; setBaseline(serialized); setPage('editor')
      try { await onSaved?.(next); setFollowupPending(false) }
      catch { setFollowupPending(true); setError('对象已保存，但场次关联或列表刷新未完成；请重试保存，不会重复创建对象'); return false }
      return true
    } catch (cause) { setError(directingError(cause)); return false }
    finally { lock.current = false; setBusy(false) }
  }
  const draftHost = useWorkspaceDraftStatus()
  useWorkspaceDraft({ name: `${labels[kind]}档案`, dirty: open && dirty && !readOnly,
    busy: open && (busy || generating || analysisBusy), save,
    discard: () => {
      if (!baseline) return
      const saved = JSON.parse(baseline)
      if (imageBased) { setName(saved.name); return }
      setName(saved.name); setDescription(kind === 'character' ? saved.description : saved.supplementary_info)
      setFacts(kind === 'character' ? {} : pickAssetFacts(kind, saved)); setReferences(saved.references ?? [])
      setVisualStyle(saved.visual_style); setStyle(saved.style)
    },
  })
  const reloadImages = useCallback(async (id: string) => {
    const epoch = loadEpoch.current
    try {
      const rows = await readResourceImages(kind, id)
      if (epoch === loadEpoch.current && savedResource.current?.id === id) { setImages(rows); setImageError('') }
    } catch { if (epoch === loadEpoch.current && savedResource.current?.id === id) setImageError('读取图片失败，档案输入已保留') }
  }, [kind])
  useEffect(() => { if (open && resource?.id) void reloadImages(resource.id) }, [open, resource?.id, reloadImages])
  useEffect(() => {
    if (!open || !resource?.id || !images.length) return
    const matching = Object.values(serverTasks).filter(task => ['queued', 'running'].includes(task.status)
      && task.target_type === `${kind}_image_slot` && images.some(image => String(image.id) === task.target_id))
    if (!matching.length) return
    setTasks(current => {
      const next = { ...current }
      for (const task of matching) {
        const image = images.find(image => String(image.id) === task.target_id)!
        const angle = image.view_angle as Angle
        if (!next[angle]?.taskId) next[angle] = { taskId: task.task_id, status: task.status, slotId: image.id, candidate: true, originalFile: image.file_id ?? undefined }
      }
      return next
    })
  }, [open, resource?.id, images, serverTasks, kind])
  const loadCandidates = useCallback(async (id: string, slotId: number, angle: Angle, originalFile?: string, taskId?: string) => {
    try {
      const entries: TaskOutputHistoryRead[] = []
      let cursor: string | undefined
      do {
        const response = await FilmService.listTaskOutputsApiV1FilmTasksOutputsGet({ targetType: `${kind}_image_slot`, targetId: String(slotId), cursor })
        entries.push(...(response.data?.items ?? []).filter(output => output.file_id && (!taskId || output.task_id === taskId)))
        const next = response.data?.next_cursor ?? undefined
        if (next === cursor) break
        cursor = next
      } while (cursor)
      if (savedResource.current?.id !== id) return
      setImageError('')
      setCandidates(current => [...current, ...entries.filter(entry => !current.some(candidate => candidate.fileId === entry.file_id))
        .map(entry => ({ fileId: entry.file_id!, angle, originalFile }))])
    } catch { setImageError(fullDetail ? '读取候选图片失败，请重试查看候选' : '读取候选图片失败，请从图片历史重试') }
  }, [kind, fullDetail])
  const taskState = useRef(tasks)
  taskState.current = tasks
  const activeTasks = Object.entries(tasks).filter(([, task]) => task?.taskId && ['queued', 'running'].includes(task.status))
  const activeTaskKey = activeTasks.map(([angle, task]) => `${angle}:${task!.taskId}`).join(',')
  useEffect(() => {
    if (!open || !activeTaskKey) return
    let active = true
    let polling = false
    const poll = async () => {
      if (polling) return
      polling = true
      try {
        await Promise.all(activeTaskKey.split(',').map(async entry => {
          const [angle, taskId] = entry.split(':')
          try {
            const canonical = useTaskUiStore.getState().serverItems[taskId]
            const status = canonical && !['queued', 'running'].includes(canonical.status) ? canonical.status
              : (await FilmService.getTaskStatusApiV1FilmTasksTaskIdStatusGet({ taskId })).data?.status
            if (!active || !status) return
            if (status === 'failed' || status === 'cancelled') acceptedAngles.current.delete(angle as Angle)
            setTasks(current => ({ ...current, [angle]: { ...current[angle as Angle], taskId, status, error: undefined } }))
            if (status === 'succeeded' && savedResource.current) {
              const info = taskState.current[angle as Angle]
              if (info?.candidate && info.slotId) await loadCandidates(savedResource.current.id, info.slotId, angle as Angle, info.originalFile, taskId)
              await reloadImages(savedResource.current.id)
            }
          } catch {
            if (active) setTasks(current => ({ ...current, [angle]: { ...current[angle as Angle]!, error: '读取任务状态失败，正在重试' } }))
          }
        }))
      } finally { polling = false }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 2000)
    return () => { active = false; window.clearInterval(timer) }
  }, [open, activeTaskKey, reloadImages, loadCandidates])
  const generate = async (requested?: Angle[], config = generation) => {
    if (generationLock.current || readOnly || analysisBusy) return
    generationLock.current = true; setGenerating(true); setError('')
    try {
      if ((!resource || dirty || followupPending) && !await save()) return
      const target = savedResource.current
      if (!target) return
      const editing = config.mode === 'edit'
      if (editing && (!editingImage?.file_id || !config.edit_instruction?.trim())) { setError('请选择一张图片并填写修改要求'); return }
      const desired = editing ? [editingImage!.view_angle as Angle] : requested?.length ? requested : requested ? ['FRONT'] as Angle[] : selectedAngles.length ? selectedAngles : ['FRONT'] as Angle[]
      const selected = fullDetail ? desired.filter(angle => !acceptedAngles.current.has(angle)) : desired
      let accepted = 0
      for (const angle of selected) {
        setTasks(current => ({ ...current, [angle]: { status: 'submitting' } }))
        try {
          const slot = await StudioEntitiesApi.createImage(kind, target.id, { view_angle: angle })
          const slotId = Number(slot?.data?.id)
          if (!slotId) throw new Error('图片记录创建失败')
          const adapter = assetAdapters[kind]
          const rendered = await adapter.renderPrompt(target.id, slotId, config)
          const taskId = await adapter.createGenerationTask(target.id, slotId, { ...rendered,
            modelId: fullDetail ? selectedModel : undefined, references: config.references ?? references, saveAsCandidate: false })
          if (!taskId) throw new Error('任务未受理')
          accepted++
          if (fullDetail) acceptedAngles.current.add(angle)
          setTasks(current => ({ ...current, [angle]: { taskId, slotId, status: 'queued', candidate: false, originalFile: editingImage?.file_id ?? undefined } }))
        } catch { setTasks(current => ({ ...current, [angle]: { status: 'failed', error: '生成提交失败，设定已保存，可单独重试' } })) }
      }
      await reloadImages(target.id)
      if (fullDetail && accepted === selected.length) setPage('editor')
    } finally { generationLock.current = false; setGenerating(false) }
  }
  const setPrimary = async (image: Picture) => {
    if (!resource || dirty || busy || generating || readOnly || analysisBusy) return false
    setBusy(true); setImageError('')
    try { await StudioEntitiesApi.updateImage(kind, resource.id, image.id, { is_primary: true }); await reloadImages(resource.id); return true }
    catch { setImageError('设置主图失败，原主图已保留，请重试'); return false }
    finally { setBusy(false) }
  }
  const [savingViewDefault, setSavingViewDefault] = useState<number>()
  const setViewDefault = async (image: Picture) => {
    if (!resource || dirty || busy || generating || readOnly || analysisBusy) return
    const epoch = loadEpoch.current
    setBusy(true); setSavingViewDefault(image.id); setImageError('')
    try {
      await StudioEntitiesService.updateEntityImageApiV1StudioEntitiesEntityTypeEntityIdImagesImageIdPatch({
        entityType: kind, entityId: resource.id, imageId: image.id, requestBody: { is_view_default: true },
      })
      if (epoch !== loadEpoch.current) return
      setImages(current => current.map(item => item.view_angle === image.view_angle ? { ...item, is_view_default: item.id === image.id } : item))
      try { const rows = await readResourceImages(kind, resource.id); if (epoch === loadEpoch.current) setImages(rows) } catch { if (epoch === loadEpoch.current) setImageError('已保存视角默认图，图片列表刷新失败，请重试读取') }
    } catch { if (epoch === loadEpoch.current) setImageError('设置视角默认图未能确认，请重新读取图片后重试') }
    finally { if (epoch === loadEpoch.current) { setBusy(false); setSavingViewDefault(undefined) } }
  }
  const publish = async () => {
    if (!resource?.project_id || busy || dirty) return
    setBusy(true); setError('')
    try {
      const response = await StudioEntitiesService.publishEntityToLibraryApiV1StudioEntitiesEntityTypeEntityIdPublishToLibraryPost({
        entityType: kind, entityId: resource.id, requestBody: { name: publishName.trim() },
      })
      if (!response.data?.id) throw new Error('未能确认入库结果，请重试')
      const next = { ...resource, library_copy_id: String(response.data.id) }
      setResource(next); savedResource.current = next; setPage('editor'); await onSaved?.(next)
    } catch (cause) { setError(directingError(cause)) }
    finally { setBusy(false) }
  }
  const [referenceToolbar, setReferenceToolbar] = useState<HTMLDivElement | null>(null)
  const closing = useRef(false)
  const closeEditor = async () => {
    if (closing.current) return
    const id = resource?.id
    const content = document.getElementById(drawerId)
    const wrapper = isDrawer ? content?.closest<HTMLElement>('.ant-drawer-content-wrapper') : null
    if (wrapper && content && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      closing.current = true
      content.inert = true
      try {
        await wrapper.animate([{ transform: 'translateX(0)', opacity: 1 }, { transform: 'translateX(24px)', opacity: 0 }],
          { duration: 180, easing: 'ease-in', fill: 'forwards' }).finished
      } catch { /* 路由切换会卸载面板并取消动画。 */ }
      finally { closing.current = false; content.inert = false }
      if (!wrapper.isConnected) return
    }
    onClose()
    if (id) requestAnimationFrame(() => requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(`[data-project-asset-id="${CSS.escape(id)}"], a[href="${resourceAssetUrl(kind, id)}"]`)
      target?.focus({ preventScroll: true })
    }))
  }
  const close = () => {
    if (page === 'publish') { setPage('editor'); return }
    if (page === 'adopt') { setPage('editor'); return }
    if (page === 'references') { setPage(pickerReturn); return }
    if (page === 'generation') { setPage('editor'); return }
    if (busy || generating || analysisBusy || dirty) setCloseRequested(true)
    else closeEditor()
  }
  const settings = readOnly ? <div className="resource-editor-fields"><p>{resource?.name}</p>
    <dl>{kind !== 'character' && ASSET_FIELDS[kind].filter(field => facts[field.key]).map(field => <div key={field.key}><dt>{field.label}</dt><dd>{facts[field.key]}</dd></div>)}</dl>
    {description && <p style={{ whiteSpace: 'pre-wrap' }}>{description}</p>}<p>{visualStyle} · {style}</p>
  </div> : <div className="resource-editor-fields">
    <label>名称<Input ref={nameInput} disabled={busy || generating || analysisBusy || loadFailed} aria-label="名称" value={name} onChange={event => setName(event.target.value)} /></label>
    {kind !== 'character' && <AssetFactsFields section={!assetId ? 'overview' : 'all'} type={kind} disabled={imageBased || busy || generating || analysisBusy || loadFailed} value={facts} onChange={setFacts} supplementaryInfo={description} />}
    <label>{kind === 'character' ? '角色设定' : '补充信息'}<Input.TextArea disabled={imageBased || busy || generating || analysisBusy || loadFailed} aria-label={kind === 'character' ? '角色设定' : '补充信息'} rows={4}
      maxLength={8000} value={description} onChange={event => setDescription(event.target.value)} /></label>
    {resource && !imageBased && kind !== 'character' && <ResourceAnalysis kind={kind} id={resource.id} name={name} facts={facts} supplement={description} disabled={busy || generating}
      onApply={(nextFacts, nextDescription) => { setFacts(nextFacts); setDescription(nextDescription) }} onState={onAnalysisState} />}
    {!assetId && kind !== 'character' && <Collapse ghost items={[{ key: 'details', label: `详细设定 · ${ASSET_FIELDS[kind].filter(field => !OVERVIEW_FIELDS[kind].includes(field.key) && facts[field.key]?.trim()).length} 项已填写`, children: <AssetFactsFields section="details" type={kind} disabled={imageBased || busy || generating || analysisBusy || loadFailed} value={facts} onChange={setFacts} supplementaryInfo={description} /> }]} />}
    {assetId && <ProjectVisualStyleAndStyleFields disabled={imageBased || busy || generating || analysisBusy || loadFailed} visual_style={visualStyle} style={style} options={options}
      onChange={next => { setVisualStyle(next.visual_style); setStyle(next.style) }} />}
  </div>
  const referenceSection = (temporary = false) => {
    const current = temporary ? editingGeneration.references ?? references : references
    return <div className="resource-editor-fields">{!readOnly && <Space wrap>
      {(['subject', ...(kind === 'character' ? ['costume', 'prop'] : [])] as ('subject' | 'costume' | 'prop')[]).map(value =>
        <Button key={value} disabled={busy || generating || analysisBusy || loadFailed} onClick={() => { setPurpose(value); setPickerReturn(temporary ? 'generation' : 'editor'); setPage('references') }}>
          选择参考{value === 'subject' ? '主体' : value === 'costume' ? '服装' : '道具'}
        </Button>)}
    </Space>}{current.map((reference, index) => <Space key={`${reference.file_id}:${reference.role}:${index}`} wrap>
      <Image width={64} height={64} src={buildFileDownloadUrl(reference.file_id)} />
      <span>{reference.role === 'costume' ? '参考服装' : reference.role === 'prop' ? '参考道具' : '参考主体'}{reference.view_angle ? ` · ${angleLabel(reference.view_angle)}` : ' · 未标注视角'}</span>
      {!readOnly && <Button onClick={() => { const next = current.filter((_, i) => i !== index)
        if (temporary) setEditingGeneration(value => ({ ...value, references: next })); else setReferences(next)
      }}>移除参考图</Button>}
    </Space>)}{!temporary && resource && !readOnly && references.some(reference => !['costume', 'prop'].includes(reference.role)) && <Button disabled={dirty || busy || generating || analysisBusy} onClick={() => {
      const subjects = references.filter(reference => !['costume', 'prop'].includes(reference.role))
      setAdoptionIndex(subjects.length === 1 ? 0 : undefined); setPage('adopt')
    }}>不生成，采用主体图片</Button>}{temporary && <Button onClick={() => setEditingGeneration(value => ({ ...value, references: undefined }))}>恢复对象参考</Button>}</div>
  }
  const subjectImages = references.filter(reference => !['costume', 'prop'].includes(reference.role))
  const saveAndClose = async (reference?: AssetPromptReference) => {
    if (await save(reference)) await closeEditor()
  }
  const createOnly = () => {
    if (subjectImages.length && (!resource || JSON.stringify(references) !== JSON.stringify(JSON.parse(baseline || '{}').references ?? []))) {
      setAdoptionIndex(subjectImages.length === 1 ? 0 : undefined); setPage('adopt')
    } else if (!assetId) void saveAndClose()
    else void save()
  }
  const folderAngles = [...new Set([...angles.map(angle => angle.value), ...images.map(image => image.view_angle ?? 'FRONT')])]
  const angleLabel = (angle: string) => angles.find(value => value.value === angle)?.label ?? ({ RIGHT: '右侧', THREE_QUARTER: '3/4 侧面', DETAIL: '细节' } as Record<string, string>)[angle] ?? angle
  const pictures = <div className="resource-editor-fields">
    {imageError && <Alert type="error" message={imageError} action={resource && <Button onClick={() => void reloadImages(resource.id)}>重试读取图片</Button>} />}
    <Tabs activeKey={browsingAngle} onChange={setBrowsingAngle} items={folderAngles.map(angle => ({ key: angle, label: angleLabel(angle),
      children: <div className="resource-reference-grid">{images.filter(image => image.view_angle === angle && image.file_id).sort((a, b) => Number(!!b.is_view_default) - Number(!!a.is_view_default) || b.id - a.id).map((image, index) => <div key={image.id}>
        <ResourceImage key={image.file_id} src={buildFileDownloadUrl(image.file_id!)!} alt={`${angleLabel(angle)}图片 ${index + 1}`} />
        {!readOnly && <Space wrap><Button aria-label={`局部修改${angleLabel(angle)}图片 ${index + 1}`} disabled={busy || generating || analysisBusy || loadFailed} onClick={() => {
          setEditingImage(image); setEditingGeneration({ ...generation, mode: 'edit', references: [{ file_id: image.file_id!, role: 'design' }], edit_instruction: '' }); setPage('generation')
        }}>局部修改</Button><Button onClick={() => resource && void loadCandidates(resource.id, image.id, angle as Angle, image.file_id!)}>图片历史</Button></Space>}
        {image.is_view_default ? <Tag>视角默认</Tag> : !readOnly && <Button loading={savingViewDefault === image.id} disabled={dirty || busy || generating || analysisBusy} onClick={() => void setViewDefault(image)}>设为{angleLabel(angle)}默认图</Button>}
        {image.is_primary ? <Tag>主图</Tag> : !readOnly && <Button disabled={dirty || busy || generating} onClick={() => void setPrimary(image)}>设为主图</Button>}
      </div>)}{!images.some(image => image.view_angle === angle && image.file_id) && <p>当前视角暂无图片</p>}</div>,
    }))} />
    {candidates.filter(candidate => !images.some(image => image.file_id === candidate.fileId)).map(candidate => <div key={candidate.fileId} className="resource-editor-fields"><h3>修改候选 · {angleLabel(candidate.angle)}</h3><Space wrap>
      {candidate.originalFile && <Image width={160} src={buildFileDownloadUrl(candidate.originalFile)} alt="原图" />}
      <Image width={160} src={buildFileDownloadUrl(candidate.fileId)} alt="候选图片" />
      <Button disabled={busy || !resource || readOnly} onClick={async () => {
        if (!resource) return
        setBusy(true)
        try { await StudioEntitiesApi.createImage(kind, resource.id, { file_id: candidate.fileId, view_angle: candidate.angle }); await reloadImages(resource.id)
          setCandidates(current => current.filter(value => value.fileId !== candidate.fileId))
        } catch { setImageError('采用候选失败，请重试') } finally { setBusy(false) }
      }}>加入视角文件夹</Button>
    </Space></div>)}
    {dirty && resource && <p>对象设定尚未保存，请先保存再调整图片选择。</p>}
    {!readOnly && <div role="group" aria-label="本次生成角度">本次生成角度<Checkbox.Group options={[...angles]} value={selectedAngles} onChange={values => setSelectedAngles(values as Angle[])} /></div>}
    {!selectedAngles.length && <p>未选择角度，默认生成正面。</p>}
    {Object.entries(tasks).map(([angle, task]) => task && <div key={angle} role="status">{angleLabel(angle)} · {task.status === 'queued' ? '排队中' : task.status === 'running' ? '生成中' : task.status === 'submitting' ? '正在提交' : task.status === 'succeeded' ? '生成成功' : '生成失败'}
      {task.error && <span>{task.error}</span>}{task.status === 'failed' && <Button disabled={generating} onClick={() => void generate([angle as Angle])}>重试{angleLabel(angle)}</Button>}
    </div>)}
  </div>
  const referencePicker = <ResourceReferencePage toolbarTarget={fullDetail ? null : referenceToolbar} kind={kind} projectId={resource ? resource.project_id : projectId} purpose={purpose}
        value={pickerReturn === 'generation' ? editingGeneration.references ?? references : references}
        onCancel={() => setPage(pickerReturn)} onApply={next => {
          if (pickerReturn === 'generation') setEditingGeneration(value => ({ ...value, references: next })); else setReferences(next)
          setPage(pickerReturn)
        }} />
  const generationPanel = <div className="resource-editor-fields">
        {editingGeneration.mode === 'edit' && <><p>局部修改仅处理当前一张图片，原图保留。</p><label>修改要求<Input.TextArea aria-label="修改要求" value={editingGeneration.edit_instruction ?? ''}
          onChange={event => setEditingGeneration(value => ({ ...value, edit_instruction: event.target.value }))} /></label><label>保持内容<Input.TextArea aria-label="保持内容" value={editingGeneration.preserve_instruction ?? ''}
          onChange={event => setEditingGeneration(value => ({ ...value, preserve_instruction: event.target.value }))} /></label></>}
        {imageBased && <ProjectVisualStyleAndStyleFields layout="horizontal" disabled={generating} visual_style={editingGeneration.visual_style ?? visualStyle} style={editingGeneration.style ?? style} options={options} onChange={next => setEditingGeneration(value => ({ ...value, visual_style: next.visual_style as AssetImagePromptRenderBody['visual_style'], style: next.style as AssetImagePromptRenderBody['style'] }))} />}
        <label>本次附加要求<Input.TextArea aria-label="本次附加要求" value={editingGeneration.additional_instruction ?? ''} rows={4}
          onChange={event => setEditingGeneration(value => ({ ...value, additional_instruction: event.target.value }))} /></label>
        <Collapse items={[{ key: 'display', label: '展示设置', children: <div className={fullDetail ? 'actor-generation-display' : undefined}>{displayFields.map(([key, label]) => <label key={key}>{label}
          <Input.TextArea aria-label={label} value={editingGeneration[key] ?? ''} onChange={event => setEditingGeneration(value => ({ ...value, [key]: event.target.value }))} />
        </label>)}</div> }]} />
        {editingGeneration.mode !== 'edit' && <><h3>临时参考</h3>{referenceSection(true)}</>}
        {editingGeneration.mode !== 'edit' && <div role="group" aria-label="本次生成角度">本次生成角度<Checkbox.Group options={[...angles]} value={editingAngles} onChange={values => setEditingAngles(values as Angle[])} /></div>}
        {!editingAngles.length && <p>未选择角度，默认生成正面。</p>}
        <Button onClick={() => setShowPreview(value => !value)}>{showPreview ? '收起提示词预览' : '预览提示词'}</Button>
        {showPreview && <>
          {previewBusy && <p role="status">提示词正在更新，当前预览尚未生效</p>}
          {previewError && <Alert type="error" message={previewError} action={<Button onClick={() => setPreviewRetry(value => value + 1)}>重试预览</Button>} />}
          {!previewBusy && !previewError && <Tabs items={Object.entries(previews).map(([angle, snapshot]) => ({ key: angle,
            label: angles.find(value => value.value === angle)?.label ?? angle,
            children: <Input.TextArea aria-label="最终提示词" readOnly value={snapshot.execution_prompt} rows={10} />,
          }))} />}
        </>}
        {!fullDetail && <p>默认图片模型：{modelName}。生成设置在关闭对象后恢复默认。{modelName === '读取失败' && <Button onClick={() => setModelRetry(value => value + 1)}>重试模型信息</Button>}</p>}
        {fullDetail && <label>图片模型<Select className="w-full" aria-label="图片模型" value={selectedModel} options={imageModels.map(model => ({ value: model.id, label: model.name }))} onChange={setSelectedModel} /></label>}
        {fullDetail && modelsFailed && <Alert type="error" message="读取图片模型失败" action={<Button onClick={() => setModelRetry(value => value + 1)}>重试模型列表</Button>} />}
      </div>
  const openGeneration = () => {
    acceptedAngles.current.clear()
    setEditingImage(undefined)
    const config: AssetImagePromptRenderBody = { ...normalGenerationConfig.current, mode: undefined }
    if (imageBased) {
      const defaultVisual = resource?.project_id ? visualStyle : defaultVisualStyle
      config.style ??= (resource?.project_id ? style : getDefaultStyle(defaultVisual)) as AssetImagePromptRenderBody['style']
      config.visual_style ??= defaultVisual as AssetImagePromptRenderBody['visual_style']
      if (config.references === undefined) {
        const main = images.find(image => image.is_primary && image.file_id)
        config.references = main ? [{ file_id: main.file_id!, role: 'design' }] : []
      }
    }
    setEditingGeneration(config)
    setShowPreview(true)
    setPage('generation')
  }

  const analysis = <ResourceAnalysis kind={kind === 'character' ? 'actor' : kind} id={resource?.id ?? ''} name={name} facts={facts} supplement={description} disabled={busy || generating}
    onApply={(nextFacts, nextDescription) => { setFacts(nextFacts); setDescription(nextDescription) }} onState={onAnalysisState} />
  const detailStyles = imageBased ? <div className="grid grid-cols-2 gap-3"><label>视觉风格<Input disabled placeholder="未提供" /></label><label>视频风格<Input disabled placeholder="未提供" /></label></div> : <ProjectVisualStyleAndStyleFields layout="horizontal" disabled={busy || generating || analysisBusy || loadFailed} visual_style={visualStyle} style={style} options={options} onChange={next => { setVisualStyle(next.visual_style); setStyle(next.style) }} />
  const detailFields = readOnly ? <div className="actor-readonly-settings">{settings}<Button onClick={() => setReadonlyOpen(true)}>查看完整设定</Button></div> : kind === 'character' ? <CharacterFields factsReadOnly={imageBased} key={`${projectId}:${kind}:${assetId}`} name={name} onName={setName} description={description} onDescription={setDescription} disabled={busy || generating || analysisBusy || loadFailed} styles={detailStyles} /> : <AssetFields factsReadOnly={imageBased} key={`${projectId}:${kind}:${assetId}`} type={kind} name={name} onName={setName} facts={facts} onFacts={setFacts} description={description} onDescription={setDescription}
    disabled={busy || generating || analysisBusy || loadFailed} onAnalysis={() => setAnalysisOpen(true)} styles={detailStyles} />
  const detailPictures = <AssetPictures key={`${projectId}:${kind}:${assetId}`} type={kind} savingViewDefault={savingViewDefault} onViewDefault={setViewDefault} assetId={assetId ?? ''} images={images} disabled={busy || generating || analysisBusy || loadFailed || !!activeTasks.length} primaryDisabled={dirty || busy || generating || analysisBusy || loadFailed} readOnly={readOnly}
    onPrimary={setPrimary} onEdit={image => { acceptedAngles.current.clear(); setEditingImage(image); setEditingGeneration({ mode: 'edit', references: [{ file_id: image.file_id!, role: 'design' }], edit_instruction: '' }); setShowPreview(true); setPage('generation') }}
    feedback={imageError && <Alert type="error" message={imageError} action={resource && <Button onClick={() => void reloadImages(resource.id)}>重试读取图片</Button>} />}
    candidates={angle => <>{imageError && <Alert type="error" message={imageError} />}{candidates.filter(candidate => candidate.angle === angle && !images.some(image => image.file_id === candidate.fileId)).map(candidate => <div key={candidate.fileId}>
      <Image width={112} src={buildFileDownloadUrl(candidate.fileId)} alt="待采用候选" /><Button disabled={busy || readOnly} onClick={async () => { if (!resource) return; setBusy(true); try { await StudioEntitiesApi.createImage(kind, resource.id, { file_id: candidate.fileId, view_angle: candidate.angle }); await reloadImages(resource.id) } catch { setImageError('采用候选失败，请重试') } finally { setBusy(false) } }}>加入视角文件夹</Button>
    </div>)}</>}
    status={angle => { const task = tasks[angle as Angle]; return task ? <>{task.error ?? ({ queued: '排队中', running: '生成中', submitting: '正在提交', succeeded: '生成成功', failed: '生成失败', cancelled: '已取消' } as Record<string,string>)[task.status]}{task.status === 'failed' && !readOnly && <Button size="small" onClick={() => { acceptedAngles.current.delete(angle as Angle); void generate([angle as Angle], editingGeneration) }}>重试</Button>}</> : null }} onGenerate={openGeneration} />
  const detailBody = <AssetDetailLayout compact={detailCompact} fields={detailFields} pictures={detailPictures} />
  return <>
    <ResourceEditorFrame id={drawerId} className={fullDetail && page !== 'publish' ? 'actor-detail-page' : undefined} drawer={isDrawer} inline={inline} renderToolbar={renderToolbar} open={open} title={title} titleExtra={<>{imageBased && <Tag>{({ upload: '上传', project: '项目转化', library: '资产库导入' } as Record<string, string>)[resource!.origin!]}</Tag>}{fullDetail && projectId ? <Tag>{resource?.source_character_id ? '从角色转化 · 只读' : readOnly ? '共享资产 · 只读' : '项目专属'}</Tag> : null}</>}
      backLabel={fullDetail && page !== 'publish' || page === 'editor' ? '返回' : '返回对象'} onClose={fullDetail && page !== 'publish' ? () => { if (busy || generating || analysisBusy || dirty) setCloseRequested(true); else void closeEditor() } : close} actionsRef={setReferenceToolbar}
      actions={fullDetail && page !== 'publish' ? <Space>{readOnly ? !resource?.source_character_id && resource?.project_id === null && <Button target="_blank" rel="noopener noreferrer" href={resourceAssetUrl(kind === 'character' ? 'actor' : kind, resource.id)}>在资产库编辑 ↗</Button> : <Button disabled={busy || generating || analysisBusy || loadFailed} onClick={() => void save()}>保存设定</Button>}{resource?.project_id && (resource.library_copy_id ? <Button type="link" target="_blank" rel="noopener noreferrer" href={resourceAssetUrl(kind === 'character' ? 'actor' : kind, resource.library_copy_id)}>查看库中资产</Button> : <Button disabled={dirty || busy || generating || analysisBusy} onClick={() => { setPublishName(resource.name); setPage('publish') }}>进入资产库</Button>)}</Space> : page === 'references' ? null : <Space wrap>{page === 'publish' ? <>{!isDrawer && <Button onClick={() => setPage('editor')}>返回编辑</Button>}
        <Button type="primary" loading={busy} disabled={!publishName.trim() || !images.some(image => image.file_id)} onClick={() => void publish()}>确认入库</Button>
      </> : readOnly ? <>
        {!resource?.source_character_id && resource?.project_id === null && resource && <Button target="_blank" rel="noopener noreferrer" href={`/assets/${kind === 'actor' ? 'actors' : kind === 'scene' ? 'scenes' : kind === 'prop' ? 'props' : 'costumes'}/${resource.id}/edit`}>在资产库编辑 ↗</Button>}
      </> : page === 'adopt' ? <>
        {!isDrawer && <Button onClick={() => setPage('editor')}>返回编辑</Button>}
        <Button loading={busy} onClick={() => void (!assetId ? saveAndClose() : save())}>{resource ? '保存不采用' : '仅创建不采用'}</Button>
        <Button type="primary" loading={busy} disabled={adoptionIndex === undefined} onClick={() => void (!assetId ? saveAndClose(subjectImages[adoptionIndex!]) : save(subjectImages[adoptionIndex!]))}>{resource ? '采用为主图' : '采用并创建'}</Button>
      </> : page === 'generation' ? <>
        {!isDrawer && <Button aria-label="取消" onClick={() => setPage('editor')}>取消</Button>}
        <Button type="primary" onClick={() => { setGeneration(editingGeneration); setSelectedAngles(editingAngles); setPage('editor') }}>应用并返回</Button>
      </> : <>
        <Button disabled={busy || generating || analysisBusy || loadFailed} onClick={() => { setEditingGeneration(generation); setEditingAngles(selectedAngles); setPage('generation') }}>生成设置{!assetId && ` · ${(selectedAngles.length ? selectedAngles : ['FRONT']).map(angleLabel).join('、')}`}</Button>
        <Button loading={busy} disabled={generating || analysisBusy || loadFailed} onClick={createOnly}>{resource || assetId ? '保存设定' : '仅创建'}</Button>
        <Button aria-label={generation.mode === 'edit' ? dirty ? '保存并生成修改图片' : '生成修改图片' : !resource ? '创建并生成' : dirty ? '保存并生成' : '生成图片'} type="primary" loading={generating} disabled={busy || analysisBusy || loadFailed || !!activeTasks.length} onClick={() => void generate()}>{generation.mode === 'edit' ? dirty ? '保存并生成修改图片' : '生成修改图片' : !resource ? '创建并生成' : dirty ? '保存并生成' : '生成图片'}{generation.mode !== 'edit' && ` · ${(selectedAngles.length ? selectedAngles : ['FRONT']).map(angleLabel).join('、')}`}</Button>
      </>}</Space>}>
      {(!fullDetail || readOnly && !projectId) && <p><Tag>{resource?.source_character_id ? '从角色转化 · 只读' : resource ? resource.project_id ? '项目专属' : '共享资产' : projectId ? '项目专属' : '共享资产'}</Tag></p>}
      {!fullDetail && resource?.project_id && page !== 'publish' && <Space wrap>
        {resource.library_copy_id ? <Button type="link" target="_blank" rel="noopener noreferrer" href={resourceAssetUrl(kind === 'character' ? 'actor' : kind, resource.library_copy_id)}>查看库中资产</Button>
          : <Button disabled={dirty || busy || generating || analysisBusy} onClick={() => { setPublishName(resource.name); setPage('publish') }}>进入资产库</Button>}
        {dirty && <span>保存设定后可进入资产库。</span>}
      </Space>}
      {imageBased && <p>此资源以图片为基础，基础设定不可编辑；可修改名称并继续生成和管理图片。</p>}
      {error && <Alert type="error" showIcon message={error} action={loadFailed && <Button onClick={() => setLoadRetry(value => value + 1)}>重试读取对象</Button>} />}
      {fullDetail && page !== 'publish' ? detailBody : page === 'publish' ? <div className="resource-editor-fields"><h3>进入资产库 · 独立副本</h3>
        <label>副本名称<Input aria-label="副本名称" maxLength={255} value={publishName} onChange={event => setPublishName(event.target.value)} /></label>
        <p>原项目对象保留，副本后续分别维护。将复制名称和全部有效图片，保留主图及各视角默认图，不复制基础设定或生成历史。</p>
        {kind === 'character' && <Alert type="info" message="角色将转化为以图片为基础的演员；名称可改，基础设定不可编辑，图片可继续生成和管理。" />}
        {!busy && !images.some(image => image.file_id) && <Alert type="warning" message="请先添加或生成有效图片，再进入资产库。" />}
        <div className="resource-reference-grid">{images.filter(image => image.file_id).map(image => <div key={image.id}><Image src={buildFileDownloadUrl(image.file_id!)} alt={`入库图片 ${image.id}`} />{image.view_angle}{image.is_primary && <Tag>主图</Tag>}</div>)}</div>
      </div> : page === 'adopt' ? <div className="resource-editor-fields"><h3>是否使用参考主体作为主图？</h3><p>选择一张图片后将复制为当前对象的独立主图；当前已有图片继续保留。</p>
        <div className="resource-reference-grid">{subjectImages.map((reference, index) => <Button className="resource-reference-tile" key={`${reference.file_id}:${index}`} aria-pressed={adoptionIndex === index}
          onClick={() => setAdoptionIndex(index)}><Image preview={false} src={buildFileDownloadUrl(reference.file_id)} alt={`参考主体图片 ${index + 1}`} />{reference.view_angle ? angleLabel(reference.view_angle) : '未标注视角（采用时归入正面）'} · 图片 {index + 1}</Button>)}</div>
      </div> : page === 'references' ? referencePicker : page === 'generation' ? generationPanel : <>
        {Object.keys(generation).length > 0 && <Alert type="info" message="已应用生成设置" action={<Button onClick={() => { setGeneration({}); setSelectedAngles(['FRONT']) }}>恢复默认</Button>} />}
        {!assetId ? <div className="resource-create-content">{settings}
          <Collapse ghost items={[
            { key: 'style', label: `风格 · ${visualStyle} · ${style}`, children: <ProjectVisualStyleAndStyleFields disabled={busy || generating || analysisBusy || loadFailed} visual_style={visualStyle} style={style} options={options} onChange={next => { setVisualStyle(next.visual_style); setStyle(next.style) }} /> },
            { key: 'references', label: `参考图片 · ${references.length ? `${references.length} 张` : '未选择'}`, children: referenceSection() },
          ]} />

          {resource && <><Link to={kind === 'character' ? `/projects/${encodeURIComponent(resource.project_id ?? projectId!)}/roles/${encodeURIComponent(resource.id)}/edit` : resourceAssetUrl(kind, resource.id)}>查看完整详情</Link>{pictures}</>}
        </div> : !mobile ? <div className="resource-editor-desktop"><div>{settings}<h3>参考</h3>{referenceSection()}</div><div>{pictures}</div></div>
        : <Tabs className="resource-editor-mobile" activeKey={section} onChange={next => {
          const content = document.getElementById(drawerId)?.querySelector('.resource-editor-body, .ant-drawer-body')
          const body = content?.closest('.project-workbench-content, .management-panel') ?? content
          if (body) sectionScroll.current[section] = body.scrollTop
          setSection(next)
          requestAnimationFrame(() => { if (body) body.scrollTop = sectionScroll.current[next] ?? 0 })
        }} items={[
          { key: 'settings', label: '设定', children: settings }, { key: 'references', label: '参考', children: referenceSection() }, { key: 'images', label: '图片', children: pictures },
        ]} />}
      </>}
    </ResourceEditorFrame>
    {fullDetail && <><Modal title="智能检测" forceRender open={analysisOpen} onCancel={() => setAnalysisOpen(false)} footer={<Button aria-label="完成" onClick={() => setAnalysisOpen(false)}>完成</Button>}>{analysis}</Modal>
      <Modal title={`完整${labels[kind]}设定`} open={readonlyOpen} onCancel={() => setReadonlyOpen(false)} footer={null}>{settings}</Modal></>}
    {fullDetail && <AssetGenerationDialog label={labels[kind]} references={page === 'references'} editing={editingGeneration.mode === 'edit'} open={page === 'generation' || page === 'references'} generating={generating} dirty={dirty}
      disabled={(imageBased && !editingGeneration.references?.some(reference => !['costume', 'prop', 'style'].includes(reference.role))) || busy || analysisBusy || loadFailed || !selectedModel || !imageModels.some(model => model.id === selectedModel) || !!activeTasks.length}
      onCancel={() => setPage('editor')} onGenerate={() => void generate(editingAngles, editingGeneration)}>
      {imageBased && page === 'generation' && !editingGeneration.references?.some(reference => !['costume', 'prop', 'style'].includes(reference.role)) && <Alert type="warning" message="请选择有效主体参考图后生成" />}{error && <Alert type="error" message={error} />}{page === 'references' ? referencePicker : generationPanel}
      {Object.entries(tasks).filter(([, task]) => task?.status === 'failed').map(([angle, task]) => <Alert key={angle} type="error" message={`${angleLabel(angle)}：${task?.error}`} />)}
    </AssetGenerationDialog>}
    {open && <AssetDetailLeaveGuard navigationManaged={draftHost.managed} dirty={dirty} busy={busy || generating} detecting={analysisBusy} canCancelDetection={analysisBusy && !analysisCancelling} cancellingDetection={analysisCancelling} partialSave={false}
      closeRequested={closeRequested} onContinue={() => setCloseRequested(false)} onClose={closeEditor} save={save} cancelDetection={() => analysisCancel.current()} />}
  </>
}


export function resourceAssetUrl(kind: ResourceKind, id: string) {
  const route = { actor: 'actors', character: 'characters', scene: 'scenes', prop: 'props', costume: 'costumes' }[kind]
  return `/assets/${route}/${encodeURIComponent(id)}/edit`
}
