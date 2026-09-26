/**
 * 工作室「视频提示词」页签里的**大模型批量生成**面板（第 4 步）。
 *
 * 为什么需要它（用户要求）：
 * 1. 第 4 步此前只能**手写**或从别处「填入本次生成结果」，工作室里没有真正的"生成"按钮；
 *    提示词要么来自巨日禄导入、要么是人工写的，大模型生成这条主路是断的。
 * 2. 默认**只补缺失项**：已有巨日禄导入 / 人工编辑 / 已确认（来源在白名单内）的镜头一律不碰，
 *    要覆盖必须显式打开开关。
 * 3. 生成结果**必须可编辑、确认后才保存**，并且**模板/演练结果不得冒充大模型输出** ——
 *    只有当后端回包 `meta.llm_called === true` 时才允许按「大模型生成」来源保存；
 *    DRY_RUN 下后端根本没调模型，这里会明确标成演练并禁用保存。
 * 4. 批量要能**停止后续、保留已完成、重试失败项**，避免重复付费。
 *
 * 数据来源：出口 A 的只读交付接口（`previewPromptDelivery`，scope=episode），
 * 一次拿到本集所有镜头的 `video_prompt` 与来源，用来判断"哪些算缺失"。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Input, Progress, Space, Table, Tag, message } from 'antd'
import { ReloadOutlined, ThunderboltOutlined } from '@ant-design/icons'
import {
  previewPromptDelivery,
  previewVideoPrompt,
  saveShotVideoPrompt,
  type PromptDeliveryRow,
} from '../../../../services/llmPipelineApi'
// 阶段 B ③（审计 §4.3 模式 6）：后端原文 → 主区中文结论（掩码 → 洗句 → 业务化改写）
import { showUserError, toUserFacingText } from '../../components/userFacingMessage'
// 阶段 B ③（审计 §4.3 模式 3）：提示词来源枚举原值不许直渲（jurilu / manual_workspace…）
import { videoPromptSourceLabel } from '../../components/enumLabels'

/** 可进入交付导出的来源白名单：这些来源的内容视为"已确认"，默认不覆盖。 */
export const CONFIRMED_PROMPT_SOURCES: string[] = [
  'jurilu',
  'skill',
  'llm',
  'internal',
  'manual',
  'manual_workspace',
  'shot_description',
]

export function isConfirmedPromptSource(source: string | null | undefined): boolean {
  return CONFIRMED_PROMPT_SOURCES.includes(String(source ?? '').trim().toLowerCase())
}

type ScopeKey = 'current' | 'selected' | 'episode'

type BatchRow = {
  shotId: string
  code: string
  title: string
  /** 库里已保存的提示词（用于"只补缺失"判断与对照） */
  saved: string
  savedSource: string
  status: 'pending' | 'skipped' | 'running' | 'generated' | 'saved' | 'failed'
  draft: string
  /** 后端是否**真的**调用了大模型（false = 演练/未调用，不允许按 LLM 来源保存） */
  llmCalled: boolean | null
  latencyMs: number | null
  error: string
  warnings: string[]
}

type VideoPromptLlmPanelProps = {
  projectId?: string
  chapterId?: string | null
  currentShotId?: string | null
  /** 工作室里勾选的分镜（用于"只处理选中项"） */
  selectedShotIds?: string[]
  /** 保存成功后通知外层刷新（工作室要同步"已保存内容"与本集进度） */
  onSaved?: (shotId: string, prompt: string, source: string) => void
  /** 标题里显示的步骤名，便于复用 */
  title?: string
}

export function VideoPromptLlmPanel({
  projectId,
  chapterId,
  currentShotId,
  selectedShotIds = [],
  onSaved,
  title = '大模型生成视频提示词',
}: VideoPromptLlmPanelProps) {
  const [rows, setRows] = useState<PromptDeliveryRow[]>([])
  const [loadingRows, setLoadingRows] = useState(false)
  const [loadError, setLoadError] = useState('')
  // 固定为当前镜头（本面板已降级为单镜补漏）
  const scope: ScopeKey = 'current'
  const [onlyMissing, setOnlyMissing] = useState(true)
  const [includeConfirmed, setIncludeConfirmed] = useState(false)
  const [items, setItems] = useState<BatchRow[]>([])
  const [running, setRunning] = useState(false)
  const [savingId, setSavingId] = useState('')
  const stopRef = useRef(false)

  const loadRows = useCallback(async () => {
    if (!projectId || !chapterId) return
    setLoadingRows(true)
    setLoadError('')
    try {
      const data = await previewPromptDelivery(projectId, chapterId, 'episode')
      setRows(data?.rows ?? [])
    } catch (error) {
      setRows([])
      setLoadError(toUserFacingText(error, '读取本集镜头失败'))
    } finally {
      setLoadingRows(false)
    }
  }, [chapterId, projectId])

  useEffect(() => {
    void loadRows()
  }, [loadRows])

  /** 目标镜头（按范围选择）+ 是否会被"只补缺失"跳过。 */
  const targets = useMemo(() => {
    const selected = new Set(selectedShotIds.filter(Boolean))
    const scoped = rows.filter((row) => {
      if (scope === 'current') return row.shot_id === currentShotId
      if (scope === 'selected') return selected.has(row.shot_id)
      return true
    })
    const missingOnly = scoped.filter((row) => {
      const saved = String(row.video_prompt ?? '').trim()
      if (!saved) return true
      return !isConfirmedPromptSource(row.video_prompt_source)
    })
    const planned = onlyMissing ? (includeConfirmed ? scoped : missingOnly) : scoped
    return { scoped, skipped: scoped.length - planned.length, planned }
  }, [currentShotId, includeConfirmed, onlyMissing, rows, scope, selectedShotIds])

  const buildItems = useCallback(
    (source: PromptDeliveryRow[]): BatchRow[] =>
      source.map((row) => ({
        shotId: row.shot_id,
        code: row.shot_code,
        title: row.shot_title,
        saved: String(row.video_prompt ?? '').trim(),
        savedSource: String(row.video_prompt_source ?? '').trim(),
        status: 'pending',
        draft: '',
        llmCalled: null,
        latencyMs: null,
        error: '',
        warnings: [],
      })),
    [],
  )

  /** 逐个生成：串行、可停止、保留已完成结果。 */
  const runBatch = useCallback(
    async (rowsToRun: BatchRow[]) => {
      if (!rowsToRun.length) return
      stopRef.current = false
      setRunning(true)
      setItems((prev) => {
        const next = [...prev]
        for (const target of rowsToRun) {
          const index = next.findIndex((item) => item.shotId === target.shotId)
          if (index >= 0) next[index] = { ...next[index], status: 'pending', error: '', warnings: [] }
        }
        return next
      })
      for (const target of rowsToRun) {
        if (stopRef.current) {
          setItems((prev) =>
            prev.map((item) =>
              item.shotId === target.shotId && item.status === 'pending'
                ? { ...item, status: 'skipped', error: '已按你的要求停止后续任务' }
                : item,
            ),
          )
          continue
        }
        setItems((prev) => prev.map((item) => (item.shotId === target.shotId ? { ...item, status: 'running' } : item)))
        try {
          const preview = await previewVideoPrompt({ shot_id: target.shotId, project_id: projectId ?? null })
          const llmCalled = Boolean(preview?.meta?.llm_called)
          setItems((prev) =>
            prev.map((item) =>
              item.shotId === target.shotId
                ? {
                    ...item,
                    status: 'generated',
                    draft: String(preview?.final_prompt ?? '').trim(),
                    llmCalled,
                    latencyMs: preview?.meta?.latency_ms ?? null,
                    warnings: Array.isArray(preview?.warnings) ? preview.warnings : [],
                    error: '',
                  }
                : item,
            ),
          )
        } catch (error) {
          setItems((prev) =>
            prev.map((item) =>
              item.shotId === target.shotId
                ? { ...item, status: 'failed', error: toUserFacingText(error, '生成失败') }
                : item,
            ),
          )
        }
      }
      setRunning(false)
      stopRef.current = false
    },
    [projectId],
  )

  const startBatch = () => {
    const planned = targets.planned
    if (!planned.length) {
      message.warning('范围内没有需要生成的镜头（可能都已有已确认的提示词）')
      return
    }
    setItems(buildItems(planned))
    void runBatch(buildItems(planned))
  }

  const retryFailed = () => {
    const failed = items.filter((item) => item.status === 'failed')
    if (!failed.length) return
    void runBatch(failed)
  }

  /** 保存一条：只有真正调用过大模型的结果才允许按「大模型生成」来源落库。 */
  const saveOne = async (item: BatchRow): Promise<boolean> => {
    const text = String(item.draft ?? '').trim()
    if (!text) {
      message.warning('提示词为空，未保存')
      return false
    }
    if (!item.llmCalled) {
      message.error('这次后端没有真正调用大模型（演练/模板），不能按「大模型生成」保存为正式产物。')
      return false
    }
    setSavingId(item.shotId)
    try {
      await saveShotVideoPrompt(item.shotId, text, 'llm')
      setItems((prev) => prev.map((row) => (row.shotId === item.shotId ? { ...row, status: 'saved' } : row)))
      onSaved?.(item.shotId, text, 'llm')
      return true
    } catch (error) {
      void showUserError(error, '保存失败')
      return false
    } finally {
      setSavingId('')
    }
  }

  const saveAllGenerated = async () => {
    const pending = items.filter((item) => item.status === 'generated' && item.llmCalled && item.draft.trim())
    if (!pending.length) {
      message.warning('没有可保存的生成结果')
      return
    }
    let saved = 0
    for (const item of pending) {
      // 串行保存：避免并发写同一批镜头时互相覆盖
      // eslint-disable-next-line no-await-in-loop
      if (await saveOne(item)) saved += 1
    }
    if (saved) {
      message.success(`已保存 ${saved} 条到镜头（来源：大模型生成）`)
      await loadRows()
    }
  }

  const stats = useMemo(() => {
    const total = items.length
    const saved = items.filter((item) => item.status === 'saved').length
    const generated = items.filter((item) => item.status === 'generated').length
    const failed = items.filter((item) => item.status === 'failed').length
    const skipped = items.filter((item) => item.status === 'skipped').length
    return { total, saved, generated, failed, skipped }
  }, [items])

  const dryRunRows = items.filter((item) => item.status === 'generated' && item.llmCalled === false)

  return (
    <div className="space-y-3">
      <div className="cs-group-title">
        <ThunderboltOutlined /> {title}
      </div>
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-600">
        整集提示词请到项目工作台第 3 步「整集视频提示词」批量生成或导入并统一确认；这里只用于当前镜头的补漏与返工：
        单镜生成草稿 → 检查/修改 → 保存到本镜（只有你确认保存的内容才会进入交付导出与视频生成）。
      </div>

      <Space wrap size={12} align="center">
        {/* 第二部分：工作台只做**单镜补漏**——整集批量生成/导入的主入口在项目工作台第 4 步 */}
        <Tag color="blue">单镜补漏</Tag>
        <Checkbox
          checked={onlyMissing}
          onChange={(event) => setOnlyMissing(event.target.checked)}
        >
          只补缺失项（不覆盖巨日禄 / 人工 / 已确认内容）
        </Checkbox>
        <Checkbox
          checked={includeConfirmed}
          disabled={!onlyMissing}
          onChange={(event) => setIncludeConfirmed(event.target.checked)}
        >
          连已有内容的镜头一起生成（会覆盖）
        </Checkbox>
        <Button size="small" icon={<ReloadOutlined />} loading={loadingRows} onClick={() => void loadRows()}>
          刷新本集状态
        </Button>
      </Space>

      {loadError ? <Alert type="warning" showIcon message={loadError} /> : null}

      <div className="text-[11px] text-gray-500">
        {`本次范围内 ${targets.scoped.length} 镜，计划生成 ${targets.planned.length} 镜`}
        {targets.skipped > 0 ? `，已跳过 ${targets.skipped} 镜（已有已确认提示词）` : ''}

      </div>

      <Space wrap size={8}>
        <Button type="primary" size="small" loading={running} disabled={!targets.planned.length} onClick={startBatch}>
          {`生成提示词（${targets.planned.length} 镜）`}
        </Button>
        <Button size="small" danger disabled={!running} onClick={() => { stopRef.current = true; message.info('已请求停止：当前这一镜会跑完，后续不再开始') }}>
          停止后续
        </Button>
        <Button size="small" disabled={!stats.failed} onClick={retryFailed}>
          {`重试失败项（${stats.failed}）`}
        </Button>
        <Button size="small" disabled={!stats.generated} onClick={() => void saveAllGenerated()}>
          保存全部已生成
        </Button>
      </Space>

      {dryRunRows.length ? (
        <Alert
          type="warning"
          showIcon
          message={`有 ${dryRunRows.length} 条是演练结果（后端未调用大模型），不能保存为正式产物`}
          description="演练模式下不会真的调用大模型，也不会花钱；要拿到可保存的结果需要先确认并开启真实调用。"
        />
      ) : null}

      {items.length ? (
        <>
          <Progress
            percent={stats.total ? Math.round(((stats.saved + stats.generated + stats.failed + stats.skipped) / stats.total) * 100) : 0}
            size="small"
            status={running ? 'active' : undefined}
          />
          <Table<BatchRow>
            size="small"
            rowKey="shotId"
            pagination={false}
            dataSource={items}
            scroll={{ y: 320 }}
            columns={[
              { title: '镜头', dataIndex: 'code', width: 70 },
              {
                title: '状态',
                dataIndex: 'status',
                width: 90,
                render: (_value, row) => {
                  const color =
                    row.status === 'saved' ? 'green' : row.status === 'failed' ? 'red' : row.status === 'skipped' ? 'default' : row.status === 'running' ? 'blue' : 'gold'
                  const label =
                    row.status === 'saved'
                      ? '已保存'
                      : row.status === 'failed'
                        ? '失败'
                        : row.status === 'skipped'
                          ? '已跳过'
                          : row.status === 'running'
                            ? '生成中'
                            : row.status === 'generated'
                              ? '已生成'
                              : '待生成'
                  return <Tag color={color}>{label}</Tag>
                },
              },
              { title: '已有内容', dataIndex: 'saved', width: 120, render: (value: string, row) => (value ? `${value.length} 字 / ${videoPromptSourceLabel(row.savedSource) || '无来源'}` : '—') },
              {
                title: '生成结果（可编辑）',
                dataIndex: 'draft',
                render: (value: string, row) => (
                  <div className="space-y-1">
                    <Input.TextArea
                      rows={3}
                      value={value}
                      placeholder={row.status === 'failed' ? toUserFacingText(row.error, '这一条没有生成成功，请重试') : '点上面的「生成提示词」后在这里检查/修改'}
                      disabled={row.status === 'failed'}
                      onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                        setItems((prev) => prev.map((item) => (item.shotId === row.shotId ? { ...item, draft: event.target.value } : item)))
                      }
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        size="small"
                        type="primary"
                        loading={savingId === row.shotId}
                        disabled={row.status !== 'generated' || !row.llmCalled || !row.draft.trim()}
                        onClick={() => void saveOne(row)}
                      >
                        保存到镜头（来源：大模型生成）
                      </Button>
                      {row.status === 'generated' && !row.llmCalled ? (
                        <span className="text-[11px] text-amber-600">演练结果：没有真正调用大模型，不可保存</span>
                      ) : null}
                    </div>
                    {row.warnings?.length ? (
                      <ul className="list-disc pl-5 text-[11px] text-amber-600">
                        {row.warnings.slice(0, 3).map((warning, index) => (
                          <li key={`${row.shotId}-warn-${index}`}>{toUserFacingText(warning, '这一条有需要注意的地方')}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ),
              },
            ]}
          />
        </>
      ) : null}
    </div>
  )
}

export default VideoPromptLlmPanel
