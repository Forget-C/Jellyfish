/**
 * 镜头准备页「AI 推荐关联」标签页内容。
 *
 * 职责边界：
 * - 推荐结果来自 `POST /api/v1/studio/llm/asset-binding/preview`（**只建议、不写库**）；
 * - 保存勾选项时复用既有写库端点（角色 / 场景 / 道具 / 服装四类 link 端点），
 *   不新增后端接口、不直接写库；
 * - DRY_RUN 守卫开启时后端不会真实调用大模型，此时建议仅来自确定性启发式规则，
 *   页面必须显式展示这一点，不能假装是模型判断。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Empty, Progress, Space, Table, Tag, Typography, message } from 'antd'
import type { TableColumnsType, TableProps } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { StudioShotCharacterLinksService, StudioShotLinksService } from '../../../../services/generated'
import { previewAssetBinding } from '../../../../services/llmPipelineApi'
import type { AssetBindingPreviewResult, AssetBindingShot, BindingSuggestion } from '../../../../services/llmPipelineApi'
import { defaultTaskActionErrorMessage } from '../../components/taskActionHelpers'
import { maskInternalIds } from '../../components/maskInternalIds'
/* 「技术详情」折叠壳**全仓只有一份**（审计 §9 第 2 项）：内部的开关原文 / 调用与模型口径一律走它。 */
import { TechnicalDetailSection } from '../../project/ProjectWorkbench/components/workbench/TechnicalDetailCollapse'
import {
  autoConfirmableRows,
  describeRecommendationReason,
  isDefaultChecked as isDefaultCheckedRule,
  requiresUserChoice,
} from './bindingRecommendationRules'

type ChapterShotAssetBindingSectionProps = {
  projectId: string
  chapterId: string
  shotId: string
  /** 保存成功后回读页面的准备状态（由页面传入 loadPreparationState）。 */
  onReloadPreparationState: () => Promise<unknown>
}

type UnmatchedNameRow = {
  shot_id?: string
  name?: string
  guessed_type?: string
  evidence?: string
}

type SaveFailure = {
  label: string
  reason: string
}

const SLOT_LABELS: Record<string, string> = {
  characters: '角色',
  scene: '场景',
  props: '道具',
  costumes: '服装',
}

const ASSET_TYPE_LABELS: Record<string, string> = {
  character: '角色',
  scene: '场景',
  prop: '道具',
  costume: '服装',
}

/**
 * 后端成本提示 → 主区可显示的一句（审计 §4.6 模式 3/5）。
 *
 * 运行时实测（本批走查）后端原话形如：
 * `估算 1 批，输入约 850 tokens、输出约 600 tokens（deepseek-chat 量级 < ¥0.1）；DRY_RUN 下不产生任何费用。`
 * —— 同一句里既有**模型名**（模式 5）又有 **`DRY_RUN`**（模式 3/4）。
 *
 * 用户真正要看的是「大概多少钱、会不会产生费用」，所以这里只做两处**定点**收口：
 *   1. 括号里的「模型名 + 量级 + 金额」→ 「预计费用 + 金额」（保住金额，去掉模型名）；
 *   2. `DRY_RUN` → 「演练模式」。
 * 原文一字不改地留在下面的「技术详情」里（`cost-note-technical-detail`）。
 */
function describePreviewCostNote(note: string): string {
  return String(note ?? '')
    .replace(/（[^）]*?(<\s*¥\s*[\d.]+)[^）]*）/g, '（预计费用 $1）')
    .replace(/(?<![A-Za-z0-9_])DRY_RUN(?![A-Za-z0-9_])\s*/g, '演练模式')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/* 兜底一律给中文（审计 §7.4：`MAP[k] ?? k` 是模式 3 的兜底坑，未登记不许回显原值）。 */
function slotLabel(slot: string): string {
  return SLOT_LABELS[slot] ?? '其它关联'
}

function assetTypeLabel(assetType: string): string {
  return ASSET_TYPE_LABELS[assetType] ?? '其它资产'
}

/**
 * 资产名：优先用建议自带的 `asset_name`，其次用候选清单里的名字
 * （启发式-only 的行后端不带 asset_name，直接显示 asset_id 会把内部 ID 暴露在主界面）。
 */
function assetLabel(row: BindingSuggestion, catalogNames?: Map<string, string>): string {
  const name = (row.asset_name ?? '').trim()
  if (name) return name
  const fromCatalog = catalogNames?.get(String(row.asset_id))?.trim()
  if (fromCatalog) return fromCatalog
  return '未命名资产'
}

function suggestionKey(row: BindingSuggestion): string {
  return `${row.slot}:${row.asset_id}`
}

// 默认勾选规则已收敛到 `bindingRecommendationRules`（同一份口径，可单测）
const isDefaultChecked = (row: BindingSuggestion): boolean => isDefaultCheckedRule(row)

function renderTierTag(tier: BindingSuggestion['tier']) {
  if (tier === 'auto') return <Tag color="green">预选</Tag>
  if (tier === 'review') return <Tag color="gold">需复核</Tag>
  return <Tag>已丢弃</Tag>
}

function renderAgreementTag(agreement: BindingSuggestion['agreement']) {
  if (agreement === 'both') return <Tag color="green">规则+模型一致</Tag>
  if (agreement === 'conflict') return <Tag color="red">与现有绑定冲突</Tag>
  if (agreement === 'heuristic_only') return <Tag color="blue">仅规则命中</Tag>
  return <Tag color="blue">仅模型命中</Tag>
}

export function ChapterShotAssetBindingSection({
  projectId,
  chapterId,
  shotId,
  onReloadPreparationState,
}: ChapterShotAssetBindingSectionProps) {
  const [preview, setPreview] = useState<AssetBindingPreviewResult | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [saveProgress, setSaveProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 })
  const [saveFailures, setSaveFailures] = useState<SaveFailure[]>([])
  const previewSeqRef = useRef(0)

  // 切换镜头时清空上一镜头的推荐结果，避免把 A 镜头的建议保存到 B 镜头上。
  // 递增 seq 后，上一镜头仍在飞行的响应会被丢弃（含它的 loading 收尾），所以这里要自己复位 loading。
  useEffect(() => {
    previewSeqRef.current += 1
    setPreview(null)
    setPreviewError(null)
    setSelectedKeys([])
    setSaveFailures([])
    setSaveProgress({ done: 0, total: 0 })
    setPreviewLoading(false)
    setSaving(false)
  }, [shotId])

  const previewShot: AssetBindingShot | null = useMemo(() => {
    if (!preview) return null
    return preview.shots.find((item) => item.shot_id === shotId) ?? preview.shots[0] ?? null
  }, [preview, shotId])

  const suggestions = previewShot?.suggestions ?? []

  const warningList = useMemo(() => {
    const list = [...(preview?.parse_warnings ?? []), ...(previewShot?.warnings ?? [])]
    return Array.from(new Set(list.map((item) => String(item).trim()).filter(Boolean)))
  }, [preview, previewShot])

  const unmatchedRows = (preview?.unmatched_names ?? []) as UnmatchedNameRow[]

  /** 候选清单 id → 名字（只读展示用，不含任何内部 ID） */
  const catalogNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of preview?.catalog ?? []) {
      const id = String((item as { asset_id?: string }).asset_id ?? '')
      const name = String((item as { name?: string }).name ?? '').trim()
      if (id && name) map.set(id, name)
    }
    return map
  }, [preview])

  const checkedRows = useMemo(
    () => suggestions.filter((row) => selectedKeys.includes(suggestionKey(row))),
    [selectedKeys, suggestions],
  )

  /** 可直接一键确认的推荐（与默认勾选规则同一口径：预选 + 未绑定） */
  const autoRecommendCount = useMemo(() => suggestions.filter(isDefaultChecked).length, [suggestions])

  const runPreview = useCallback(async () => {
    if (!projectId || !shotId) return
    const seq = previewSeqRef.current + 1
    previewSeqRef.current = seq
    setPreviewLoading(true)
    setPreviewError(null)
    try {
      const data = await previewAssetBinding({
        project_id: projectId,
        shot_ids: [shotId],
        batch_size: 1,
        max_shots: 1,
      })
      if (previewSeqRef.current !== seq) return
      setPreview(data)
      const target = data.shots.find((item) => item.shot_id === shotId) ?? data.shots[0] ?? null
      setSelectedKeys((target?.suggestions ?? []).filter(isDefaultChecked).map(suggestionKey))
      if (!target) {
        message.warning('本次推荐结果里没有当前镜头的条目，请确认镜头归属后重试')
      }
    } catch (error) {
      if (previewSeqRef.current !== seq) return
      setPreview(null)
      setSelectedKeys([])
      setPreviewError(defaultTaskActionErrorMessage(error, 'AI 推荐资产关联失败'))
    } finally {
      if (previewSeqRef.current === seq) {
        setPreviewLoading(false)
      }
    }
  }, [projectId, shotId])

  /** 单个建议 → 既有写库端点（与 ChapterStudio 的调用形状保持一致）。 */
  const linkSuggestion = useCallback(
    async (row: BindingSuggestion, characterIndex: number) => {
      if (row.asset_type === 'character') {
        await StudioShotCharacterLinksService.upsertShotCharacterLinkApiV1StudioShotCharacterLinksPost({
          requestBody: { shot_id: shotId, character_id: row.asset_id, index: characterIndex, note: '' },
        })
        return
      }
      if (row.asset_type === 'scene') {
        await StudioShotLinksService.createProjectSceneLinkApiV1StudioShotLinksScenePost({
          requestBody: { project_id: projectId, chapter_id: chapterId, shot_id: shotId, asset_id: row.asset_id },
        })
        return
      }
      if (row.asset_type === 'prop') {
        await StudioShotLinksService.createProjectPropLinkApiV1StudioShotLinksPropPost({
          requestBody: { project_id: projectId, chapter_id: chapterId, shot_id: shotId, asset_id: row.asset_id },
        })
        return
      }
      if (row.asset_type === 'costume') {
        await StudioShotLinksService.createProjectCostumeLinkApiV1StudioShotLinksCostumePost({
          requestBody: { project_id: projectId, chapter_id: chapterId, shot_id: shotId, asset_id: row.asset_id },
        })
        return
      }
      throw new Error(`不支持的资产类型：${row.asset_type}`)
    },
    [chapterId, projectId, shotId],
  )

  /**
   * 写入一批关联（唯一实现）。
   *
   * 「确认全部推荐」与「确认并保存勾选项」都走这里：口径相同，只是一次性把
   * 「预选 + 未绑定」的建议整批写入，用户不用逐条点。
   */
  const saveRows = useCallback(async (rows: BindingSuggestion[]) => {
    if (saving) return
    if (rows.length === 0) {
      message.warning('请先勾选需要保存的关联项')
      return
    }
    setSaving(true)
    setSaveFailures([])
    setSaveProgress({ done: 0, total: rows.length })

    // 角色关联按 index 排序，这里从现有条数之后追加，避免挤掉已有顺序。
    let characterBaseIndex = 0
    if (rows.some((row) => row.asset_type === 'character')) {
      try {
        const res = await StudioShotCharacterLinksService.listShotCharacterLinksApiV1StudioShotCharacterLinksGet({
          shotId,
        })
        characterBaseIndex = (res.data ?? []).length
      } catch {
        characterBaseIndex = 0
      }
    }

    let okCount = 0
    let characterAdded = 0
    const failures: SaveFailure[] = []
    for (const [index, row] of rows.entries()) {
      try {
        await linkSuggestion(row, characterBaseIndex + characterAdded)
        if (row.asset_type === 'character') characterAdded += 1
        okCount += 1
      } catch (error) {
        // 逐条容错：单条失败不中断整批，最后统一给出明细。
        failures.push({
          label: `${slotLabel(row.slot)} · ${assetLabel(row, catalogNames)}`,
          // 审计 §4.6 模式 6：写 state 时就走统一管道（掩码 + 去内部术语），不留未脱敏原文
          reason: defaultTaskActionErrorMessage(error, '保存失败'),
        })
      }
      setSaveProgress({ done: index + 1, total: rows.length })
    }

    setSaveFailures(failures)
    if (failures.length === 0) {
      message.success(`已保存 ${okCount} 条资产关联`)
    } else if (okCount > 0) {
      message.warning(`已保存 ${okCount} 条，${failures.length} 条失败，详见下方失败明细`)
    } else {
      message.error('全部保存失败，详见下方失败明细')
    }

    // 1) 回读准备状态（左侧就绪度、资产概览会同步刷新）
    try {
      await onReloadPreparationState()
    } catch {
      // 刷新失败不影响后续重算
    }
    // 2) 重新推荐，让 already_bound 反映真实绑定情况
    await runPreview()
    setSaving(false)
  }, [catalogNames, linkSuggestion, onReloadPreparationState, runPreview, saving, shotId])

  /** 勾选项保存（既有入口） */
  const saveChecked = useCallback(async () => {
    await saveRows(checkedRows)
  }, [checkedRows, saveRows])

  /**
   * 「确认全部推荐」：把「层级＝预选 且 尚未绑定」的建议**一次性**写入。
   *
   * 明确匹配的才自动勾选（与 `isDefaultChecked` 同一口径）；多候选 / 冲突 / 已丢弃
   * 仍然留给你逐条判断，不在这里替你决定。保存后立即回读本镜状态。
   */
  const confirmAllRecommendations = useCallback(async () => {
    const autoRows = autoConfirmableRows(suggestions)
    if (autoRows.length === 0) {
      message.info('没有可直接确认的推荐项（「需复核」「与现有绑定冲突」的仍要你逐条勾选）')
      return
    }
    setSelectedKeys(autoRows.map(suggestionKey))
    await saveRows(autoRows)
  }, [saveRows, suggestions])

  const columns: TableColumnsType<BindingSuggestion> = [
    {
      /* 审计 §4.6 模式 2 + §7.3：「槽位」是主区禁词。这里的槽位指**挂到哪一类资产**
         （角色 / 场景 / 道具 / 服装），不是图片角度，所以按业务含义叫「关联类别」。 */
      title: '关联类别',
      dataIndex: 'slot',
      width: 76,
      render: (slot: string) => <Tag>{slotLabel(slot)}</Tag>,
    },
    {
      title: '资产',
      key: 'asset',
      ellipsis: true,
      render: (_: unknown, row: BindingSuggestion) => (
        <div className="min-w-0 truncate" title={assetLabel(row, catalogNames)}>
          {assetLabel(row, catalogNames)}
        </div>
      ),
    },
    {
      title: '层级',
      dataIndex: 'tier',
      width: 92,
      render: (tier: BindingSuggestion['tier']) => renderTierTag(tier),
    },
    {
      title: '对账',
      dataIndex: 'agreement',
      width: 120,
      render: (agreement: BindingSuggestion['agreement']) => renderAgreementTag(agreement),
    },
    {
      title: '置信度',
      dataIndex: 'confidence',
      width: 84,
      render: (confidence: number) => (typeof confidence === 'number' ? confidence.toFixed(2) : '—'),
    },
    {
      title: '已绑定',
      dataIndex: 'already_bound',
      width: 84,
      render: (alreadyBound: boolean) =>
        alreadyBound ? <Tag color="blue">已绑定</Tag> : <span className="text-slate-400">未绑定</span>,
    },
    {
      /* 审计 §4.6 模式 6：列名「理由」改「建议依据」；后端逐条 reason 先掩内部标识再上屏 */
      title: '建议依据',
      dataIndex: 'reason',
      render: (reason: string, row: BindingSuggestion) => (
        <div className="min-w-0">
          <div className="text-xs text-slate-600">{requiresUserChoice(row) ? describeRecommendationReason(row) : '明确匹配'}</div>
          {reason?.trim() ? <div className="text-[11px] text-slate-400">{maskInternalIds(reason)}</div> : null}
        </div>
      ),
    },
  ]

  const rowSelection: TableProps<BindingSuggestion>['rowSelection'] = {
    selectedRowKeys: selectedKeys,
    onChange: (keys) => setSelectedKeys(keys.map((key) => String(key))),
    getCheckboxProps: () => ({ disabled: saving }),
  }

  const meta = preview?.meta ?? null
  const tierSummary = preview?.tier_summary ?? {}
  const progressPercent =
    saveProgress.total > 0 ? Math.round((saveProgress.done / saveProgress.total) * 100) : 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-900">AI 推荐资产关联</div>
          <Typography.Text type="secondary" className="text-[11px]">
            系统按当前项目已有资产给出「角色 / 场景 / 道具 / 服装」四类关联建议：
            明确匹配的默认勾选，多候选或与现有绑定冲突的留给你逐条判断；
            点「确认全部推荐」即可一次写入，保存后本镜状态立即刷新。这个推荐只读、不写库。
          </Typography.Text>
        </div>
        <Space size={8}>
          <Button
            type="primary"
            size="small"
            loading={previewLoading}
            disabled={saving}
            onClick={() => void runPreview()}
          >
            AI 推荐资产关联
          </Button>
          <Button
            size="small"
            type="primary"
            loading={saving}
            disabled={previewLoading || saving}
            onClick={() => void confirmAllRecommendations()}
          >
            {`确认全部推荐${autoRecommendCount > 0 ? `（${autoRecommendCount}）` : ''}`}
          </Button>
          <Button
            size="small"
            ghost
            loading={saving}
            disabled={previewLoading || checkedRows.length === 0}
            onClick={() => void saveChecked()}
          >
            {`只保存勾选项${checkedRows.length > 0 ? `（${checkedRows.length}）` : ''}`}
          </Button>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            disabled={previewLoading || saving || !preview}
            onClick={() => void runPreview()}
          >
            重新推荐
          </Button>
        </Space>
      </div>

      {previewError ? (
        <Alert
          type="error"
          showIcon
          message="推荐失败"
          description={
            <div className="space-y-1">
              <div>{previewError}</div>
              <div className="text-[11px] text-slate-500">
                若提示项目内没有可绑定资产，请先在资产库创建角色 / 场景 / 道具 / 服装。
              </div>
            </div>
          }
        />
      ) : null}

      {/* 审计 §4.6 模式 6：原来主区直接写 `DRY_RUN 守卫状态` / `JELLYFISH_DRY_RUN` /
          `llm_called=… 目标模型=…`。现在主区只给产品自己的中文结论，
          开关原文、是否真的调用过模型、目标模型名一律收进默认收起的「技术详情」。 */}
      {meta?.dry_run ? (
        <Alert
          type="warning"
          showIcon
          message="当前是演练模式：本次没有真实调用模型，也没有产生费用"
          description={
            <div className="space-y-1">
              <div>下方建议来自固定规则的占位结果，不是模型判断，请谨慎勾选。</div>
              <TechnicalDetailSection
                testId="binding-preview-dry-run-technical-detail"
                hint="演练开关的原始状态与本次调用的内部信息，只用于排查问题。"
              >
                <div className="space-y-0.5">
                  <div>演练原始说明：{meta.dry_run_reason || '未提供'}</div>
                  <div>是否调用过模型：{String(meta.llm_called)}</div>
                  <div>目标模型：{meta.target?.model_name ?? '未解析'}</div>
                </div>
              </TechnicalDetailSection>
            </div>
          }
        />
      ) : null}

      {warningList.length > 0 ? (
        <Alert
          type="info"
          showIcon
          /* 审计 §4.6 模式 6：标题「后端提示」本身就是模式 2 → 改「需要注意的地方」；
             列表项过 `maskInternalIds`（后端 warnings 可能内嵌内部编号）。 */
          message="需要注意的地方"
          description={
            <ul className="list-disc pl-4 space-y-0.5 text-xs">
              {warningList.map((item) => (
                <li key={item}>{maskInternalIds(item)}</li>
              ))}
            </ul>
          }
        />
      ) : null}

      {saveFailures.length > 0 ? (
        <Alert
          type="error"
          showIcon
          message={`${saveFailures.length} 条关联保存失败（其余已保存成功）`}
          description={
            <ul className="list-disc pl-4 space-y-0.5 text-xs">
              {saveFailures.map((item) => (
                <li key={`${item.label}-${item.reason}`}>
                  {`${item.label}：${item.reason}`}
                </li>
              ))}
            </ul>
          }
        />
      ) : null}

      {saving ? (
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <Progress percent={progressPercent} size="small" status="active" />
          <div className="text-[11px] text-slate-500">
            {`正在逐条保存：${saveProgress.done}/${saveProgress.total}（串行调用写入接口，请勿关闭页面）`}
          </div>
        </div>
      ) : null}

      {preview ? (
        <div className="space-y-3">
          <Space size={[6, 6]} wrap>
            {/* 审计 §9 第 5 项（用户拍板：「候选条数 / 聚合 N 组」属后端概念）：
                主区只留用户要判断的几个数（本次建议 / 预选 / 需复核 / 已丢弃），
                「资产池条数」「分批份数」收进下面的技术详情。 */}
            <Tag>{`本次建议 ${suggestions.length}`}</Tag>
            <Tag color="green">{`预选 ${tierSummary.auto ?? 0}`}</Tag>
            <Tag color="gold">{`需复核 ${tierSummary.review ?? 0}`}</Tag>
            <Tag>{`已丢弃 ${tierSummary.discard ?? 0}`}</Tag>
          </Space>
          <TechnicalDetailSection
            testId="binding-preview-count-technical-detail"
            hint="本次推荐的内部分批与资产池口径，只用于排查问题。"
          >
            <div className="space-y-0.5">
              <div>资产池条数：{preview.catalog.length}</div>
              <div>分批份数：{preview.batch_count}</div>
            </div>
          </TechnicalDetailSection>
          {preview.cost_note ? (
            <div className="text-[11px] text-slate-500">
              {describePreviewCostNote(preview.cost_note)}
              <TechnicalDetailSection
                className="mt-1"
                testId="binding-preview-cost-technical-detail"
                hint="服务端给出的费用原话（含内部模型标识与开关状态），只用于核对。"
              >
                <div>{preview.cost_note}</div>
              </TechnicalDetailSection>
            </div>
          ) : null}

          <Alert
            type="info"
            showIcon
            message="默认勾选规则"
            description={
              <div className="text-xs">
                {'只自动勾选「预选」且还没有绑定过的建议；'}
                「需复核」「已丢弃」以及已经绑定过的候选一律默认不勾选，需要你人工判断后再勾。
                点「确认全部推荐」会把这些预选项一次性写入；「需复核」「与现有绑定冲突」的请逐条勾选后点「只保存勾选项」。
              </div>
            }
          />

          <Table<BindingSuggestion>
            size="small"
            rowKey={suggestionKey}
            rowSelection={rowSelection}
            columns={columns}
            dataSource={suggestions}
            pagination={false}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前镜头没有推荐条目" /> }}
          />

          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
            <div className="text-xs font-medium text-slate-800">
              {`模型看到但候选清单里没有的实体（${unmatchedRows.length}）`}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              这些名称只做只读展示，系统不会自动创建资产；如需使用请先到资产库手动创建，再回来重新推荐。
            </div>
            {unmatchedRows.length === 0 ? (
              <div className="mt-2 text-[11px] text-slate-400">无</div>
            ) : (
              <ul className="mt-2 space-y-1 text-xs text-slate-700">
                {unmatchedRows.map((item, index) => (
                  <li key={`${item.name ?? 'unknown'}-${index}`} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{item.name?.trim() ? item.name : '未命名'}</span>
                    {item.guessed_type ? <Tag>{assetTypeLabel(item.guessed_type)}</Tag> : null}
                    {item.evidence ? (
                      <span className="text-[11px] text-slate-500">{`依据：${item.evidence}`}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : !previewLoading && !previewError ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="还没有推荐结果，点击「AI 推荐资产关联」开始"
        />
      ) : null}
    </div>
  )
}
