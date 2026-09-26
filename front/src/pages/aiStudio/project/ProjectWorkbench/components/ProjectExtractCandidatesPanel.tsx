/**
 * 第 2 步「提取资产」的就地工作面板。
 *
 * 本轮要解决的问题（用户原话）：候选表只有「确认写入」，确认完**不知道下一步做什么**，
 * 资产也不会立刻出现在下方的「资产生产区」。现在这里提供：
 *
 *   1. **勾选多条 → 一次「确认选中项」**，也保留**逐条确认**；
 *   2. 每一条都能选确认方式（用户语言）：
 *        - 角色：**关联全局演员（人物资产）** / **新建项目角色**
 *        - 场景、道具、服装：**关联资产库已有资产** / **新建资产**
 *      （判定与入参的纯逻辑在 `extractConfirmPlan.ts`，可单测）
 *   3. 确认成功后**触发既有的页面刷新信号** `onReload`（工作台把同一个 `reloadSignals`
 *      同时传给本面板与下方「资产生产区」`ProjectImagePrepPanel`），所以确认的资产会
 *      **立刻出现在同页下方的资产生产区**——不新造跨页跳转，也不改兄弟面板；
 *   4. 页面用用户语言说清楚**下一步是「生成提示词」还是「生成图片」**；
 *   5. 普通页面只显示用户看得懂的状态：后台参数（模型名 / 原始状态 / 任务编号等）
 *      统一收进页面顶部默认收起的「技术详情」，费用提示用大白话写。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Key } from 'react'
import { Alert, Button, Card, Empty, Modal, Radio, Select, Space, Spin, Table, Tag, Tooltip, Typography, message } from 'antd'
import type { TableColumnsType } from 'antd'
import { ReloadOutlined, StopOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { useParams } from 'react-router-dom'
import { ScriptProcessingService, StudioEntitiesService, StudioShotsService } from '../../../../../services/generated'
import type { EntityNameExistenceItem, ShotExtractedCandidateRead } from '../../../../../services/generated'
import type { AnyRecord } from '../../../../../services/llmPipelineApi'
import { classifyGenerationFailure, failureText, useGenerationGate, type GenerationFailure } from '../../../components/generationGate'
import { StudioEntitiesApi } from '../../../../../services/studioEntities'
import {
  buildConfirmPlan,
  confirmKindLabel,
  defaultStrategyFor,
  planCounts,
  resolveConfirmTarget,
  strategyOptionsFor,
  summarizeConfirmPlan,
  type ConfirmAssetKind,
  type ConfirmChoice,
  type ConfirmExistenceInput,
  type ConfirmPlan,
  type ConfirmPlanItem,
  type ConfirmStrategy,
} from './extractConfirmPlan'
import {
  costNoticeText,
  describeGenerationReadiness,
  describeUserStage,
  resolveNextStepHint,
  sanitizeUserText,
  TECHNICAL_DETAIL_HINT,
} from './userFacingStatus'
import { toUserFacingText } from '../../../components/userFacingMessage.ts'

type ProjectExtractPanelProps = {
  projectId: string | null
  chapterId: string | null
  chapterLabel: string | null
  /** 确认/忽略/提取之后重算六步信号（摘要条与**同页下方资产生产区**要跟着变） */
  onReload?: () => void
}

type AssetKind = ConfirmAssetKind

type ExtractGroup = {
  key: string
  kind: AssetKind
  name: string
  typeLabel: string
  candidateIds: number[]
  shotIds: string[]
  statuses: Record<string, number>
  linkedEntityId: string | null
}

const KIND_META: Record<AssetKind, { label: string; color: string }> = {
  character: { label: '角色', color: 'purple' },
  scene: { label: '场景', color: 'blue' },
  prop: { label: '道具', color: 'gold' },
  costume: { label: '服装', color: 'cyan' },
}

/** 候选状态也用用户语言（不出现原始状态值）。 */
const STATUS_META: Record<string, { label: string; color: string }> = {
  pending: { label: '待确认', color: 'gold' },
  linked: { label: '已加入项目', color: 'green' },
  ignored: { label: '已忽略', color: 'default' },
}

type LibraryOption = { id: string; name: string; thumbnail?: string }

const EXTRACT_LOADING_KEY = 'project-extract-loading'
const LINK_LIBRARY_PAGE_SIZE = 100

function isAssetKind(value: string): value is AssetKind {
  return value === 'character' || value === 'scene' || value === 'prop' || value === 'costume'
}

export function ProjectExtractCandidatesPanel({ projectId, chapterId, chapterLabel, onReload }: ProjectExtractPanelProps) {
  const params = useParams<{ projectId?: string }>()
  const effectiveProjectId = projectId ?? params.projectId ?? null

  const gate = useGenerationGate()
  const [rows, setRows] = useState<ShotExtractedCandidateRead[]>([])
  const [shotCount, setShotCount] = useState(0)
  const [existence, setExistence] = useState<Record<string, EntityNameExistenceItem>>({})
  const [loading, setLoading] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [busyKeys, setBusyKeys] = useState<Record<string, boolean>>({})
  const [failure, setFailure] = useState<GenerationFailure | null>(null)
  const [loadError, setLoadError] = useState('')

  /** 勾选的行（批量确认用） */
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  /** 每行用户改过的确认方式与目标 */
  const [choices, setChoices] = useState<Record<string, ConfirmChoice>>({})
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [executing, setExecuting] = useState(false)
  /** 确认成功后的「下一步做什么」（用户语言） */
  const [confirmedCount, setConfirmedCount] = useState(0)

  /** 资产库 / 演员库的下拉数据（只读列表，不触网付费） */
  const [libraryOptions, setLibraryOptions] = useState<Record<AssetKind, LibraryOption[]>>({
    character: [],
    scene: [],
    prop: [],
    costume: [],
  })
  const [libraryLoading, setLibraryLoading] = useState(false)

  /** 拉取本集全部镜头 + 每个镜头的提取候选，按「类型:名称」聚合。 */
  const load = useCallback(async () => {
    if (!chapterId) {
      setRows([])
      setShotCount(0)
      return
    }
    setLoading(true)
    setLoadError('')
    try {
      const shotsRes = await StudioShotsService.listShotsApiV1StudioShotsGet({
        chapterId,
        page: 1,
        pageSize: 100,
        order: 'index',
        isDesc: false,
      })
      const shots = shotsRes.data?.items ?? []
      setShotCount(shots.length)
      const candidateLists = await Promise.all(
        shots.map((shot) =>
          StudioShotsService.getShotExtractedCandidatesApiV1StudioShotsShotIdExtractedCandidatesGet({
            shotId: shot.id,
          })
            .then((res) => (res.data ?? []) as ShotExtractedCandidateRead[])
            .catch(() => [] as ShotExtractedCandidateRead[]),
        ),
      )
      setRows(candidateLists.flat())
    } catch (error) {
      setLoadError((error as Error)?.message || '读取这一集的待确认词条失败')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [chapterId])

  useEffect(() => {
    void load()
  }, [load])

  const groups = useMemo<ExtractGroup[]>(() => {
    const map = new Map<string, ExtractGroup>()
    rows.forEach((row) => {
      const kind = String(row.candidate_type)
      if (!isAssetKind(kind)) return
      const name = String(row.candidate_name ?? '').trim()
      if (!name) return
      const key = `${kind}:${name}`
      const existing = map.get(key)
      const status = String(row.candidate_status ?? 'pending')
      if (existing) {
        existing.candidateIds.push(row.id)
        if (!existing.shotIds.includes(row.shot_id)) existing.shotIds.push(row.shot_id)
        existing.statuses[status] = (existing.statuses[status] ?? 0) + 1
        existing.linkedEntityId = existing.linkedEntityId ?? row.linked_entity_id ?? null
        return
      }
      map.set(key, {
        key,
        kind,
        name,
        typeLabel: KIND_META[kind].label,
        candidateIds: [row.id],
        shotIds: [row.shot_id],
        statuses: { [status]: 1 },
        linkedEntityId: row.linked_entity_id ?? null,
      })
    })
    return Array.from(map.values()).sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
  }, [rows])

  /** 对账：项目里 / 资产库里有没有同名资产，决定「确认」是关联还是新建。 */
  const refreshExistence = useCallback(
    async (targets: ExtractGroup[]) => {
      if (!effectiveProjectId || targets.length === 0) return
      const byKind: Record<AssetKind, string[]> = { character: [], scene: [], prop: [], costume: [] }
      targets.forEach((group) => {
        if (group.statuses.linked) return
        byKind[group.kind].push(group.name)
      })
      const body: AnyRecord = { project_id: effectiveProjectId }
      if (byKind.character.length) body.character_names = byKind.character
      if (byKind.scene.length) body.scene_names = byKind.scene
      if (byKind.prop.length) body.prop_names = byKind.prop
      if (byKind.costume.length) body.costume_names = byKind.costume
      if (!byKind.character.length && !byKind.scene.length && !byKind.prop.length && !byKind.costume.length) {
        return
      }
      try {
        const res = await StudioEntitiesService.checkEntityNamesExistenceApiV1StudioEntitiesExistenceCheckPost({
          requestBody: body as never,
        })
        const data = res.data
        const next: Record<string, EntityNameExistenceItem> = {}
        const buckets: [AssetKind, EntityNameExistenceItem[] | undefined][] = [
          ['character', data?.characters],
          ['scene', data?.scenes],
          ['prop', data?.props],
          ['costume', data?.costumes],
        ]
        buckets.forEach(([kind, list]) => {
          ;(list ?? []).forEach((item) => {
            const name = String(item?.name ?? '').trim()
            if (name) next[`${kind}:${name}`] = item
          })
        })
        setExistence(next)
      } catch (error) {
        setFailure(classifyGenerationFailure(error, 'llm'))
      }
    },
    [effectiveProjectId],
  )

  useEffect(() => {
    void refreshExistence(groups)
  }, [groups, refreshExistence])

  /** 是否已经真跑过提取（有候选即视为跑过）。 */
  const hasExtracted = rows.length > 0
  const pendingGroups = useMemo(
    () => groups.filter((group) => (group.statuses.pending ?? 0) > 0),
    [groups],
  )
  const summary = useMemo(() => {
    const byStatus: Record<string, number> = {}
    rows.forEach((row) => {
      const status = String(row.candidate_status ?? 'pending')
      byStatus[status] = (byStatus[status] ?? 0) + 1
    })
    return byStatus
  }, [rows])

  /** 对账结果 → 纯逻辑入参（存在性判定只有一处口径）。 */
  const existenceInput = useMemo<Record<string, ConfirmExistenceInput>>(() => {
    const next: Record<string, ConfirmExistenceInput> = {}
    Object.entries(existence).forEach(([key, item]) => {
      next[key] = {
        exists: item?.exists === true,
        assetId: item?.asset_id ?? null,
        linkedToProject: item?.linked_to_project === true,
      }
    })
    return next
  }, [existence])

  /** 本面板可确认的行 = 还有待确认候选的行。 */
  const confirmableGroups = useMemo(() => pendingGroups, [pendingGroups])

  const selectedConfirmable = useMemo(
    () => confirmableGroups.filter((group) => selectedKeys.includes(group.key)),
    [confirmableGroups, selectedKeys],
  )

  /** 勾选多条时先看到计划（计数与不能确认的原因）。 */
  const previewPlan = useMemo(
    () => buildConfirmPlan({ groups: confirmableGroups, selectedKeys, existence: existenceInput, choices }),
    [choices, confirmableGroups, existenceInput, selectedKeys],
  )

  /** 表格里当前用到的资产类型（下拉数据按需加载）。 */
  const libraryKindsNeeded = useMemo(() => {
    const kinds = new Set<AssetKind>()
    selectedConfirmable.forEach((group) => {
      const strategy = choices[group.key]?.strategy ?? defaultStrategyFor(group.kind, existenceInput[group.key])
      if (group.kind === 'character' && strategy === 'link_actor') kinds.add('character')
      if (group.kind !== 'character' && strategy === 'link_existing') kinds.add(group.kind)
    })
    return Array.from(kinds)
  }, [choices, existenceInput, selectedConfirmable])

  /** 读取演员库 / 资产库（只读接口，用于「关联已有」的目标选择）。 */
  const loadLibrary = useCallback(async (kinds: AssetKind[], keyword: string) => {
    if (kinds.length === 0) return
    setLibraryLoading(true)
    try {
      const results = await Promise.all(
        kinds.map(async (kind) => {
          const res = await StudioEntitiesApi.list(kind, {
            q: keyword.trim() || undefined,
            page: 1,
            pageSize: LINK_LIBRARY_PAGE_SIZE,
            order: 'updated_at',
            isDesc: true,
          })
          const items = (res.data?.items ?? []) as LibraryOption[]
          return [kind, items.map((item) => ({ id: item.id, name: item.name, thumbnail: item.thumbnail }))] as const
        }),
      )
      setLibraryOptions((prev) => {
        const next = { ...prev }
        results.forEach(([kind, items]) => {
          next[kind] = items
        })
        return next
      })
    } catch {
      message.error('读取资产库失败，可直接选择「新建」')
    } finally {
      setLibraryLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!confirmOpen) return
    void loadLibrary(libraryKindsNeeded, '')
  }, [confirmOpen, libraryKindsNeeded, loadLibrary])

  /** 开始提取 / 重新提取：复用已有同步提取接口（写回 shot_extracted_candidates）。 */
  const runExtract = useCallback(async () => {
    if (!effectiveProjectId || !chapterId) return
    setFailure(null)
    setExtracting(true)
    message.loading({ content: '正在同步提取（本进程内跑完，通常需要数十秒）…', key: EXTRACT_LOADING_KEY, duration: 0 })
    try {
      const shotsRes = await StudioShotsService.listShotsApiV1StudioShotsGet({
        chapterId,
        page: 1,
        pageSize: 100,
        order: 'index',
        isDesc: false,
      })
      const shots = shotsRes.data?.items ?? []
      if (shots.length === 0) {
        message.destroy(EXTRACT_LOADING_KEY)
        message.warning('本集还没有分镜，请先在第 1 步提取分镜')
        return
      }
      const scriptDivision = {
        total_shots: shots.length,
        shots: shots.map((shot) => ({
          index: shot.index,
          start_line: 1,
          end_line: 1,
          script_excerpt: shot.script_excerpt ?? '',
          shot_name: shot.title ?? '',
        })),
      }
      await ScriptProcessingService.extractScriptApiV1ScriptProcessingExtractPost({
        requestBody: {
          project_id: effectiveProjectId,
          chapter_id: chapterId,
          script_division: scriptDivision as never,
          consistency: undefined,
          refresh_cache: true,
        } as never,
      })
      message.destroy(EXTRACT_LOADING_KEY)
      message.success('提取完成，词条已刷新；请在下方确认后再加入项目资产')
      await load()
      onReload?.()
    } catch (error) {
      message.destroy(EXTRACT_LOADING_KEY)
      const classified = classifyGenerationFailure(error, 'llm')
      setFailure(classified)
      message.error(sanitizeUserText(failureText(classified)))
    } finally {
      setExtracting(false)
    }
  }, [chapterId, effectiveProjectId, load, onReload])

  /**
   * 执行一条确认计划。
   *
   * 三条分支都在这里落地（全部复用既有端点，不新建后端）：
   *   - 关联已有资产：必要时先把它关联到项目/镜头，再把候选挂上去；
   *   - 关联全局演员：项目内已有同名角色就直接复用；否则新建角色并绑定所选演员；
   *   - 新建：在项目里新建一份资产，再把候选挂上去。
   */
  const runPlanItem = useCallback(
    async (group: ExtractGroup, item: ConfirmPlanItem) => {
      if (!effectiveProjectId || !chapterId) throw new Error('缺少项目或章节，无法确认资产')
      let linkedEntityId = ''

      if (item.action === 'link_existing') {
        linkedEntityId = item.targetAssetId
        if (!item.reuseProjectAsset) {
          // 资产库里有同名资产但没进本项目：复用「关联已有资产」端点，把它挂到项目/章节/镜头。
          await Promise.all(
            group.shotIds.map((shotId) =>
              StudioShotsService.linkExistingAssetForPreparationApiApiV1StudioShotsShotIdPreparationLinkPost({
                shotId,
                requestBody: {
                  project_id: effectiveProjectId,
                  chapter_id: chapterId,
                  entity_type: group.kind,
                  linked_entity_id: item.targetAssetId,
                } as never,
              }),
            ),
          )
        }
      } else if (item.reuseProjectAsset) {
        linkedEntityId = item.targetAssetId
      } else {
        // 新建（角色可选带上演员绑定；后端会在同一事务里把演员关联到本项目）。
        const payload: AnyRecord = {
          id: `asset_${Date.now()}_${group.kind}`,
          name: group.name,
          description: '',
          tags: [],
          thumbnail: '',
          project_id: effectiveProjectId,
          chapter_id: chapterId,
        }
        if (group.kind === 'character' && item.actorId) payload.actor_id = item.actorId
        const created = await StudioEntitiesApi.create(group.kind, payload)
        linkedEntityId = String((created.data as { id?: string } | undefined)?.id ?? '')
        if (!linkedEntityId) throw new Error('新建资产失败：服务没有返回资产编号')
      }

      if (!linkedEntityId) throw new Error('确认失败：没有拿到要关联的资产')

      // 候选项逐条确认：这是既有端点，会同时把镜头状态重算为就绪。
      await Promise.all(
        group.candidateIds.map((candidateId) =>
          StudioShotsService.linkExtractedCandidateApiV1StudioShotsExtractedCandidatesCandidateIdLinkPatch({
            candidateId,
            requestBody: { linked_entity_id: linkedEntityId },
          }),
        ),
      )
    },
    [chapterId, effectiveProjectId],
  )

  /**
   * 执行整份计划（逐条确认与批量确认共用）。
   *
   * 成功后一定做两件事：
   *   1. `load()` 刷新本面板；
   *   2. `onReload?.()` 触发**既有的页面刷新信号**——工作台把同一个 `reloadSignals`
   *      同时给下方「资产生产区」，所以确认的资产会立刻出现在同页下方。
   */
  const executePlan = useCallback(
    async (plan: ConfirmPlan, options?: { closeModal?: boolean }) => {
      if (!effectiveProjectId || !chapterId) return
      if (plan.items.length === 0) {
        message.warning(plan.blocked[0] ? `${plan.blocked[0].name}：${plan.blocked[0].reason}` : '请先勾选要确认的词条')
        return
      }
      setExecuting(true)
      setFailure(null)
      const touchedKeys = plan.items.map((item) => item.key)
      setBusyKeys((prev) => {
        const next = { ...prev }
        touchedKeys.forEach((key) => {
          next[key] = true
        })
        return next
      })

      let okCount = 0
      const succeeded: ConfirmPlanItem[] = []
      const failures: string[] = []
      for (const item of plan.items) {
        const group = groups.find((candidate) => candidate.key === item.key)
        if (!group) continue
        try {
          await runPlanItem(group, item)
          okCount += 1
          succeeded.push(item)
        } catch (error) {
          const classified = classifyGenerationFailure(error, 'llm')
          setFailure(classified)
          failures.push(`${item.name}：${sanitizeUserText(failureText(classified), '没有确认成功')}`)
        }
      }

      setBusyKeys((prev) => {
        const next = { ...prev }
        touchedKeys.forEach((key) => {
          next[key] = false
        })
        return next
      })
      setExecuting(false)

      if (okCount > 0) {
        message.success(summarizeConfirmPlan({ items: succeeded, blocked: [], counts: planCounts(succeeded) }))
        setConfirmedCount(okCount)
      }
      if (failures.length > 0) {
        message.error(`有 ${failures.length} 项没有确认成功：${failures.join('；')}`)
      }
      if (plan.blocked.length > 0) {
        message.warning(
          `有 ${plan.blocked.length} 项还不能确认：` +
            plan.blocked.map((item) => `${item.name}（${item.reason}）`).join('；'),
        )
      }

      setSelectedKeys([])
      setChoices({})
      if (options?.closeModal !== false) setConfirmOpen(false)

      // 先刷新本面板与页面信号：下方的资产生产区要立刻看到刚确认的资产。
      await load()
      onReload?.()
    },
    [chapterId, effectiveProjectId, groups, load, onReload, runPlanItem],
  )

  /** 逐条确认：用该行的默认方式（项目/库里已有同名资产 → 关联它，否则新建）。 */
  const confirmOneGroup = useCallback(
    async (group: ExtractGroup) => {
      const plan = buildConfirmPlan({
        groups: [group],
        selectedKeys: [group.key],
        existence: existenceInput,
        choices,
      })
      await executePlan(plan, { closeModal: false })
    },
    [choices, executePlan, existenceInput],
  )

  const ignoreGroup = useCallback(
    async (group: ExtractGroup) => {
      if (busyKeys[group.key]) return
      setBusyKeys((prev) => ({ ...prev, [group.key]: true }))
      setFailure(null)
      try {
        await Promise.all(
          group.candidateIds.map((candidateId) =>
            StudioShotsService.ignoreExtractedCandidateApiV1StudioShotsExtractedCandidatesCandidateIdIgnorePatch({
              candidateId,
            }),
          ),
        )
        message.success(`已忽略「${group.name}」`)
        await load()
        onReload?.()
      } catch (error) {
        const classified = classifyGenerationFailure(error, 'llm')
        setFailure(classified)
        message.error(sanitizeUserText(failureText(classified)))
      } finally {
        setBusyKeys((prev) => ({ ...prev, [group.key]: false }))
      }
    },
    [busyKeys, load, onReload],
  )

  const columns: TableColumnsType<ExtractGroup> = [
    {
      title: '从剧本里读出的词条',
      key: 'name',
      render: (_: unknown, group) => (
        <Space size={6} wrap>
          <Tag color={KIND_META[group.kind].color} className="mr-0">
            {KIND_META[group.kind].label}
          </Tag>
          <span className="truncate font-medium" title={group.name}>
            {group.name}
          </span>
        </Space>
      ),
    },
    {
      title: '出现镜头',
      key: 'shots',
      width: 96,
      render: (_: unknown, group) => <Tag bordered={false}>{`${group.shotIds.length} 镜`}</Tag>,
    },
    {
      title: '对账结果',
      key: 'existence',
      width: 200,
      render: (_: unknown, group) => {
        const item = existence[group.key]
        if (!item) return <Tag bordered={false}>正在核对…</Tag>
        if (item.exists && item.linked_to_project) return <Tag color="green" bordered={false}>项目内已有同名资产</Tag>
        if (item.exists) return <Tag color="blue" bordered={false}>资产库已有，可关联</Tag>
        return <Tag color="gold" bordered={false}>暂无同名资产（将新建）</Tag>
      },
    },
    {
      title: '确认进度',
      key: 'status',
      width: 160,
      render: (_: unknown, group) => (
        <Space size={4} wrap>
          {Object.entries(group.statuses).map(([status, count]) => (
            <Tag key={status} color={STATUS_META[status]?.color ?? 'default'} bordered={false}>
              {`${STATUS_META[status]?.label ?? '待确认'} ${count}`}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 170,
      render: (_: unknown, group) => (
        <Space size={4}>
          <Tooltip title="直接用这条的默认方式确认：项目/资产库里有同名资产就关联它，没有就新建">
            <Button
              size="small"
              type="primary"
              loading={busyKeys[group.key]}
              disabled={(group.statuses.linked ?? 0) === group.candidateIds.length}
              onClick={() => void confirmOneGroup(group)}
            >
              确认
            </Button>
          </Tooltip>
          <Tooltip title="这些都还不是资产，忽略后不再挡着这一步">
            <Button
              size="small"
              type="text"
              danger
              icon={<StopOutlined />}
              disabled={(group.statuses.pending ?? 0) === 0}
              onClick={() => void ignoreGroup(group)}
            />
          </Tooltip>
        </Space>
      ),
    },
  ]

  /** 用户可见状态条（纯逻辑产出，绝不出现后台参数）。 */
  const stage = describeUserStage({
    shotCount,
    hasExtracted,
    loading: loading && rows.length === 0,
    running: extracting || executing,
    runningKind: 'extract',
    failureReason: failure ? failureText(failure) : '',
    failureKind: 'extract',
    pendingCandidateCount: summary.pending ?? 0,
    imagePrep: null,
  })

  const readiness = describeGenerationReadiness({
    outletLabel: '提示词',
    error: gate.error,
    dryRun: gate.loading ? null : gate.dryRun,
    modelReady: gate.loading ? null : gate.models.llm.state === 'configured',
  })

  /** 确认之后页面必须说清楚下一步：生成提示词还是生成图片。 */
  const nextStep = resolveNextStepHint({ hasImagePrompt: false })

  if (!chapterId) {
    return (
      <Card size="small" className="mb-2">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={<span className="text-xs text-gray-500">请先选择一集，再确认提取出的词条</span>}
        />
      </Card>
    )
  }

  const confirmPlanTitle = previewPlan.counts.total > 0 ? `确认资产（${previewPlan.counts.total} 项）` : '确认资产'

  return (
    <Card
      size="small"
      className="mb-2"
      styles={{ body: { paddingTop: 10, paddingBottom: 10 } }}
      title={
        <Space size={8} wrap>
          <span className="text-sm font-medium">第 2 步 · 资产准备（先确认提取出的词条）</span>
          <Tag bordered={false}>{`本集 ${shotCount} 镜`}</Tag>
          {rows.length > 0 ? <Tag color="blue" bordered={false}>{`待你确认的词条 ${rows.length} 条`}</Tag> : null}
          {(summary.pending ?? 0) > 0 ? (
            <Tag color="gold" bordered={false}>{`待确认 ${summary.pending}`}</Tag>
          ) : rows.length > 0 ? (
            <Tag color="green" bordered={false}>{`已处理 ${rows.length - (summary.pending ?? 0)}`}</Tag>
          ) : null}
        </Space>
      }
      extra={
        <Space size={6}>
          <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
            重新读取
          </Button>
          <Button
            size="small"
            type="primary"
            icon={<ThunderboltOutlined />}
            loading={extracting}
            disabled={shotCount === 0}
            onClick={() => void runExtract()}
          >
            {hasExtracted ? '重新提取' : '开始提取'}
          </Button>
        </Space>
      }
    >
      {/* 状态条：只说「现在能不能做、下一步做什么」，后台参数一律收进「技术详情」。 */}
      <Alert
        type={stage.tone}
        showIcon
        message={<span className="text-xs font-medium">{stage.label}</span>}
        description={
          <span className="text-xs">
            {stage.detail}
            <br />
            {`费用说明：${costNoticeText(gate.dryRun)}`}
          </span>
        }
        style={{ marginBottom: 8 }}
      />

      {readiness.tone === 'error' || readiness.tone === 'warning' ? (
        <Alert
          type={readiness.tone}
          showIcon
          message={<span className="text-xs font-medium">{readiness.title}</span>}
          description={<span className="text-xs">{readiness.detail}</span>}
          style={{ marginBottom: 8 }}
        />
      ) : null}

      {confirmedCount > 0 ? (
        <Alert
          type="success"
          showIcon
          message={<span className="text-xs font-medium">{nextStep.title}</span>}
          description={<span className="text-xs">{`刚确认了 ${confirmedCount} 项资产，已经出现在下面的「资产生产区」。${nextStep.detail}`}</span>}
          style={{ marginBottom: 8 }}
        />
      ) : null}

      {loadError ? (
        <Alert
          type="error"
          showIcon
          message="读取待确认的词条失败"
          description={toUserFacingText(loadError, '读取失败：请稍后重试，或展开「技术详情」查看原始信息。')}
          style={{ marginBottom: 8 }}
        />
      ) : null}

      {shotCount === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={<span className="text-xs text-gray-500">本集还没有分镜，请先在第 1 步提取分镜</span>}
        />
      ) : rows.length === 0 && !loading ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span className="text-xs text-gray-500">
              {chapterLabel ?? '本集'} 还没有可确认的词条：点右上角「开始提取」，按剧本提取角色、场景、道具与服装。
            </span>
          }
        />
      ) : loading && rows.length === 0 ? (
        <div className="py-6 text-center">
          <Spin />
          <div className="mt-2 text-xs text-gray-500">正在读取待确认的词条…</div>
        </div>
      ) : (
        <>
          <Typography.Text type="secondary" className="text-[11px]">
            「确认」= 关联已有资产或新建资产，并把这批词条标为已加入项目；确认后资产会立刻出现在下面的「资产生产区」。
          </Typography.Text>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              size="small"
              type="primary"
              disabled={selectedConfirmable.length === 0 || executing}
              loading={executing}
              onClick={() => setConfirmOpen(true)}
            >
              {`确认选中项（${selectedConfirmable.length}）`}
            </Button>
            <Button
              size="small"
              disabled={selectedKeys.length === 0}
              onClick={() => {
                setSelectedKeys([])
                setChoices({})
              }}
            >
              清空勾选
            </Button>
            <span className="text-[11px] text-gray-500">
              勾选多条可以一次确认；也可以直接点某一行的「确认」逐条确认。
            </span>
          </div>

          <Table<ExtractGroup>
            className="mt-2"
            rowKey="key"
            size="small"
            loading={loading}
            columns={columns}
            dataSource={groups}
            rowSelection={{
              selectedRowKeys: selectedConfirmable.map((group) => group.key),
              onChange: (keys: Key[]) => {
                const nextKeys = keys.map(String)
                setSelectedKeys(nextKeys)
                setChoices((prev) => {
                  const next: Record<string, ConfirmChoice> = {}
                  nextKeys.forEach((key) => {
                    if (prev[key]) next[key] = prev[key]
                  })
                  return next
                })
              },
              getCheckboxProps: (group) => ({
                disabled: (group.statuses.pending ?? 0) === 0,
                name: group.name,
              }),
            }}
            pagination={{ pageSize: 8, size: 'small' }}
          />

          {pendingGroups.length > 0 ? (
            <div className="mt-2 text-[11px] text-gray-500">
              {`还有 ${pendingGroups.length} 项还没确认；确认完它们，这一步就算完成。`}
            </div>
          ) : (
            <div className="mt-2 text-[11px] text-emerald-600">
              {`本集词条已全部处理。${nextStep.title}：${nextStep.detail}`}
            </div>
          )}

          <div className="mt-2 text-[11px] text-gray-400">{TECHNICAL_DETAIL_HINT}</div>
        </>
      )}

      <Modal
        open={confirmOpen}
        title={confirmPlanTitle}
        onCancel={() => setConfirmOpen(false)}
        onOk={() => void executePlan(previewPlan)}
        confirmLoading={executing}
        okText={previewPlan.counts.total > 0 ? `确认这 ${previewPlan.counts.total} 项` : '确认'}
        okButtonProps={{ disabled: previewPlan.counts.total === 0 }}
        cancelText="取消"
        width={780}
      >
        <div className="max-h-[60vh] overflow-auto">
          <div className="mb-2 text-xs text-gray-500">
            勾选的每一行都可以选确认方式：关联已有资产，或在项目里新建。确认后资产会立刻出现在下面的「资产生产区」。
          </div>
          {previewPlan.items.length === 0 && previewPlan.blocked.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span className="text-xs">还没有勾选任何一项</span>} />
          ) : null}
          <div className="space-y-2">
            {selectedConfirmable.map((group) => {
              const choice = choices[group.key] ?? {}
              const strategy = choice.strategy ?? defaultStrategyFor(group.kind, existenceInput[group.key])
              const resolution = resolveConfirmTarget({
                group,
                existence: existenceInput[group.key],
                choice: { ...choice, strategy },
              })
              const options = strategyOptionsFor(group.kind)
              return (
                <div key={group.key} className="rounded border border-gray-200 p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Tag color={KIND_META[group.kind].color} className="mr-0">
                      {confirmKindLabel(group.kind)}
                    </Tag>
                    <span className="font-medium">{group.name}</span>
                    <Tag bordered={false}>{`${group.shotIds.length} 镜`}</Tag>
                    <Tag bordered={false}>{`${group.candidateIds.length} 条记录`}</Tag>
                  </div>

                  <Radio.Group
                    className="mt-2"
                    size="small"
                    value={strategy}
                    onChange={(event) => {
                      const nextStrategy = event.target.value as ConfirmStrategy
                      setChoices((prev) => ({ ...prev, [group.key]: { ...prev[group.key], strategy: nextStrategy } }))
                    }}
                    options={options.map((option) => ({
                      label: option.label,
                      value: option.value,
                    }))}
                  />

                  <div className="mt-1 text-[11px] text-gray-500">
                    {options.find((option) => option.value === strategy)?.hint}
                  </div>

                  {group.kind === 'character' && strategy === 'link_actor' && !resolution.reuseProjectAsset ? (
                    <Select
                      className="mt-2 w-full"
                      size="small"
                      showSearch
                      allowClear
                      filterOption={false}
                      loading={libraryLoading}
                      placeholder="从全局演员库选一位演员"
                      value={choice.actorId ?? undefined}
                      onSearch={(keyword) => void loadLibrary(['character'], keyword)}
                      onChange={(value?: string) =>
                        setChoices((prev) => ({ ...prev, [group.key]: { ...prev[group.key], strategy, actorId: value ?? null } }))
                      }
                      options={libraryOptions.character.map((option) => ({ label: option.name, value: option.id }))}
                    />
                  ) : null}

                  {group.kind !== 'character' && strategy === 'link_existing' ? (
                    <Select
                      className="mt-2 w-full"
                      size="small"
                      showSearch
                      allowClear
                      filterOption={false}
                      loading={libraryLoading}
                      placeholder="从资产库选一份已有资产"
                      value={choice.targetAssetId ?? existenceInput[group.key]?.assetId ?? undefined}
                      onSearch={(keyword) => void loadLibrary([group.kind], keyword)}
                      onChange={(value?: string) =>
                        setChoices((prev) => ({
                          ...prev,
                          [group.key]: { ...prev[group.key], strategy, targetAssetId: value ?? null },
                        }))
                      }
                      options={libraryOptions[group.kind].map((option) => ({ label: option.name, value: option.id }))}
                    />
                  ) : null}

                  <div className="mt-1 text-[11px]">
                    {resolution.ready ? (
                      <span className="text-gray-500">
                        {resolution.reuseProjectAsset
                          ? `项目里已经有同名资产，确认后直接关联到它。`
                          : resolution.action === 'link_existing'
                            ? '确认后把这一项关联到资产库里的那份资产。'
                            : group.kind === 'character' && resolution.actorId
                              ? '确认后新建项目角色，并绑定所选演员的人物形象。'
                              : '确认后在项目里新建这份资产。'}
                      </span>
                    ) : (
                      <span className="text-red-500">{resolution.blockedReason}</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </Modal>
    </Card>
  )
}

export default ProjectExtractCandidatesPanel
