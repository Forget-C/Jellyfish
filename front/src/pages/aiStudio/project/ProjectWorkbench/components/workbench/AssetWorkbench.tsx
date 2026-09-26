/**
 * 第 2 步「资产准备」= **一个资产生产工作台**（参考项目「剧本批量出图」界面的信息层级）。
 *
 * 用户要解决的问题（原话要点）：旧的第 2 步只是把三个旧模块上下拼起来
 * （上游表 → 资产生产表 → 提示词表），同一批资产被重复选择和重复展示，
 * 主页面还暴露大量后台维度。这一屏把它收成一个工作台：
 *
 *   ┌ 顶部 sticky：当前章节 + 四类数量 + 状态计数 + **唯一**批量操作区 + 统一任务进度 ┐
 *   │ 左：剧本原文（可收起）        右：四个页签 → 资产卡片网格（同一项资产只出现一次）│
 *   └ 结果区：既有出图机制的结果卡片网格（采纳 / 设为定版 / 重新生成）              ┘
 *
 * 数据全部来自一个新后端接口（契约冻结，见 `assetWorkbenchContract.ts`）；
 * 资料还没齐时**如实说"资料还在准备中"**，并用既有接口拼一份可用视图，绝不伪造数据。
 *
 * 复用而不是重写（用户点名）：
 *   - 出图计划 / 提交 / 轮询 / 结果 / 采纳 / 定版 / 提示词生成与保存 / 质量拦截：
 *     整块交给既有 `AssetProductionArea`（本屏以 `embedded` 方式渲染，用 ref 驱动它的
 *     同一套提交机制），**不新写第二套轮询**；
 *   - 资料编辑：既有 `AssetProfileEditEntry`（`PATCH …/asset-profiles/records/{id}`）；
 *   - 状态文案：`userFacingStatus`；
 *   - 生成守卫与原始状态：既有 `useGenerationGate` / `GenerationGateBanner`。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Modal, Spin, Tag, message } from 'antd'

import type { ProjectSignalAsset, ProjectStepSignalDetail } from '../../hooks/useProjectStepSignals'
import { useGenerationGate } from '../../../../components/generationGate'
import { GenerationGateBanner } from '../../../../components/GenerationGateBanner'
import { AssetProductionArea, type AssetProductionAreaHandle } from '../AssetProductionArea'
import { AssetImagePromptLlmPanel } from '../AssetImagePromptLlmPanel'
import { AssetProfileEditEntry } from '../AssetProfileEditEntry'
import { taskProgressLines, emptyTaskProgress, type TaskProgressSummary } from './taskProgress.ts'
import { DEFAULT_ASPECT_RATIO } from '../assetProduction.ts'

import {
  deriveAnalysisAction,
  deriveWorkbenchCommand,
  applyWorkbenchSelection,
  countByStatus,
  countByType,
  describePendingReview,
  isBatchEligible,
  itemsForTab,
  workbenchItemKey,
  workbenchItemName,
  workbenchItemType,
  type WorkbenchAssetType,
  type WorkbenchItemLike,
} from './workbenchState.ts'
import {
  buildDegradedWorkbench,
  type AssetWorkbenchItem,
  type AssetWorkbenchPendingReview,
  type AssetWorkbenchResponse,
  type WorkbenchLoadResult,
  type WorkbenchLoadSource,
} from './assetWorkbenchContract.ts'
import { fetchAssetWorkbench } from './assetWorkbenchApi.ts'
import { describeSkippedPromptPanelAssets, selectPromptPanelAssets } from './promptPanelAssets.ts'
import { runChapterAnalysis } from './chapterAnalysis.ts'
import { WORKBENCH_CONTRACT_PENDING_NOTE, WORKBENCH_CONTRACT_PENDING_RETRY, WORKBENCH_CONTRACT_PENDING_TITLE } from './assetWorkbenchContract.ts'

import { WorkbenchCommandBar } from './WorkbenchCommandBar.tsx'
import { AssetCardGrid } from './AssetCardGrid.tsx'
import { AssetDetailDrawer } from './AssetDetailDrawer.tsx'
import { PendingReviewDrawer } from './PendingReviewDrawer.tsx'
import { ScriptTextPanel, type ScriptShotRef } from './ScriptTextPanel.tsx'
import { TechnicalDetailCollapse } from './TechnicalDetailCollapse.tsx'


export type AssetWorkbenchProps = {
  projectId: string | null
  chapter: {
    id: string | null
    index: number | null
    title: string
    rawText: string
    scriptChars: number
  }
  /** 既有步骤信号：降级视图用它，结果区（既有出图机制）也用它 */
  assets: ProjectSignalAsset[]
  /** 既有步骤信号明细（技术详情用） */
  detail: ProjectStepSignalDetail
  loading: boolean
  /** 采纳 / 定版 / 保存提示词后重算步骤信号 */
  onReload: () => void
  /** 打开既有资产编辑页 */
  onOpenAssetEditor: (asset: ProjectSignalAsset, options?: { generate?: boolean }) => void
  /**
   * 打开改版前的「提取确认页」（保留入口，不再是第 2 步主界面）。
   *
   * 为什么还要留着：资产的写入前逐条人工确认是老能力，改版不能把它弄丢；
   * 入口收在「技术详情」里（主界面不放后台维度的词），
   * 以及「待处理 N 项」抽屉里当前清单找不到对应资产时的兜底。
   */
  onOpenLegacyExtractConfirm?: () => void
}

export function AssetWorkbench(props: AssetWorkbenchProps) {
  const { projectId, chapter, assets, loading, onReload, onOpenAssetEditor, onOpenLegacyExtractConfirm } = props

  const [contractData, setContractData] = useState<AssetWorkbenchResponse | null>(null)
  const [contractFailed, setContractFailed] = useState('')
  const [reloading, setReloading] = useState(false)
  const [analysisRunning, setAnalysisRunning] = useState(false)
  /** 「生成图片提示词」面板开关（只带选中的资产；里面那次点击才会真正调用模型） */
  const [promptPanelOpen, setPromptPanelOpen] = useState(false)
  const [tab, setTab] = useState<WorkbenchAssetType>('character')
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [scriptCollapsed, setScriptCollapsed] = useState(false)
  const [detailItem, setDetailItem] = useState<AssetWorkbenchItem | null>(null)
  const [detailShotIndex, setDetailShotIndex] = useState<number | null>(null)
  const [pendingOpen, setPendingOpen] = useState(false)
  const [aspectRatio, setAspectRatio] = useState(DEFAULT_ASPECT_RATIO)
  const [progress, setProgress] = useState<TaskProgressSummary>(() => emptyTaskProgress())
  const [runBusy, setRunBusy] = useState(false)

  /** 结果区：既有出图机制（本屏不复制它的提交 / 轮询 / 结果逻辑） */
  const productionRef = useRef<AssetProductionAreaHandle | null>(null)
  const gate = useGenerationGate()

  const chapterId = chapter.id

  /* ----------------------------------------------------------- 取数（新接口） */

  /**
   * 只拉**契约接口**这一件事。
   *
   * 降级视图**不在这里拼**：降级视图要跟着既有步骤信号（`assets`）实时重建，
   * 否则首屏会在资产还没加载完时先拼出一份空清单然后一直停在空清单上
   * （这是本轮自检抓到的真实缺陷）。
   */
  const loadWorkbench = useCallback(async () => {
    if (!chapterId) {
      setContractData(null)
      setContractFailed('')
      return
    }
    setReloading(true)
    setContractFailed('')
    try {
      setContractData(await fetchAssetWorkbench(chapterId))
    } catch (error) {
      /**
       * 契约还没落地（后端并行实现中）时**如实降级**：
       * 用既有步骤信号的真实字段拼一份视图，并把原因写清楚（不伪造契约字段）。
       */
      setContractData(null)
      setContractFailed(error instanceof Error ? error.message : String(error))
    } finally {
      setReloading(false)
    }
  }, [chapterId])

  useEffect(() => {
    void loadWorkbench()
  }, [loadWorkbench])

  const degraded = useMemo(
    () =>
      buildDegradedWorkbench({
        projectId: projectId ?? '',
        chapterId: chapterId ?? '',
        chapterTitle: chapter.title,
        scriptChars: chapter.scriptChars,
        assets,
        reason: contractFailed,
      }),
    [assets, chapter.scriptChars, chapter.title, chapterId, contractFailed, projectId],
  )

  const load: WorkbenchLoadResult = contractData
    ? { source: 'contract', data: contractData, note: '' }
    : degraded
  const data: AssetWorkbenchResponse | null = load.data
  const source: WorkbenchLoadSource = load.source
  const loadError = contractFailed
  const items = useMemo(() => data?.items ?? [], [data])
  const pendingReview: AssetWorkbenchPendingReview[] = data?.pending_review ?? []

  const itemLike: WorkbenchItemLike[] = items
  const typeCounts = useMemo(() => countByType(itemLike), [itemLike])
  const statusCounts = useMemo(() => countByStatus(itemLike), [itemLike])
  const command = useMemo(
    () =>
      deriveWorkbenchCommand({
        items: itemLike,
        selectedKeys,
        busy: runBusy,
        analysis: data?.analysis ?? null,
      }),
    [data?.analysis, itemLike, runBusy, selectedKeys],
  )
  const analysisAction = useMemo(() => deriveAnalysisAction(data?.analysis ?? null), [data?.analysis])

  /** 页签过滤：同一项资产只在这一处出现。 */
  const tabItems = useMemo(() => itemsForTab(items, tab), [items, tab])

  /** 本章出场分镜（由各资产的剧本关系汇总，左侧剧本面板与抽屉共用）。 */
  const shots = useMemo<ScriptShotRef[]>(() => {
    const map = new Map<number, ScriptShotRef>()
    items.forEach((item) => {
      ;(item.script_relation?.shot_refs ?? []).forEach((shot) => {
        if (!map.has(shot.shot_index)) {
          map.set(shot.shot_index, {
            shotIndex: shot.shot_index,
            title: shot.title,
            excerpt: shot.script_excerpt,
          })
        }
      })
    })
    return Array.from(map.values()).sort((a, b) => a.shotIndex - b.shotIndex)
  }, [items])

  /* ----------------------------------------------------- 与既有出图机制对接 */

  /** 选择同步给结果区（它才是提交范围的权威来源）。 */
  useEffect(() => {
    productionRef.current?.setSelection(selectedKeys)
  }, [selectedKeys])

  const handleToggleSelect = useCallback((key: string, checked: boolean) => {
    setSelectedKeys((prev) => (checked ? Array.from(new Set([...prev, key])) : prev.filter((row) => row !== key)))
  }, [])

  const handleSelectAll = useCallback(() => {
    // 「全选本页签」：只收**可进批量**的项（服装不在出图契约内、提示词需重写的项
    // batch_eligible=false），与「只选未生成项」「批量生成图」用同一套 isBatchEligible
    // 口径，不另立一套（否则按钮上的数字会和真正提交的张数对不上）。
    setSelectedKeys((prev) => applyWorkbenchSelection(items, prev, 'all', tab))
  }, [items, tab])

  const handleSelectUngenerated = useCallback(() => {
    setSelectedKeys((prev) => applyWorkbenchSelection(items, prev, 'ungenerated', tab))
  }, [items, tab])

  const handleClearSelection = useCallback(() => setSelectedKeys([]), [])

  const keysForRun = useCallback(
    (operation: 'generate' | 'regenerate') => {
      const picked = items.filter((item) => selectedKeys.includes(workbenchItemKey(item)))
      const eligible = picked.filter((item) => {
        const type = workbenchItemType(item)
        // 服装不在出图服务契约内；提示词需要重新生成的项 batch_eligible=false，一律不提交
        if (type === 'costume' || !isBatchEligible(item)) return false
        if (operation === 'generate') return item.image?.has_image !== true
        return item.image?.has_image === true
      })
      return eligible.map(workbenchItemKey)
    },
    [items, selectedKeys],
  )

  const handleGenerate = useCallback(() => {
    const keys = keysForRun('generate')
    if (keys.length === 0) return
    productionRef.current?.runBatch('generate', keys)
  }, [keysForRun])

  const handleRegenerate = useCallback(() => {
    const keys = keysForRun('regenerate')
    if (keys.length === 0) return
    productionRef.current?.runBatch('regenerate', keys)
  }, [keysForRun])

  /** 卡片上的单项生成 / 重新生成：走同一套提交机制（并且同样会二次确认）。 */
  /**
   * 主按钮按状态机给的 `primaryAction` 分派：
   * - `generate_prompts` / `rewrite_prompts` → 打开图片提示词面板（只带选中资产），
   *   由面板自己的「生成图片提示词（N）」按钮负责计数、二次确认与失败即停（**点了才花钱**）；
   * - `generate_images` → 走既有出图批量机制（含质量闸门与确认框）。
   */
  const handlePrimary = useCallback(() => {
    if (command.primaryAction === 'generate_prompts' || command.primaryAction === 'rewrite_prompts') {
      setPromptPanelOpen(true)
      return
    }
    handleGenerate()
  }, [command.primaryAction, handleGenerate])

  const handleGenerateOne = useCallback((item: AssetWorkbenchItem, operation: 'generate' | 'regenerate') => {
    productionRef.current?.runBatch(operation, [workbenchItemKey(item)])
  }, [])

  const handleEditPrompt = useCallback((item: AssetWorkbenchItem) => {
    productionRef.current?.openPromptEditor(workbenchItemKey(item))
  }, [])

  const handleOpenDetail = useCallback((item: AssetWorkbenchItem, focus?: { shotIndex?: number }) => {
    setDetailItem(item)
    setDetailShotIndex(focus?.shotIndex ?? null)
  }, [])

  const handleFocusShot = useCallback(
    (shotIndex: number) => {
      const owner = items.find((item) => (item.script_relation?.shot_refs ?? []).some((shot) => shot.shot_index === shotIndex))
      if (!owner) return
      setTab(workbenchItemType(owner))
      handleOpenDetail(owner, { shotIndex })
    },
    [handleOpenDetail, items],
  )

  const handleRunAnalysis = useCallback(async () => {
    if (!projectId || !chapterId) {
      message.warning('还没有选定要分析的集：请先在顶部选择一集。')
      return
    }
    setAnalysisRunning(true)
    try {
      // 已经有资料且用户点的是「重新分析」→ refresh=true（会再花一次）；
      // 首次分析 refresh 不传（后端库里没有就生成，不会重复花钱）。
      const needsRefresh = (data?.analysis?.generated ?? false) === true
      const result = await runChapterAnalysis({ projectId, chapterId, refresh: needsRefresh })
      if (result.ok) {
        message.success('本章资产分析已完成：下面按类型看每一项资产的资料与状态。')
        await loadWorkbench()
        onReload()
      } else {
        message.warning(result.reason)
      }
    } finally {
      setAnalysisRunning(false)
    }
  }, [chapterId, loadWorkbench, onReload, projectId])

  /** 生成设置：顶部条改了比例就推进结果区**真正用于提交**的那份设置（不做假开关）。 */
  const handleAspectRatioChange = useCallback((value: string) => {
    setAspectRatio(value)
    productionRef.current?.setAspectRatio(value)
  }, [])

  const handleProgress = useCallback((summary: TaskProgressSummary, busy: boolean) => {
    setProgress(summary)
    setRunBusy(busy)
  }, [])

  const renderProfileEditor = useCallback(
    (item: AssetWorkbenchItem) =>
      chapterId ? (
        <AssetProfileEditEntry
          chapterId={chapterId}
          asset={{ type: item.asset_type, name: workbenchItemName(item), id: item.asset_id }}
          hasImagePrompt={Boolean(String(item.prompt?.text ?? '').trim())}
          label="编辑资料"
          onSaved={() => {
            void loadWorkbench()
            onReload()
          }}
        />
      ) : null,
    [chapterId, loadWorkbench, onReload],
  )

  const chapterLabel = chapter.index === null ? chapter.title : `第 ${chapter.index} 集 · ${chapter.title}`

  /**
   * 面板的资产行集：**只**来自用户勾选的那些项，键与工作台选择键同口径
   * （见 `promptPanelAssets.ts`：不回退到全部、不丢服装、空 id 的项如实列出来）。
   */
  const promptPanelAssets = useMemo(
    () => selectPromptPanelAssets(items, selectedKeys),
    [items, selectedKeys],
  )
  /** 弹窗标题：勾了几项、其中几项本次无法生成（数字必须对得上，别让用户猜） */
  const promptPanelTitle = useMemo(() => {
    const skipped = promptPanelAssets.skipped.length
    const tail = skipped > 0 ? `（其中 ${skipped} 项本次无法生成）` : ''
    return `生成图片提示词 · 已选 ${selectedKeys.length} 项${tail}`
  }, [promptPanelAssets.skipped.length, selectedKeys.length])

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <WorkbenchCommandBar
        chapterLabel={chapterLabel}
        scriptChars={data?.script_chars ?? chapter.scriptChars}
        analysis={data?.analysis ?? null}
        analysisLabel={analysisAction.label}
        analysisPrimary={analysisAction.primary}
        analysisRunning={analysisRunning}
        onRunAnalysis={() => void handleRunAnalysis()}
        command={command}
        progress={progress}
        busy={runBusy}
        onGenerate={handlePrimary}
        onRegenerate={handleRegenerate}
        onGenerateImages={handleGenerate}
        onSelectAll={handleSelectAll}
        onSelectUngenerated={handleSelectUngenerated}
        onClearSelection={handleClearSelection}
        onStop={() => productionRef.current?.stop()}
        onClearResults={() => productionRef.current?.clearResults()}
        aspectRatio={aspectRatio}
        onAspectRatioChange={handleAspectRatioChange}
        typeCounts={typeCounts}
        statusCounts={statusCounts}
        items={itemLike}
        selectedKeys={selectedKeys}
        activeTab={tab}
        onSelectTab={setTab}
        pendingReviewCount={pendingReview.length}
        pendingReviewLabel={describePendingReview(pendingReview.length)}
        onOpenPendingReview={() => setPendingOpen(true)}
        hasPendingReview={pendingReview.length > 0}
      />

      {/* 资料还没齐时的说明：用用户语言说清「现在能看到什么、什么时候补齐」，不用假数据糊过去 */}
      {source === 'degraded' ? (
        <Alert
          type="warning"
          showIcon
          /* 审计 §4.2（本行 + assetWorkbenchContract.ts:373,377,467）：
             原文是「等待后端契约：本章资产资料接口还没有就绪」——「契约 / 接口 / 就绪」
             都是开发术语，用户既看不懂也不知道该做什么。这里只说用户该知道的事。 */
          message={WORKBENCH_CONTRACT_PENDING_TITLE}
          description={
            /* 读取失败原文有唯一落点：技术详情折叠区的「读取失败原因」行 */
            <span className="text-xs">{WORKBENCH_CONTRACT_PENDING_NOTE}</span>
          }
          action={
            /* 用户要求的**重试入口**：资料补齐后不必刷新整页，点一下重新读取即可 */
            <Button size="small" loading={reloading} onClick={() => void loadWorkbench()}>
              {WORKBENCH_CONTRACT_PENDING_RETRY}
            </Button>
          }
          data-testid="contract-pending-banner"
        />
      ) : null}

      {analysisAction.staleNotice ? (
        <Alert type="info" showIcon message={<span className="text-xs">{analysisAction.staleNotice}</span>} />
      ) : null}

      {/* 两栏工作区：左剧本原文（可收起）+ 右主区 */}
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div
          className="h-full shrink-0"
          style={{ width: scriptCollapsed ? 36 : 380 }}
          data-testid="script-panel"
        >
          <ScriptTextPanel
            chapterIndex={chapter.index}
            chapterTitle={chapter.title}
            scriptChars={data?.script_chars ?? chapter.scriptChars}
            rawText={chapter.rawText}
            shots={shots}
            collapsed={scriptCollapsed}
            onToggleCollapsed={() => setScriptCollapsed((prev) => !prev)}
            onFocusShot={handleFocusShot}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
          <Spin spinning={loading || reloading}>
            <div className="space-y-3">
              {/* 卡片网格：当前页签的资产，每项只出现一次 */}
              <AssetCardGrid
                items={tabItems}
                selectedKeys={selectedKeys}
                busy={runBusy}
                onToggleSelect={handleToggleSelect}
                onOpenDetail={handleOpenDetail}
                onEditPrompt={handleEditPrompt}
                onGenerateOne={handleGenerateOne}
                renderProfileEditor={renderProfileEditor}
              />

              {/* 结果区：既有出图机制（进度、结果卡片、采纳、定版、重新生成都在它里面） */}
              <div className="border-t border-slate-200 pt-3">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-900">生成结果</span>
                  <Tag bordered={false}>{`本轮 ${progress.total} 项`}</Tag>
                  {taskProgressLines(progress).map((line) => (
                    <Tag key={line.label} bordered={false}>{`${line.label} ${line.value}`}</Tag>
                  ))}
                  <span className="text-[11px] text-gray-500">
                    生成的图会先出现在这里：点「采纳」落到资产图片，点「设为定版」定下对外使用的那一张。
                  </span>
                </div>
                {/*
                  「生成图片提示词」：行集**只**来自用户勾选的那些资产（键与工作台选择键同口径），
                  面板自己不会再按项目/章节拉一份全部资产；勾选的项里暂时生成不了的（本章只有资料记录、
                  还没建出资产）如实列出来，不让"按钮说 N 项、实际只发出更少请求"。
                */}
                <Modal
                  open={promptPanelOpen}
                  title={promptPanelTitle}
                  onCancel={() => setPromptPanelOpen(false)}
                  footer={null}
                  width={1040}
                  destroyOnClose={false}
                >
                  <div className="space-y-2">
                    <Alert
                      type="info"
                      showIcon
                      message="每项会调用一次文本模型（按次计费，会花钱）"
                      description="生成后请逐项检查再保存；任何一次失败都会立即停止、不自动重试。保存的位置就是生图实际读取的那份资产提示词。"
                    />
                    {promptPanelAssets.skipped.length > 0 ? (
                      <Alert
                        type="warning"
                        showIcon
                        message={`有 ${promptPanelAssets.skipped.length} 项勾选的资产本次无法生成提示词`}
                        description={
                          <span className="text-xs">
                            {describeSkippedPromptPanelAssets(promptPanelAssets.skipped)}
                          </span>
                        }
                      />
                    ) : null}
                    <AssetImagePromptLlmPanel
                      projectId={projectId ?? ''}
                      chapterId={chapterId}
                      preselectAllMissing
                      assets={promptPanelAssets.assets}
                      onSaved={() => {
                        setPromptPanelOpen(false)
                        void loadWorkbench()
                        onReload()
                      }}
                    />
                  </div>
                </Modal>

                <AssetProductionArea
                  ref={productionRef}
                  projectId={projectId ?? ''}
                  assets={toSignalAssets(data)}
                  gate={gate}
                  embedded
                  resultGridClassName="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]"
                  onProgress={handleProgress}
                  onReload={() => {
                    void loadWorkbench()
                    onReload()
                  }}
                  onOpenAssetEditor={onOpenAssetEditor}
                />
              </div>

              {/* 技术详情（默认收起）：内部信息唯一的落点 */}
              <TechnicalDetailCollapse
                input={{ data, source, chapterId, loadError }}
                gateBanner={<GenerationGateBanner gate={gate} outlet="image" />}
                onOpenLegacyExtractConfirm={onOpenLegacyExtractConfirm}
              />
            </div>
          </Spin>
        </div>
      </div>

      <AssetDetailDrawer
        open={Boolean(detailItem)}
        item={detailItem}
        focusShotIndex={detailShotIndex}
        onClose={() => {
          setDetailItem(null)
          setDetailShotIndex(null)
        }}
        onEditPrompt={handleEditPrompt}
        renderProfileEditor={renderProfileEditor}
      />

      <PendingReviewDrawer
        open={pendingOpen}
        rows={pendingReview}
        onClose={() => setPendingOpen(false)}
        onGoHandle={(row) => {
          const matched = items.find(
            (item) => item.name === row.name && (row.asset_type ? item.asset_type === row.asset_type : true),
          )
          setPendingOpen(false)
          if (matched) {
            setTab(workbenchItemType(matched))
            handleOpenDetail(matched)
            return
          }
          if (onOpenLegacyExtractConfirm) {
            // 清单里还没有对应资产 = 这一项大概还没确认写入：去写入前的人工确认页处理
            onOpenLegacyExtractConfirm()
            return
          }
          message.info('这一项在当前清单里没有对应资产：可以先重新分析本章资产，再回来处理。')
        }}
      />

      {!chapterId ? (
        <Alert
          type="info"
          showIcon
          message={<span className="text-xs">还没有选定集：请先在页面顶部选择一集，再准备这一集的资产。</span>}
          action={
            <Button size="small" onClick={() => setTab('character')}>
              知道了
            </Button>
          }
        />
      ) : null}
    </div>
  )
}

/**
 * 契约项 → 结果区（既有出图机制）认识的资产形状。
 *
 * 只搬运**真实字段**：图片有无 / 定版有无 / 提示词有无 / 缩略图 / 图片行号。
 * 契约没落地的降级视图里这些字段同样来自既有接口，所以两边都成立。
 */
function toSignalAssets(data: AssetWorkbenchResponse | null): ProjectSignalAsset[] {
  if (!data) return []
  return data.items
    .filter((item) => item.asset_type !== 'costume')
    .map((item) => ({
      id: item.asset_id,
      name: workbenchItemName(item),
      type: (['character', 'scene', 'prop'].includes(item.asset_type)
        ? item.asset_type
        : 'character') as ProjectSignalAsset['type'],
      hasImage: item.image?.has_image === true,
      thumbnail: item.image?.thumbnail ?? '',
      hasPrimary: item.image?.has_primary === true,
      imageId: typeof item.image?.image_id === 'number' ? item.image.image_id : null,
      hasImagePrompt: Boolean(String(item.prompt?.text ?? '').trim()),
      hasPendingCandidate: false,
    }))
}

export default AssetWorkbench
