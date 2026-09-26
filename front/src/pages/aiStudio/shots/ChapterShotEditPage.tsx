import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, Card, Divider, Empty, Layout, List, Modal, Popconfirm, Segmented, Space, Spin, Tabs, Tooltip, Typography, message } from 'antd'
import { ArrowLeftOutlined, ClearOutlined, CloseCircleOutlined, ReloadOutlined } from '@ant-design/icons'
import type {
  EntityNameExistenceItem,
  ShotAssetOverviewItem,
  ShotAssetsOverviewRead,
  ShotDetailRead,
  ShotDialogLineRead,
  ShotDialogLineUpdate,
  ShotExtractionSummaryRead,
  ShotExtractedDialogueCandidateRead,
  ShotPreparationStateRead,
  ShotRead,
} from '../../../services/generated'
import {
  ScriptProcessingService,
  StudioChaptersService,
  StudioEntitiesService,
  StudioProjectsService,
  StudioShotDetailsService,
  StudioShotDialogLinesService,
  StudioShotsService,
} from '../../../services/generated'
import { defaultTaskActionErrorMessage, executeTaskCancel, notifyExistingTask } from '../components/taskActionHelpers'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { getChapterShotEditPath, getChapterShotsPath } from '../project/ProjectWorkbench/routes'
import { DisplayImageCard } from '../assets/components/DisplayImageCard'
import { ChapterShotAssetBindingSection } from './components/ChapterShotAssetBindingSection'
import { ChapterShotAssetConfirmation } from './components/ChapterShotAssetConfirmation'
import { ChapterShotBasicInfoSection } from './components/ChapterShotBasicInfoSection'
import { ChapterShotDialogueConfirmation } from './components/ChapterShotDialogueConfirmation'
import { ChapterShotPreparationGuide } from './components/ChapterShotPreparationGuide'
import { useRelationTaskNotification } from '../components/taskNotificationHelpers'
import { useTaskPageContext } from '../components/taskPageContext'
import { createTaskSettledReloader } from '../components/taskResultHelpers'
import { TASK_COPY } from '../components/taskCopy'
import {
  SCRIPT_EXTRACTION_RELATION_TYPE,
  useCancelableRelationTask,
} from '../project/ProjectWorkbench/chapterDivisionTasks'
import { StudioEntitiesApi } from '../../../services/studioEntities'
import { resolveAssetUrl } from '../assets/utils'
import { readRawErrorMessage } from '../components/taskActionHelpers'
import { showUserConclusion } from '../components/userFacingMessage'

const { Header, Content } = Layout
const extractTaskCopy = TASK_COPY.scriptExtract

type AssetKind = 'scene' | 'actor' | 'prop' | 'costume'
type NamedDraft = { name: string; thumbnail?: string | null; id?: string | null; file_id?: string | null; description?: string | null }
type AssetVM = NamedDraft & {
  kind: AssetKind
  status: 'linked' | 'new'
  candidateId?: number
  candidateStatus?: ShotAssetOverviewItem['candidate_status']
}
type ShotListFilter = 'all' | 'not_extracted' | 'pending'

type ShotAssetCreatedAndLinkedMessage = {
  type: 'studio-shot-asset-created-and-linked'
  projectId?: string
  chapterId?: string
  shotId?: string
  assetId?: string | null
  assetName?: string
}

const DEFAULT_EXTRACTION_SUMMARY: ShotExtractionSummaryRead = {
  state: 'not_extracted',
  has_extracted: false,
  last_extracted_at: null,
  asset_candidate_total: 0,
  dialogue_candidate_total: 0,
  pending_asset_count: 0,
  pending_dialogue_count: 0,
}

function getExtractionStateMeta(
  shot: ShotRead | null,
  pendingConfirmCount: number,
): {
  tone: 'green' | 'gold' | 'blue'
  title: string
  description: string
} {
  const state = shot?.extraction?.state
  if (state === 'skipped') {
    return {
      tone: 'green',
      title: '当前镜头已标记为无需提取',
      description: '系统会直接按“提取确认已完成”处理。如需恢复正式提取流程，请使用上方维护动作。',
    }
  }
  if (state === 'not_extracted') {
    return {
      tone: 'gold',
      title: '当前镜头还没有执行过信息提取',
      description: '点击“提取并刷新候选”后，系统会同步提取资产和对白候选（同步执行，通常需要 10-120 秒）。',
    }
  }
  if (state === 'extracted_empty') {
    return {
      tone: 'blue',
      title: '当前镜头已完成提取，但没有识别到候选',
      description: '这说明系统已经跑过提取流程，只是当前没有识别到资产或对白候选。',
    }
  }
  if (state === 'extracted_resolved') {
    return {
      tone: 'green',
      title: '当前镜头的提取结果已确认完成',
      description: '资产和对白候选都已处理完成，可以继续进入后续生成流程。',
    }
  }
  return {
    tone: 'gold',
    title: '当前镜头仍有提取结果待确认',
    description: `还有 ${pendingConfirmCount} 项待处理，建议先完成资产和对白确认。`,
  }
}

function getShotExtractionSummary(shot: ShotRead | null | undefined): ShotExtractionSummaryRead {
  return shot?.extraction ?? DEFAULT_EXTRACTION_SUMMARY
}

function getExtractionListStatus(shot: ShotRead): {
  text: string
  background: string
  color: string
} {
  const state = getShotExtractionSummary(shot).state
  if (state === 'skipped') {
    return { text: '已跳过', background: '#e0f2fe', color: '#075985' }
  }
  if (state === 'not_extracted') {
    return { text: '未提取', background: '#fef3c7', color: '#92400e' }
  }
  if (state === 'extracted_empty') {
    return { text: '已提取无结果', background: '#dbeafe', color: '#1d4ed8' }
  }
  if (state === 'extracted_resolved' || shot.status === 'ready') {
    return { text: '确认已完成', background: '#dbeafe', color: '#1d4ed8' }
  }
  return { text: '待确认', background: '#fef3c7', color: '#92400e' }
}

function isPendingExtractionConfirmation(shot: ShotRead): boolean {
  return getShotExtractionSummary(shot).state === 'extracted_pending'
}

function isActionablePreparationShot(shot: ShotRead): boolean {
  const state = getShotExtractionSummary(shot).state
  return state === 'not_extracted' || state === 'extracted_pending'
}

function getShotPreparationIssueSummary(shot: ShotRead): {
  text: string
  tone: 'gold' | 'blue' | 'green'
} {
  const basicReady = !!shot.title?.trim() && !!shot.script_excerpt?.trim()
  const extractionState = getShotExtractionSummary(shot).state
  if (!basicReady) {
    return { text: '基础待补', tone: 'gold' }
  }
  if (extractionState === 'not_extracted') {
    return { text: '待执行提取', tone: 'gold' }
  }
  if (extractionState === 'extracted_pending') {
    return { text: '待确认候选', tone: 'gold' }
  }
  if (extractionState === 'extracted_empty') {
    return { text: '已提取无结果', tone: 'blue' }
  }
  if (extractionState === 'skipped') {
    return { text: '已跳过提取', tone: 'blue' }
  }
  return { text: '准备完成', tone: 'green' }
}

function overviewTypeToAssetKind(kind: ShotAssetOverviewItem['type']): AssetKind {
  return kind === 'character' ? 'actor' : kind
}

export function ChapterShotEditPage() {
  const navigate = useNavigate()
  const { projectId, chapterId, shotId } = useParams<{
    projectId: string
    chapterId: string
    shotId: string
  }>()

  const [chapterTitle, setChapterTitle] = useState('')
  const [chapterIndex, setChapterIndex] = useState<number | null>(null)
  const [projectVisualStyle, setProjectVisualStyle] = useState<'现实' | '动漫'>('现实')
  const [projectStyle, setProjectStyle] = useState<string>('真人都市')
  const [shots, setShots] = useState<ShotRead[]>([])
  const [shot, setShot] = useState<ShotRead | null>(null)
  const [title, setTitle] = useState('')
  const [scriptExcerpt, setScriptExcerpt] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [semanticSaving, setSemanticSaving] = useState(false)
  const [preparationState, setPreparationState] = useState<ShotPreparationStateRead | null>(null)
  const [shotDetail, setShotDetail] = useState<ShotDetailRead | null>(null)
  const [shotAssetsOverview, setShotAssetsOverview] = useState<ShotAssetsOverviewRead | null>(null)
  const preparationStateRequestSeqRef = useRef(0)
  const [extractingAssets, setExtractingAssets] = useState(false)
  const [batchExtractingAssets, setBatchExtractingAssets] = useState(false)
  const [skipExtractionUpdating, setSkipExtractionUpdating] = useState(false)
  const extractInFlightRef = useRef(false)
  const [selectedShotIds, setSelectedShotIds] = useState<string[]>(shotId ? [shotId] : [])
  const pendingExternalAssetCreateRef = useRef(false)

  const [linkingOpen, setLinkingOpen] = useState(false)
  const [linkingLoading, setLinkingLoading] = useState(false)
  const [linkingActionLoading, setLinkingActionLoading] = useState(false)
  const [linkingHint, setLinkingHint] = useState<string>('')
  const [linkingKind, setLinkingKind] = useState<AssetKind>('scene')
  const [linkingName, setLinkingName] = useState<string>('')
  const [linkingThumb, setLinkingThumb] = useState<string | undefined>(undefined)
  const [linkingItem, setLinkingItem] = useState<EntityNameExistenceItem | null>(null)

  const [existenceByKindName, setExistenceByKindName] = useState<Record<AssetKind, Record<string, EntityNameExistenceItem>>>({
    scene: {},
    actor: {},
    prop: {},
    costume: {},
  })
  const existenceInFlightRef = useRef<Record<AssetKind, boolean>>({
    scene: false,
    actor: false,
    prop: false,
    costume: false,
  })

  const [dialogLoading, setDialogLoading] = useState(false)
  const [savedDialogLines, setSavedDialogLines] = useState<ShotDialogLineRead[]>([])
  const [extractedDialogLines, setExtractedDialogLines] = useState<ShotExtractedDialogueCandidateRead[]>([])
  const [dialogDeletingIds, setDialogDeletingIds] = useState<Record<number, boolean>>({})
  const [dialogAddingKeys, setDialogAddingKeys] = useState<Record<string, boolean>>({})
  const [batchDialogAdding, setBatchDialogAdding] = useState(false)
  const [candidateActionIds, setCandidateActionIds] = useState<Record<number, boolean>>({})
  const [editorTabKey, setEditorTabKey] = useState<'basic' | 'confirm' | 'binding'>('basic')
  const [shotListFilter, setShotListFilter] = useState<ShotListFilter>('all')
  const dialogDebounceTimersRef = useRef<Map<number, number>>(new Map())
  const tabAutoInitShotIdRef = useRef<string | null>(null)
  const editorTabMemoryRef = useRef<Record<string, 'basic' | 'confirm' | 'binding'>>({})

  const shotsSorted = useMemo(
    () => [...shots].sort((a, b) => a.index - b.index),
    [shots],
  )
  const selectedShots = useMemo(
    () => shotsSorted.filter((item) => selectedShotIds.includes(item.id)),
    [selectedShotIds, shotsSorted],
  )
  const multiSelectActive = selectedShotIds.length > 1
  const shotListFilterCounts = useMemo(
    () => ({
      all: shotsSorted.length,
      not_extracted: shotsSorted.filter((item) => getShotExtractionSummary(item).state === 'not_extracted').length,
      pending: shotsSorted.filter((item) => isPendingExtractionConfirmation(item)).length,
    }),
    [shotsSorted],
  )
  const shotListFilterOptions = useMemo<Array<{ label: string; value: ShotListFilter }>>(
    () => [
      { label: `全部 ${shotListFilterCounts.all}`, value: 'all' },
      { label: `未提取 ${shotListFilterCounts.not_extracted}`, value: 'not_extracted' },
      { label: `待确认 ${shotListFilterCounts.pending}`, value: 'pending' },
    ],
    [shotListFilterCounts.all, shotListFilterCounts.not_extracted, shotListFilterCounts.pending],
  )
  const filteredShots = useMemo(() => {
    if (shotListFilter === 'all') return shotsSorted
    if (shotListFilter === 'not_extracted') {
      return shotsSorted.filter((item) => getShotExtractionSummary(item).state === 'not_extracted')
    }
    return shotsSorted.filter((item) => isPendingExtractionConfirmation(item))
  }, [shotListFilter, shotsSorted])
  const nextActionableShot = useMemo(() => {
    if (!shotId) return shotsSorted.find((item) => isActionablePreparationShot(item)) ?? null
    const currentIndex = shotsSorted.findIndex((item) => item.id === shotId)
    if (currentIndex < 0) {
      return shotsSorted.find((item) => isActionablePreparationShot(item)) ?? null
    }
    for (let i = currentIndex + 1; i < shotsSorted.length; i += 1) {
      if (isActionablePreparationShot(shotsSorted[i])) return shotsSorted[i]
    }
    for (let i = 0; i < currentIndex; i += 1) {
      if (isActionablePreparationShot(shotsSorted[i])) return shotsSorted[i]
    }
    return null
  }, [shotId, shotsSorted])

  const unionAssets = useMemo(() => {
    const groups: Record<AssetKind, AssetVM[]> = {
      scene: [],
      actor: [],
      prop: [],
      costume: [],
    }
    for (const item of shotAssetsOverview?.items ?? []) {
      if (item.candidate_status === 'ignored') continue
      const kind = overviewTypeToAssetKind(item.type)
      groups[kind].push({
        kind,
        name: item.name,
        thumbnail: item.thumbnail ?? null,
        id: item.linked_entity_id ?? null,
        file_id: item.file_id ?? null,
        description: item.description ?? null,
        status: item.is_linked ? 'linked' : 'new',
        candidateId: item.candidate_id ?? undefined,
        candidateStatus: item.candidate_status ?? undefined,
      })
    }
    return groups
  }, [shotAssetsOverview])

  const [expandedKinds, setExpandedKinds] = useState<Record<AssetKind, boolean>>({
    scene: false,
    actor: false,
    prop: false,
    costume: false,
  })

  const toggleExpanded = (kind: AssetKind) => {
    setExpandedKinds((prev) => ({ ...prev, [kind]: !prev[kind] }))
  }

  const loadPage = useCallback(async () => {
    if (!chapterId || !shotId || !projectId) return
    setLoading(true)
    setDialogLoading(true)
    try {
      const [projectRes, chRes, listRes, preparationRes, detailRes] = await Promise.all([
        StudioProjectsService.getProjectApiV1StudioProjectsProjectIdGet({ projectId }),
        StudioChaptersService.getChapterApiV1StudioChaptersChapterIdGet({ chapterId }),
        StudioShotsService.listShotsApiV1StudioShotsGet({
          chapterId,
          page: 1,
          pageSize: 100,
          order: 'index',
          isDesc: false,
        }),
        StudioShotsService.getShotPreparationStateApiApiV1StudioShotsShotIdPreparationStateGet({ shotId }),
        StudioShotDetailsService.getShotDetailApiV1StudioShotDetailsShotIdGet({ shotId }),
      ])
      const nextVisualStyle = projectRes.data?.visual_style
      const nextStyle = projectRes.data?.style
      if (nextVisualStyle === '现实' || nextVisualStyle === '动漫') {
        setProjectVisualStyle(nextVisualStyle)
      }
      if (typeof nextStyle === 'string' && nextStyle.trim()) {
        setProjectStyle(nextStyle)
      }

      const c = chRes.data
      setChapterTitle(c?.title ?? '')
      setChapterIndex(typeof c?.index === 'number' ? c.index : null)

      const items = listRes.data?.items ?? []
      const preparationState = preparationRes.data ?? null
      const detail = detailRes.data ?? null
      const s = preparationState?.shot ?? null

      if (!s) {
        message.error('分镜不存在')
        navigate(getChapterShotsPath(projectId, chapterId), { replace: true })
        return
      }
      if (s.chapter_id !== chapterId) {
        message.error('分镜不属于当前章节')
        navigate(getChapterShotsPath(projectId, chapterId), { replace: true })
        return
      }

      setPreparationState(preparationState)
      setShotDetail(detail)
      setShot(s)
      setTitle(s.title ?? '')
      setScriptExcerpt(s.script_excerpt ?? '')
      setShots(items.map((item) => (item.id === s.id ? s : item)))
      setShotAssetsOverview(preparationState?.assets_overview ?? null)
      setSavedDialogLines(preparationState?.saved_dialogue_lines ?? [])
      setExtractedDialogLines(
        (preparationState?.dialogue_candidates ?? []).filter((item) => item.candidate_status === 'pending'),
      )
    } catch {
      message.error('加载失败')
      navigate(getChapterShotsPath(projectId, chapterId), { replace: true })
    } finally {
      setDialogLoading(false)
      setLoading(false)
    }
  }, [chapterId, navigate, projectId, shotId])

  const clearDialogDebounceTimers = useCallback(() => {
    for (const [, timer] of dialogDebounceTimersRef.current.entries()) {
      window.clearTimeout(timer)
    }
    dialogDebounceTimersRef.current.clear()
  }, [])

  const applyPreparationState = useCallback(
    (state: ShotPreparationStateRead, options?: { syncBasicInfo?: boolean }) => {
      setPreparationState(state)
      const nextShot = state.shot
      setShot(nextShot)
      setShots((prev) => prev.map((item) => (item.id === nextShot.id ? nextShot : item)))
      setShotAssetsOverview(state.assets_overview ?? null)
      setSavedDialogLines(state.saved_dialogue_lines ?? [])
      setExtractedDialogLines((state.dialogue_candidates ?? []).filter((item) => item.candidate_status === 'pending'))
      if (options?.syncBasicInfo) {
        setTitle(nextShot.title ?? '')
        setScriptExcerpt(nextShot.script_excerpt ?? '')
      }
    },
    [],
  )

  const loadPreparationState = useCallback(
    async (options?: { syncBasicInfo?: boolean; silent?: boolean }) => {
      if (!shotId) return null
      const reqSeq = ++preparationStateRequestSeqRef.current
      setDialogLoading(true)
      try {
        const res = await StudioShotsService.getShotPreparationStateApiApiV1StudioShotsShotIdPreparationStateGet({
          shotId,
        })
        if (reqSeq !== preparationStateRequestSeqRef.current) return null
        const data = res.data ?? null
        if (!data) return null
        applyPreparationState(data, { syncBasicInfo: options?.syncBasicInfo })
        return data
      } catch {
        if (!options?.silent) {
          message.error('准备状态加载失败')
        }
        return null
      } finally {
        if (reqSeq === preparationStateRequestSeqRef.current) {
          setDialogLoading(false)
        }
      }
    },
    [applyPreparationState, shotId],
  )

  const reloadAfterExtractTaskSettled = useCallback(
    createTaskSettledReloader(loadPage),
    [loadPage],
  )
  // 注意：提取按钮已改为同步接口（不再创建 async 任务），但这里保留了对本 chapter 的
  // script_extraction 活跃任务轮询/取消能力：DB 里可能残留历史任务行，轮询仍是它的唯一入口，
  // 因此不是死代码。见本次改动报告的说明。
  const { task: extractTask, settledTask: extractSettledTask, applyCancelData: applyExtractCancelData } = useCancelableRelationTask({
    enabled: !!chapterId,
    relationType: SCRIPT_EXTRACTION_RELATION_TYPE,
    relationEntityId: chapterId,
    onTaskSettled: reloadAfterExtractTaskSettled,
  })
  useTaskPageContext(
    chapterId
      ? [
          {
            relationType: SCRIPT_EXTRACTION_RELATION_TYPE,
            relationEntityId: chapterId,
          },
        ]
      : [],
  )
  const extractTaskActive = !!extractTask

  const scheduleSaveDialogLine = useCallback(
    (lineId: number, patch: ShotDialogLineUpdate) => {
      const prev = dialogDebounceTimersRef.current.get(lineId)
      if (prev) window.clearTimeout(prev)
      const timer = window.setTimeout(async () => {
        try {
          await StudioShotDialogLinesService.updateShotDialogLineApiV1StudioShotDialogLinesLineIdPatch({
            lineId,
            requestBody: patch,
          })
        } catch {
          message.error('对白保存失败')
        }
      }, 1000)
      dialogDebounceTimersRef.current.set(lineId, timer)
    },
    [],
  )

  const updateSavedDialogText = useCallback(
    (lineId: number, text: string) => {
      setSavedDialogLines((prev) => prev.map((l) => (l.id === lineId ? { ...l, text } : l)))
      scheduleSaveDialogLine(lineId, { text })
    },
    [scheduleSaveDialogLine],
  )

  const deleteSavedDialogLine = useCallback(
    async (lineId: number) => {
      if (dialogDeletingIds[lineId]) return
      const prevTimer = dialogDebounceTimersRef.current.get(lineId)
      if (prevTimer) window.clearTimeout(prevTimer)
      dialogDebounceTimersRef.current.delete(lineId)
      setDialogDeletingIds((m) => ({ ...m, [lineId]: true }))
      try {
        await StudioShotDialogLinesService.deleteShotDialogLineApiV1StudioShotDialogLinesLineIdDelete({ lineId })
        setSavedDialogLines((prev) => prev.filter((l) => l.id !== lineId))
        message.success('已删除')
      } catch {
        message.error('删除失败')
      } finally {
        setDialogDeletingIds((m) => ({ ...m, [lineId]: false }))
      }
    },
    [dialogDeletingIds],
  )

  const updateExtractedDialogText = useCallback((candidateId: number, text: string) => {
    setExtractedDialogLines((prev) => prev.map((l) => (l.id === candidateId ? { ...l, text } : l)))
  }, [])

  const acceptExtractedDialogLine = useCallback(
    async (line: ShotExtractedDialogueCandidateRead, options?: { silent?: boolean }): Promise<ShotPreparationStateRead | null> => {
      const text = (line.text ?? '').trim()
      if (!text) {
        if (!options?.silent) message.warning('请先填写对白内容')
        return null
      }
      const res = await StudioShotsService.acceptExtractedDialogueCandidateApiV1StudioShotsExtractedDialogueCandidatesCandidateIdAcceptPatch({
        candidateId: line.id,
        requestBody: {
          index: line.index,
          text,
          line_mode: line.line_mode,
          speaker_name: line.speaker_name ?? null,
          target_name: line.target_name ?? null,
        },
      })
      return res.data?.state ?? null
    },
    [],
  )

  const addExtractedDialogLine = useCallback(
    async (line: ShotExtractedDialogueCandidateRead) => {
      const loadingKey = String(line.id)
      if (dialogAddingKeys[loadingKey]) return
      setDialogAddingKeys((m) => ({ ...m, [loadingKey]: true }))
      try {
        const created = await acceptExtractedDialogLine(line)
        if (created) {
          applyPreparationState(created)
          message.success('已接受')
        }
      } catch {
        message.error('接受失败')
      } finally {
        setDialogAddingKeys((m) => ({ ...m, [loadingKey]: false }))
      }
    },
    [acceptExtractedDialogLine, applyPreparationState, dialogAddingKeys],
  )

  const acceptAllExtractedDialogLines = useCallback(async () => {
    if (batchDialogAdding || extractedDialogLines.length === 0) return
    setBatchDialogAdding(true)
    try {
      let acceptedCount = 0
      let lastState: ShotPreparationStateRead | null = null
      for (const line of extractedDialogLines) {
        try {
          const accepted = await acceptExtractedDialogLine(line, { silent: true })
          if (accepted) {
            acceptedCount += 1
            lastState = accepted
          }
        } catch {
          // 逐条容错，最后统一反馈。
        }
      }
      if (lastState) {
        applyPreparationState(lastState)
      } else if (acceptedCount > 0) {
        await loadPreparationState({ silent: true })
      }
      if (acceptedCount === extractedDialogLines.length) {
        message.success(`已接受 ${acceptedCount} 条对白`)
      } else if (acceptedCount > 0) {
        message.warning(`已接受 ${acceptedCount} 条，对剩余 ${extractedDialogLines.length - acceptedCount} 条请逐条检查`)
      } else {
        message.error('批量接受失败')
      }
    } finally {
      setBatchDialogAdding(false)
    }
  }, [acceptExtractedDialogLine, applyPreparationState, batchDialogAdding, extractedDialogLines, loadPreparationState])

  const ignoreExtractedDialogLine = useCallback(
    async (
      line: ShotExtractedDialogueCandidateRead,
      options?: { silent?: boolean; applyState?: boolean },
    ): Promise<ShotPreparationStateRead | null> => {
      const loadingKey = String(line.id)
      if (dialogAddingKeys[loadingKey]) return null
      setDialogAddingKeys((m) => ({ ...m, [loadingKey]: true }))
      try {
        const res = await StudioShotsService.ignoreExtractedDialogueCandidateApiV1StudioShotsExtractedDialogueCandidatesCandidateIdIgnorePatch({
          candidateId: line.id,
        })
        const nextState = res.data?.state ?? null
        if (nextState && options?.applyState !== false) {
          applyPreparationState(nextState)
        } else if (!nextState) {
          await loadPreparationState({ silent: true })
        }
        if (!options?.silent) message.success('已忽略')
        return nextState
      } catch {
        if (!options?.silent) message.error('忽略失败')
        throw new Error('ignore failed')
      } finally {
        setDialogAddingKeys((m) => ({ ...m, [loadingKey]: false }))
      }
    },
    [applyPreparationState, dialogAddingKeys, loadPreparationState],
  )

  const ignoreAllExtractedDialogLines = useCallback(async () => {
    if (batchDialogAdding || extractedDialogLines.length === 0) return
    setBatchDialogAdding(true)
    try {
      let ignoredCount = 0
      let lastState: ShotPreparationStateRead | null = null
      for (const line of extractedDialogLines) {
        try {
          const ignored = await ignoreExtractedDialogLine(line, { silent: true, applyState: false })
          ignoredCount += 1
          if (ignored) lastState = ignored
        } catch {
          // 逐条容错，最后统一反馈。
        }
      }
      if (lastState) {
        applyPreparationState(lastState)
      } else if (ignoredCount > 0) {
        await loadPreparationState({ silent: true })
      }
      if (ignoredCount === extractedDialogLines.length) {
        message.success(`已忽略 ${ignoredCount} 条对白`)
      } else if (ignoredCount > 0) {
        message.warning(`已忽略 ${ignoredCount} 条，对剩余 ${extractedDialogLines.length - ignoredCount} 条请逐条检查`)
      } else {
        message.error('批量忽略失败')
      }
    } finally {
      setBatchDialogAdding(false)
    }
  }, [applyPreparationState, batchDialogAdding, extractedDialogLines, ignoreExtractedDialogLine, loadPreparationState])

  useEffect(() => {
    void loadPage()
  }, [loadPage])

  useEffect(() => {
    if (!shotId) {
      setSelectedShotIds([])
      return
    }
    setSelectedShotIds((prev) => {
      if (prev.length === 0) return [shotId]
      if (!prev.includes(shotId) && prev.length <= 1) return [shotId]
      return prev
    })
  }, [shotId])

  useEffect(() => {
    if (!projectId || !chapterId || !shotId) return

    const resetExistenceCache = () => {
      setExistenceByKindName({
        scene: {},
        actor: {},
        prop: {},
        costume: {},
      })
    }

    const refreshAfterExternalCreate = async () => {
      pendingExternalAssetCreateRef.current = false
      resetExistenceCache()
      await loadPreparationState({ silent: true })
    }

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const data = event.data as ShotAssetCreatedAndLinkedMessage | null
      if (!data || data.type !== 'studio-shot-asset-created-and-linked') return
      if (data.projectId !== projectId || data.chapterId !== chapterId || data.shotId !== shotId) return
      void refreshAfterExternalCreate()
    }

    const handleFocus = () => {
      if (!pendingExternalAssetCreateRef.current) return
      void refreshAfterExternalCreate()
    }

    window.addEventListener('message', handleMessage)
    window.addEventListener('focus', handleFocus)
    return () => {
      window.removeEventListener('message', handleMessage)
      window.removeEventListener('focus', handleFocus)
    }
  }, [chapterId, loadPreparationState, projectId, shotId])

  // 切换分镜时：清理对白防抖，准备状态由 loadPage 统一加载
  useEffect(() => {
    clearDialogDebounceTimers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shotId])

  useEffect(() => () => clearDialogDebounceTimers(), [clearDialogDebounceTimers])

  const saveShot = useCallback(async () => {
    if (!shot || !title.trim()) {
      message.warning('请填写标题')
      return
    }
    setSaving(true)
    setSemanticSaving(true)
    try {
      const [shotRes, detailRes] = await Promise.all([
        StudioShotsService.updateShotApiV1StudioShotsShotIdPatch({
          shotId: shot.id,
          requestBody: {
            title: title.trim(),
            script_excerpt: scriptExcerpt.trim() ? scriptExcerpt.trim() : null,
          },
        }),
        shotDetail
          ? StudioShotDetailsService.updateShotDetailApiV1StudioShotDetailsShotIdPatch({
              shotId: shot.id,
              requestBody: {
                camera_shot: shotDetail.camera_shot,
                angle: shotDetail.angle,
                movement: shotDetail.movement,
                duration: shotDetail.duration ?? 4,
                action_beats: shotDetail.action_beats ?? [],
              },
            })
          : Promise.resolve({ data: null } as any),
      ])

      const next = shotRes.data
      const nextDetail = detailRes.data ?? null
      if (nextDetail) {
        setShotDetail(nextDetail)
      }
      if (next) {
        setShot(next)
        setShots((prev) => prev.map((x) => (x.id === next.id ? next : x)))
        message.success('已保存基础信息与镜头语言')
      }
    } catch {
      message.error('保存失败')
    } finally {
      setSaving(false)
      setSemanticSaving(false)
    }
  }, [scriptExcerpt, shot, shotDetail, title])

  const updateShotSemantic = useCallback((patch: {
    camera_shot?: ShotDetailRead['camera_shot']
    angle?: ShotDetailRead['angle']
    movement?: ShotDetailRead['movement']
    duration?: number
    action_beats?: Array<string>
  }) => {
    setShotDetail((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        ...patch,
      }
    })
  }, [])

  const updateSkipExtraction = useCallback(
    async (skip: boolean) => {
      if (!shotId) return
      setSkipExtractionUpdating(true)
      try {
        const res = await StudioShotsService.updateShotSkipExtractionApiV1StudioShotsShotIdSkipExtractionPatch({
          shotId,
          requestBody: { skip },
        })
        const nextState = res.data?.state ?? null
        if (nextState) {
          applyPreparationState(nextState)
        } else {
          await loadPreparationState({ silent: true })
        }
        message.success(skip ? '已标记为无需提取' : '已恢复提取确认流程')
      } catch {
        message.error(skip ? '标记无需提取失败' : '恢复提取失败')
      } finally {
        setSkipExtractionUpdating(false)
      }
    },
    [applyPreparationState, loadPreparationState, shotId],
  )

  // 提取走同步接口：本环境没有 Celery worker / Redis，`*-async` 只写一条永远不会被执行的任务行，
  // 按钮因此拿不到任何结果。同步接口在本进程内直接跑 LLM 并写回候选项，无需 worker；
  // 代价是请求会挂 10-120 秒，用持续的 loading 提示把等待讲清楚。
  const extractAssets = useCallback(async () => {
    if (!projectId || !chapterId || !shot) return
    if (extractInFlightRef.current) return
    if (notifyExistingTask(extractTask, {
      cancellingMessage: extractTaskCopy.cancellingMessage,
      runningMessage: extractTaskCopy.runningMessage,
    })) {
      return
    }
    extractInFlightRef.current = true
    setExtractingAssets(true)
    const hideLoading = message.loading('正在同步提取（通常需要 10-120 秒），请勿关闭或刷新页面…', 0)
    try {
      const scriptDivision = {
        total_shots: 1,
        shots: [
          {
            index: shot.index,
            start_line: 1,
            end_line: 1,
            script_excerpt: shot.script_excerpt ?? '',
            shot_name: shot.title ?? '',
          },
        ],
      }
      await ScriptProcessingService.extractScriptApiV1ScriptProcessingExtractPost({
        requestBody: {
          project_id: projectId,
          chapter_id: chapterId,
          script_division: scriptDivision as any,
          consistency: undefined,
          refresh_cache: true,
        } as any,
      })
      message.success('提取完成，候选已刷新')
      await loadPreparationState({ silent: true })
    } catch (error) {
      /* 审计 §4.6 模式 6：主区走统一管道的中文结论，后端原文经掩码进「技术详情」 */
      void showUserConclusion(
        'error',
        defaultTaskActionErrorMessage(error, '提取失败'),
        readRawErrorMessage(error),
        '提取资产',
      )
    } finally {
      hideLoading()
      setExtractingAssets(false)
      extractInFlightRef.current = false
    }
  }, [chapterId, extractTask, loadPreparationState, projectId, shot])

  const batchExtractAssets = useCallback(async () => {
    if (!projectId || !chapterId || selectedShots.length === 0) return
    if (extractInFlightRef.current) return
    if (notifyExistingTask(extractTask, {
      cancellingMessage: extractTaskCopy.cancellingMessage,
      runningMessage: extractTaskCopy.runningMessage,
    })) {
      return
    }

    const actionableShots = selectedShots
      .filter((item) => !item.skip_extraction)
      .sort((a, b) => a.index - b.index)

    if (actionableShots.length === 0) {
      message.info('当前选中的镜头都已标记为无需提取，如需调整请先恢复提取')
      return
    }

    extractInFlightRef.current = true
    setBatchExtractingAssets(true)
    const hideLoading = message.loading(
      `正在同步提取 ${actionableShots.length} 条镜头（通常需要 10-120 秒），请勿关闭或刷新页面…`,
      0,
    )
    try {
      const scriptDivision = {
        total_shots: actionableShots.length,
        shots: actionableShots.map((item) => ({
          index: item.index,
          start_line: 1,
          end_line: 1,
          script_excerpt: item.script_excerpt ?? '',
          shot_name: item.title ?? '',
        })),
      }
      await ScriptProcessingService.extractScriptApiV1ScriptProcessingExtractPost({
        requestBody: {
          project_id: projectId,
          chapter_id: chapterId,
          script_division: scriptDivision as any,
          consistency: undefined,
          refresh_cache: true,
        } as any,
      })
      message.success(`已完成 ${actionableShots.length} 条镜头的提取，候选已刷新`)
      await loadPage()
    } catch (error) {
      /* 同上（审计 §4.6 模式 6） */
      void showUserConclusion(
        'error',
        defaultTaskActionErrorMessage(error, '批量提取失败'),
        readRawErrorMessage(error),
        '批量提取资产',
      )
    } finally {
      hideLoading()
      setBatchExtractingAssets(false)
      extractInFlightRef.current = false
    }
  }, [chapterId, extractTask, loadPage, projectId, selectedShots])

  const cancelExtractTask = useCallback(async () => {
    if (!extractTask?.taskId) return
    try {
      await executeTaskCancel({
        taskId: extractTask.taskId,
        reason: '用户在分镜编辑页取消提取任务',
        applyCancelData: applyExtractCancelData,
        cancelledImmediatelyMessage: extractTaskCopy.cancelledImmediatelyMessage,
        cancelRequestedMessage: extractTaskCopy.cancelRequestedMessage,
        fallbackErrorMessage: '取消提取任务失败',
      })
    } catch {
      // executeTaskCancel 已统一处理错误提示
    }
  }, [applyExtractCancelData, extractTask])

  useRelationTaskNotification({
    task: extractTask,
    settledTask: extractSettledTask,
    title: extractTaskCopy.title,
    sourceLabel: shot?.title ? `镜头：${shot.title}` : '分镜编辑页',
    runningDescription: extractTaskCopy.runningDescription,
    cancellingDescription: extractTaskCopy.cancellingDescription,
    successDescription: extractTaskCopy.successDescription,
    cancelledDescription: extractTaskCopy.cancelledDescription,
    failedDescription: extractTaskCopy.failedDescription,
    onCancel: extractTask ? () => void cancelExtractTask() : null,
    onNavigate:
      projectId && chapterId && shotId
        ? () => navigate(getChapterShotEditPath(projectId, chapterId, shotId))
        : null,
  })

  const goShot = (id: string) => {
    if (!projectId || !chapterId || id === shotId) return
    setSelectedShotIds([id])
    navigate(`/projects/${projectId}/chapters/${chapterId}/shots/${id}/edit`)
  }
  const handleShotListClick = useCallback(
    (targetShotId: string, e: React.MouseEvent) => {
      const isToggle = e.metaKey || e.ctrlKey
      if (isToggle) {
        setSelectedShotIds((prev) =>
          prev.includes(targetShotId) ? prev.filter((id) => id !== targetShotId) : [...prev, targetShotId],
        )
        return
      }
      goShot(targetShotId)
    },
    [goShot],
  )
  const goNextActionableShot = useCallback(() => {
    if (!nextActionableShot) return
    goShot(nextActionableShot.id)
  }, [nextActionableShot])

  const openLinkingModal = useCallback(
    async (kind: AssetKind, name: string, item: EntityNameExistenceItem, hint: string) => {
      setLinkingKind(kind)
      setLinkingName(name)
      setLinkingItem(item)
      setLinkingHint(hint)
      setLinkingThumb(undefined)
      setLinkingOpen(true)
      if (!item.asset_id) return
      setLinkingLoading(true)
      try {
        const entityType =
          kind === 'scene' ? 'scene' : kind === 'prop' ? 'prop' : kind === 'costume' ? 'costume' : 'character'
        const res = await StudioEntitiesApi.get(entityType as any, item.asset_id)
        const data: any = res.data
        const thumb = resolveAssetUrl(data?.thumbnail ?? data?.images?.[0]?.thumbnail ?? '')
        setLinkingThumb(thumb || undefined)
      } catch {
        // ignore
      } finally {
        setLinkingLoading(false)
      }
    },
    [],
  )

  const doLink = useCallback(async () => {
    if (!projectId || !chapterId || !shotId) return
    if (!linkingItem?.asset_id) return
    setLinkingActionLoading(true)
    try {
      const res = await StudioShotsService.linkExistingAssetForPreparationApiApiV1StudioShotsShotIdPreparationLinkPost({
        shotId,
        requestBody: {
          project_id: projectId,
          chapter_id: chapterId,
          entity_type: linkingKind === 'actor' ? 'character' : linkingKind,
          linked_entity_id: linkingItem.asset_id,
        },
      })
      message.success('已关联')
      if (res.data?.state) {
        applyPreparationState(res.data.state)
      } else {
        await loadPreparationState({ silent: true })
      }
      setLinkingOpen(false)
    } catch {
      message.error('关联失败')
    } finally {
      setLinkingActionLoading(false)
    }
  }, [applyPreparationState, chapterId, linkingItem?.asset_id, linkingKind, loadPreparationState, projectId, shotId])

  const handleNewAsset = useCallback(
    async (asset: AssetVM) => {
      if (!projectId || !chapterId || !shotId) return
      const name = asset.name.trim()
      if (!name) return
      try {
        const req: any = { project_id: projectId, shot_id: shotId }
        if (asset.kind === 'scene') req.scene_names = [name]
        else if (asset.kind === 'prop') req.prop_names = [name]
        else if (asset.kind === 'costume') req.costume_names = [name]
        else req.character_names = [name]

        const res = await StudioEntitiesService.checkEntityNamesExistenceApiV1StudioEntitiesExistenceCheckPost({
          requestBody: req,
        })
        const data = res.data
        const bucket =
          asset.kind === 'scene'
            ? data?.scenes
            : asset.kind === 'prop'
              ? data?.props
              : asset.kind === 'costume'
                ? data?.costumes
                : data?.characters
        const item = (bucket?.[0] as EntityNameExistenceItem | undefined) ?? null
        if (!item) {
          /* 审计 §4.6 模式 4：接口名（`existence-check`）原来直接给用户看 → 换用户语言 */
          message.error('没有查到该资产是否已存在，请重试')
          return
        }

        if (!item.exists) {
          // **就地新建并关联**：原来这里 window.open 一个带 create=1&name=… 的新标签页，
          // 但资产页会把查询参数抹掉（实际打开的是 /assets?tab=xxx），预填的名称/项目/镜头全丢，
          // 用户得在另一个标签里重新手填一遍再回来 —— 主流程被硬生生截断。
          // 现在直接调实体新建接口（它本身支持带 chapter_id/shot_id 落关联），留在本页完成。
          Modal.confirm({
            title: `项目中还没有「${name}」，是否新建并关联到本镜？`,
            okText: '新建并关联',
            cancelText: '取消',
            onOk: async () => {
              const entityType =
                asset.kind === 'scene'
                  ? 'scene'
                  : asset.kind === 'prop'
                    ? 'prop'
                    : asset.kind === 'costume'
                      ? 'costume'
                      : 'character'
              const created = await StudioEntitiesApi.create(entityType as 'character' | 'scene' | 'prop' | 'costume', {
                id: `asset_${Date.now()}`,
                name,
                description: asset.description?.trim() || '',
                tags: [],
                thumbnail: '',
                visual_style: projectVisualStyle,
                style: projectStyle,
                project_id: projectId,
                chapter_id: chapterId,
                shot_id: shotId,
              })
              const createdId = String((created.data as { id?: string } | undefined)?.id ?? '')
              if (!createdId) {
                message.error('新建资产失败，请刷新后重试')
                return
              }
              message.success(`已新建「${name}」并关联到本镜`)
              await loadPreparationState({ silent: true })
            },
          })
          return
        }

        if (item.exists && !item.linked_to_project) {
          await openLinkingModal(asset.kind, name, item, '在资产库中存在同名资产，可关联')
          return
        }
        if (item.exists && item.linked_to_project && !item.linked_to_shot) {
          await openLinkingModal(asset.kind, name, item, '项目中存在同名资产，可关联')
          return
        }

        message.info('该资产已关联到当前镜头')
      } catch {
        message.error('查询资产失败，请重试')
      }
    },
    [openLinkingModal, chapterId, projectId, projectStyle, projectVisualStyle, shotId],
  )

  const ignoreCandidate = useCallback(
    async (asset: AssetVM) => {
      if (!asset.candidateId) return
      if (candidateActionIds[asset.candidateId]) return
      setCandidateActionIds((prev) => ({ ...prev, [asset.candidateId!]: true }))
      try {
        const res = await StudioShotsService.ignoreExtractedCandidateApiV1StudioShotsExtractedCandidatesCandidateIdIgnorePatch({
          candidateId: asset.candidateId,
        })
        if (res.data?.state) {
          applyPreparationState(res.data.state)
        } else {
          await loadPreparationState({ silent: true })
        }
        message.success('已忽略该候选项')
      } catch {
        message.error('忽略失败')
      } finally {
        setCandidateActionIds((prev) => ({ ...prev, [asset.candidateId!]: false }))
      }
    },
    [applyPreparationState, candidateActionIds, loadPreparationState],
  )


  const prefetchExistenceForNewAssets = useCallback(
    async (kind: AssetKind, items: AssetVM[]) => {
      if (!projectId || !shotId) return
      if (existenceInFlightRef.current[kind]) return
      const missingNames = items
        .filter((x) => x.status === 'new')
        .map((x) => x.name.trim())
        .filter(Boolean)
        .filter((n) => !existenceByKindName[kind][n])
      if (missingNames.length === 0) return

      existenceInFlightRef.current[kind] = true
      try {
        const req: any = { project_id: projectId, shot_id: shotId }
        if (kind === 'scene') req.scene_names = missingNames
        else if (kind === 'prop') req.prop_names = missingNames
        else if (kind === 'costume') req.costume_names = missingNames
        else req.character_names = missingNames

        const res = await StudioEntitiesService.checkEntityNamesExistenceApiV1StudioEntitiesExistenceCheckPost({
          requestBody: req,
        })
        const data = res.data
        const bucket =
          kind === 'scene'
            ? data?.scenes
            : kind === 'prop'
              ? data?.props
              : kind === 'costume'
                ? data?.costumes
                : data?.characters
        const list = Array.isArray(bucket) ? (bucket as EntityNameExistenceItem[]) : []
        if (list.length === 0) return
        setExistenceByKindName((prev) => {
          const next = { ...prev, [kind]: { ...prev[kind] } }
          for (const it of list) {
            const key = it?.name?.trim?.() ? it.name.trim() : ''
            if (!key) continue
            next[kind][key] = it
          }
          return next
        })
      } catch {
        // 静默：避免频繁 toast
      } finally {
        existenceInFlightRef.current[kind] = false
      }
    },
    [existenceByKindName, projectId, shotId],
  )

  useEffect(() => {
    void prefetchExistenceForNewAssets('scene', unionAssets.scene)
    void prefetchExistenceForNewAssets('actor', unionAssets.actor)
    void prefetchExistenceForNewAssets('prop', unionAssets.prop)
    void prefetchExistenceForNewAssets('costume', unionAssets.costume)
  }, [prefetchExistenceForNewAssets, unionAssets])

  if (!projectId || !chapterId || !shotId) {
    return <Navigate to="/projects" replace />
  }

  const hasTitleAndExcerpt = preparationState?.basic_info_ready ?? (!!title.trim() && !!scriptExcerpt.trim())
  const hasSemanticDefaults = preparationState?.semantic_defaults_ready
    ?? (!!shotDetail?.camera_shot && !!shotDetail?.angle && !!shotDetail?.movement && (shotDetail?.duration ?? 0) > 0)
  const actionBeatsCount = preparationState?.action_beats_count
    ?? (shotDetail?.action_beats ?? []).filter((item) => item.trim().length > 0).length
  const actionBeatsReady = preparationState?.action_beats_ready ?? (actionBeatsCount > 0)
  const linkedAssetCount = shotAssetsOverview?.summary.linked_count ?? 0
  const pendingAssetCount = shotAssetsOverview?.summary.pending_count ?? 0
  const pendingConfirmCount = preparationState?.pending_confirm_count ?? (pendingAssetCount + extractedDialogLines.length)
  const assetsReady = !!shotAssetsOverview && pendingAssetCount === 0
  const dialogsReady = extractedDialogLines.length === 0
  const statusReady = preparationState?.ready_for_generation ?? (shot?.status === 'ready')
  const basicInfoReady = hasTitleAndExcerpt && hasSemanticDefaults
  const confirmReady = pendingConfirmCount === 0
  const currentShotActionable = shot ? isActionablePreparationShot(shot) || !basicInfoReady || !actionBeatsReady : false
  const extractionSummary = getShotExtractionSummary(shot)
  const extractionStateMeta = getExtractionStateMeta(shot, pendingConfirmCount)
  /**
   * 「下一步」只走六步主流程：分镜完成之后先做资产提取，而不是直接进分镜工作室
   * （直接进工作室会跳过资产提取 / 图片准备 / 整集提示词 / 关联绑定）。
   */
  const continueFlow = () => navigate(`/projects/${projectId}?step=extract_assets`)
  const nextStepTitle = '下一步：第 2 步 资产准备'
  const nextStepDescription = statusReady
    ? '当前镜头的准备已确认。回到项目工作台按顺序继续：剧本与分镜 → 资产准备 → 整集视频提示词 → 资产与声音绑定 → 生成与交付。'
    : actionBeatsReady
      ? '当前镜头仍有提取候选、对白或镜头基础信息待确认。确认后回到项目工作台，按五步流程继续后续步骤。'
      : '当前镜头的动作拍点还没有确认。建议先补齐动作序列，再回到项目工作台继续后续步骤。'

  const checklistItems = [
    {
      key: 'script',
      label: '标题、摘录与镜头语言',
      tone: basicInfoReady ? 'success' : 'warning',
      text: basicInfoReady ? '已确认基础信息与镜头语言' : '请先补齐标题、剧本摘录和镜头语言',
    },
    {
      key: 'action_beats',
      label: '动作拍点',
      tone: actionBeatsReady ? 'success' : 'warning',
      text: actionBeatsReady
        ? `已确认 ${actionBeatsCount} 条动作拍点`
        : '请先确认当前镜头的动作变化序列',
    },
    {
      key: 'assets',
      label: '资产',
      tone: assetsReady ? 'success' : shotAssetsOverview ? 'warning' : 'default',
      text: assetsReady
        ? extractionSummary.state === 'skipped'
          ? '已跳过资产准备'
          : extractionSummary.state === 'extracted_empty'
            ? '已提取无候选'
            : linkedAssetCount > 0
              ? '已完成资产确认'
              : '已完成资产确认'
        : extractionSummary.state === 'not_extracted'
          ? '未提取'
          : extractionSummary.state === 'extracted_empty'
            ? '已提取无候选'
            : shotAssetsOverview
              ? `待处理 ${pendingAssetCount}`
              : '待处理',
    },
    {
      key: 'dialogs',
      label: '对白',
      tone: dialogsReady ? 'success' : extractedDialogLines.length > 0 ? 'warning' : 'default',
      text: dialogsReady
        ? extractionSummary.state === 'skipped'
          ? '已跳过对白提取'
          : extractionSummary.state === 'extracted_empty'
            ? '已提取无候选'
            : savedDialogLines.length > 0
              ? '已完成对白确认'
              : '已完成对白确认'
        : extractionSummary.state === 'not_extracted'
          ? '未提取'
          : extractionSummary.state === 'extracted_empty'
            ? '已提取无候选'
            : extractedDialogLines.length > 0
              ? `待处理 ${extractedDialogLines.length}`
              : '待处理',
    },
    {
      key: 'shoot',
      label: '拍摄准备',
      tone: statusReady ? 'success' : 'default',
      text: statusReady
        ? '已具备进入视频生成流程的前置条件'
        : '请先完成信息提取确认',
    },
  ] as const

  useEffect(() => {
    if (!shotId) return
    if (loading || !shot) return
    const rememberedTab = editorTabMemoryRef.current[shotId]
    if (rememberedTab) {
      if (editorTabKey !== rememberedTab) setEditorTabKey(rememberedTab)
      tabAutoInitShotIdRef.current = shotId
      return
    }
    if (tabAutoInitShotIdRef.current === shotId) return
    setEditorTabKey(pendingConfirmCount > 0 ? 'confirm' : 'basic')
    tabAutoInitShotIdRef.current = shotId
  }, [editorTabKey, loading, pendingConfirmCount, shot, shotId])

  const handleEditorTabChange = useCallback(
    (key: string) => {
      const nextKey = key as 'basic' | 'confirm' | 'binding'
      setEditorTabKey(nextKey)
      if (shotId) {
        editorTabMemoryRef.current[shotId] = nextKey
        tabAutoInitShotIdRef.current = shotId
      }
    },
    [shotId],
  )

  const editorTabItems = [
    {
      key: 'basic',
      label: (
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: basicInfoReady ? '#22c55e' : '#f59e0b' }}
          />
          <span>1 基础信息</span>
        </div>
      ),
      children: (
        <ChapterShotBasicInfoSection
          title={title}
          scriptExcerpt={scriptExcerpt}
          saving={saving}
          semanticSaving={semanticSaving}
          semantic={{
            camera_shot: shotDetail?.camera_shot ?? undefined,
            angle: shotDetail?.angle ?? undefined,
            movement: shotDetail?.movement ?? undefined,
            duration: shotDetail?.duration ?? 4,
            action_beats: shotDetail?.action_beats ?? [],
          }}
          actionBeatPhases={preparationState?.action_beat_phases ?? []}
          onTitleChange={setTitle}
          onScriptExcerptChange={setScriptExcerpt}
          onSemanticChange={updateShotSemantic}
          onSave={() => void saveShot()}
        />
      ),
    },
    {
      key: 'confirm',
      label: (
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: confirmReady ? '#22c55e' : '#f59e0b' }}
          />
          <span>2 提取确认</span>
          {pendingConfirmCount > 0 ? <Badge count={pendingConfirmCount} size="small" /> : null}
        </div>
      ),
      children: (
        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-4 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-slate-900">提取确认工作区</div>
              <div className="text-[11px] text-slate-500 mt-1">
                这里集中处理系统提取出的资产和对白候选，确认完成后当前镜头才能真正进入生成阶段。
              </div>
              <div
                className="mt-3 rounded-lg border px-3 py-2 text-xs"
                style={{
                  borderColor:
                    extractionStateMeta.tone === 'green'
                      ? '#86efac'
                      : extractionStateMeta.tone === 'blue'
                        ? '#93c5fd'
                        : '#fcd34d',
                  background:
                    extractionStateMeta.tone === 'green'
                      ? '#f0fdf4'
                      : extractionStateMeta.tone === 'blue'
                        ? '#eff6ff'
                        : '#fffbeb',
                  color:
                    extractionStateMeta.tone === 'green'
                      ? '#166534'
                      : extractionStateMeta.tone === 'blue'
                        ? '#1d4ed8'
                        : '#92400e',
                }}
              >
                <div className="font-medium">{extractionStateMeta.title}</div>
                <div className="mt-1 opacity-90">{extractionStateMeta.description}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Tooltip title="同步执行提取，通常需要 10-120 秒，期间请勿关闭页面">
                <Button
                  type="primary"
                  size="small"
                  loading={extractingAssets || extractTaskActive}
                  disabled={extractTaskActive}
                  onClick={() => void extractAssets()}
                >
                  提取并刷新候选
                </Button>
              </Tooltip>
              {extractTask ? (
                <Button
                  size="small"
                  danger
                  icon={<CloseCircleOutlined />}
                  disabled={extractTask.cancelRequested}
                  onClick={() => void cancelExtractTask()}
                >
                  {extractTask.cancelRequested ? '正在取消' : '取消提取'}
                </Button>
              ) : null}
              {shot?.skip_extraction ? (
                <Button
                  size="small"
                  loading={skipExtractionUpdating}
                  onClick={() => void updateSkipExtraction(false)}
                >
                  恢复提取
                </Button>
              ) : (
                <Popconfirm
                  title="确认标记为无需提取？"
                  description="标记后当前镜头会直接按“提取确认已完成”处理。"
                  okText="确认"
                  cancelText="取消"
                  onConfirm={() => void updateSkipExtraction(true)}
                  okButtonProps={{ danger: true, loading: skipExtractionUpdating }}
                  cancelButtonProps={{ disabled: skipExtractionUpdating }}
                >
                  <Button
                    size="small"
                    danger
                    loading={skipExtractionUpdating}
                  >
                    无需提取
                  </Button>
                </Popconfirm>
              )}
            </div>
          </div>

          <ChapterShotAssetConfirmation
            projectId={projectId}
            extraction={extractionSummary}
            unionAssets={unionAssets}
            expandedKinds={expandedKinds}
            candidateActionIds={candidateActionIds}
            existenceByKindName={existenceByKindName}
            onToggleExpanded={toggleExpanded}
            onIgnoreCandidate={(asset) => void ignoreCandidate(asset)}
            onHandleNewAsset={(asset) => void handleNewAsset(asset)}
          />

          <Divider className="!my-1" />
          <ChapterShotDialogueConfirmation
            extraction={extractionSummary}
            savedDialogLines={savedDialogLines}
            extractedDialogLines={extractedDialogLines}
            batchDialogAdding={batchDialogAdding}
            dialogLoading={dialogLoading}
            dialogDeletingIds={dialogDeletingIds}
            dialogAddingKeys={dialogAddingKeys}
            onAcceptAll={() => void acceptAllExtractedDialogLines()}
            onIgnoreAll={() => void ignoreAllExtractedDialogLines()}
            onDeleteSavedDialogLine={(lineId) => void deleteSavedDialogLine(lineId)}
            onUpdateSavedDialogText={updateSavedDialogText}
            onAddExtractedDialogLine={(line) => void addExtractedDialogLine(line)}
            onIgnoreExtractedDialogLine={(line) => void ignoreExtractedDialogLine(line)}
            onUpdateExtractedDialogText={updateExtractedDialogText}
          />
        </div>
      ),
    },
    {
      key: 'binding',
      label: (
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: '#93c5fd' }} />
          <span>3 AI 推荐关联</span>
        </div>
      ),
      children: (
        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-4">
          <ChapterShotAssetBindingSection
            projectId={projectId}
            chapterId={chapterId}
            shotId={shotId}
            onReloadPreparationState={() => loadPreparationState({ silent: true })}
          />
        </div>
      ),
    },
  ] as const

  return (
    <Layout style={{ height: '100%', minHeight: 0, background: '#eef2f7' }}>
      <Header
        style={{
          padding: '0 16px',
          background: '#fff',
          borderBottom: '1px solid #e2e8f0',
          boxShadow: '0 2px 4px rgba(0,0,0,0.04)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <Link
          to={getChapterShotsPath(projectId, chapterId)}
          className="text-gray-600 hover:text-blue-600 flex items-center gap-1"
        >
          <ArrowLeftOutlined /> 返回分镜列表
        </Link>
        <Divider type="vertical" />

        <div className="min-w-0 flex-1 overflow-hidden">
          <Typography.Text
            strong
            className="truncate block"
            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {chapterIndex !== null ? `第${chapterIndex}章 · ${chapterTitle || '未命名'}` : chapterTitle || '章节'}
          </Typography.Text>
          <Typography.Text
            type="secondary"
            className="text-xs truncate block"
            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            分镜准备与信息确认
          </Typography.Text>
        </div>
      </Header>

      <Content
        style={{
          padding: 16,
          minHeight: 0,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Card
          title="分镜准备"
          style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
          bodyStyle={{
            padding: 12,
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {loading ? (
            <div className="flex-1 flex items-center justify-center min-h-[200px]">
              <Spin size="large" />
            </div>
          ) : !shot ? (
            <Empty description="无法加载分镜" />
          ) : (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 12, overflow: 'hidden' }}>
              <Card
                size="small"
                title={
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <Space size={8} className="min-w-0 overflow-hidden">
                      <span className="font-medium shrink-0">{`镜头（${shotsSorted.length}）`}</span>
                      {!multiSelectActive ? (
                        <Space size={4} className="min-w-0 text-[11px] text-slate-500">
                          <ReloadOutlined className="shrink-0" />
                          <span className="truncate" title="Command/Ctrl + 点击多选">
                            Command/Ctrl + 点击多选
                          </span>
                        </Space>
                      ) : (
                        <span className="text-xs font-normal text-slate-500 shrink-0">{`已选 ${selectedShotIds.length} 条`}</span>
                      )}
                    </Space>
                    {multiSelectActive ? (
                      <Space size={6} className="shrink-0">
                        <Tooltip title="批量提取并刷新（同步执行，可能较慢）">
                          <Button
                            size="small"
                            type="primary"
                            shape="circle"
                            icon={<ReloadOutlined />}
                            loading={batchExtractingAssets || extractTaskActive}
                            disabled={extractTaskActive}
                            onClick={() => void batchExtractAssets()}
                          />
                        </Tooltip>
                        <Tooltip title="清空选择">
                          <Button
                            size="small"
                            shape="circle"
                            icon={<ClearOutlined />}
                            onClick={() => setSelectedShotIds(shotId ? [shotId] : [])}
                          />
                        </Tooltip>
                      </Space>
                    ) : null}
                  </div>
                }
                style={{
                  width: 320,
                  minWidth: 260,
                  maxWidth: 420,
                  height: '100%',
                  minHeight: 0,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                }}
                bodyStyle={{ padding: 8, flex: 1, minHeight: 0, overflow: 'auto' }}
              >
                <div className="mb-3">
                  <Segmented
                    block
                    size="small"
                    value={shotListFilter}
                    onChange={(value) => setShotListFilter(value as ShotListFilter)}
                    options={shotListFilterOptions}
                  />
                  <div className="mt-2">
                    <Button
                      block
                      size="small"
                      disabled={!nextActionableShot || nextActionableShot.id === shotId}
                      type={!currentShotActionable && nextActionableShot && nextActionableShot.id !== shotId ? 'primary' : 'default'}
                      onClick={goNextActionableShot}
                    >
                      {nextActionableShot
                        ? !currentShotActionable && nextActionableShot.id !== shotId
                          ? `继续处理下一个待处理镜头：#${nextActionableShot.index}`
                          : `下一个待处理：#${nextActionableShot.index}`
                        : '当前没有待处理镜头'}
                    </Button>
                  </div>
                </div>
                <List
                  size="small"
                  dataSource={filteredShots}
                  locale={{ emptyText: <Empty description="暂无镜头" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
                  renderItem={(item) => {
                    const active = item.id === shotId
                    const selected = selectedShotIds.includes(item.id)
                    const itemBasicReady = !!item.title?.trim() && !!item.script_excerpt?.trim()
                    const itemConfirmStatus = getExtractionListStatus(item)
                    const itemIssueSummary = getShotPreparationIssueSummary(item)
                    const itemActionable = isActionablePreparationShot(item) || !itemBasicReady
                    const itemCompleted = itemBasicReady && !itemActionable
                    return (
                      <List.Item
                        onClick={(e) => handleShotListClick(item.id, e)}
                        style={{
                          cursor: 'pointer',
                          borderRadius: 10,
                          padding: '8px 10px',
                          background: active
                            ? itemCompleted
                              ? 'rgba(34,197,94,0.12)'
                              : 'rgba(59,130,246,0.10)'
                            : selected
                              ? 'rgba(59,130,246,0.06)'
                            : itemActionable
                              ? 'rgba(245,158,11,0.06)'
                              : itemCompleted
                                ? 'rgba(34,197,94,0.04)'
                              : undefined,
                          border: active
                            ? itemCompleted
                              ? '1px solid rgba(34,197,94,0.28)'
                              : '1px solid rgba(59,130,246,0.25)'
                            : selected
                              ? '1px solid rgba(59,130,246,0.18)'
                            : itemActionable
                              ? '1px solid rgba(245,158,11,0.22)'
                              : itemCompleted
                                ? '1px solid rgba(34,197,94,0.16)'
                              : '1px solid transparent',
                          boxShadow: active && itemCompleted ? '0 0 0 1px rgba(34,197,94,0.08) inset' : undefined,
                        }}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-medium truncate">
                              #{item.index} · {item.title?.trim() ? item.title : '未命名镜头'}
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              {active && itemCompleted ? (
                                <span
                                  className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium"
                                  style={{
                                    background: '#dcfce7',
                                    color: '#166534',
                                  }}
                                >
                                  当前已完成
                                </span>
                              ) : null}
                              <span
                                className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium"
                                style={{
                                  background:
                                    itemIssueSummary.tone === 'green'
                                      ? '#dcfce7'
                                      : itemIssueSummary.tone === 'blue'
                                        ? '#dbeafe'
                                        : '#fef3c7',
                                  color:
                                    itemIssueSummary.tone === 'green'
                                      ? '#166534'
                                      : itemIssueSummary.tone === 'blue'
                                        ? '#1d4ed8'
                                        : '#92400e',
                                }}
                              >
                                {itemIssueSummary.text}
                              </span>
                            </div>
                          </div>
                          <div className="text-xs text-gray-500 truncate">{item.script_excerpt ?? ''}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <span
                              className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium"
                              style={{
                                background: itemBasicReady ? '#dcfce7' : '#fef3c7',
                                color: itemBasicReady ? '#166534' : '#92400e',
                              }}
                            >
                              {itemBasicReady ? '基础已完成' : '基础待补'}
                            </span>
                            <span
                              className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium"
                              style={{
                                background: itemConfirmStatus.background,
                                color: itemConfirmStatus.color,
                              }}
                            >
                              {itemConfirmStatus.text}
                            </span>
                          </div>
                        </div>
                      </List.Item>
                    )
                  }}
                />
              </Card>

              <Card
                size="small"
                title={
                  <div className="space-y-3 min-w-0">
                    <div className="font-medium">{`镜头 #${shot.index} 详情`}</div>
                    <ChapterShotPreparationGuide
                      statusReady={statusReady}
                      checklistItems={checklistItems}
                      nextStepTitle={nextStepTitle}
                      nextStepDescription={nextStepDescription}
                      onContinueFlow={continueFlow}
                    />
                  </div>
                }
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: '100%',
                  minHeight: 0,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                }}
                bodyStyle={{ padding: 12, flex: 1, minHeight: 0, overflow: 'auto' }}
              >
                <Tabs
                  activeKey={editorTabKey}
                  onChange={handleEditorTabChange}
                  items={editorTabItems as any}
                />
              </Card>
            </div>
          )}
        </Card>
      </Content>

      <Modal
        title="关联资产"
        open={linkingOpen}
        onCancel={() => setLinkingOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setLinkingOpen(false)} disabled={linkingActionLoading}>
            取消
          </Button>,
          <Button
            key="link"
            type="primary"
            loading={linkingActionLoading}
            disabled={!linkingItem?.asset_id}
            onClick={() => void doLink()}
          >
            关联
          </Button>,
        ]}
        width={520}
      >
        <div className="space-y-3">
          <Typography.Text>{linkingHint}</Typography.Text>
          <DisplayImageCard
            title={<div className="truncate">{linkingName || '—'}</div>}
            imageAlt={linkingName || 'asset'}
            imageUrl={linkingThumb}
            placeholder={linkingLoading ? <Spin /> : '暂无图片'}
            enablePreview
            hoverable={false}
            size="small"
            imageHeightClassName="h-44"
          />
        </div>
      </Modal>
    </Layout>
  )
}
