import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Modal, Space, Spin, Table, Tag, Tooltip, message } from 'antd'
import type { TableColumnsType } from 'antd'
import { ArrowRightOutlined, ReloadOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { StudioEntitiesService } from '../../../../../services/generated'
import { previewImagePlan, type ImagePlanTarget } from '../../../../../services/llmPipelineApi'
import {
  getProjectSignalAssetTypeLabel,
  type ProjectSignalAsset,
  type ProjectSignalAssetType,
  type ProjectStepSignalDetail,
} from '../hooks/useProjectStepSignals'
import { AssetImagePromptLlmPanel } from './AssetImagePromptLlmPanel'
import { GenerationGateBanner } from '../../../components/GenerationGateBanner'
import { useGenerationGate } from '../../../components/generationGate'
import { classifyGenerationFailure, failureText } from '../../../components/generationGate'
import {
  ASSET_PREP_STATUSES,
  assetPrepInputFromReadiness,
  describeAssetPrepSummary,
  resolveAssetPrepStatus,
  summarizeAssetPrep,
} from '../assetPrepStatus'
import { AssetProductionArea } from './AssetProductionArea'
import { TechnicalDetailSection } from './workbench/TechnicalDetailCollapse'
import { toUserFacingText } from '../../../components/userFacingMessage'
import { OUTPUT_MODE_STATEMENT } from './assetProduction'
import {
  CHARACTER_REFERENCE_RATIO,
  CHARACTER_REFERENCE_RATIO_SERVER_NOTE,
  resultArtifactCopy,
  type ImageAssetType,
} from './assetResultKind.ts'

const TYPE_COLOR: Record<ProjectSignalAssetType, string> = {
  character: 'purple',
  scene: 'blue',
  prop: 'gold',
  costume: 'cyan',
}

function assetKey(asset: ProjectSignalAsset): string {
  return `${asset.type}:${asset.id}`
}

/**
 * 第 2 步「资产准备」的入口页 —— 连续生产流程的主界面。
 *
 * 流程（同屏连续完成，不再来回跳页面）：
 *   剧本提取候选 → 审核候选并关联/新建（`ProjectExtractCandidatesPanel`，本页上方）
 *   → 批量生成/完善图片提示词 → **选择要生成的资产 → 批量出图 → 进度与失败原因
 *   → 结果卡片 → 采纳 → 设为定版** → 全部必要资产定版后进入下一步。
 *
 * 中间那段「生产区」在 `AssetProductionArea` 里（本轮新增），它复用既有的出图管线：
 *   - 只读计划 `POST /studio/image-pipeline/plan/preview`
 *   - 同进程内联出图 `POST /studio/image-pipeline/submit`（**不进任何队列**）
 *   - 任务回读 `GET /studio/image-pipeline/task/{id}`、采纳 `POST /studio/image-pipeline/adopt`
 *   - 提示词生成/完善 `POST /studio/llm/image-prompt/preview` + 既有保存接口
 *
 * 本组件只负责：总体状态（与步骤判定同一数据源）、大模型批量提示词面板、技术详情。
 */
type ProjectImagePrepPanelProps = {
  assets: ProjectSignalAsset[]
  detail: ProjectStepSignalDetail
  loading: boolean
  /** 保存图片提示词 / 采纳 / 设为定版后重算本步骤信号（摘要条与资产表要跟着变） */
  onReload?: () => void
}

export function ProjectImagePrepPanel({ assets, detail, loading, onReload }: ProjectImagePrepPanelProps) {
  const navigate = useNavigate()
  const { projectId } = useParams<{ projectId: string }>()

  /**
   * 打开资产编辑页。
   *
   * `generate=true` 时带上 `?generate=1`：资产编辑页会自动打开该资产的出图确认弹窗。
   * 两条路径都带项目作用域（character 走项目角色路由，其余带 returnTo），
   * 避免出现「从资产库进入 → 缺项目作用域 → 出图静默失败」。
   */
  const openAssetEditor = useCallback(
    (asset: ProjectSignalAsset, options?: { generate?: boolean }) => {
      if (!projectId) return
      const assetType = asset.type
      const generateParam = options?.generate ? '?generate=1' : ''
      if (assetType === 'character') {
        navigate(`/projects/${projectId}/roles/${asset.id}/edit${generateParam}`)
        return
      }
      const segment = assetType === 'scene' ? 'scenes' : assetType === 'prop' ? 'props' : 'costumes'
      const tabByType: Record<Exclude<ProjectSignalAssetType, 'character'>, 'scenes' | 'props' | 'costumes'> = {
        scene: 'scenes',
        prop: 'props',
        costume: 'costumes',
      }
      const returnTo = encodeURIComponent(`/projects/${projectId}?step=image_prep&tab=${tabByType[assetType]}`)
      navigate(`/assets/${segment}/${asset.id}/edit?returnTo=${returnTo}${options?.generate ? '&generate=1' : ''}`)
    },
    [navigate, projectId],
  )

  /**
   * 每行资产的业务状态与顶部统计**共用同一个映射**
   * （`assetPrepInputFromReadiness` ← 统一数据源 `asset-readiness`）。
   */
  const prepInputs = useMemo(
    () =>
      assets.map((asset) =>
        assetPrepInputFromReadiness({
          has_pending_candidate: asset.hasPendingCandidate,
          has_image_prompt: asset.hasImagePrompt,
          has_image: asset.hasImage,
          has_primary: asset.hasPrimary,
        }),
      ),
    [assets],
  )

  const statusByAsset = useMemo(() => {
    const map = new Map<string, ReturnType<typeof resolveAssetPrepStatus>>()
    assets.forEach((asset, index) => {
      map.set(assetKey(asset), resolveAssetPrepStatus(prepInputs[index]))
    })
    return map
  }, [assets, prepInputs])

  const prepSummary = useMemo(() => summarizeAssetPrep(prepInputs), [prepInputs])

  // ---- 出图计划预览（只读端点，永不触网、不花钱）----
  // 这一步存在的意义：让「保存的图片提示词」在**生产流程里**能当场看到被生图计划读取
  // （prompt_source=saved），而不是只能靠接口测试或肉眼看文本。
  const [plan, setPlan] = useState<{
    targets: ImagePlanTarget[]
    warnings: string[]
    summary: Record<string, unknown>
    /**
     * 只读计划里的**按类型分流口径**（后端新字段）：
     * `result_kind` / `result_label` / `aspect_ratio` / `aspect_ratio_fixed` / `aspect_ratio_note`。
     * 页面用它把"这份计划会生成什么类型的图"直接标出来，而不是让用户猜。
     */
    strategy: Record<string, unknown>
  } | null>(null)
  const [planLoading, setPlanLoading] = useState(false)
  const [planError, setPlanError] = useState('')
  const [planType, setPlanType] = useState<ProjectSignalAssetType>('character')

  const loadPlan = useCallback(async () => {
    if (!projectId) return
    if (planType === 'costume') {
      // 出图服务只接受人物/场景/道具，服装没有可预览的出图计划
      setPlan(null)
      setPlanError('')
      return
    }
    setPlanLoading(true)
    setPlanError('')
    try {
      const data = await previewImagePlan({
        project_id: projectId,
        asset_type: planType,
        stage: 'reference_batch',
        use_primary_reference: true,
      })
      setPlan({
        targets: data.targets ?? [],
        warnings: data.warnings ?? [],
        summary: data.summary ?? {},
        strategy: ((data as unknown as { strategy?: Record<string, unknown> }).strategy ?? {}) as Record<string, unknown>,
      })
    } catch (e) {
      setPlanError((e as Error)?.message || '出图计划读取失败')
      setPlan(null)
    } finally {
      setPlanLoading(false)
    }
  }, [planType, projectId])

  useEffect(() => {
    if (assets.length === 0) return
    void loadPlan()
  }, [assets.length, loadPlan])

  /** 出图守卫状态（点击前显示：被演练模式拦住 ≠ 接口没接通） */
  const gate = useGenerationGate()

  /**
   * 资产明细表里的「设为定版」入口（生产区那套是主路径，这里是轻量补充）。
   *
   * 契约（后端定版保护）：该资产**已有定版图**、而本次会把它换成另一张时，
   * 必须显式带 `confirm_replace_primary=true`，否则返回结构化 409（一行都不改）。
   * 按钮在已有定版时是禁用的；万一数据不同步被后端拒了，就用后端原文再确认一次，
   * 用户确认后才带开关重发——**绝不静默替换定版**。
   */
  const [settingPrimaryKey, setSettingPrimaryKey] = useState('')
  const handleSetPrimary = useCallback(
    async (asset: ProjectSignalAsset) => {
      const imageId = asset.imageId
      if (!imageId) {
        message.warning('该资产还没有图片，请先在生产区生成或上传图片')
        return
      }
      setSettingPrimaryKey(assetKey(asset))
      const applyPrimary = (confirmReplace: boolean) =>
        StudioEntitiesService.updateEntityImageApiV1StudioEntitiesEntityTypeEntityIdImagesImageIdPatch({
          entityType: asset.type,
          entityId: asset.id,
          imageId,
          requestBody: { is_primary: true, confirm_replace_primary: confirmReplace } as never,
        })
      try {
        try {
          await applyPrimary(false)
        } catch (error) {
          if ((error as { status?: number } | null)?.status !== 409) throw error
          /* 审计 §4.2 模式 6：409 的后端原文里可能带内部字段名，先过统一管道再上屏 */
          const detail = toUserFacingText(error, '该资产已有定版图，需要你确认后才能替换。')
          await new Promise<void>((resolve, reject) => {
            Modal.confirm({
              title: `「${asset.name}」已有定版图，确认替换吗？`,
              width: 540,
              okText: '确认替换定版',
              cancelText: '取消',
              content: <div className="text-xs">{detail}</div>,
              onOk: () => resolve(),
              onCancel: () => reject(new Error('cancelled')),
            })
          })
          await applyPrimary(true)
        }
        message.success(`已把「${asset.name}」的这张图设为定版`)
        onReload?.()
      } catch (error) {
        if (error instanceof Error && error.message === 'cancelled') return
        const failure = classifyGenerationFailure(error, 'image')
        message.error(failureText(failure))
      } finally {
        setSettingPrimaryKey('')
      }
    },
    [onReload],
  )

  const planSavedCount = (plan?.targets ?? []).filter((target) => target.prompt_source === 'saved').length

  const detailColumns: TableColumnsType<ProjectSignalAsset> = [
    {
      title: '资产',
      key: 'name',
      ellipsis: true,
      render: (_: unknown, record) => (
        <span className="flex min-w-0 items-center gap-2">
          <Tag color={TYPE_COLOR[record.type]} className="mr-0">
            {getProjectSignalAssetTypeLabel(record.type)}
          </Tag>
          {/* 审计 §4.2 模式 1：资产名取不到时不许回退成内部编号 */}
          <span className="truncate" title={record.name}>
            {record.name || '未命名资产'}
          </span>
        </span>
      ),
    },
    {
      title: '业务状态',
      key: 'prepStatus',
      width: 210,
      render: (_: unknown, record) => {
        const status = statusByAsset.get(assetKey(record)) ?? ASSET_PREP_STATUSES.pending_candidate
        const color =
          status.tone === 'green' ? 'green' : status.tone === 'blue' ? 'blue' : status.tone === 'gold' ? 'gold' : 'default'
        return (
          <Space size={4} wrap>
            <Tag color={color} bordered={false}>
              {status.label}
            </Tag>
            <span className="text-[11px] text-gray-400">{`下一步：${status.nextActionLabel}`}</span>
          </Space>
        )
      },
    },
    {
      title: '定版操作',
      key: 'primary',
      width: 130,
      render: (_: unknown, record) =>
        record.hasImage ? (
          <Tooltip title="把该资产当前的首选图设为定版；已有定版时会被替换，请确认后再点">
            <Button
              size="small"
              loading={settingPrimaryKey === assetKey(record)}
              disabled={record.hasPrimary}
              onClick={() => void handleSetPrimary(record)}
            >
              {record.hasPrimary ? '已是定版' : '设为定版'}
            </Button>
          </Tooltip>
        ) : (
          <Tag bordered={false} className="text-gray-400">
            未生成
          </Tag>
        ),
    },
    {
      title: '资产页',
      key: 'editor',
      width: 110,
      render: (_: unknown, record) => (
        <Button size="small" type="link" className="!px-0" onClick={() => openAssetEditor(record, { generate: true })}>
          去编辑/出图
        </Button>
      ),
    },
  ]

  return (
    <Card
      title="资产准备 · 生产区"
      extra={
        <Space size={8} wrap>
          <Tag bordered={false}>角色 {detail.assetCounts.characters}</Tag>
          <Tag bordered={false}>场景 {detail.assetCounts.scenes}</Tag>
          <Tag bordered={false}>道具 {detail.assetCounts.props}</Tag>
          <Tag bordered={false}>服装 {detail.assetCounts.costumes}</Tag>
          <Tag color={detail.assetImageCount > 0 ? 'green' : 'gold'} bordered={false}>
            已有参考图 {detail.assetImageCount}
          </Tag>
          <Button icon={<ArrowRightOutlined />} onClick={() => navigate('/assets')}>
            前往资产库
          </Button>
        </Space>
      }
    >
      <div className="mb-3 space-y-1 text-xs text-gray-500">
        <div>
          为人物、场景、道具准备图片提示词与定版图：先批量生成/完善提示词，再选择要生成的资产批量出图，
          看进度与失败原因，最后逐张「采纳」「设为定版」。定版图是该资产对外确认使用的那张图。
        </div>
        <div>
          {/* 按类型取词：人物 = 参考图；场景 / 道具 = 各自的资产图（不让场景说成"参考图"） */}
          生成的是什么图按资产类型分：人物 = 人物参考图，场景 = 场景资产图，道具 = 道具资产图，
          服装 = 服装设定图。默认流程就是按提示词直接生成；需要保持同一个资产的图片一致性时，
          用结果卡片上的「使用已有图片重新生成」（可选返工流程，会先二次确认）。
        </div>
        <div>
          {/* 用户点名要写出来的一句话 */}
          {`人物参考图固定 ${CHARACTER_REFERENCE_RATIO}，不等于项目最终视频画幅：成片画幅按项目自己的视频比例，两者不要混用。`}
        </div>
      </div>

      {/* 各状态数量：只有范围内资产全部「已定版」才显示就绪 */}
      <Alert
        type={prepSummary.allDone ? 'success' : 'info'}
        showIcon
        style={{ marginBottom: 8 }}
        message={
          prepSummary.allDone
            ? `资产准备已就绪（${prepSummary.total}/${prepSummary.total} 已定版）`
            : `资产准备未就绪（${prepSummary.done}/${prepSummary.total} 已定版）`
        }
        description={<span className="text-xs">{describeAssetPrepSummary(prepSummary)}</span>}
        action={
          prepSummary.allDone ? (
            <Button size="small" type="primary" onClick={() => navigate(`/projects/${projectId}?step=video_prompt`)}>
              进入下一步
            </Button>
          ) : null
        }
      />

      <Spin spinning={loading}>
        {/* 生产区：选择 → 批量生成 → 进度 → 结果卡片 → 采纳 → 设为定版 */}
        <AssetProductionArea
          projectId={projectId}
          assets={assets}
          gate={gate}
          onReload={onReload}
          onOpenAssetEditor={openAssetEditor}
          promptPanel={
            <AssetImagePromptLlmPanel
              projectId={projectId}
              // 当前集：本机草稿按「项目 + 集」分键，换集不会串到上一集的草稿上
              chapterId={detail.focusChapterId}
              assets={assets}
              onSaved={onReload}
            />
          }
        />
      </Spin>

      {/*
        技术详情：出图计划、原始字段、资产明细（默认收起）。

        审计 §9 第 2 项 / §4.2（模式 2）：这里原来是**第二套自建折叠区**
        （自己写 `<details>` + 自己的「技术详情」标签），而源码级禁词测试
        只能给**一个文件**开口子 —— 多一套实现等于豁免范围失控。
        本批把它换成统一的 `TechnicalDetailSection`（内容与布局一个字节都没动）。
      */}
      <TechnicalDetailSection
        testId="image-prep-technical"
        className="mt-4"
        hint="这里放的是出图计划、资产明细与其它内部字段；日常操作不需要看，默认收起。"
      >
              {/* 生成配置与演练开关的原始状态（模型名 / 演练开关原文）只在这里出现 */}
              <div>
                <div className="mb-1 text-[11px] text-gray-500">生成配置与演练开关（原始状态）</div>
                <GenerationGateBanner gate={gate} outlet="image" />
              </div>
              <Space size={8} wrap>
                <Tag bordered={false}>{`计划目标 ${plan?.targets.length ?? 0} 条`}</Tag>
                <Tag color={planSavedCount > 0 ? 'green' : 'gold'} bordered={false}>
                  {`用已保存提示词 ${planSavedCount} 条`}
                </Tag>
                {/* 出图方式口径：按提示词直接生成（按类型取词，见 assetResultKind） */}
                <Tag bordered={false}>{OUTPUT_MODE_STATEMENT}</Tag>
                {/* 计划里带的分流口径（消费后端新字段）：本次计划会生成什么类型的图 */}
                {plan?.strategy?.result_label ? (
                  <Tag color="blue" bordered={false}>{`本次计划的结果类型：${String(plan.strategy.result_label)}`}</Tag>
                ) : null}
                {plan?.strategy?.prompt_template ? (
                  <Tag bordered={false}>{`提示词模板：${String(plan.strategy.prompt_template)}`}</Tag>
                ) : null}
                {plan?.strategy?.aspect_ratio_note ? (
                  <Tag bordered={false} title={CHARACTER_REFERENCE_RATIO_SERVER_NOTE}>
                    {`画幅口径：人物参考图固定 ${CHARACTER_REFERENCE_RATIO}（不等于项目最终视频画幅）`}
                  </Tag>
                ) : null}
                {(['character', 'scene', 'prop'] as ProjectSignalAssetType[]).map((type) => (
                  <Button
                    key={type}
                    size="small"
                    type={planType === type ? 'primary' : 'default'}
                    onClick={() => setPlanType(type)}
                  >
                    {`看${getProjectSignalAssetTypeLabel(type)}计划`}
                  </Button>
                ))}
                <span className="text-[11px] text-gray-400">
                  服装没有出图计划（出图服务只支持人物 / 场景 / 道具）
                </span>
                <Button size="small" icon={<ReloadOutlined />} loading={planLoading} onClick={() => void loadPlan()}>
                  刷新计划
                </Button>
              </Space>

              {planError ? (
                <Alert type="error" showIcon message="出图计划读取失败" description={planError} />
              ) : null}

              {plan ? (
                <div className="space-y-2">
                  {plan.warnings.length > 0 ? (
                    <Alert
                      type="info"
                      showIcon
                      message="后端提示"
                      description={
                        <ul className="list-disc pl-4 space-y-0.5 text-xs">
                          {plan.warnings.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      }
                    />
                  ) : null}
                  <Table<ImagePlanTarget>
                    rowKey={(row, index) => `${row.source_task_id}-${index ?? 0}`}
                    size="small"
                    loading={planLoading}
                    columns={[
                      { title: '资产', dataIndex: 'name', ellipsis: true },
                      { title: '提示词来源', dataIndex: 'prompt_source', width: 130 },
                      { title: '提示词', dataIndex: 'prompt', ellipsis: true },
                      {
                        title: '计划里的已有图片输入字段（默认流程不传）',
                        dataIndex: 'reference_image',
                        width: 240,
                        ellipsis: true,
                        render: (value: unknown) => String(value ?? '') || '（默认流程不传）',
                      },
                      {
                        title: '结果类型',
                        dataIndex: 'result_label',
                        width: 120,
                        render: (value: unknown, row) =>
                          String(value ?? '') ||
                          resultArtifactCopy((row.asset_type as ImageAssetType) ?? 'character').label,
                      },
                    ]}
                    dataSource={plan.targets}
                    pagination={plan.targets.length > 8 ? { pageSize: 8, size: 'small' } : false}
                  />
                </div>
              ) : null}

              <Table<ProjectSignalAsset>
                rowKey={assetKey}
                size="small"
                columns={detailColumns}
                dataSource={assets}
                pagination={assets.length > 10 ? { pageSize: 10 } : false}
              />
      </TechnicalDetailSection>
    </Card>
  )
}
