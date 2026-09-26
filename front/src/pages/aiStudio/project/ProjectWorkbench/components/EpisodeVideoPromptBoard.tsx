/**
 * 集级视频提示词生产页面（项目工作台第 4 步；**进入分镜工作台之前**的主入口）。
 *
 * 用户要求（2026-09-19）：一整集的视频提示词要在**集级页面**里一次做完 ——
 * 批量生成（大模型，逐镜排队、可停止）或批量导入（巨日禄 Cookie 为主入口、粘贴/上传为辅），
 * 两者都进入**同一张整集预览确认表**，用户逐条校对、调整匹配、删改后统一确认保存；
 * 未确认前**一个字节都不写正式提示词**。
 *
 * 关键设计（都有对应的后端约束兜住）：
 * - 逐镜队列：一次只请求一镜（`/prompt-board/{cid}/draft`），点「停止」就不再发下一镜，
 *   已完成草稿保留，失败项可单独重试 —— 不做异步任务系统。
 * - **草稿落服务端**（2026-09-19 修「整集提示词草稿丢失」）：进页面先 `GET /drafts` 把
 *   上次生成到哪一步恢复到表里；每镜生成结束服务端已经存好了，刷新/关页面/中断都不再丢。
 * - **只重试失败/缺失**：`retryTargets()` 只挑 `failed / 已中断 / 未开始`，
 *   已完成（有草稿）与生成中的**绝不重发**（钱的问题，纯逻辑在 `promptBoardDrafts.ts`，有测试）。
 * - **防重复付费是服务端保证**：发起前先 `POST /drafts/claim` 占租约，抢不到就跳过并给中文提示
 *   （按钮 disabled 只是 UI，真正的闸门在服务端；租约过期后可继续，中断不会永久锁死）。
 * - **只有「确认保存」写正式列**：草稿永远不自动写 `shot_details.video_prompt`；
 *   保存成功后服务端才会清掉对应草稿（响应里的 `cleared_draft_count`）。
 * - 来源由流程决定：大模型草稿=llm（必须带服务端 HMAC 签名令牌，**没有令牌就只能按人工内容保存**）、
 *   巨日禄=jurilu、其它外部导入=external_import、工作台人工修改=manual；本页只按流程分组。
 * - 演练草稿（`status=dry_run`）在表里明确标注且**不可保存**。
 * - 数量不一致 / 编号重复 / 无法匹配 → 默认阻止保存，必须显式打开「仅保存已匹配项」。
 * - 页面上**不显示"已确认数量"**（系统当前没有可靠的确认状态）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Drawer,
  Empty,
  Input,
  Popconfirm,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
  message,
} from 'antd'
import { DeleteOutlined, ImportOutlined, ReloadOutlined, StopOutlined, ThunderboltOutlined } from '@ant-design/icons'
import {
  claimShotDraft,
  deleteShotDrafts,
  draftVideoPrompt,
  fetchPromptBoard,
  fetchPromptBoardDrafts,
  parsePromptImport,
  previewJuriluImport,
  releaseShotDraft,
  savePromptBoard,
  saveShotDraft,
  type PromptBoardDraft,
  type PromptBoardDraftState,
  type PromptBoardMode,
  type PromptBoardOrigin,
  type PromptBoardShot,
  extractJuriluDiagnostics,
  type JuriluScriptGroup,
} from '../../../../../services/llmPipelineApi'
import { StudioChaptersService, StudioShotsService } from '../../../../../services/generated'
import { classifyGenerationFailure, failureText } from '../../../components/generationGate'
import { useChapters, newId } from '../hooks/useProjectData'
import { nextChapterIndex } from '../../../chapter/chapterIndexing'
import JuriluScriptGroupPicker from './JuriluScriptGroupPicker'
import {
  applyGroupSwitch,
  buildJuriluEntries,
  clearRowsBeforeMatch,
  countMatchedEntries,
  groupCoverageNotice,
  normalizeScriptGroups,
  planCreateMissingShots,
  planGroupMatch,
  resolveJuriluFlow,
  resolveScriptSelection,
  saveButtonText,
  summarizeScriptGroups,
  wholeGroupSaveNotice,
  type JuriluMatch,
  type JuriluPreviewEntry,
  type ShortageOptionKey,
} from './juriluScriptGroups'
import {
  PHASE_META,
  SAVED_META,
  buildShotDraftStatuses,
  draftRestoreNotice,
  formatBusyNotice,
  hadDraftRow,
  includedShotConflicts,
  needsGeneration,
  orphanPlaceholderShotIds,
  resolveSaveOrigin,
  restorePlanFor,
  restoredRowsFromDrafts,
  retryTargets,
  selectGenerationTargets,
  shouldDropClaimPlaceholder,
  sourceLabel,
  type DraftPhase,
  type ShotDraftStatus,
} from './promptBoardDrafts'
import { buildPromptBoardSaveBody, juriluScriptScopeError } from './promptBoardSaveBody'
import { buildUserFacingMessage, showUserError, showUserWarning, toUserFacingText } from '../../../components/userFacingMessage'
import { TechnicalDetailSection } from './workbench/TechnicalDetailCollapse.tsx'

type RowStatus = 'ok' | 'draft' | 'dry_run' | 'failed' | 'interrupted' | 'busy' | 'skipped' | 'unmatched' | 'duplicate'

type PreviewRow = {
  key: string
  shotId: string
  code: string
  /** 镜头内容（标题 + 剧本摘录），供人工核对 */
  shotText: string
  prompt: string
  origin: PromptBoardOrigin
  /** 匹配方式：number（编号）/ order（顺序）/ manual（人工调整）/ cookie（巨日禄编号）/ restore（服务端草稿恢复） */
  matchBy: string
  status: RowStatus
  message: string
  draftToken?: string
  /** 用户是否改过草稿正文（改过就不再算大模型原样草稿） */
  edited: boolean
  include: boolean
  regenerating?: boolean
  /** 服务端草稿阶段（恢复来的行才有；用于状态提示） */
  phase?: DraftPhase
  /** 正文能不能按大模型草稿保存（没有服务端令牌就不行） */
  saveable?: boolean
  /** 巨日禄脚本组（script_id）：统一预览表的「脚本组」列 */
  scriptId?: string
  /** 巨日禄那边的分镜序号：统一预览表的「巨日禄序号」列 */
  juriluSeq?: string
}

const ORIGIN_META: Record<PromptBoardOrigin, { label: string; color: string }> = {
  llm_draft: { label: '大模型生成', color: 'blue' },
  jurilu_import: { label: '巨日禄导入', color: 'purple' },
  external_import: { label: '外部导入', color: 'geekblue' },
  manual: { label: '人工修改', color: 'default' },
}

const STATUS_META: Record<RowStatus, { label: string; color: string }> = {
  ok: { label: '匹配正常', color: 'green' },
  draft: { label: '草稿（未保存）', color: 'blue' },
  // 用户语言：这一行没有真正调用大模型，所以不算可保存的草稿。
  // （原来的「演练草稿」是开发术语，普通生产页面不该出现。）
  dry_run: { label: '未真实生成（不可保存）', color: 'gold' },
  failed: { label: '失败', color: 'red' },
  interrupted: { label: '已中断（可重试）', color: 'orange' },
  busy: { label: '正在生成中（已跳过）', color: 'orange' },
  skipped: { label: '已跳过', color: 'default' },
  unmatched: { label: '无法匹配', color: 'red' },
  duplicate: { label: '编号重复', color: 'red' },
}

/** 单镜生成的结果（页面内部口径；不直接等于后端返回，已归一）。 */
type GenerateOutcome = {
  shotId: string
  code: string
  status: 'draft' | 'dry_run' | 'failed' | 'skipped' | 'busy' | 'error'
  prompt: string
  draftToken: string
  message: string
  persisted: boolean
}

type EpisodeVideoPromptBoardProps = {
  projectId: string
  chapterId: string | null
  chapterLabel: string
  /** 进入分镜工作台（集级确认保存后再去逐镜绑定/生成） */
  onEnterStudio?: () => void
  /** 保存后继续第 2 步「资产准备」 */
  onContinueAssets?: () => void
  /** 已有资产，直接去第 4 步「资产与声音绑定」 */
  onGoBinding?: () => void
}

export function EpisodeVideoPromptBoard({
  projectId,
  chapterId: chapterIdProp,
  chapterLabel: chapterLabelProp,
  onEnterStudio,
  onContinueAssets,
  onGoBinding,
}: EpisodeVideoPromptBoardProps) {
  /**
   * **目标章节**（2026-09-20 升级要求：选完脚本组后可以选本项目已有章节，或直接新建章节）。
   *
   * 为什么在组件内部维护：本页是"集级"页面，页面级选中集来自 URL（`?chapter=`）。
   * 巨日禄整组导入的目标集完全可以与 URL 里那一集不同（例如临时验收章节），
   * 所以内部保留一个目标集，默认跟随 prop；后续所有读写都用这个变量。
   */
  const [targetChapterId, setTargetChapterId] = useState<string | null>(chapterIdProp ?? null)
  useEffect(() => {
    setTargetChapterId(chapterIdProp ?? null)
  }, [chapterIdProp])
  const chapterId = targetChapterId
  /** 项目章节列表（目标章节选择器用；与「章节列表」同一个 hook / 同一个接口） */
  const { chapters: projectChapters, loading: chaptersLoading, refresh: refreshChapters } = useChapters(projectId)
  const [creatingChapter, setCreatingChapter] = useState(false)

  const chapterLabel = useMemo(() => {
    if (!chapterId) return chapterLabelProp || '未选择章节'
    if (chapterId === chapterIdProp) return chapterLabelProp || '未选择章节'
    const matched = projectChapters.find((item) => item.id === chapterId)
    if (!matched) return `章节 ${chapterId}`
    return `第${matched.index}集 · ${matched.title}`
  }, [chapterId, chapterIdProp, chapterLabelProp, projectChapters])

  const chapterOptions = useMemo(
    () =>
      [...projectChapters]
        .sort((a, b) => a.index - b.index)
        .map((item) => ({
          value: item.id,
          label: `第${item.index}集 · ${item.title}`,
          shotCount: Number(item.storyboardCount) || 0,
        })),
    [projectChapters],
  )

  /**
   * 换目标章节 = 换了一张要写的表：旧集的匹配结果、勾选与"已匹配组"标记**一律清掉**。
   * 与"换脚本组先清表"同一条口径 —— 跨章节混表同样是脏数据。
   */
  const switchTargetChapter = useCallback(
    (next: string, opts: { silent?: boolean } = {}) => {
      if (!next || next === targetChapterId) return
      setTargetChapterId(next)
      setRows([])
      setIssues([])
      setCountMismatch(false)
      setAllowPartial(false)
      setJuriluMatch(null)
      setShortageDismissed(false)
      if (!opts.silent) message.info('已切换目标章节：预览表已清空，缺口与已匹配标记也清空（不会把上一集的匹配结果带过去）', 6)
    },
    [targetChapterId],
  )

  /** 新建章节：**复用项目既有的建章节能力**（章节列表里那一套接口与序号口径）。 */
  const createChapter = useCallback(
    async (input: { title: string; summary: string }) => {
      if (!projectId) return
      setCreatingChapter(true)
      try {
        const nextIndex = nextChapterIndex(projectChapters.map((item) => item.index))
        const createdId = newId('c')
        await StudioChaptersService.createChapterApiV1StudioChaptersPost({
          requestBody: {
            id: createdId,
            project_id: projectId,
            index: nextIndex,
            title: input.title,
            summary: input.summary,
            storyboard_count: 0,
            status: 'draft',
          } as never,
        })
        message.success(`章节创建成功：第${nextIndex}集 · ${input.title}（未建任何镜头、未写提示词）`, 6)
        // 让本页的目标章节指向新建的集：后面的建镜头 / 匹配 / 保存都写在这一集
        // （silent：上面已经给过"章节创建成功"的提示，不再叠一条切换提示）
        switchTargetChapter(createdId, { silent: true })
        await refreshChapters()
      } catch (error) {
        /* 审计 §4.5 模式 6（`:273`）：改前把后端原文拼进 toast。现在主区只出中文结论，
           原文（掩码后）由 showUserError 收进「技术详情」日志（`rememberTechnicalDetail`）。 */
        void showUserError(error, '创建章节失败：请稍后重试')
      } finally {
        setCreatingChapter(false)
      }
    },
    [projectChapters, projectId, refreshChapters, switchTargetChapter],
  )

  const [shots, setShots] = useState<PromptBoardShot[]>([])
  const [rows, setRows] = useState<PreviewRow[]>([])
  const [loading, setLoading] = useState(false)
  const [creatingShots, setCreatingShots] = useState(false)
  /** 建镜的在途闸门：状态更新是异步的，靠 state 挡不住连点 */
  const createShotsInFlightRef = useRef(false)
  const [mode, setMode] = useState<PromptBoardMode>('fill_empty')
  const [selectedShotIds, setSelectedShotIds] = useState<string[]>([])
  const [allowPartial, setAllowPartial] = useState(false)
  const [issues, setIssues] = useState<string[]>([])
  /**
   * 最近一次巨日禄抓取 / 匹配失败的**原始诊断**（已掩码 + 洗过）。
   *
   * 审计 §4.5 模式 6（`:1073,1216`）：改前把「后端原文｜脱敏诊断」整串扔进 toast
   * 和页面的问题清单（都是**主区**）。现在主区只给「登录凭证可能已失效」这类结论，
   * 诊断收进下面默认收起的「技术详情」。 */
  const [juriluFailureDetail, setJuriluFailureDetail] = useState('')
  const [countMismatch, setCountMismatch] = useState(false)
  const [running, setRunning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [purging, setPurging] = useState(false)
  const stopRef = useRef(false)

  // 服务端草稿（刷新/中断不丢的那一份）
  const [drafts, setDrafts] = useState<PromptBoardDraft[]>([])
  const [draftNote, setDraftNote] = useState('')
  const [restoring, setRestoring] = useState(false)
  const [runningShotIds, setRunningShotIds] = useState<string[]>([])
  /** 本次页面持有的租约令牌：收尾时释放用（**离开页面不解锁**，见 generateOne 的注释） */
  const claimTokensRef = useRef<Map<string, string>>(new Map())

  // 导入抽屉（巨日禄 Cookie 主入口 + 其它外部平台粘贴/上传）
  const [importOpen, setImportOpen] = useState(false)
  const [importTab, setImportTab] = useState<'jurilu' | 'other'>('jurilu')
  const [juriluUrl, setJuriluUrl] = useState('')
  const [juriluCookie, setJuriluCookie] = useState('')
  const [juriluAuthorization, setJuriluAuthorization] = useState('')
  const [juriluAuthMode, setJuriluAuthMode] = useState('auto')
  /** 完整 Cookie 自带 Authorization= 项时，HTTP 头只发 Cookie（自动切到「不发送」）。 */
  const [juriluAuthModeTouched, setJuriluAuthModeTouched] = useState(false)
  const [juriluReferer, setJuriluReferer] = useState('')

  /** Cookie / Authorization 只在本次抓取内存里存活：抓取结束、关抽屉、取消、离开页面立即清空。 */
  const clearJuriluCredentials = useCallback(() => {
    setJuriluCookie('')
    setJuriluAuthorization('')
    setJuriluReferer('')
  }, [])
  const [juriluFetching, setJuriluFetching] = useState(false)
  /**
   * 巨日禄**脚本组选择**（2026-09-20 用户要求）：
   * 一次抓取会拿到三个 scriptId、合计 109 条分镜，**默认不跨 scriptId 合并**，
   * 必须由用户明确选一组之后，才把那一组送进统一预览与镜头匹配。
   *
   * - `scriptGroups`   后端返回的脚本组（第一步记录的可用字段名等都在里面）
   * - `selectedScriptId` 用户当前勾选（**'' = 默认一组都不选**）
   * - `matchedScriptId`  当前表里的 rows 属于哪一组（表抬头与保存都要它）
   */
  const [scriptGroups, setScriptGroups] = useState<JuriluScriptGroup[]>([])
  const [selectedScriptId, setSelectedScriptId] = useState('')
  /** 已完成匹配的唯一凭证（后端 preview 已返回并进表）：哪一组 + 哪一集 + 后端报告的本集镜头数。 */
  const [juriluMatch, setJuriluMatch] = useState<JuriluMatch | null>(null)
  const [juriluMatching, setJuriluMatching] = useState(false)
  /** 脚本组状态机给出的中文提示（选组 / 换组 / 后端要求重选时逐条展示） */
  const [juriluNotices, setJuriluNotices] = useState<string[]>([])
  /**
   * 选组后**第二次** preview 要复用的凭证。
   *
   * 只活在"本次导入会话"的内存里（React state 之外、不写日志、不回显）：
   * 抓取 → 选组 → 匹配 是一个连续动作，中途清掉凭证会让第二步永远发不出去。
   * 生命周期：点「放弃本次导入」、离开页面、组件卸载 → 立即清空。
   */
  const juriluSessionRef = useRef<{
    url: string
    cookie: string
    authorization: string
    auth_mode: string
    referer: string
  } | null>(null)
  const [otherText, setOtherText] = useState('')
  const [parsing, setParsing] = useState(false)

  const shotById = useMemo(() => new Map(shots.map((shot) => [shot.shot_id, shot])), [shots])
  /**
   * **永远最新**的镜头表（ref，不是闭包快照）。
   *
   * 为什么需要它（2026-09-20 页面自查实测到的真实缺陷）：
   * 「创建缺失镜头 → 重新匹配」是一条**跨多个 await 的长链路**，
   * 其中 `applyImportPreview` / `toRow` 是点击那一刻的闭包，里头的 `shots` 还是"建镜之前"的旧值。
   * 结果：新镜头其实已经建好、shot_id 也匹配上了，但表里的「镜头编号 / 镜头内容」被算成空 /（未匹配）。
   * 用 ref 取当下最新的镜头表，任何异步链路都不会再拿到过期快照。
   */
  const shotByIdRef = useRef(shotById)
  useEffect(() => {
    shotByIdRef.current = shotById
  }, [shotById])

  /** 逐镜状态（每一镜都有一行，含"未开始"）：状态表与"重试谁"都以它为准。 */
  const statuses = useMemo(() => buildShotDraftStatuses({ shots, drafts }), [shots, drafts])
  const statusById = useMemo(() => new Map(statuses.map((item) => [item.shotId, item])), [statuses])

  /** 把服务端草稿状态并进预览表（**服务端是草稿的唯一真相**）。 */
  const mergeRestoredDraftRows = useCallback(
    (nextStatuses: ShotDraftStatus[], boardShots: PromptBoardShot[]) => {
      const restored = restoredRowsFromDrafts(nextStatuses)
      if (!restored.length) return
      const shotMap = new Map(boardShots.map((shot) => [shot.shot_id, shot]))
      setRows((prev) => {
        const restoredIds = new Set(restored.map((item) => item.shotId))
        // 用户改过的行不覆盖（正文是用户正在编辑的），只保留
        const editedIds = new Set(prev.filter((row) => row.edited).map((row) => row.shotId))
        const kept = prev.filter((row) => !(row.origin === 'llm_draft' && restoredIds.has(row.shotId) && !editedIds.has(row.shotId)))
        const next = [...kept]
        for (const item of restored) {
          if (editedIds.has(item.shotId)) continue
          const shot = shotMap.get(item.shotId)
          const existing = next.find((row) => row.key === `llm_draft:${item.shotId}`)
          const row: PreviewRow = {
            key: `llm_draft:${item.shotId}`,
            shotId: item.shotId,
            code: shot?.code ?? existing?.code ?? '',
            shotText: shot ? `${shot.title}${shot.script_excerpt ? `｜${shot.script_excerpt.slice(0, 40)}` : ''}` : (existing?.shotText ?? ''),
            prompt: item.prompt,
            origin: item.origin,
            matchBy: 'restore',
            status: item.status,
            message: item.message,
            draftToken: item.draftToken || undefined,
            edited: false,
            include: item.include,
            phase: item.phase,
            saveable: item.saveable,
          }
          if (existing) Object.assign(existing, row)
          else next.push(row)
        }
        // 同一镜头被两条记录指向 → 恢复来的草稿行让位，避免"确认保存"时才撞唯一性
        const conflicts = includedShotConflicts(next)
        const ordered = next.map((row) =>
          conflicts.has(row.shotId) && row.matchBy === 'restore'
            ? { ...row, include: false, message: '同一镜头还有另一条记录：已取消勾选，请先决定保留哪一条。' }
            : row,
        )
        // 按集内镜头顺序排（sort 在 V8 里是稳定的）：恢复来的行与本地行不再交错，
        // 否则"第一行"可能是一天前的演练占位，而真正要确认的草稿沉在下面
        const orderOf = (shotId: string) => boardShots.findIndex((shot) => shot.shot_id === shotId)
        return ordered.slice().sort((a, b) => {
          const left = orderOf(a.shotId)
          const right = orderOf(b.shotId)
          return (left < 0 ? Number.MAX_SAFE_INTEGER : left) - (right < 0 ? Number.MAX_SAFE_INTEGER : right)
        })
      })
    },
    [],
  )

  const applyDraftState = useCallback(
    (state: PromptBoardDraftState, boardShots: PromptBoardShot[]) => {
      const list = state.shots ?? []
      setDrafts(list)
      const nextStatuses = buildShotDraftStatuses({ shots: boardShots, drafts: list })
      setDraftNote(draftRestoreNotice(nextStatuses))
      mergeRestoredDraftRows(nextStatuses, boardShots)
    },
    [mergeRestoredDraftRows],
  )

  /** 只刷新服务端草稿状态（只读、不触网模型）：状态表与"重试谁"立刻跟上。 */
  const refreshDraftState = useCallback(async (): Promise<PromptBoardDraft[]> => {
    if (!chapterId) return []
    try {
      const state = await fetchPromptBoardDrafts(chapterId)
      const list = state.shots ?? []
      setDrafts(list)
      return list
    } catch (error) {
      /* 审计 §4.5 模式 6（`:450`）：后端原文不再直渲（原文进技术详情日志）。 */
      void showUserWarning(error, '读取上次生成进度失败：请稍后重试')
      return []
    }
  }, [chapterId])

  const loadBoard = useCallback(async () => {
    if (!chapterId) return
    setLoading(true)
    try {
      const data = await fetchPromptBoard(chapterId)
      const list = data.shots ?? []
      setShots(list)
      setSelectedShotIds(list.map((shot) => shot.shot_id))
      // 进页面就恢复服务端草稿：用户一眼看到"上次生成到哪了"
      try {
        const state = await fetchPromptBoardDrafts(chapterId)
        applyDraftState(state, list)
      } catch (error) {
        setDraftNote('上次生成进度读取失败：本页只显示当前内容，刷新可能丢。')
        /* 审计 §4.5 模式 6（`:469`）：主区只留中文结论，原文进技术详情。 */
        void showUserWarning(error, '读取上次生成进度失败：本页只显示当前内容，刷新可能丢。')
      }
    } catch (error) {
      /* 审计 §4.5 模式 6（`:472`）。 */
      void showUserError(error, '读取本集镜头失败：请刷新页面重试')
    } finally {
      setLoading(false)
    }
  }, [applyDraftState, chapterId])

  useEffect(() => {
    void loadBoard()
  }, [loadBoard])

  // 离开页面（含切换步骤/关闭标签）时清空敏感输入与本次导入会话
  useEffect(
    () => () => {
      clearJuriluCredentials()
      juriluSessionRef.current = null
    },
    [clearJuriluCredentials],
  )

  /**
   * **刻意不在离开页面时释放租约**：此刻可能有一次真实调用正在飞，
   * 提前放锁会让另一个请求抢到同一镜 → 重复付费。
   * 租约自带过期时间（服务端 300 秒，中断后读层渲染成"已中断"），到点自然可继续。
   */

  /** 整表唯一性：被勾选的行里，同一个镜头只能被一条记录占用。 */
  const findConflictingRow = useCallback(
    (shotId: string, ignoreKey: string): PreviewRow | null =>
      rows.find((row) => row.key !== ignoreKey && row.include && row.shotId && row.shotId === shotId) ?? null,
    [rows],
  )

  /** 保存前的整表唯一性校验（**在按来源分组之前**做，避免不同来源先后写同一镜头）。 */
  const validateTableUnique = useCallback(
    (candidateRows: PreviewRow[]): string | null => {
      const seen = new Map<string, string>()
      for (const row of candidateRows) {
        if (!row.include || !row.prompt.trim() || !row.shotId) continue
        const code = row.code || row.shotId
        const other = seen.get(row.shotId)
        if (other) return `镜头 ${code} 被两条记录指向（${other} 与 ${row.origin}）：请先删掉或改开其中一条。`
        seen.set(row.shotId, row.origin)
      }
      return null
    },
    [],
  )

  const updateRow = useCallback((key: string, patch: Partial<PreviewRow>) => {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }, [])

  const toRow = useCallback(
    (input: {
      shotId: string
      prompt: string
      origin: PromptBoardOrigin
      matchBy: string
      status: RowStatus
      message?: string
      draftToken?: string
      edited?: boolean
      scriptId?: string
      juriluSeq?: string
    }): PreviewRow => {
      // 取**当下最新**的镜头表（ref），避免长链路里用到建镜前的旧快照
      const shot = shotByIdRef.current.get(input.shotId)
      return {
        key: `${input.origin}:${input.shotId}:${Math.random().toString(36).slice(2, 8)}`,
        shotId: input.shotId,
        code: shot?.code ?? '',
        shotText: shot ? `${shot.title}${shot.script_excerpt ? `｜${shot.script_excerpt.slice(0, 40)}` : ''}` : '（未匹配）',
        prompt: input.prompt,
        origin: input.origin,
        matchBy: input.matchBy,
        status: input.status,
        message: input.message ?? '',
        draftToken: input.draftToken,
        edited: Boolean(input.edited),
        include: input.status !== 'unmatched' && input.status !== 'duplicate' && input.status !== 'dry_run' && input.status !== 'busy',
        scriptId: input.scriptId,
        juriluSeq: input.juriluSeq,
      }
    },
    [],
  )

  /**
   * 把一次生成结果落进预览表。
   *
   * 关键取舍：**空正文的结果不清空已有草稿正文**（busy/skipped/中断都不是"内容没了"），
   * 否则用户点一次"停止"就会看到草稿变成空白 —— 那正是这次要修的问题。
   */
  const applyOutcomeToRows = useCallback(
    (outcome: GenerateOutcome) => {
      setRows((prev) => {
        const stableKey = `llm_draft:${outcome.shotId}`
        const existing =
          prev.find((row) => row.key === stableKey) ??
          prev.find((row) => row.shotId === outcome.shotId && row.origin === 'llm_draft' && row.matchBy === 'generate')
        const rowStatus: RowStatus =
          outcome.status === 'draft'
            ? 'draft'
            : outcome.status === 'dry_run'
              ? 'dry_run'
              : outcome.status === 'busy'
                ? 'busy'
                : outcome.status === 'skipped'
                  ? 'skipped'
                  : 'failed'
        const shot = shotById.get(outcome.shotId)
        const nextRow: PreviewRow = {
          key: existing?.key ?? stableKey,
          shotId: outcome.shotId,
          code: outcome.code || shot?.code || existing?.code || '',
          shotText: shot
            ? `${shot.title}${shot.script_excerpt ? `｜${shot.script_excerpt.slice(0, 40)}` : ''}`
            : (existing?.shotText ?? ''),
          // 没有新正文就保留旧正文：中断/跳过/失败都不该把已付费的草稿抹成空白
          prompt: outcome.prompt.trim() ? outcome.prompt : (existing?.prompt ?? ''),
          origin: 'llm_draft',
          matchBy: 'generate',
          status: rowStatus,
          message: outcome.message || existing?.message || '',
          draftToken: outcome.draftToken || existing?.draftToken,
          edited: outcome.status === 'draft' ? false : Boolean(existing?.edited),
          include: outcome.status === 'draft',
          saveable: outcome.status === 'draft' ? true : Boolean(existing?.saveable),
        }
        return existing ? prev.map((row) => (row.key === existing.key ? nextRow : row)) : [...prev, nextRow]
      })
    },
    [shotById],
  )

  /**
   * **生成一镜**（页面唯一的付费入口，所有按钮最终都走这里）。
   *
   * 顺序刻意如此：
   * 1. 先 `POST /drafts/claim` 占服务端租约 —— 抢不到就**跳过并给中文提示**，绝不发起付费调用。
   *    这是"防重复付费"的硬闸门（按钮 disabled 挡不住并发与多标签页）。
   * 2. 再 `POST /draft`，并把租约令牌带回去（服务端认出自己的租约直接续租）。
   * 3. 收尾：非成功路径释放租约；若这一行**完全是这次占位新建的空行**（演练/跳过），整行清掉，
   *    免得它永远显示成"已中断"。已有草稿行绝不动（那是付过费的）。
   * 4. 中断/网络失败：**释放租约但不动正文**（把已生成的草稿误标成失败就是丢钱）。
   */
  const generateOne = useCallback(
    async (shotId: string, opts: { mode?: PromptBoardMode } = {}): Promise<GenerateOutcome> => {
      const status = statusById.get(shotId)
      const code = status?.code ?? shotById.get(shotId)?.code ?? shotId
      const modeToUse = opts.mode ?? mode
      if (!chapterId) {
        return { shotId, code, status: 'error', prompt: '', draftToken: '', message: '未选择集', persisted: false }
      }
      const preHadRow = hadDraftRow(status)
      let claimToken = ''
      try {
        const claim = await claimShotDraft(chapterId, { shot_id: shotId })
        if (!claim.claimed) {
          // 「该镜头正在生成中，已跳过」——并发/重复提交时的中文提示，不静默失败
          message.warning(formatBusyNotice(claim.code || code, claim.reason), 6)
          await refreshDraftState()
          return {
            shotId,
            code: claim.code || code,
            status: 'busy',
            prompt: '',
            draftToken: '',
            message: claim.reason || '该镜头正在生成中',
            persisted: false,
          }
        }
        claimToken = String(claim.claim_token || '')
      } catch (error) {
        const text = error instanceof Error ? error.message : '这一镜暂时排不上'
        /* 审计 §4.5 模式 6（`:647`）：「申请生成租约失败」是开发术语，
           主区改成用户能懂的一句；原文（掩码后）进技术详情。 */
        void showUserError(error, `镜头 ${code} 暂时排不上：请稍后重试`)
        return { shotId, code, status: 'error', prompt: '', draftToken: '', message: text, persisted: false }
      }
      claimTokensRef.current.set(shotId, claimToken)
      setRunningShotIds((prev) => (prev.includes(shotId) ? prev : [...prev, shotId]))
      try {
        const result = await draftVideoPrompt(chapterId, { shot_id: shotId, mode: modeToUse, claim_token: claimToken })
        const prompt = String(result.prompt ?? '')
        const persisted = Boolean(result.persisted)
        const statusOut = result.status
        if (statusOut === 'busy') {
          message.warning(formatBusyNotice(result.code || code, result.reason ?? ''), 6)
        }
        if (statusOut === 'draft' && !persisted) {
          // 真有正文却没说"已落库"：宁可吵一声，也不能让草稿悄悄只活在内存里
          message.warning(`镜头 ${code} 的草稿未确认写入服务端（刷新可能丢）：请重试这一镜`, 8)
        }
        if (statusOut !== 'draft') {
          await releaseShotDraft(chapterId, { shot_id: shotId, claim_token: claimToken }).catch(() => undefined)
          // 注意：演练模式回的正文是**占位**，后端一个字节都没落库 → 不算"有草稿"
          if (shouldDropClaimPlaceholder({ preHadRow, status: statusOut, persisted })) {
            // 这一行完全是这次占位新建的空行（演练/跳过）→ 整行清掉，别留下假的"已中断"
            await deleteShotDrafts(chapterId, [shotId]).catch(() => undefined)
          } else {
            // 原来就有草稿（失败原因 / 已完成正文）→ 把状态写回去，claim 不改动它的观感
            const plan = restorePlanFor(status)
            if (plan.action !== 'none') {
              await saveShotDraft(chapterId, {
                shot_id: shotId,
                status: plan.action === 'ok' ? 'ok' : 'failed',
                prompt: plan.prompt,
                error: plan.error,
                source: plan.source || undefined,
                model: plan.model || undefined,
                meta: plan.meta,
              }).catch(() => undefined)
            }
          }
        }
        return {
          shotId,
          code: result.code || code,
          status: statusOut,
          prompt,
          draftToken: String(result.draft_token ?? ''),
          message: result.reason ?? '',
          persisted,
        }
      } catch (error) {
        await releaseShotDraft(chapterId, { shot_id: shotId, claim_token: claimToken }).catch(() => undefined)
        const failure = classifyGenerationFailure(error, 'llm')
        const text = failureText(failure)
        // 被演练门禁/未确认拦下 = 根本没有付费调用：不记失败，把占位行也收干净
        if (failure.state === 'dry_run') {
          if (shouldDropClaimPlaceholder({ preHadRow, status: 'skipped', persisted: false })) {
            await deleteShotDrafts(chapterId, [shotId]).catch(() => undefined)
          }
          return { shotId, code, status: 'skipped', prompt: '', draftToken: '', message: text, persisted: false }
        }
        return { shotId, code, status: 'failed', prompt: '', draftToken: '', message: text, persisted: false }
      } finally {
        claimTokensRef.current.delete(shotId)
        setRunningShotIds((prev) => prev.filter((id) => id !== shotId))
      }
    },
    [chapterId, mode, refreshDraftState, shotById, statusById],
  )

  /** 逐镜队列：一次只请求一镜；点停止后不再发下一镜，已完成的草稿留在服务端。 */
  const runGenerate = useCallback(
    async (targetShotIds: string[]) => {
      if (!chapterId || !targetShotIds.length) return
      stopRef.current = false
      setRunning(true)
      const tally = { done: 0, dryRun: 0, failed: 0, skipped: 0, busy: 0 }
      const outcomes: GenerateOutcome[] = []
      message.info(`开始逐镜生成（本次 ${targetShotIds.length} 镜，一次一镜；已有草稿的不重发）`, 5)
      for (const shotId of targetShotIds) {
        if (stopRef.current) {
          message.info(
            '已停止：后续镜头不再请求。已完成的草稿都保存在服务端（刷新/重开页面都在），失败与未开始的镜头可点「重试失败 / 未开始」继续。',
            8,
          )
          break
        }
        // eslint-disable-next-line no-await-in-loop
        const outcome = await generateOne(shotId)
        outcomes.push(outcome)
        if (outcome.status === 'draft') tally.done += 1
        else if (outcome.status === 'dry_run') tally.dryRun += 1
        else if (outcome.status === 'busy') tally.busy += 1
        else if (outcome.status === 'failed' || outcome.status === 'error') tally.failed += 1
        else tally.skipped += 1
        applyOutcomeToRows(outcome)
      }
      setRunning(false)
      let list = await refreshDraftState()
      // 兜底清扫：这一轮"什么都没产出"却在服务端留下空 running 行的镜头（逐镜收尾漏网的那些）
      const orphans = orphanPlaceholderShotIds({ outcomes, drafts: list })
      if (orphans.length && chapterId) {
        await deleteShotDrafts(chapterId, orphans).catch(() => undefined)
        list = await refreshDraftState()
      }
      mergeRestoredDraftRows(buildShotDraftStatuses({ shots, drafts: list }), shots)
      message.success(
        `本轮结束：草稿成功 ${tally.done} 镜 · 失败 ${tally.failed} 镜 · 跳过 ${tally.skipped + tally.busy} 镜` +
          // 「未真实生成」= 本次没有真正调用大模型、不产生费用，也就没有可保存的正文
          (tally.dryRun ? ` · 未真实生成 ${tally.dryRun} 镜（未保存，不产生费用）` : ''),
        6,
      )
    },
    [applyOutcomeToRows, chapterId, generateOne, mergeRestoredDraftRows, refreshDraftState, shots],
  )

  /** 本次会生成哪些镜头：**失败 / 已中断 / 未开始**；已完成与生成中的不重发。 */
  const generateTargets = useMemo(
    () => selectGenerationTargets({ statuses, mode, selectedShotIds }),
    [mode, selectedShotIds, statuses],
  )

  /** 「重试失败 / 未开始」的候选（与批量同一口径：已完成与生成中的绝不在内）。 */
  const retryShotIds = useMemo(() => retryTargets({ statuses, mode, selectedShotIds }), [mode, selectedShotIds, statuses])

  /**
   * 单镜显式操作（某一行/状态表里点"生成这一镜"）：用 `overwrite_selected` 口径。
   *
   * 为什么不用当前模式：显式点单镜就是"我就要这一镜的草稿"，而 `/draft` **从不写正式列**，
   * 「只填充空白」那道门是给批量操作防静默覆盖用的；否则点了没反应（后端 skip）更让人误解。
   */
  const perShotMode: PromptBoardMode = 'overwrite_selected'

  /**
   * 对某一行"重新生成"：**替换这一行**（key 不变），来源变为 `llm_draft`。
   *
   * 注意不是"再插一行"：导入来的行被重新生成后，原行就代表这份新草稿，
   * 否则同一镜头会出现两条记录（预览表整体唯一性也会立刻被破坏）。
   */
  const regenerateRow = useCallback(
    async (row: PreviewRow) => {
      if (!chapterId || !row.shotId) return
      updateRow(row.key, { regenerating: true })
      const outcome = await generateOne(row.shotId, { mode: perShotMode })
      const status: RowStatus =
        outcome.status === 'draft'
          ? 'draft'
          : outcome.status === 'dry_run'
            ? 'dry_run'
            : outcome.status === 'busy'
              ? 'busy'
              : outcome.status === 'skipped'
                ? 'skipped'
                : 'failed'
      updateRow(row.key, {
        // 没有新正文就保留旧正文（中断/跳过不该把草稿变空白）
        prompt: outcome.prompt.trim() ? outcome.prompt : row.prompt,
        origin: 'llm_draft',
        matchBy: 'generate',
        status,
        message: outcome.message || (outcome.status === 'draft' ? '已用新的大模型草稿替换本行' : row.message),
        draftToken: outcome.draftToken || row.draftToken,
        edited: false,
        include: status === 'draft',
        saveable: status === 'draft' ? true : row.saveable,
        regenerating: false,
      })
      await refreshDraftState()
    },
    [chapterId, generateOne, perShotMode, refreshDraftState, updateRow],
  )

  /** 从服务端把草稿重新铺进预览表（刷新按钮 / 恢复按钮 / 保存后都用它）。 */
  const restoreFromServer = useCallback(async () => {
    if (!chapterId) return
    setRestoring(true)
    try {
      const list = await refreshDraftState()
      const nextStatuses = buildShotDraftStatuses({ shots, drafts: list })
      setDraftNote(draftRestoreNotice(nextStatuses))
      mergeRestoredDraftRows(nextStatuses, shots)
      const done = nextStatuses.filter((item) => item.phase === 'draft_ok').length
      message.success(`已从服务端恢复草稿：已完成 ${done} 镜（未开始的不在表里，状态表里有全部 ${nextStatuses.length} 镜）`)
    } finally {
      setRestoring(false)
    }
  }, [chapterId, mergeRestoredDraftRows, refreshDraftState, shots])

  const applyImportPreview = useCallback(
    (
      entries: Array<{
        prompt: string
        shot_id: string
        matched_by: string
        status: string
        message: string
        scriptId?: string
        juriluSeq?: string
      }>,
      origin: PromptBoardOrigin,
    ) => {
      const next = entries.map((entry) =>
        toRow({
          shotId: entry.shot_id,
          prompt: entry.prompt,
          origin,
          matchBy: entry.matched_by || 'none',
          status: entry.status === 'ok' ? 'ok' : entry.status === 'duplicate' ? 'duplicate' : 'unmatched',
          message: entry.message,
          edited: false,
          scriptId: entry.scriptId,
          juriluSeq: entry.juriluSeq,
        }),
      )
      setRows(next)
    },
    [toRow],
  )

  /**
   * 「提示词起步」的关键补位：本集还没有镜头（或镜头少于导入条数）时，
   * 按导入顺序**创建缺失镜头**，然后重新解析一次让预览表把提示词匹配到新镜头上，
   * 最后仍由用户点「确认保存」才写库。
   *
   * 为什么不做成自动保存：保存是写库动作，必须由用户在预览表里确认过。
   */
  /**
   * 粘贴文本里有多少「条目」。
   *
   * 为什么要在这里估：本集还没有镜头时，后端 `import-parse` 会直接拒绝解析
   * （「该集还没有镜头，无法导入」），于是预览表是空的、也就没有「匹配到第几镜」可言。
   * 但「提示词起步」的正常顺序就是先有提示词再补镜头，所以要用文本段数推出要建几个镜头。
   */
  const pendingBlockCount = useMemo(() => {
    const text = otherText.trim()
    if (!text) return 0
    const blocks = text
      .split(/\n\s*\n/)
      .map((block) => block.trim())
      .filter(Boolean)
    return blocks.length > 0 ? blocks.length : 1
  }, [otherText])

  /** 当前选中的脚本组（'' = 未选组）；整组导入的目标条数就来自它的 record_count。 */
  /**
   * 当前表里**匹配正常**的巨日禄条数（"仅保存已经匹配的条目（N 条）"用的就是它）。
   * 复用纯函数 `countMatchedEntries`，避免这里和纯逻辑各写一套判定。
   */
  const juriluMatchedCount = useMemo(
    () =>
      countMatchedEntries(
        rows
          .filter((row) => row.origin === 'jurilu_import')
          .map<JuriluPreviewEntry>((row) => ({
            prompt: row.prompt,
            shot_id: row.shotId,
            matched_by: row.matchBy,
            status: row.status === 'ok' ? 'ok' : 'unmatched',
            message: row.message,
            scriptId: row.scriptId ?? '',
            juriluSeq: row.juriluSeq ?? '',
          })),
      ),
    [rows],
  )
  /**
   * **巨日禄流程的唯一真相**（2026-09-20 复测修复的核心）。
   *
   * 判定全在纯函数 `resolveJuriluFlow`（有测试）：
   * - 未选组 / 选了组但没点匹配 / 匹配请求在飞 / 匹配结果因换组或换章节作废
   *   → **缺口面板与一切建镜头入口一律不出现**；
   * - 只有 matched（后端预览已返回，且组与章节都对得上）才给出**后端真实**镜头数与缺口；
   * - 目标章节文案（名称 + ID 末段 + 镜头数）也由它一份产出，页面各处不会各写各的。
   */
  const juriluFlow = useMemo(
    () =>
      resolveJuriluFlow({
        scriptGroups,
        selectedScriptId,
        match: juriluMatch,
        matching: juriluMatching,
        chapterId,
        chapterLabel,
        entryCount: rows.filter((row) => row.origin === 'jurilu_import').length,
        matchedRowCount: juriluMatchedCount,
      }),
    [chapterId, chapterLabel, juriluMatch, juriluMatching, juriluMatchedCount, rows, scriptGroups, selectedScriptId],
  )
  const shortage = juriluFlow.shortage
  /** 缺口计算的目标条数（**只有已匹配才有值**；绝不来自"仅仅选中"的组）。 */
  const juriluTargetCount = juriluFlow.targetCount
  /** 已匹配的脚本组 id（保存和整组说明都用它；未匹配时恒为空串）。 */
  const matchedScriptId = juriluFlow.matchedScriptId

  /**
   * 还需要创建几个镜头（取「预览行数」「文本段数」「**已匹配**脚本组条数」的最大者）。
   * `juriluTargetCount` 只有 matched 才有值 —— 只是选中组时恒为 0，不会提前冒出缺口或建镜头入口。
   */
  const missingShotCount = Math.max(rows.length, pendingBlockCount, juriluTargetCount) - shots.length

  const [shortageDismissed, setShortageDismissed] = useState(false)


  const doParseOtherImport = useCallback(async () => {
    if (!chapterId) return
    setParsing(true)
    try {
      const preview = await parsePromptImport(chapterId, otherText)
      setIssues(preview.issues ?? [])
      setCountMismatch(Boolean(preview.count_mismatch))
      setAllowPartial(false)
      applyImportPreview(preview.entries ?? [], 'external_import')
      message.success(`已解析 ${preview.entries?.length ?? 0} 条，请在预览表中校对`)
    } catch (error) {
      /* 审计 §4.5 模式 6（`:959`）。 */
      void showUserError(error, '解析失败：请检查粘贴的内容后再试')
    } finally {
      setParsing(false)
    }
  }, [applyImportPreview, chapterId, otherText])

  const doJuriluPreview = useCallback(async () => {
    if (!projectId || !chapterId) return
    if (!juriluUrl.trim()) {
      message.warning('请填写巨日禄页面 URL')
      return
    }
    // 凭证填写引导（这三个校验是真实踩过的坑，别让用户猜）：
    // 1) Authorization 框收到的是**整串 Cookie**（含 Authorization= 或分号）→ 拦住，让他放进 Cookie 框；
    // 2) Cookie 框里没有 Authorization= 项 → 多半只粘了分析 Cookie，给出提示但允许继续；
    // 3) 巨日禄要求整串 Cookie 走 Cookie 请求头，Authorization 框留空、授权方式选「不发送」。
    const authRaw = juriluAuthorization.trim()
    if (authRaw.includes('Authorization=') || authRaw.includes(';')) {
      message.error('Authorization 框收到的是整串 Cookie：请把它放进上面的 Cookie 框，Authorization 框留空')
      return
    }
    const cookieRaw = juriluCookie.trim()
    if (cookieRaw && !cookieRaw.includes('Authorization=')) {
      message.warning('Cookie 里没有 Authorization= 项，可能不是完整 Cookie（浏览器里请用「复制全部 Cookie」）', 6)
    }
    setJuriluFetching(true)
    try {
      // 第一步**不带** script_ids（空数组 = 还没选组）：后端只返回脚本组、rows 为空。
      // 「不要因为接口共返回 109 条，就把 109 条当成同一集的连续镜头」——这一步只做分组。
      const preview = await previewJuriluImport(projectId, {
        chapter_id: chapterId,
        url: juriluUrl.trim(),
        cookie: juriluCookie,
        authorization: juriluAuthorization,
        auth_mode: juriluAuthMode,
        // Referer 留空时用页面 URL 兜底：巨日禄会按 Referer 判来源
        referer: juriluReferer.trim() || juriluUrl.trim(),
        create_missing: false,
        overwrite: false,
        script_ids: [],
      })
      const groups = normalizeScriptGroups(preview.script_groups)
      const rowsBack = preview.rows?.length ?? 0
      const selection = resolveScriptSelection({
        groups,
        selectedScriptIds: [], // 默认一组都不选
        requiresScriptSelection: preview.requires_script_selection,
        rowCount: rowsBack,
        responseSelectedIds: preview.selected_script_ids,
      })

      // 旧组的状态一律清干净：换一次抓取就是一次全新的选择
      setScriptGroups(groups)
      setSelectedScriptId('')
      setJuriluMatch(null)
      setShortageDismissed(false)
      setAllowPartial(false)

      if (groups.length) {
        // 抓到脚本组 → 先让用户选，**这一步不匹配、不写库**
        setRows([])
        setIssues(preview.warnings ?? [])
        setCountMismatch(false)
        const notices = [...selection.notices, preview.note ?? ''].map((item) => item.trim()).filter(Boolean)
        notices.push(
          '本次抓取凭证只保留在本次导入会话内存中（选组后还要再请求一次）；点「放弃本次导入」或离开页面立即清空。',
        )
        if (rowsBack > 0 && selection.dropRows) {
          // 后端一边要求选组、一边给了 rows：一条都不许进表
          message.warning(selection.notices.find((item) => /必须重新选组/.test(item)) ?? '请重新选择脚本组', 8)
        }
        setJuriluNotices(notices)
        juriluSessionRef.current = {
          url: juriluUrl.trim(),
          cookie: juriluCookie,
          authorization: juriluAuthorization,
          auth_mode: juriluAuthMode,
          referer: juriluReferer.trim() || juriluUrl.trim(),
        }
        const summary = summarizeScriptGroups(groups)
        message.success(
          `已抓到 ${summary.groupCount} 个脚本组、合计 ${summary.recordTotal} 条分镜：默认不合并，请在页面上选择一组后点「用这一组匹配镜头」`,
          8,
        )
        setImportOpen(false)
        return
      }

      if (preview.requires_script_selection) {
        // 后端要求先选组，却没给出脚本组 → 不能拿 rows 硬凑
        setRows([])
        setJuriluNotices(selection.notices)
        /* 同型残留（审计 §4.5 模式 2/3）：这句话原本把两个后端字段名写进了主区。 */
        setIssues(['这一次没有拿到可选的脚本组：请重新抓取，或联系管理员核对导入设置。'])
        message.error('后端要求先选脚本组，但没有返回脚本组清单：本次不匹配任何镜头', 8)
        setImportOpen(false)
        return
      }

      // 老后端（没有 script_groups 字段）：保持原有行为，直接进统一预览表
      const entries = buildJuriluEntries(preview.rows ?? [], '')
      setJuriluNotices([])
      setIssues(preview.warnings ?? [])
      setCountMismatch((preview.chapter_shot_count ?? 0) !== entries.length)
      setAllowPartial(false)
      applyImportPreview(entries, 'jurilu_import')
      message.success(`已抓取 ${entries.length} 条巨日禄提示词，请在预览表中校对后确认保存`)
      setImportOpen(false)
    } catch (error) {
      // 错误信息只透出后端的文案，绝不回显 Cookie / Authorization；
      // 401/403 的**脱敏诊断**（接口阶段 / HTTP 状态 / 是否带 Cookie / 是否额外带 Authorization / 授权模式）
      // 一律收进默认收起的「技术详情」，不上主区（审计 §4.5 模式 6，`:1073`）。
      const text = error instanceof Error ? error.message : '巨日禄抓取失败（Cookie 是否有效？）'
      const diag = extractJuriluDiagnostics(error)
      setIssues([])
      setJuriluFailureDetail(buildUserFacingMessage(diag || text).detail)
      void showUserError(error, '巨日禄抓取失败：登录凭证可能已失效，请重新获取后再试')
    } finally {
      setJuriluFetching(false)
      clearJuriluCredentials()
    }
  }, [applyImportPreview, chapterId, clearJuriluCredentials, juriluAuthorization, juriluAuthMode, juriluCookie, juriluReferer, juriluUrl, projectId])

  /** 放弃本次巨日禄导入：脚本组、选中状态、会话凭证一起清掉（凭证不留内存）。 */
  const abandonJuriluImport = useCallback(() => {
    juriluSessionRef.current = null
    setScriptGroups([])
    setSelectedScriptId('')
    setJuriluMatch(null)
    setShortageDismissed(false)
    setJuriluNotices([])
    clearJuriluCredentials()
    message.info('已放弃本次巨日禄导入：脚本组与凭证都已清空（未写库）')
  }, [clearJuriluCredentials])

  /**
   * 用户点选/切换脚本组：**先把上一组的 rows / 配对结果清干净**，再等他点「用这一组匹配镜头」。
   * 纯逻辑在 `juriluScriptGroups.applyGroupSwitch`（有测试），这里只负责落到 state。
   */
  const selectScriptGroup = useCallback(
    (scriptId: string) => {
      const outcome = applyGroupSwitch<PreviewRow>({
        previousSelectedId: selectedScriptId,
        selectedId: scriptId,
        currentRowCount: rows.length,
      })
      if (!outcome.changed) return
      // 换组即清表：两组分镜绝不出现在同一张表里
      setRows(outcome.nextRows)
      setIssues([])
      setCountMismatch(false)
      setAllowPartial(false)
      setSelectedScriptId(outcome.selectedId)
      // 换组 = 上一组的匹配作废（缺口、镜头数、已匹配标记一起清）
      setJuriluMatch(null)
      setShortageDismissed(false)
      if (outcome.notice) message.info(outcome.notice, 6)
    },
    [rows.length, selectedScriptId],
  )

  /**
   * 「用这一组匹配镜头」：只把**用户明确选中的那一组**送去匹配。
   *
   * 顺序刻意如此：先清空旧组 rows（`planGroupMatch.clearBefore`），再发第二次 preview，
   * 回来的是这一组的 rows —— 默认不合并、不自动选组、不自动保存。
   */
  const matchSelectedGroup = useCallback(async () => {
    if (!projectId || !chapterId) return
    const plan = planGroupMatch({
      previousSelectedId: matchedScriptId,
      selectedId: selectedScriptId,
      currentRowCount: rows.length,
    })
    if (!plan.send) {
      message.warning(plan.blockedReason)
      return
    }
    const session = juriluSessionRef.current
    if (!session) {
      message.warning('本次抓取的凭证已清空（只保留在导入会话内存里）：请重新打开导入抽屉粘贴 Cookie 后再匹配')
      return
    }
    // 清干净之后才允许新请求（这一步是同步的，不会出现"两组数据同表"的瞬间）
    if (plan.clearBefore) {
      setRows(clearRowsBeforeMatch(rows, plan))
      setIssues([])
      setCountMismatch(false)
    }
    if (plan.notice) setJuriluNotices([plan.notice])
    setShortageDismissed(false)
    setJuriluMatching(true)
    try {
      const preview = await previewJuriluImport(projectId, {
        chapter_id: chapterId,
        url: session.url,
        cookie: session.cookie,
        authorization: session.authorization,
        auth_mode: session.auth_mode,
        referer: session.referer,
        create_missing: false,
        overwrite: false,
        script_ids: plan.scriptIds,
      })
      const groupsBack = normalizeScriptGroups(preview.script_groups)
      const groupsToKeep = groupsBack.length ? groupsBack : scriptGroups
      // **整组导入**：该组全部 rows 原样进表（不截断、不抽样），每条都带脚本组与巨日禄序号
      const entries = buildJuriluEntries(preview.rows ?? [], plan.scriptIds[0])
      const selection = resolveScriptSelection({
        groups: groupsToKeep,
        selectedScriptIds: plan.scriptIds,
        requiresScriptSelection: preview.requires_script_selection,
        rowCount: entries.length,
        responseSelectedIds: preview.selected_script_ids,
      })
      setScriptGroups(groupsToKeep)
      setIssues(preview.warnings ?? [])
      // 组覆盖率：后端少给/多给都要说出来（页面既不截断也不补齐）
      const groupRecordCount =
        groupsToKeep.find((item) => item.script_id === plan.scriptIds[0])?.record_count ?? entries.length
      const coverage = groupCoverageNotice(groupRecordCount, entries.length)
      const notices = [plan.notice, coverage, ...selection.notices, preview.note ?? '']
        .map((item) => item.trim())
        .filter(Boolean)
      setJuriluNotices(notices)
      if (selection.dropRows) {
        // 后端仍要求选组却给了 rows：一条都不进表
        setRows([])
        setJuriluMatch(null)
        setCountMismatch(false)
        message.warning('后端仍要求重新选择脚本组：这次返回的分镜不会进入预览表，请重新选一组再匹配', 8)
        return
      }
      setCountMismatch((preview.chapter_shot_count ?? 0) !== entries.length)
      setAllowPartial(false)
      applyImportPreview(entries, 'jurilu_import')
      // **唯一凭证据点**：后端预览已经返回 → 记下"哪一组 + 哪一集 + 后端报告的本集镜头数"
      setJuriluMatch({
        scriptId: plan.scriptIds[0],
        chapterId,
        entryCount: entries.length,
        matchedCount: countMatchedEntries(entries),
        groupRecordCount,
        chapterShotCount: Math.max(0, Math.trunc(preview.chapter_shot_count ?? 0)),
      })
      message.success(
        /* 审计 §4.5 模式 1（与 `:1416` 同口径）：内部组编号不上主区，用户只需要知道匹配了多少条。 */
        `已用所选脚本组整组匹配 ${entries.length} 条巨日禄提示词（默认不合并、未写库）：请在下面的预览表里核对后确认保存`,
        8,
      )
    } catch (error) {
      // 匹配失败 → 不作数：清掉"已匹配"凭证，缺口与建镜头入口一起收回去
      setJuriluMatch(null)
      const text = error instanceof Error ? error.message : '巨日禄匹配失败（Cookie 是否有效？）'
      const diag = extractJuriluDiagnostics(error)
      setIssues([])
      setJuriluFailureDetail(buildUserFacingMessage(diag || text).detail)
      void showUserError(error, '巨日禄匹配失败：登录凭证可能已失效，请重新获取后再试')
    } finally {
      setJuriluMatching(false)
    }
  }, [applyImportPreview, chapterId, matchedScriptId, projectId, rows, scriptGroups, selectedScriptId])

  /**
   * 按导入顺序**创建缺失镜头**，然后重新匹配（预览表马上显示正确编号/内容/状态），
   * 最后由用户点「确认保存」才写库 —— **没有任何自动写库、自动建镜头**。
   *
   * 巨日禄整组导入：目标条数取自**已匹配**脚本组的记录数（`juriluFlow.targetCount`），
   * 所以「本集 0 镜 + 该组 31 条」也能一次补齐 31 个镜头，然后用**同一组**重新匹配
   * （复用这条既有链路，不另造割裂流程）。
   *
   * 硬闸门（2026-09-20 复测要求）：
   * - 巨日禄链路上**必须已匹配**（后端预览已返回）且由用户**明确点击**才允许创建；
   * - 一次点击只发一轮请求（`createShotsInFlightRef` 同步闸门 + `planCreateMissingShots` 判定）；
   * - 缺口用**后端最新镜头数**算（先 `fetchPromptBoard` 再算），不依赖页面缓存。
   *
   * 为什么放在 `matchSelectedGroup` **后面**：它要复用匹配链路，放在前面会踩
   * useCallback 依赖数组的 TDZ（数组在渲染时就求值）。
   */
  const doCreateMissingShots = useCallback(async () => {
    if (!chapterId) return
    // 巨日禄链路：没拿到后端预览结果（未匹配）之前，一颗镜头都不许建
    if (selectedScriptId && juriluFlow.stage !== 'matched') {
      message.warning('请先点「用这一组匹配镜头」拿到后端预览结果，再决定是否创建缺失镜头')
      return
    }
    // 防重复点击：按钮 loading/disabled 之外再加一道同步闸门（状态更新是异步的）
    if (createShotsInFlightRef.current) return
    createShotsInFlightRef.current = true
    setCreatingShots(true)
    try {
      // 以**数据库现状**为准计算缺口，而不是用可能过期的本地状态：
      // 这样即使上一次部分失败/用户在别处建过镜头，也不会重复创建或撞序号。
      const latest = await fetchPromptBoard(chapterId)
      const latestShots = latest.shots ?? []
      const target = Math.max(rows.length, pendingBlockCount, juriluTargetCount)
      const plan = planCreateMissingShots({
        latestShotCount: latestShots.length,
        targetCount: target,
        inFlight: false,
      })
      const missing = plan.count
      if (!plan.allowed) {
        // 后端最新数据说已经够了（或闸门拦下）→ 一轮请求都不发
        message.info(plan.reason)
        await loadBoard()
        return
      }
      message.info(plan.reason)
      const baseIndex = latestShots.reduce((max, shot) => Math.max(max, Number(shot.index) || 0), 0)
      let created = 0
      const failures: string[] = []
      for (let offset = 1; offset <= missing; offset += 1) {
        const row = rows[latestShots.length + offset - 1]
        const blocks = otherText
          .split(/\n\s*\n/)
          .map((block) => block.trim())
          .filter(Boolean)
        const prompt = (row?.prompt ?? blocks[latestShots.length + offset - 1] ?? '').trim()
        const index = baseIndex + offset
        try {
          await StudioShotsService.createShotApiV1StudioShotsPost({
            requestBody: {
              // id 是 ShotCreate 的必填字段：用「章节 + 序号 + 时间戳」保证唯一且可排查
              id: `shot_${chapterId}_${index}_${Date.now()}`,
              chapter_id: chapterId,
              index,
              title: prompt.slice(0, 20) || `镜头 ${index}`,
              script_excerpt: prompt,
            } as never,
          })
          created += 1
        } catch (error) {
          /* 单个失败不中断其余：SQLite 唯一约束下更可能是序号冲突，跳过继续。
             审计 §7.1-6：后端原文在**收集时**就过管道，主区只说这一镜没成功。 */
          failures.push(`第 ${index} 个：${toUserFacingText(error, '创建失败')}`)
        }
      }
      if (created > 0) {
        message.success(`已创建 ${created} 个镜头${failures.length ? `（${failures.length} 个失败，可再次点击补齐）` : ''}`)
      } else {
        void showUserError(failures[0] ?? '', '镜头创建失败：请稍后重试')
      }
      // 关键：立刻刷新镜头列表再重新匹配，预览表马上显示正确的编号/内容/状态
      await loadBoard()
      if (selectedScriptId) {
        // 巨日禄：用**同一组**重新整组匹配（镜头已经按该组条数补齐）
        setShortageDismissed(false)
        await matchSelectedGroup()
      } else if (otherText.trim()) {
        const preview = await parsePromptImport(chapterId, otherText)
        setIssues(preview.issues ?? [])
        setCountMismatch(Boolean(preview.count_mismatch))
        applyImportPreview(preview.entries ?? [], 'external_import')
      }
    } catch (error) {
      const failure = classifyGenerationFailure(error, 'llm')
      message.error(failureText(failure))
    } finally {
      createShotsInFlightRef.current = false
      setCreatingShots(false)
    }
  }, [
    applyImportPreview,
    chapterId,
    juriluFlow.stage,
    juriluTargetCount,
    loadBoard,
    matchSelectedGroup,
    otherText,
    pendingBlockCount,
    rows,
    selectedScriptId,
  ])


  /** 分组保存：同一张表里允许存在多种来源，按 origin 分组调用。 */
  const doSave = useCallback(
    async (opts: { partialOverride?: boolean } = {}) => {
      if (!chapterId) return
      const included = rows.filter((row) => row.include && row.prompt.trim())
      if (!included.length) {
        message.warning('没有勾选任何要保存的提示词')
        return
      }
      // 巨日禄这条线的闸门：**必须已经用某一组匹配过**才能保存。
      // 默认不跨 scriptId 合并 —— 没选组就不该有巨日禄内容写进库（后端 apply 也拒）。
      // 注意：这里**没有**任何条数上限，选中一组就是整组保存（勾选多少保存多少）。
      const juriluIncluded = included.filter((row) => resolveSaveOrigin(row) === 'jurilu_import')
      if (juriluIncluded.length && !matchedScriptId) {
        message.error('巨日禄分镜必须先选择一组脚本组并点「用这一组匹配镜头」才能保存（默认不跨 scriptId 合并）')
        return
      }
      // 脚本组范围自检（与后端同一句判定）：本批巨日禄条目必须**逐条**属于当前那一组。
      // 后端 `/save` 会 400（那是最终保证）；这里先把"第几条不属于这一组"讲清楚再拦下。
      const scopeError = juriluIncluded.length
        ? juriluScriptScopeError(
            juriluIncluded.map((row) => ({ shotId: row.shotId, prompt: row.prompt, scriptId: row.scriptId })),
            matchedScriptId,
          )
        : null
      if (scopeError) {
        message.error(scopeError)
        return
      }
      const partialAllowed = opts.partialOverride ?? allowPartial
      if (countMismatch && !partialAllowed) {
        message.error('数量不一致：默认不允许保存，请先确认「仅保存已匹配项」')
        return
      }
    // 整表唯一性：必须在**按来源分组之前**校验，否则不同来源会分两次调用先后写同一镜头
    const uniqueError = validateTableUnique(rows)
    if (uniqueError) {
      message.error(uniqueError)
      return
    }
    setSaving(true)
    try {
      const groups = new Map<PromptBoardOrigin, PreviewRow[]>()
      for (const row of included) {
        // 大模型草稿只有在"没改过 + 带服务端令牌"时才是 llm；否则按人工内容记录（后端还会用 HMAC 再验一次）
        const origin = resolveSaveOrigin(row)
        groups.set(origin, [...(groups.get(origin) ?? []), row])
      }
      let applied = 0
      let cleared = 0
      const failures: string[] = []
      for (const [origin, groupRows] of groups) {
        // 请求体统一由纯函数构造（单测钉住形状）：巨日禄只出现**单数** script_id，
        // 且每条 entry 带上同一个脚本组；其它来源两个字段都不出现。
        // 注意：这里**绝不**传复数 script_ids —— 后端收到它会明确 400（不是静默忽略）。
        const body = buildPromptBoardSaveBody({
          rows: groupRows.map((row) => ({
            shotId: row.shotId,
            prompt: row.prompt,
            scriptId: row.scriptId,
            draftToken: row.draftToken,
          })),
          mode,
          origin,
          matchedScriptId,
          selectedShotIds,
          allowPartial: countMismatch ? partialAllowed : true,
        })
        // eslint-disable-next-line no-await-in-loop
        const result = await savePromptBoard(chapterId, body)
        applied += result.applied_count ?? 0
        cleared += result.cleared_draft_count ?? 0
        for (const item of result.results ?? []) {
          // 审计 §4.5 模式 1：回退成镜头编号原值属模式 1；取不到业务名就只说这一镜没写入
          if (!item.applied) failures.push(`有一镜未写入：${toUserFacingText(item.reason, '原因未提供')}`)
        }
        if (result.error) failures.push(toUserFacingText(result.error, '这一批没有全部写入'))
      }
      if (applied) {
        message.success(
          /* 审计 §4.2 模式 5：「来源 jurilu / 脚本组 <内部编号>」是供应商名 + 内部标识，
             一律不上主区；用户只需要知道存了多少条。 */
          `已保存 ${applied} 条到镜头（正式提示词）${cleared ? `；服务端已清掉 ${cleared} 份对应草稿` : ''}`,
          8,
        )
      }
      if (failures.length) message.warning(`有 ${failures.length} 条未写入：${failures.slice(0, 3).join('；')}`, 8)
      await loadBoard()
      setRows([])
      // 表清空了：「已匹配」凭证与缺口跟着清（否则面板还会按上一组算缺口）
      setJuriluMatch(null)
      setShortageDismissed(false)
      // 保存后草稿可能已被服务端清掉，但其它镜头（失败/未保存）的草稿要在表里继续可见
      await restoreFromServer()
    } catch (error) {
      /* 审计 §4.5 模式 6（`:1429`）。 */
      void showUserError(error, '保存失败：请稍后重试')
    } finally {
      setSaving(false)
    }
  }, [allowPartial, chapterId, countMismatch, loadBoard, matchedScriptId, mode, restoreFromServer, rows, selectedShotIds, validateTableUnique])

  /** 「镜头不足」三个选项的动作（都由用户点击触发；没有任何一条会自动写库）。 */
  const onShortageOption = useCallback(
    (key: ShortageOptionKey) => {
      if (key === 'create_missing') {
        void doCreateMissingShots()
        return
      }
      if (key === 'save_matched_only') {
        // ② 仅保存已经匹配的条目：显式打开 allow_partial 再走同一条保存链路
        setAllowPartial(true)
        void doSave({ partialOverride: true })
        return
      }
      // ③ 返回调整：什么都不写，回预览表手工改匹配 / 换脚本组
      setShortageDismissed(true)
      message.info('已返回调整：可在预览表里手工改镜头编号或删条目，也可以换一个脚本组；这一步没有写库、没有建镜头。', 8)
      document
        .querySelector('[data-testid="prompt-board-preview-table"]')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    },
    [doCreateMissingShots, doSave],
  )

  /** 清空本集服务端草稿（危险动作：草稿是真金白银生成的，必须二次确认）。 */
  const doClearDrafts = useCallback(async () => {
    if (!chapterId) return
    setPurging(true)
    try {
      const result = await deleteShotDrafts(chapterId)
      message.success(`已清空本集服务端草稿 ${result.cleared} 份（正式提示词未改动）`)
      setRows((prev) => prev.filter((row) => row.origin !== 'llm_draft'))
      await restoreFromServer()
    } catch (error) {
      /* 审计 §4.5 模式 6（`:1468`）。 */
      void showUserError(error, '清空草稿失败：请稍后重试')
    } finally {
      setPurging(false)
    }
  }, [chapterId, restoreFromServer])

  const includedCount = rows.filter((row) => row.include && row.prompt.trim()).length
  /** 缺口面板是否真的显示（用它统一决定"数量不一致"提示要不要让位）。 */
  const shortageVisible = Boolean(shortage?.show) && !shortageDismissed
  const draftDoneCount = statuses.filter((item) => item.phase === 'draft_ok').length

  if (!chapterId) {
    return <Card title="集级视频提示词"><Empty description="请先在顶部选择一集" /></Card>
  }

  return (
    <Card
      title={`集级视频提示词 · ${chapterLabel}`}
      extra={
        <Space>
          <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={() => void loadBoard()}>
            刷新镜头
          </Button>
          {/* 提示词确认保存之后的两个业务出口（顺序与五步流程一致） */}
          {onContinueAssets ? (
            <Button size="small" type="link" onClick={onContinueAssets}>
              继续准备资产 →
            </Button>
          ) : null}
          {onGoBinding ? (
            <Button size="small" type="link" onClick={onGoBinding}>
              已有资产，直接进入绑定 →
            </Button>
          ) : null}
          {onEnterStudio ? (
            <Button size="small" type="link" onClick={onEnterStudio}>
              进入分镜工作台 →
            </Button>
          ) : null}
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        className="mb-3"
        message="整集提示词在这里一次做完再进工作台"
        description="批量生成或批量导入都会先进入下面这张预览确认表；只有点「确认保存」才会写入镜头（未确认前不写库）。生成的草稿存在服务端，刷新/中断都不会丢。工作台只用于逐镜检查与补漏。"
      />

      {/* 逐镜状态：只读服务端草稿，刷新/中断后进页面第一眼就看它 */}
      <Card
        size="small"
        className="mb-3"
        title="逐镜状态（服务端草稿 · 刷新/中断都不丢）"
        data-testid="prompt-draft-status-card"
        extra={
          <Space size={8}>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              loading={restoring}
              data-testid="prompt-draft-restore"
              onClick={() => void restoreFromServer()}
            >
              从服务端恢复草稿
            </Button>
            <Popconfirm
              title="清空本集服务端草稿？"
              description="草稿是真金白银生成的，清掉后无法恢复；正式提示词（已保存内容）不受影响。"
              okText="确认清空"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => void doClearDrafts()}
            >
              <Button size="small" danger icon={<DeleteOutlined />} loading={purging} disabled={!drafts.length}>
                清空草稿
              </Button>
            </Popconfirm>
          </Space>
        }
      >
        <Typography.Text type="secondary" className="text-[11px] block mb-2" data-testid="prompt-draft-note">
          {draftNote ||
            '本集还没有读出服务端草稿状态：点右上「从服务端恢复草稿」重试；未开始（没有草稿）的镜头也在这张表里。'}
        </Typography.Text>
        <Table<ShotDraftStatus>
          size="small"
          rowKey="shotId"
          loading={loading}
          dataSource={statuses}
          pagination={false}
          scroll={{ y: 220 }}
          data-testid="prompt-draft-status-table"
          locale={{ emptyText: '本集还没有镜头' }}
          columns={[
            { title: '编号', dataIndex: 'code', width: 80 },
            { title: '镜头', dataIndex: 'title', ellipsis: true },
            {
              title: '草稿状态',
              dataIndex: 'phase',
              width: 150,
              render: (_value, row) => (
                <Tooltip title={PHASE_META[row.phase].hint}>
                  <Tag color={PHASE_META[row.phase].color} data-testid={`prompt-draft-phase-${row.shotId}`}>
                    {PHASE_META[row.phase].label}
                  </Tag>
                </Tooltip>
              ),
            },
            {
              title: '正式提示词（已保存列）',
              dataIndex: 'saved',
              width: 170,
              render: (_value, row) =>
                row.saved ? (
                  <Tag color={SAVED_META.color} data-testid={`prompt-saved-${row.shotId}`}>
                    {`${SAVED_META.label} · ${sourceLabel(row.savedSource)}`}
                  </Tag>
                ) : (
                  <Tag data-testid={`prompt-saved-${row.shotId}`}>{SAVED_META.emptyLabel}</Tag>
                ),
            },
            {
              title: '草稿正文',
              dataIndex: 'draftPrompt',
              width: 110,
              render: (_value, row) =>
                row.hasDraft ? <Tag color="blue">{`有草稿 ${row.draftPrompt.trim().length} 字`}</Tag> : <Tag>无</Tag>,
            },
            {
              title: '草稿更新时间',
              dataIndex: 'updatedAt',
              width: 160,
              render: (value: string | null) => (value ? new Date(value).toLocaleString('zh-CN') : '—'),
            },
            {
              title: '说明 / 失败原因',
              dataIndex: 'error',
              render: (_value, row) => (
                <div className="text-[11px] text-gray-600">
                  {row.phase === 'failed' && row.error ? row.error : PHASE_META[row.phase].hint}
                  {row.phase === 'draft_ok' && row.saveable ? '（带服务端大模型令牌，可按大模型草稿保存）' : ''}
                  {row.phase === 'draft_ok' && !row.saveable ? '（没有大模型令牌：只能按人工内容保存）' : ''}
                </div>
              ),
            },
            {
              title: '操作',
              key: 'draft-actions',
              width: 120,
              render: (_value, row) => {
                const busy = row.phase === 'running' || runningShotIds.includes(row.shotId) || running
                const button = (
                  <Button
                    size="small"
                    loading={runningShotIds.includes(row.shotId)}
                    disabled={busy}
                    data-testid={`prompt-draft-generate-${row.shotId}`}
                    onClick={() => void runGenerate([row.shotId])}
                  >
                    {needsGeneration(row) ? '生成这一镜' : '重新生成'}
                  </Button>
                )
                if (busy) {
                  return <Tooltip title="该镜头正在生成中（服务端租约未过期），不会重复发起">{button}</Tooltip>
                }
                if (needsGeneration(row)) return button
                return (
                  <Popconfirm
                    title="这一镜已经有草稿，重新生成会再调用一次大模型（会再次付费）。确认重发？"
                    okText="重新生成"
                    cancelText="取消"
                    onConfirm={() => void runGenerate([row.shotId])}
                  >
                    {button}
                  </Popconfirm>
                )
              },
            },
          ]}
        />
      </Card>

      <Space wrap size={12} className="mb-3">
        <Radio.Group
          size="small"
          value={mode}
          onChange={(event) => setMode(event.target.value as PromptBoardMode)}
          optionType="button"
          options={[
            { value: 'fill_empty', label: '只填充空白镜头' },
            { value: 'overwrite_selected', label: '覆盖选中镜头' },
          ]}
        />
        <Button
          size="small"
          onClick={() => setSelectedShotIds(shots.map((shot) => shot.shot_id))}
          disabled={!shots.length}
        >
          选中本集全部镜头
        </Button>
        <Button size="small" onClick={() => setSelectedShotIds([])}>
          清空选择
        </Button>
        <Typography.Text type="secondary" className="text-[11px]">
          {`本集 ${shots.length} 镜 · 已选 ${selectedShotIds.length} 镜 · 待生成 ${generateTargets.length} 镜 · 已完成草稿 ${draftDoneCount} 镜`}
        </Typography.Text>
      </Space>

      <Space wrap size={8} className="mb-3">
        <Tooltip title="逐镜请求，一次一镜；点停止后不再请求下一镜。已有草稿的镜头不会被重发（不重复付费）">
          <Button
            type="primary"
            size="small"
            icon={<ThunderboltOutlined />}
            loading={running}
            disabled={!generateTargets.length}
            data-testid="prompt-draft-batch-generate"
            onClick={() => void runGenerate(generateTargets)}
          >
            {`生成失败/未开始（${generateTargets.length} 镜）`}
          </Button>
        </Tooltip>
        <Button
          size="small"
          danger
          icon={<StopOutlined />}
          disabled={!running}
          data-testid="prompt-draft-stop"
          onClick={() => {
            stopRef.current = true
          }}
        >
          停止
        </Button>
        <Button
          size="small"
          disabled={!retryShotIds.length || running}
          data-testid="prompt-draft-retry"
          onClick={() => void runGenerate(retryShotIds)}
        >
          {`重试失败 / 未开始（${retryShotIds.length}）`}
        </Button>
        <Button size="small" icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>
          批量导入（巨日禄 Cookie / 其他平台）
        </Button>
        <Button
          size="small"
          onClick={() => {
            setRows([])
            setIssues([])
            setCountMismatch(false)
            // 表清空了，"已匹配"凭证也要跟着清（否则缺口面板还会按上一组算）
            setJuriluMatch(null)
            setShortageDismissed(false)
            clearJuriluCredentials()
            message.info('已清空预览表（服务端草稿仍保留，点「从服务端恢复草稿」可找回）')
          }}
          disabled={!rows.length}
        >
          清空预览表
        </Button>
      </Space>

      {countMismatch && !shortageVisible ? (
        <Alert
          type="warning"
          showIcon
          className="mb-2"
          message="数量与镜头不一致：默认阻止保存"
          description={
            <Space direction="vertical" size={4}>
              <span>请先核对下面的匹配关系；确需只保存已匹配的条目，请显式打开开关。</span>
              <Checkbox checked={allowPartial} onChange={(event) => setAllowPartial(event.target.checked)}>
                仅保存已匹配项（允许部分保存）
              </Checkbox>
            </Space>
          }
        />
      ) : null}

      {issues.length ? (
        <Alert
          type="warning"
          showIcon
          className="mb-2"
          message={`发现 ${issues.length} 个问题`}
          description={
            <ul className="list-disc pl-4 text-[11px]">
              {issues.slice(0, 6).map((issue, index) => (
                <li key={`issue-${index}`}>{issue}</li>
              ))}
            </ul>
          }
        />
      ) : null}

      {/* 技术详情（默认收起）：巨日禄抓取 / 匹配失败的原始诊断落点（已掩码 + 洗过）。 */}
      {juriluFailureDetail ? (
        <TechnicalDetailSection testId="prompt-board-jurilu-failure" className="mb-2">
          <div className="text-[11px] leading-5 text-slate-500">{juriluFailureDetail}</div>
        </TechnicalDetailSection>
      ) : null}

      {/* 脚本组选择区：抓取后显示在统一预览表**上面**；默认一组都不选，选完才整组匹配 */}
      {scriptGroups.length ? (
        <JuriluScriptGroupPicker
          groups={scriptGroups}
          selectedId={selectedScriptId}
          onSelect={selectScriptGroup}
          onMatch={() => void matchSelectedGroup()}
          matching={juriluMatching}
          matchedId={matchedScriptId}
          matchedRowCount={juriluMatch?.entryCount ?? 0}
          notices={juriluNotices}
          onAbandon={abandonJuriluImport}
          chapterOptions={chapterOptions}
          targetChapterId={chapterId ?? ''}
          onTargetChapterChange={(next) => switchTargetChapter(next)}
          chaptersLoading={chaptersLoading}
          onCreateChapter={createChapter}
          creatingChapter={creatingChapter}
          /* 目标章节与流程状态与缺口面板**同源**：都来自 juriluFlow，不会互相矛盾 */
          targetChapterText={juriluFlow.chapterText}
          flowStatusText={juriluFlow.statusText}
          stage={juriluFlow.stage}
        />
      ) : null}

      {scriptGroups.length ? (
        <Alert
          type="info"
          showIcon
          className="mb-2"
          data-testid="jurilu-flow-banner"
          message={`巨日禄流程状态：${juriluFlow.statusText}`}
          description={
            juriluFlow.matchedScriptId
              ? `下面这张表里的巨日禄分镜全部来自当前选中的那一组（${juriluMatch?.entryCount ?? 0} 条，不截断、也不与别的组混在一起）；换组或换目标章节都会先清空这张表、清掉缺口与已匹配标记。`
              : '下面这张表里没有巨日禄分镜：在完成该组的「用这一组匹配镜头」之前，页面不会显示镜头缺口，也不会提供任何创建镜头的入口。'
          }
        />
      ) : null}

      <Table<PreviewRow>
        size="small"
        rowKey="key"
        loading={loading}
        dataSource={rows}
        pagination={false}
        data-testid="prompt-board-preview-table"
        locale={{
          emptyText: scriptGroups.length
            ? '还没有匹配任何脚本组：请在上面的「巨日禄脚本组选择」里选一组并点「用这一组匹配镜头」（默认不合并、不自动选组）'
            : '还没有草稿：点「生成失败/未开始」或「批量导入」开始；刷新后这里会从服务端恢复上次的草稿',
        }}
        rowSelection={{
          selectedRowKeys: rows.filter((row) => row.include).map((row) => row.key),
          onChange: (keys) => {
            const wanted = new Set(keys.map(String))
            setRows((prev) => prev.map((row) => ({ ...row, include: wanted.has(row.key) })))
          },
          getCheckboxProps: (row) => ({ disabled: row.status === 'dry_run' || row.status === 'busy' }),
        }}
        columns={[
          {
            title: '所属剧本组',
            dataIndex: 'scriptId',
            width: 130,
            render: (_value, row) =>
              row.origin === 'jurilu_import' ? (
                <Tag color="purple" data-testid={`prompt-row-script-${row.key}`}>
                  {row.scriptId || '未提供脚本组'}
                </Tag>
              ) : (
                <span className="text-gray-400">—</span>
              ),
          },
          {
            title: '巨日禄序号',
            dataIndex: 'juriluSeq',
            width: 100,
            render: (_value, row) =>
              row.origin === 'jurilu_import' ? (row.juriluSeq || '未提供') : <span className="text-gray-400">—</span>,
          },
          { title: '镜头编号', dataIndex: 'code', width: 80 },
          { title: '镜头内容', dataIndex: 'shotText', width: 200, ellipsis: true },
          {
            title: '待写入提示词',
            dataIndex: 'prompt',
            render: (value: string, row) => (
              <Input.TextArea
                rows={2}
                value={value}
                placeholder={row.status === 'failed' ? row.message : '（空）'}
                onChange={(event) =>
                  updateRow(row.key, {
                    prompt: event.target.value,
                    // 改过正文就不算大模型原样草稿：保存时来源降级为人工（令牌也会失配）
                    edited: event.target.value.trim() !== '' ? true : row.edited,
                  })
                }
              />
            ),
          },
          {
            title: '来源',
            dataIndex: 'origin',
            width: 110,
            render: (_value, row) => {
              const meta = ORIGIN_META[resolveSaveOrigin(row) === 'manual' && row.origin === 'llm_draft' ? 'manual' : row.origin]
              return <Tag color={meta.color}>{meta.label}</Tag>
            },
          },
          { title: '匹配方式', dataIndex: 'matchBy', width: 90 },
          {
            title: '匹配状态与原因',
            dataIndex: 'status',
            width: 200,
            render: (_value, row) => (
              <div>
                <Tag color={STATUS_META[row.status].color}>{STATUS_META[row.status].label}</Tag>
                {row.message ? <div className="text-[11px] text-gray-500">{row.message}</div> : null}
              </div>
            ),
          },
          {
            title: '操作',
            key: 'actions',
            width: 200,
            render: (_value, row) => (
              <Space size={4} wrap>
                <Select
                  size="small"
                  style={{ width: 96 }}
                  placeholder="改镜头"
                  value={row.shotId || undefined}
                  options={shots.map((shot) => ({ value: shot.shot_id, label: shot.code }))}
                  onChange={(value) => {
                    const nextShotId = String(value)
                    // 同一镜头已经有另一条勾选记录 → 立即提示冲突并**拒绝这次选择**
                    const conflict = findConflictingRow(nextShotId, row.key)
                    if (conflict) {
                      message.error(
                        `镜头 ${shotById.get(nextShotId)?.code ?? nextShotId} 已被另一条记录占用（来源：${ORIGIN_META[conflict.origin].label}），请先删掉那一条再改。`,
                      )
                      return
                    }
                    const shot = shotById.get(nextShotId)
                    updateRow(row.key, {
                      shotId: nextShotId,
                      code: shot?.code ?? '',
                      shotText: shot ? `${shot.title}｜${shot.script_excerpt.slice(0, 40)}` : '',
                      matchBy: 'manual',
                      status: 'ok',
                      message: '已人工调整匹配的镜头',
                      include: true,
                    })
                  }}
                />
                <Button
                  size="small"
                  loading={row.regenerating}
                  disabled={!row.shotId || !chapterId || running}
                  onClick={() => void regenerateRow(row)}
                >
                  重新生成
                </Button>
                <Button size="small" danger onClick={() => setRows((prev) => prev.filter((item) => item.key !== row.key))}>
                  删除
                </Button>
              </Space>
            ),
          },
        ]}
      />

      {/* 镜头不足：明确写出缺少数量 + 三个选项（都靠用户点击，没有任何自动写库/自动建镜头） */}
      {shortageVisible && shortage ? (
        <Alert
          type="warning"
          showIcon
          className="mt-3"
          data-testid="jurilu-shot-shortage"
          message={shortage.message}
          description={
            <Space direction="vertical" size={6} className="w-full">
              {shortage.options.map((option) => (
                <Space key={option.key} size={8} align="start" wrap>
                  <Button
                    size="small"
                    type={option.key === 'create_missing' ? 'primary' : 'default'}
                    disabled={option.disabled || creatingShots || saving}
                    loading={(option.key === 'create_missing' && creatingShots) || (option.key === 'save_matched_only' && saving)}
                    data-testid={`jurilu-shortage-${option.key}`}
                    onClick={() => onShortageOption(option.key)}
                  >
                    {option.label}
                  </Button>
                  <Typography.Text type="secondary" className="text-[11px]">
                    {option.hint}
                  </Typography.Text>
                </Space>
              ))}
              {shortageDismissed ? null : (
                <Typography.Text type="secondary" className="text-[11px]">
                  三个选项都不会自动写库：只有「仅保存已经匹配的条目」会立刻发起保存（仍需你在服务端返回前确认过勾选）。
                </Typography.Text>
              )}
            </Space>
          }
        />
      ) : null}

      <Space className="mt-3">
        {/* 巨日禄链路进行中（选了组/在匹配/已匹配）时**隐藏**这条通用按钮：
            创建入口只留缺口面板里的那一个 primary，避免两个入口同时可点。 */}
        {juriluFlow.showBottomCreateButton &&
        missingShotCount > 0 &&
        (rows.length > 0 || pendingBlockCount > 0 || juriluTargetCount > 0) ? (
          <Tooltip title="按导入顺序补齐本集缺失的镜头，再用同一批（或同一组）提示词重新匹配（建完仍需你点「确认保存」）">
            <Button
              loading={creatingShots}
              disabled={creatingShots}
              data-testid="prompt-board-create-shots"
              onClick={() => void doCreateMissingShots()}
            >
              {juriluTargetCount > 0 && selectedScriptId
                ? `按本组提示词创建缺失镜头（${missingShotCount} 个）并重新匹配`
                : `创建缺失镜头（${missingShotCount} 个）并重新匹配`}
            </Button>
          </Tooltip>
        ) : null}
        <Button
          type="primary"
          loading={saving}
          disabled={!includedCount || creatingShots}
          data-testid="prompt-board-save"
          onClick={() => void doSave()}
        >
          {saveButtonText(includedCount)}
        </Button>
        <Typography.Text type="secondary" className="text-[11px]" data-testid="prompt-board-save-note">
          保存后即写入各镜的提示词（正式列）；工作室与交付导出读的就是这份已保存内容。草稿不会被自动保存。
          {matchedScriptId
            ? ` ${wholeGroupSaveNotice(includedCount, matchedScriptId, juriluMatch?.groupRecordCount ?? 0)}`
            : ''}
        </Typography.Text>
      </Space>

      <Drawer
        title="批量导入视频提示词"
        open={importOpen}
        onClose={() => {
          setImportOpen(false)
          clearJuriluCredentials()
        }}
        width={640}
        destroyOnClose
      >
        <Radio.Group
          value={importTab}
          onChange={(event) => setImportTab(event.target.value as 'jurilu' | 'other')}
          optionType="button"
          className="mb-3"
          data-testid="prompt-import-source"
          options={[
            { value: 'jurilu', label: '巨日禄 Cookie 导入（主入口）' },
            { value: 'other', label: '其他外部平台（粘贴 / 上传）' },
          ]}
        />
        {importTab === 'jurilu' ? (
          <Space direction="vertical" className="w-full" size="small">
            <Alert
              type="info"
              showIcon
              message="Cookie 只用于本次抓取：不保存、不回显、不写日志"
              description="抓取结果不会直接落库，会先进入统一预览确认表，由你核对匹配关系后确认保存。正确填法：把浏览器「复制全部 Cookie」的整串（含开头的 Authorization= 项）放进 Cookie 框，Authorization 框留空，授权方式选「不发送（仅 Cookie）」，Referer 留空会默认用页面 URL。抓到脚本组后会先让你选组（默认不合并、不自动选），选完点「用这一组匹配镜头」才匹配。"
            />
            <Input placeholder="巨日禄页面 URL（含 projectId / clipId）" value={juriluUrl} onChange={(e) => setJuriluUrl(e.target.value)} />
            <Input.Password
              placeholder="粘贴巨日禄「复制全部 Cookie」（含 Authorization= 项，掩码显示，仅本次抓取使用）"
              value={juriluCookie}
              onChange={(e) => {
                const next = e.target.value
                setJuriluCookie(next)
                // 完整 Cookie 里已经带了 Authorization= 项 → 默认「不发送，仅 Cookie」（用户手动改过就不覆盖）
                if (!juriluAuthModeTouched && next.includes('Authorization=')) {
                  setJuriluAuthMode('none')
                }
              }}
            />
            <Space>
              <Input.Password
                placeholder="Authorization（整串 Cookie 时留空，掩码显示）"
                value={juriluAuthorization}
                onChange={(e) => setJuriluAuthorization(e.target.value)}
              />
              <Select
                size="middle"
                value={juriluAuthMode}
                style={{ width: 170 }}
                onChange={(value) => {
                  setJuriluAuthModeTouched(true)
                  setJuriluAuthMode(value)
                }}
                options={[
                  { value: 'auto', label: '自动' },
                  { value: 'none', label: '不发送（仅 Cookie）' },
                  { value: 'raw', label: '原样发送' },
                  { value: 'bearer', label: 'Bearer' },
                ]}
              />
            </Space>
            <Input placeholder="Referer（可留空）" value={juriluReferer} onChange={(e) => setJuriluReferer(e.target.value)} />
            <Button type="primary" loading={juriluFetching} onClick={() => void doJuriluPreview()}>
              获取整集提示词（预览，不写库）
            </Button>
          </Space>
        ) : (
          <Space direction="vertical" className="w-full" size="small">
            <Upload
              accept=".txt,.md,.csv,.json"
              showUploadList={false}
              beforeUpload={(file) => {
                void file.text().then((text) => setOtherText(text))
                return false
              }}
            >
              <Button>上传文本文件（.txt/.md/.csv/.json）</Button>
            </Upload>
            <Input.TextArea
              rows={10}
              aria-label="批量提示词文本"
              data-testid="prompt-import-text"
              placeholder={'整段粘贴：每条之间空行；支持 S001 / #1 / 1. 这类编号，没有编号就按顺序匹配'}
              value={otherText}
              onChange={(e) => setOtherText(e.target.value)}
            />
            <Button
              type="primary"
              loading={parsing}
              data-testid="prompt-import-parse"
              onClick={() => void doParseOtherImport()}
            >
              解析并进入预览表（不写库）
            </Button>
          </Space>
        )}
      </Drawer>
    </Card>
  )
}

export default EpisodeVideoPromptBoard
