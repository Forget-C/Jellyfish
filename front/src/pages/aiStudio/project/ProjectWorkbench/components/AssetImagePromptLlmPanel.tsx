/**
 * 第 3 步「图片准备」里的**大模型生成图片提示词**面板（按资产 / 可批量 / 可确认保存）。
 *
 * 为什么需要它（用户要求）：
 * 1. 第 3 步此前只有「手工填写提示词」（把用户自己的字写进 `image_prompts`），
 *    真正的"让大模型按资产画像生成图片提示词"在项目工作台上没有入口；
 * 2. 默认**只补缺失项**：已经有 `image_prompts` 的资产不碰，要覆盖必须显式打开开关；
 * 3. 生成结果必须**可编辑、确认后才保存**，且**模板/演练不得冒充大模型输出** ——
 *    只有后端回包 `meta.llm_called === true` 才允许保存；
 * 4. 批量要能**停止后续、保留已完成、重试失败项**。
 *
 * 本轮修正三件事（用户点名）：
 *   A. **槽位吃后端槽位表**（`/studio/llm/orchestration/status` 的 `image_prompt_slots`）：
 *      道具不再显示「不支持（无槽位）」——它有 `prop_image_front` 槽位，
 *      可以勾选、可以手工填写并保存；后端槽位表里还没补上时只说「正在补，先手工填写」，
 *      不再是一个死胡同（见 `assetPromptSlots.resolveAssetPromptSlot`）。
 *   B. **质量如实呈现**：这一行拿到的提示词如果不可用（空 / 外观信息不足 /
 *      只有名称+通用摄影词），页面直接给出原因与怎么修，**不显示成"提示词已就绪"**，
 *      也不许原样保存进资产（先按原因改好，改完就能存）。
 *   C. **生成依据（默认收起）**：每一行都能展开看本次用了哪些项目风格 / 资产资料 /
 *      剧本片段 / 分镜依据；后端还没返回这些字段时如实显示「本次未提供生成依据」。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Collapse, Input, Modal, Space, Table, Tag, Tooltip, message } from 'antd'
import { ReloadOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { StudioEntitiesApi } from '../../../../../services/studioEntities'
import { StudioProjectsService } from '../../../../../services/generated'
// 阶段 B ①：技术详情折叠壳全仓唯一实现（三处自建折叠区已合并到它）
import { TechnicalDetailSection } from './workbench/TechnicalDetailCollapse'
// 阶段 B ①：模式 6 出口统一走三级管道（去 ID → 去内部术语 → 业务化改写 + 中文兜底）
import { toUserFacingText } from '../../../components/userFacingMessage.ts'
import {
  fetchImagePromptSlots,
  getAssetImagePrompts,
  saveAssetImagePrompts,
} from '../../../../../services/llmPipelineApi'
import {
  previewAssetImagePrompt,
  fetchAssetPromptBatchSaveSupport,
  fetchPromptRequestSupport,
  saveAssetImagePromptsBatch,
} from './assetProductionApi'
import { AssetGenerationBasisPanel } from './AssetGenerationBasisPanel'
import {
  buildRequestStructureText,
  readGenerationBasis,
  summarizeGenerationBasis,
  type GenerationBasisExtras,
} from './assetGenerationBasis.ts'
import { PromptQualityAlert, PromptQualityTag } from './PromptQualityAlert'
import {
  describeRowAvailability,
  readAssetPromptAvailabilityError,
} from './assetPromptRequestScope.ts'
import { describeUnrequestableAssets } from './workbench/promptPanelAssets.ts'
import {
  buildPromptDifferenceLines,
  describePromptPanelRowQuality,
  describePromptSaveFailure,
  canSavePromptToAsset,
  summarizePromptDifferences,
} from './assetPromptQuality.ts'
import {
  buildBatchWriteScopeConfirmation,
  buildGlobalAssetWriteConfirmation,
  describeAssetScopeCopy,
  isGlobalAssetType,
} from './assetWriteScope.ts'
import {
  PROMPT_REQUEST_SUPPORT_NONE,
  buildAssetPromptBatchSaveBody,
  describePromptRequestDelivery,
  type PromptRequestFieldSupport,
} from './assetPromptRequestContract.ts'
import type { ProjectSignalAsset, ProjectSignalAssetType } from '../hooks/useProjectStepSignals'
import {
  buildRestoredDraftLine,
  buildRestoredDraftRowFields,
  clearAssetPromptDraft,
  loadAssetPromptDraftPlan,
  matchAssetPromptDraftEntries,
  resolveRestoredDraftSaveGuard,
  saveAssetPromptDraft,
} from './workbench/assetPromptDrafts.ts'
import {
  ASSET_PROMPT_CATEGORY,
  ASSET_PROMPT_CATEGORY_LABEL,
  buildUnsupportedSlotAlert,
  describePromptRowAsset,
  describePromptRowExisting,
  describePromptRowGenerateHint,
  describePromptRowSlot,
  describePromptRowState,
  mergeLoadedAssetPrompts,
  resolveAssetPromptSlot,
  type AssetPromptSlotSpecLike,
} from './assetPromptSlots.ts'

/** 槽位表与文案都在 `assetPromptSlots` 里（纯逻辑，可单测）；这里只做转出，避免旧引用失效。 */
export { ASSET_PROMPT_CATEGORY, ASSET_PROMPT_CATEGORY_LABEL }

type AssetRow = {
  key: string
  id: string
  type: ProjectSignalAssetType
  name: string
  /** 有没有提示词槽位（四类资产都有；没有的类型才不能勾选） */
  supported: boolean
  /** 后端槽位表里有没有这一项（能否一键让大模型生成） */
  generateSupported: boolean
  category: string
  /** 槽位中文名（后端槽位表优先） */
  label: string
  /** 不能一键生成时的如实说明 */
  generateBlockedReason: string
  /** 已保存的提示词（生图实际读取的那一列） */
  existing: string
  /**
   * 该资产**已保存的全部槽位提示词**（打开时读一次）。
   *
   * 保存接口是"整列替换"，只发一个槽位会抹掉该资产其它槽位，所以保存时合并写回。
   */
  existingMap: Record<string, string>
  status: 'pending' | 'running' | 'generated' | 'saved' | 'failed' | 'stopped' | 'unavailable'
  draft: string
  llmCalled: boolean | null
  latencyMs: number | null
  error: string
  warnings: string[]
  /** 本次生成依据的原始回包片段（默认收起的「生成依据」面板读它） */
  basisPayload: unknown
  /** 本次质量判定的原始回包片段（后端结构化优先） */
  qualityPayload: unknown
  /** ④ 本次**真的发出去**的请求结构（脱敏后展示） */
  requestStructure: string
  /**
   * 这一行的正文是不是**本机草稿**（生成过、还没保存，靠它活过刷新）恢复回来的。
   *
   * 恢复来的行会打上「草稿（未保存）」标签，与绿色「已保存」严格区分；
   * 用户一旦重新生成或保存成功，这几个字段立刻清空（草稿不再代表当前正文）。
   */
  restoredFromDraft: boolean
  /** 恢复当时的那一版正文：用来判"用户改过没有" */
  restoredPrompt: string
  /** 恢复当时这条能不能保存（生成时就判不可用的，恢复后也不许绕过） */
  restoredSavable: boolean
  /** 恢复时的质量结论（只用于回显，不冒充现在的判定） */
  restoredQualityLabel: string
  restoredQualityReason: string
  /** 恢复时的**依据摘要**（用户语言一句话；整份依据回包不进草稿） */
  restoredBasisSummary: string
  /** 草稿的生成时间 */
  restoredAt: number
}

/** 默认只勾选这么多个缺失资产，放大批量必须人工点「全选缺失」。 */
const DEFAULT_SELECT_LIMIT = 3
/** 超过这个数量就要求二次确认（真实大模型调用是花钱的）。 */
const CONFIRM_THRESHOLD = 10

type AssetImagePromptLlmPanelProps = {
  projectId?: string
  /**
   * 当前集（章节）：本机草稿按 **项目 + 集** 分键，换项目 / 换集互不串。
   *
   * 不给就是一个"不分集"的桶（键里用固定段名），不会和别的项目串上；
   * 两个调用方（工作台的批量入口、第 2 步图片准备）都会把当前集传进来。
   */
  chapterId?: string | null
  assets: ProjectSignalAsset[]
  /** 保存成功后通知外层重算本步骤信号（摘要与资产表要跟着变） */
  onSaved?: () => void
  /**
   * 调用方**已经替用户选好了这批资产**（例如工作台顶部"生成图片提示词（4）"）时置 true：
   * 默认勾选这批里的全部缺失项，不再套用 `DEFAULT_SELECT_LIMIT` 的"只勾前 3 个"保护。
   *
   * 为什么需要：上限保护的目的是防止"一次勾几十个一键烧钱"，而当上游已经是一个
   * **用户明确选过的子集**时，再默默砍掉一部分会让"按钮说 4、实际只发 3"，
   * 用户看到的数量与实际调用不一致（这正是本轮要修的）。
   */
  preselectAllMissing?: boolean
}

export function AssetImagePromptLlmPanel({
  projectId,
  chapterId,
  assets,
  onSaved,
  preselectAllMissing = false,
}: AssetImagePromptLlmPanelProps) {
  const [rows, setRows] = useState<AssetRow[]>([])
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [onlyMissing, setOnlyMissing] = useState(true)
  const [includeExisting, setIncludeExisting] = useState(false)
  const [running, setRunning] = useState(false)
  const [savingKey, setSavingKey] = useState('')
  const stopRef = useRef(false)
  /**
   * 本机草稿的恢复说明（空串 = 这次没有恢复出可回填的草稿）。
   *
   * 只用来**告诉用户发生了什么**：这一段是只读恢复的产物，页面不会因为恢复了草稿
   * 就去保存或重新生成任何一行。
   */
  const [draftNote, setDraftNote] = useState('')
  /**
   * 本次**送进面板**的资产里，有几项连请求都发不出去（`asset_id` 为空）。
   *
   * 如实列出来，是为了让"按钮上的数字"和"实际发生的调用次数"永远对得上：
   * 这类项不参与生成，也不能被静默丢掉。
   */
  const [unrequestableAssets, setUnrequestableAssets] = useState<string[]>([])
  /** 后端槽位表：道具槽位补上后这里会自动出现它（前端不再硬编码"道具没有槽位"） */
  const [slotSpecs, setSlotSpecs] = useState<AssetPromptSlotSpecLike[]>([])
  /** 这次批量生成时**对所有选中资产**的补充要求（④ 项依据；后端声明了对应字段才会真的发出去） */
  const [userSupplement, setUserSupplement] = useState('')
  /** 请求字段能力（读后端接口清单得到；读不到就一个额外字段都不发） */
  const [requestSupport, setRequestSupport] = useState<PromptRequestFieldSupport>(PROMPT_REQUEST_SUPPORT_NONE)
  /** 项目整体风格（① 项依据） */
  const [projectStyleHint, setProjectStyleHint] = useState('')
  /**
   * 批量保存入口是否已上线（读接口清单）。
   *
   * 上线后走它（一次事务 + 跨资产查重 + 合并写入）；没上线就退回逐资产保存（今天的口径）。
   */
  const [batchSaveAvailable, setBatchSaveAvailable] = useState(false)

  /** 只读：后端槽位表 + 请求字段能力 + 项目整体风格（都不触发任何生成） */
  useEffect(() => {
    let cancelled = false
    void fetchImagePromptSlots()
      .then((specs) => {
        if (!cancelled) setSlotSpecs(Array.isArray(specs) ? specs : [])
      })
      .catch(() => {
        if (!cancelled) setSlotSpecs([])
      })
    void fetchPromptRequestSupport().then((support) => {
      if (!cancelled) setRequestSupport(support)
    })
    void fetchAssetPromptBatchSaveSupport().then((support) => {
      if (!cancelled) setBatchSaveAvailable(support.available)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    void (async () => {
      try {
        const res = await StudioProjectsService.getProjectApiV1StudioProjectsProjectIdGet({ projectId })
        const project = (res?.data ?? {}) as { visual_style?: string | null; style?: string | null }
        const parts = [project.visual_style, project.style]
          .map((item) => (typeof item === 'string' ? item.trim() : ''))
          .filter((item) => item.length > 0)
        if (!cancelled) setProjectStyleHint(Array.from(new Set(parts)).join('，'))
      } catch {
        if (!cancelled) setProjectStyleHint('')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

  /**
   * 把步骤信号里的资产转换成面板行；`existing` 需要拉一次实体详情（步骤信号不带描述与提示词）。
   *
   * **行集只来自 `props.assets`**（调用方已经替用户选好的那些资产）：
   * 面板不会自己按项目/章节再拉一份资产清单，也不会在 `assets` 为空时"回退到全部" ——
   * 回退到全部等于把没被勾选的资产也一起拿去调用模型（真实事故：勾 4 项却生成到别的资产）。
   *
   * `asset_id` 为空的行（本章只有资料记录、还没建出资产）**不进面板**：
   * 面板是按资产逐项发请求的，空 id 连实体详情都读不到，放进来只会
   * "按钮说 N 项、实际只发出更少请求"，而且失败会打断后面的项。这类项如实列在页面上。
   */
  const loadRows = useCallback(async () => {
    const next: AssetRow[] = []
    const unrequestable: string[] = []
    for (const asset of assets) {
      if (!String(asset.id ?? '').trim()) {
        unrequestable.push(asset.name || '（未命名资产）')
        continue
      }
      // 槽位**吃后端槽位表**（读不到就退回内置表，四类资产都有槽位）
      const slot = resolveAssetPromptSlot(asset.type, slotSpecs)
      next.push({
        key: `${asset.type}:${asset.id}`,
        id: asset.id,
        type: asset.type,
        name: asset.name || asset.id,
        supported: slot.supported,
        generateSupported: slot.generateSupported,
        category: slot.category,
        label: slot.label,
        generateBlockedReason: slot.generateBlockedReason,
        existing: '',
        existingMap: {},
        status: 'pending',
        draft: '',
        llmCalled: null,
        latencyMs: null,
        error: '',
        warnings: [],
        basisPayload: null,
        qualityPayload: null,
        requestStructure: '',
        restoredFromDraft: false,
        restoredPrompt: '',
        restoredSavable: true,
        restoredQualityLabel: '',
        restoredQualityReason: '',
        restoredBasisSummary: '',
        restoredAt: 0,
      })
    }
    setRows(next)
    setUnrequestableAssets(unrequestable)
    // 缺失项默认只勾**前 3 个**（`hasImagePrompt !== true` 视为缺失）：
    // 一次几十个资产就是几十次真实大模型调用，默认全勾等于把按钮做成"一键烧钱"。
    const missing = next.filter((row) => row.supported && assets.find((a) => a.id === row.id)?.hasImagePrompt !== true)
    // 上游已明确选好子集（工作台批量入口）→ 全选这批缺失项；否则仍只勾前 3 个（防一键烧钱）
    setSelectedKeys(
      (preselectAllMissing ? missing : missing.slice(0, DEFAULT_SELECT_LIMIT)).map((row) => row.key),
    )
    // 已有内容的资产：拉一次详情，把已保存的提示词显示出来（用于对照与"不覆盖"判断）
    const withExisting = next.filter((row) => assets.find((a) => a.id === row.id)?.hasImagePrompt === true)
    const loaded = await Promise.all(
      withExisting.map(async (row) => {
        try {
          const res = await StudioEntitiesApi.get(row.type as 'character' | 'scene' | 'prop' | 'costume', row.id)
          const prompts = getAssetImagePrompts(res.data as Record<string, unknown>)
          const map = Object.fromEntries(
            Object.entries(prompts)
              .map(([slot, value]) => [slot, String(value ?? '').trim()])
              .filter(([, value]) => Boolean(value)),
          )
          return { key: row.key, existing: String(prompts[row.category] ?? '').trim(), existingMap: map }
        } catch {
          return { key: row.key, existing: '', existingMap: {} }
        }
      }),
    )
    /* ---- 草稿恢复（只读）开始 -------------------------------------------------
     * 为什么要有这一段：点一次「生成图片提示词（N）」就是 N 次**真实付费**调用。
     * 今天真出过一次事故 —— 4 次调用都跑完了，用户还没点「保存到资产」页面就被关掉，
     * 已经付过费的 4 条提示词全丢（资产里还是空的）。所以生成结果会立刻写进本机草稿，
     * 这里负责把它**回填**到编辑器里，等用户自己检查、修改、再点「保存到资产」。
     *
     * 这一段里**只允许读**：读本机草稿 + 回填行。
     *   - 不保存到资产（用户没点，就一个字节都不进资产）；
     *   - 不重新生成（那要再花一次钱，而且用户没要求）；
     *   - 不发任何请求（下面这些函数全是纯函数 / 本地读写）。
     * 测试 `workbench/assetPromptDrafts.test.ts` 会按这两个标记切片扫描，
     * 这一段里出现任何提交 / 生成入口的名字都会直接失败。
     * ------------------------------------------------------------------------ */
    const draftPlan = loadAssetPromptDraftPlan({
      projectId: projectId ?? '',
      chapterId,
      rows: next.map((row) => ({ type: row.type, id: row.id, category: row.category })),
    })
    const matchedDrafts = draftPlan.restored
      ? matchAssetPromptDraftEntries(next, draftPlan.entries).matched
      : []
    setDraftNote(draftPlan.note)
    if (loaded.length || matchedDrafts.length) {
      /**
       * **按 key 合并**，不是整行替换（缺陷 D1 的修复）。
       *
       * `loaded` 里的每一项只有 `{ key, existing }`；以前写的是
       * `prev.map(row => loaded.find(...) ?? row)` —— 命中的行会被这个两字段对象**整行替换**，
       * name / type / supported / category 全部丢失，界面立刻变成
       * 「undefined（undefined）」+「不支持（无槽位）」+ 复选框禁用（不能勾选、不能生成），
       * 有几项已保存提示词就有几行坏掉，还误报「有 N 个资产类型没有大模型槽位」。
       *
       * 本机草稿同样只往**已经存在的那一行**上回填（`matchedDrafts` 只认类型 + 资产 + 槽位全对上的），
       * 不凭空造行；草稿本身只在浏览器里，一次写入都不发生。
       */
      setRows((prev) => {
        const merged = loaded.length ? mergeLoadedAssetPrompts(prev, loaded) : prev
        if (!matchedDrafts.length) return merged
        const byRowKey = new Map(matchedDrafts.map((item) => [item.row.key, item.entry]))
        return merged.map((row) => {
          const draftEntry = byRowKey.get(row.key)
          return draftEntry ? { ...row, ...buildRestoredDraftRowFields(draftEntry) } : row
        })
      })
    }
    /* ---- 草稿恢复（只读）结束 ---------------------------------------------- */
  }, [assets, chapterId, preselectAllMissing, projectId, slotSpecs])

  /**
   * 资产清单的**内容**指纹。
   *
   * 为什么不能直接用 `assets` 当依赖：它是父组件每次渲染都会新建的数组
   * （调用方写的是 `filter(...)`），拿它当依赖会让"父组件随便重渲染一次"
   * 也被当成"资产清单变了" → 面板把 `selectedKeys` 重置成默认勾选、
   * 已生成的行也一起被重建（用户刚点完生成，勾选却自己变了）。
   * 指纹只认真正影响行集的内容：类型 + 资产 + 有没有已保存提示词。
   */
  const assetsSignature = useMemo(
    () =>
      assets.map((asset) => `${asset.type}:${asset.id}:${asset.hasImagePrompt ? 1 : 0}`).join('|'),
    [assets],
  )

  useEffect(() => {
    void loadRows()
    // 只在**资产清单内容**、集、项目或槽位表变化时重载；`loadRows` 的引用变化不触发（见上面说明）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetsSignature, chapterId, preselectAllMissing, projectId, slotSpecs])

  const plannedRows = useMemo(
    () =>
      rows.filter((row) => {
        // 一键生成要求后端槽位表里有这一项（没补上时只能手工填写并保存，不当成"不支持"）
        if (!row.supported || !row.generateSupported) return false
        if (!selectedKeys.includes(row.key)) return false
        if (!onlyMissing || includeExisting) return true
        return !row.existing
      }),
    [includeExisting, onlyMissing, rows, selectedKeys],
  )

  const generateOne = async (row: AssetRow): Promise<void> => {
    // 这一行连资产身份都不完整（理论上不会发生：`loadRows` 已经把空 id 的行挡在外面）：
    // 直接如实报错，绝不发一个"不知道是哪个资产"的请求出去。
    if (!String(row.id ?? '').trim()) {
      throw new Error('这一项还没有对应资产，无法生成提示词：请先在资产准备页补齐这一项。')
    }
    // 画像卡：把该资产的描述交给编排层，保证"提示词是照这个资产写的"
    const detail = await StudioEntitiesApi.get(row.type as 'character' | 'scene' | 'prop' | 'costume', row.id)
    const entity = (detail.data ?? {}) as Record<string, unknown>
    const preview = await previewAssetImagePrompt({
      projectId: projectId ?? null,
      chapterId: chapterId ?? null,
      assetType: row.type,
      assetId: row.id,
      name: String(entity.name ?? row.name),
      description: String(entity.description ?? ''),
      category: row.category,
      // ① 项目整体风格 + ④ 本次补充要求（后端没声明对应字段时不会发出去，页面会说明）
      styleHint: projectStyleHint,
      userSupplement,
      requestSupport,
    })
    /**
     * 这一版的**质量结论**：既用来立刻落草稿（下面就要写），也是"能不能保存到资产"的唯一依据。
     * 后端结构化判定优先，读不到就前端自查（与批量出图的拦截是同一份逻辑）。
     */
    const draftVerdict = describePromptPanelRowQuality(
      { name: row.name, type: row.type, draft: preview.prompt, existing: row.existing },
      { serverQuality: preview.qualityPayload, serverWarnings: preview.warnings },
    )
    setRows((prev) =>
      prev.map((item) =>
        item.key === row.key
          ? {
              ...item,
              status: 'generated',
              draft: preview.prompt,
              llmCalled: preview.llmCalled,
              latencyMs: preview.latencyMs,
              warnings: preview.warnings,
              basisPayload: preview.basisPayload,
              qualityPayload: preview.qualityPayload,
              requestStructure: buildRequestStructureText(preview.requestBody),
              error: preview.slotMissing ? '这一类暂时不能一键生成：可以手工填写后保存到资产。' : '',
              // 这一行是刚生成的新版本，之前恢复来的草稿不再是"当前正文"
              restoredFromDraft: false,
              restoredPrompt: '',
              restoredSavable: true,
              restoredQualityLabel: '',
              restoredQualityReason: '',
              restoredBasisSummary: '',
              restoredAt: 0,
            }
          : item,
      ),
    )
    /**
     * 生成成功 → **立刻**把这一版写进本机草稿（`localStorage`，不发任何请求、不写库）。
     *
     * 为什么写在 `setRows` 之后而不是等用户点保存：这一版正文是**已经付过费**的产物，
     * 只要页面被关掉 / 刷新，它就会凭空消失（真实事故）。草稿仍然不是"已保存到资产"：
     * 资产里的提示词只有用户自己点「保存到资产」才会变。
     *
     * 写草稿本身失败（隐私模式 / 超配额）**不影响本次生成结果**：静默降级，页面照常用。
     */
    saveAssetPromptDraft({
      projectId: projectId ?? '',
      chapterId,
      entry: {
        assetType: row.type,
        assetId: row.id,
        assetName: row.name,
        slot: row.category,
        prompt: preview.prompt,
        llmCalled: preview.llmCalled === true,
        latencyMs: preview.latencyMs,
        warnings: preview.warnings,
        // 只存"人话那一句"依据摘要（本次用到：项目风格 / 规范化资料 N 项…），不存回包原始片段
        basisSummary: summarizeGenerationBasis(readGenerationBasis(preview.basisPayload)),
        qualityLabel: draftVerdict.label,
        qualityReason: draftVerdict.reason,
        savable: canSavePromptToAsset(draftVerdict, preview.prompt),
        savedAt: Date.now(),
      },
    })
  }

  const runBatch = async (targets: AssetRow[]) => {
    if (!targets.length) return
    stopRef.current = false
    setRunning(true)
    /** 本次因为"库里没有可用于出图的资料"被后端拒掉的项数（收尾时如实告知，不当成失败） */
    let unavailableCount = 0
    /** 剩下的还没开始的项（失败/停止后要如实回显"它们没有开始"） */
    const remaining: AssetRow[] = []
    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index]
      if (stopRef.current) {
        remaining.push(target)
        continue
      }
      setRows((prev) => prev.map((item) => (item.key === target.key ? { ...item, status: 'running' } : item)))
      try {
        // 串行：一次只打一个 LLM 请求，避免并发把配额打满、也便于"停止后续"立刻生效
        // eslint-disable-next-line no-await-in-loop
        await generateOne(target)
      } catch (error) {
        /**
         * **逐项隔离**：后端明确说"这一项在库里没有可用于出图的资料"时，这是**这一项**的问题
         * （与批量出图的逐项失败隔离同一口径），不是整批的问题：
         * 把原因与"怎么补"标在**这一行**上，然后接着做后面的项 ——
         * 否则勾了 4 项、其中 1 项没资料，另外 3 项会一起拿不到结果。
         *
         * 这次请求在后端**生成之前**就被拒了（没有计费调用），所以继续是安全的。
         */
        const availability = readAssetPromptAvailabilityError(error)
        if (availability.missingProfile) {
          const reason =
            availability.reason ||
            `「${target.name}」在库里没有可用于出图的资料（资产描述、外观资料、本章资料都是空的）。`
          unavailableCount += 1
          setRows((prev) =>
            prev.map((item) =>
              item.key === target.key
                ? {
                    ...item,
                    status: 'unavailable',
                    error: '这一项没有可用于出图的资料：本次没有发起生成（不花钱）。',
                    /**
                     * 把后端的结构化原因装成**质量判定**的形状：这样行内的原因与
                     * "怎么补"由既有组件渲染（与质量拦截同一份文案），不另写一套。
                     */
                    qualityPayload: {
                      savable: false,
                      quality_issues: [
                        { code: 'vague_filler', message: reason, fix: availability.fix },
                      ],
                    },
                  }
                : item,
            ),
          )
          continue
        }
        setRows((prev) =>
          prev.map((item) =>
            item.key === target.key
              ? /**
                 * 模式 6：后端原文**不入 state**（主区这一列只放中文结论）；
                 * 原文已掩码 + 业务化，兜底句见 `toUserFacingText`。
                 */
                { ...item, status: 'failed', error: toUserFacingText(error, '这一项没生成成功') }
              : item,
          ),
        )
        /**
         * **失败立即停止、不自动重试**（用户口径：真实调用是按次数授权的，
         * 任何一次失败都要停下来由人决定，不能让页面自己接着烧次数）。
         */
        remaining.push(...targets.slice(index + 1))
        break
      }
    }
    if (remaining.length > 0) {
      const stopped = stopRef.current ? '已按你的要求停止' : '上一次调用失败后已自动停止（不会重试）'
      setRows((prev) =>
        prev.map((item) => (item.status === 'pending' ? { ...item, status: 'stopped', error: `${stopped}：这一项没有开始` } : item)),
      )
      message.info(`${stopped}：剩余 ${remaining.length} 项没有开始。确认后可点「生成图片提示词」继续，页面不会自动重试。`)
    }
    if (unavailableCount > 0) {
      /**
       * 缺资料是**逐项**的事：说清"哪几项、为什么、怎么补"，并明确其它项照常，
       * 不让用户以为整批都没成（真实事故里正是这一句缺失，用户看到的是"4 项都没拿到"）。
       */
      message.warning(
        `有 ${unavailableCount} 项因为库里没有可用于出图的资料，本次没有生成（也没有计费）：` +
          '按每一行给出的原因与「怎么补」补好资料后再生成；其它项不受影响。',
      )
    }
    setRunning(false)
    stopRef.current = false
  }

  const saveOne = async (row: AssetRow, options: { skipConfirm?: boolean } = {}): Promise<boolean> => {
    const text = String(row.draft ?? '').trim()
    if (!text) {
      message.warning('提示词为空，未保存')
      return false
    }
    if (!row.llmCalled) {
      message.error('这次没有真正调用大模型（演练/模板），不能按大模型结果保存为正式产物。')
      return false
    }
    // 质量不可用的提示词**不许原样存进资产**（否则它会被后面的出图当成可用提示词）
    const verdict = describePromptPanelRowQuality(row, { serverQuality: row.qualityPayload, serverWarnings: row.warnings })
    if (!canSavePromptToAsset(verdict, text)) {
      // 质量原因归这一行下面的「质量原因」块（与资产生产区同一口径），主区只留「怎么修」
      message.error(
        verdict.fixes[0]
          ? `这一行不能保存。怎么修：${verdict.fixes[0]}`
          : '这一行不能保存：请按这一行下面给出的原因补充外观信息后再试。',
      )
      return false
    }
    /**
     * 恢复来的草稿：正文**没改过**且生成时就被判"不可用" → 仍然不许保存。
     *
     * 否则刷新一次就把当时的质量拦截绕过去了（生成时不让存的东西，刷新后突然能存）。
     * 用户按原因改好正文之后，这条判定自动失效（`resolveRestoredDraftSaveGuard` 只认"没改过"的那一版）。
     */
    const restoredGuard = resolveRestoredDraftSaveGuard(row)
    if (restoredGuard.blocked) {
      // 模式 6：原因先过三级管道（去 ID → 去内部术语 → 业务化改写），再拼进这句中文
      message.error(
        `这条本机草稿在生成时就判为不可用：${toUserFacingText(
          restoredGuard.reason,
          '正文不符合要求',
        )}；按原因改好正文即可保存。`,
      )
      return false
    }
    // 合并写回：只改这一行那一个槽位，该资产其它槽位原样保留（保存接口是整列替换）
    const nextPrompts: Record<string, string> = { ...row.existingMap, [row.category]: text }
    /**
     * 写入范围确认：全局资产（场景/道具/服装）**一律**先确认"这会写回全局资产库"+差异；
     * 角色（项目内资产）只在会替换已有内容时确认。
     */
    const writeScope = buildGlobalAssetWriteConfirmation({
      assetType: row.type,
      assetName: row.name,
      existing: row.existingMap,
      incoming: nextPrompts,
    })
    const replacedSlots = writeScope.replacedSlots
    const doSave = async (): Promise<boolean> => {
      setSavingKey(row.key)
      try {
        // 覆盖已有提示词必须**显式确认**（后端默认不动；确认后带 confirm_replace_image_prompt=true）
        await saveAssetImagePrompts(
          row.type as 'character' | 'scene' | 'prop' | 'costume',
          row.id,
          nextPrompts,
          replacedSlots.length > 0 ? { confirm_replace_image_prompt: true } : {},
        )
        /**
         * 保存成功 → 清掉这一行的**本机草稿**。
         *
         * 不清的话，页面上会同时存在"已保存到资产"和"本机草稿"两份同一内容的副本，
         * 用户没法判断哪一份才是生图会读的那一份（以后改了草稿还会以为资产跟着变了）。
         * 只删这一行（资产 + 槽位）：同一资产别的槽位、别的资产的草稿都不动。
         */
        clearAssetPromptDraft({
          projectId: projectId ?? '',
          chapterId,
          target: { assetType: row.type, assetId: row.id, slot: row.category },
        })
        setRows((prev) =>
          prev.map((item) =>
            item.key === row.key
              ? {
                  ...item,
                  status: 'saved',
                  existing: text,
                  restoredFromDraft: false,
                  restoredPrompt: '',
                  restoredSavable: true,
                  restoredQualityLabel: '',
                  restoredQualityReason: '',
                  restoredBasisSummary: '',
                  restoredAt: 0,
                }
              : item,
          ),
        )
        onSaved?.()
        return true
      } catch (error) {
        /**
         * 模式 6：`failure.message` 来自后端结构化错误（已掩码但仍是后端措辞），
         * 所以再走一遍三级管道，主区只出中文结论。
         */
        const failure = describePromptSaveFailure(error)
        const detail = failure.fix ? `${failure.message}（${failure.fix}）` : failure.message
        message.error(toUserFacingText(detail, '保存提示词失败：请稍后重试'))
        return false
      } finally {
        setSavingKey('')
      }
    }
    // 保护既有的人工提示词：覆盖前先确认（不会静默盖掉）；全局资产还要说明"写回全局"
    // （批量回退路径已经**一次性**确认过整批的范围与差异，这里不重复弹框）
    if (writeScope.required && options.skipConfirm !== true) {
      return await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: writeScope.title,
          width: 600,
          okText: writeScope.okText,
          cancelText: writeScope.cancelText,
          content: (
            <ul className="list-disc pl-5 text-xs leading-5">
              {writeScope.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ),
          onOk: () => {
            void doSave().then(resolve)
          },
          onCancel: () => resolve(false),
        })
      })
    }
    return await doSave()
  }

  const saveAll = async () => {
    const pending = rows.filter((row) => row.status === 'generated' && row.llmCalled && row.draft.trim())
    if (!pending.length) {
      message.warning('没有可保存的生成结果')
      return
    }
    let saved = 0
    let skipped = 0
    const saveable: AssetRow[] = []
    for (const row of pending) {
      const verdict = describePromptPanelRowQuality(row, {
        serverQuality: row.qualityPayload,
        serverWarnings: row.warnings,
      })
      if (!canSavePromptToAsset(verdict, String(row.draft ?? ''))) {
        skipped += 1
        continue
      }
      // 恢复来的草稿：没改过且生成时就判不可用的，照样跳过（刷新不许把质量拦截绕过去）
      if (resolveRestoredDraftSaveGuard(row).blocked) {
        skipped += 1
        continue
      }
      saveable.push(row)
    }
    /**
     * **后端批量入口优先**（本轮后端新增，读接口清单确认已上线）。
     *
     * 它一次事务内做：逐资产质量拦截 + **跨资产查重** + 覆盖保护 + 合并写入；
     * 逐资产 PATCH 看不到"两个角色拿到同一段提示词"，还会部分成功。
     */
    if (batchSaveAvailable && projectId && saveable.length > 0) {
      const items = saveable.map((row) => ({
        assetType: row.type,
        assetId: row.id,
        // 合并写回：只改这一行那一个槽位，该资产其它槽位原样保留
        imagePrompts: { ...row.existingMap, [row.category]: String(row.draft ?? '').trim() } as Record<string, string>,
      }))
      const writeScope = buildBatchWriteScopeConfirmation(
        saveable.map((row) => ({
          assetType: row.type,
          assetName: row.name,
          existing: row.existingMap,
          incoming: { ...row.existingMap, [row.category]: String(row.draft ?? '').trim() },
        })),
      )
      const needsConfirm = writeScope.required && (writeScope.globalCount > 0 || writeScope.replacedSlots > 0)
      const doBatch = async (confirmedReplace: boolean) => {
        setSavingKey('__batch__')
        try {
          const body = buildAssetPromptBatchSaveBody({ items, confirmedReplace })
          await saveAssetImagePromptsBatch(projectId, body)
          const savedKeys = new Set(saveable.map((row) => row.key))
          /**
           * 保存成功 → 逐行清掉**本机草稿**（只清这次真的写进资产的那几行）。
           *
           * 与逐行保存同一口径：资产里已经有正式的那一份了，草稿再留着只会让人分不清。
           */
          saveable.forEach((row) => {
            clearAssetPromptDraft({
              projectId: projectId ?? '',
              chapterId,
              target: { assetType: row.type, assetId: row.id, slot: row.category },
            })
          })
          setRows((prev) =>
            prev.map((item) =>
              savedKeys.has(item.key)
                ? {
                    ...item,
                    status: 'saved',
                    existing: String(item.draft ?? '').trim(),
                    existingMap: { ...item.existingMap, [item.category]: String(item.draft ?? '').trim() },
                    restoredFromDraft: false,
                    restoredPrompt: '',
                    restoredSavable: true,
                    restoredQualityLabel: '',
                    restoredQualityReason: '',
                    restoredBasisSummary: '',
                    restoredAt: 0,
                  }
                : item,
            ),
          )
          onSaved?.()
          message.success(`已保存 ${saveable.length} 个资产的图片提示词（生图会立刻读它们）`)
        } catch (error) {
          // 模式 6：与单条保存同一口径 —— 后端原文不入主区，只出中文结论
          const failure = describePromptSaveFailure(error)
          const detail = failure.fix ? `${failure.message}（${failure.fix}）` : failure.message
          message.error(toUserFacingText(detail, '保存提示词失败：请稍后重试'))
        } finally {
          setSavingKey('')
        }
      }
      if (needsConfirm) {
        Modal.confirm({
          title: writeScope.title,
          width: 620,
          okText: writeScope.okText,
          cancelText: writeScope.cancelText,
          content: (
            <ul className="list-disc pl-5 text-xs leading-5">
              {writeScope.lines.split('\n').map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ),
          onOk: () => void doBatch(writeScope.replacedSlots > 0),
        })
        if (skipped) message.warning(`有 ${skipped} 个资产的提示词判定不可用，已跳过；按每行的原因补好后再保存。`)
        return
      }
      await doBatch(false)
      if (skipped) message.warning(`有 ${skipped} 个资产的提示词判定不可用，已跳过；按每行的原因补好后再保存。`)
      return
    }

    // 批量入口没上线：退回逐资产保存（今天的口径，逐项给出结果）
    const fallbackScope = buildBatchWriteScopeConfirmation(
      saveable.map((row) => ({
        assetType: row.type,
        assetName: row.name,
        existing: row.existingMap,
        incoming: { ...row.existingMap, [row.category]: String(row.draft ?? '').trim() },
      })),
    )
    const runFallback = async (skipConfirm: boolean) => {
      for (const row of saveable) {
        // eslint-disable-next-line no-await-in-loop
        if (await saveOne(row, { skipConfirm })) saved += 1
      }
      if (saved) message.success(`已保存 ${saved} 个资产的图片提示词（生图会立刻读它们）`)
      if (skipped) message.warning(`有 ${skipped} 个资产的提示词判定不可用，已跳过；按每行的原因补好后再保存。`)
    }
    if (fallbackScope.required) {
      // 一次性把整批的写入范围（含"哪几项会写回全局资产库"）与差异确认清楚
      Modal.confirm({
        title: fallbackScope.title,
        width: 620,
        okText: fallbackScope.okText,
        cancelText: fallbackScope.cancelText,
        content: (
          <ul className="list-disc pl-5 text-xs leading-5">
            {fallbackScope.lines.split('\n').map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ),
        onOk: () => void runFallback(true),
      })
      return
    }
    await runFallback(false)
  }

  /**
   * ⑤「最终提示词及差异」：把每行**本次真的会用**的那条提示词并排比。
   *
   * 单看一条提示词看不出"两个角色是不是拿到了同一段内容"，必须放在一起比
   * （相似度达到阈值就点名"高度重复"，这也是后端 409 跨资产查重的前置提示）。
   */
  const promptDifferences = useMemo(
    () =>
      summarizePromptDifferences(
        rows.map((row) => ({
          key: row.key,
          name: row.name,
          type: row.type,
          prompt: String(row.draft ?? '').trim() || String(row.existing ?? '').trim(),
        })),
      ),
    [rows],
  )
  const differenceLineByKey = useMemo(
    () => new Map(promptDifferences.map((row) => [row.key, row.diffLine])),
    [promptDifferences],
  )
  /** 这一行的 ④⑤ 证据（前端自己知道的）：喂给「生成依据」面板 */
  const basisExtrasFor = useCallback(
    (row: AssetRow): GenerationBasisExtras => ({
      requestStructure: row.requestStructure,
      finalPrompt: String(row.draft ?? '').trim() || String(row.existing ?? '').trim(),
      promptDifferences: differenceLineByKey.has(row.key) ? [differenceLineByKey.get(row.key) as string] : [],
      globalAsset: isGlobalAssetType(row.type),
    }),
    [differenceLineByKey],
  )

  const unsupportedAlert = buildUnsupportedSlotAlert(rows)
  const dryRunRows = rows.filter((row) => row.status === 'generated' && row.llmCalled === false)
  /** 「重试失败项」只认**真正的失败**：缺资料不是重试能解决的（要先去补资料），别混在一起 */
  const failedCount = rows.filter((row) => row.status === 'failed').length
  /** 本次因为库里没有资料而没能生成的项（逐项列出：为什么 + 怎么补；不阻塞其它项） */
  const unavailableRows = rows.filter((row) => row.status === 'unavailable')
  /**
   * 勾选了、但**后端槽位表里还没有这一项**所以本次不会生成的资产（未补槽位前的道具）。
   *
   * 不静默跳过：生成前把名字列出来并说明走哪条路（手工填写 + 保存）。
   */
  const checkedWithoutSlot = rows.filter(
    (row) => selectedKeys.includes(row.key) && row.supported && !row.generateSupported,
  )

  return (
    <div className="space-y-3">
      <div className="cs-group-title">
        <ThunderboltOutlined /> 大模型生成图片提示词
      </div>
      {/* 日常操作区只说用户语言；接口路径/编排实现等内部信息收进默认收起的「技术详情」 */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-600">
        根据项目风格、资产资料和本章剧情生成图片提示词。每项会调用一次文本模型，保存前可以检查和修改结果；
        保存的位置就是生图实际读取的那份资产提示词。
        <span className="text-slate-700">
          生成结果会立刻存成本机草稿（放在你自己的浏览器里）：页面被刷新或关掉也不会丢，但只有点「保存到资产」才会写进资产。
        </span>
      </div>
      {/* 本机草稿恢复：只读提示 —— 恢复不会自动保存、不会自动重新生成（那会再花一次钱） */}
      {draftNote ? (
        <Alert
          type="info"
          showIcon
          message="已恢复本机草稿（还没保存到资产）"
          description={<span className="text-xs">{draftNote}</span>}
        />
      ) : null}
      {/* 阶段 B ①：折叠壳统一到 workbench/TechnicalDetailCollapse.tsx（不再各页自建折叠区） */}
      <TechnicalDetailSection hint="这一屏怎么工作的（每项资产一次调用、一次计费）">
        <div className="space-y-1 text-[11px] leading-5 text-slate-500">
          <div>提示词由后台的大模型生成，每项资产一次调用、一次计费。</div>
          <div>保存后「生图计划预览」会把提示词来源标成「已保存提示词」—— 用它可当场验证保存内容真的被生图使用。</div>
          <div>失败即停、不自动重试；被质量拦截的提示词不会保存。</div>
        </div>
      </TechnicalDetailSection>

      <Space wrap size={12} align="center">
        <Checkbox checked={onlyMissing} onChange={(event) => setOnlyMissing(event.target.checked)}>
          只补缺失项（已有提示词与已定版资产不动）
        </Checkbox>
        <Checkbox checked={includeExisting} disabled={!onlyMissing} onChange={(event) => setIncludeExisting(event.target.checked)}>
          连已有提示词的资产一起生成（保存时会覆盖确认）
        </Checkbox>
        <Button
          size="small"
          onClick={() =>
            setSelectedKeys(rows.filter((row) => row.supported && row.generateSupported && (includeExisting || !row.existing)).map((row) => row.key))
          }
        >
          全选缺失
        </Button>
        <Button size="small" onClick={() => setSelectedKeys([])}>
          清空选择
        </Button>
        <Button size="small" icon={<ReloadOutlined />} onClick={() => void loadRows()}>
          重载资产清单
        </Button>
      </Space>

      <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <div className="text-[11px] text-slate-600">本次补充要求（会作为「你的补充/修改」一起交给提示词生成）</div>
        <Input.TextArea
          rows={2}
          value={userSupplement}
          onChange={(event) => setUserSupplement(event.target.value)}
          placeholder="例如：正面半身，纯白背景；道具要显示材质与比例"
        />
        <div className="text-[11px] text-gray-500">
          {describePromptRequestDelivery(requestSupport, Boolean(userSupplement.trim()))}
        </div>
      </div>

      {/*
        ⑤ 最终提示词及差异：验收要核对"四个资产的提示词确实不同"——
        单看一条看不出来，必须并排比；达到 90% 相似度就点名"高度重复"。
      */}
      <Collapse
        ghost
        size="small"
        items={[
          {
            key: 'prompt-diffs',
            label: (
              <span className="text-xs text-slate-600">
                {`本次真正会用的提示词与差异（${promptDifferences.filter((row) => row.prompt).length} 条有内容）`}
              </span>
            ),
            children: (
              <div className="space-y-2">
                {promptDifferences.every((row) => !row.prompt) ? (
                  <div className="text-[11px] text-gray-400">
                    还没有可对比的提示词：生成后这里会列出每个资产最终会用的那一条，以及与其它资产的相似度。
                  </div>
                ) : (
                  promptDifferences.map((row) => (
                    <div key={row.key} className="text-[11px] leading-5">
                      <span className="font-medium text-slate-700">{`${row.name}（${row.typeLabel}）`}</span>
                      <span className={row.duplicated ? 'text-red-500' : 'text-gray-500'}>{`：${row.diffLine}`}</span>
                      <div className="text-gray-400" style={{ wordBreak: 'break-all' }}>
                        {row.prompt || '（还没有提示词）'}
                      </div>
                    </div>
                  ))
                )}
                {promptDifferences.some((row) => row.duplicated) ? (
                  <Alert
                    type="error"
                    showIcon
                    message={<span className="text-xs">有资产之间的提示词高度重复（≥90%）：按它出图会把不同资产画成同一个</span>}
                    description={
                      <ul className="list-disc pl-5 text-[11px]">
                        {buildPromptDifferenceLines(promptDifferences.filter((row) => row.duplicated)).map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    }
                  />
                ) : null}
              </div>
            ),
          },
        ]}
      />

      {/* 用户语言：说清"点一次 = 花一次钱"，不写接口名、不写模型 ID、不写状态码 */}
      <div className="text-[11px] text-gray-500">
        每项会调用一次文本模型（按次计费，会花钱）；
        <span className="text-slate-700">任何一次失败都会立即停止且不自动重试</span>
        ，剩余项会标成「未开始」由你决定要不要继续。
      </div>

      {unsupportedAlert ? (
        <Alert
          type="info"
          showIcon
          message={unsupportedAlert.message}
          description={unsupportedAlert.description}
        />
      ) : null}

      {/*
        送进来、但连请求都发不出去的项（本章只有资料记录、还没建出资产）：
        如实说清"哪几项、为什么"，否则按钮上的数字与实际调用次数会对不上。
      */}
      {unrequestableAssets.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          message={describeUnrequestableAssets(unrequestableAssets)}
          description="这些项在本章只有资料记录：请在资产准备页确认写入这一项（建出资产）后再回来生成提示词。"
        />
      ) : null}

      {/*
        缺资料的项**逐项**列清楚（为什么不可用 + 怎么补），并点明"其它项不受影响"：
        真实事故里正是这一条缺失 —— 用户看到的是"整批都没拿到"，而实际上只是其中几项没资料。
      */}
      {unavailableRows.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          message={`有 ${unavailableRows.length} 项因为库里没有可用于出图的资料，本次没有生成（也没有计费）：${unavailableRows
            .map((row) => row.name)
            .join('、')}`}
          description={
            <ul className="list-disc pl-5 text-[11px]">
              {unavailableRows.map((row) => {
                const verdict = describePromptPanelRowQuality(row, {
                  serverQuality: row.qualityPayload,
                  serverWarnings: row.warnings,
                })
                return (
                  <li key={`unavailable-${row.key}`}>
                    {describeRowAvailability(row.name, verdict.reason, verdict.fixes[0])}
                  </li>
                )
              })}
              <li>其它项不受影响：它们照常生成，可以逐项检查、保存。</li>
            </ul>
          }
        />
      ) : null}

      <div className="text-[11px] text-gray-500">
        {`已选 ${plannedRows.length} 个资产待生成`}
        {onlyMissing && !includeExisting ? '（已有提示词的会被跳过）' : ''}
        {checkedWithoutSlot.length > 0
          ? `；另有 ${checkedWithoutSlot.length} 项这一类暂时不能一键生成，可以手工填写并保存`
          : ''}
      </div>

      <Space wrap size={8}>
        <Button
          type="primary"
          size="small"
          loading={running}
          disabled={!plannedRows.length}
          onClick={() => {
            // 大批量先二次确认：真实大模型调用按资产数计费，误点代价是钱
            if (plannedRows.length > CONFIRM_THRESHOLD) {
              Modal.confirm({
                title: `确认对 ${plannedRows.length} 个资产调用大模型生成提示词？`,
                content: '每个资产一次大模型调用（会花钱）。演练模式下不会真的调用，也不会产生费用。',
                okText: '开始生成',
                cancelText: '取消',
                onOk: () => void runBatch(plannedRows),
              })
              return
            }
            void runBatch(plannedRows)
          }}
        >
          {`生成图片提示词（${plannedRows.length} 个资产）`}
        </Button>
        <Button
          size="small"
          danger
          disabled={!running}
          onClick={() => {
            stopRef.current = true
            message.info('已请求停止：当前这个资产会跑完，后续不再开始')
          }}
        >
          停止后续
        </Button>
        <Button size="small" disabled={!failedCount} onClick={() => void runBatch(rows.filter((row) => row.status === 'failed'))}>
          {`重试失败项（${failedCount}）`}
        </Button>
        <Button size="small" disabled={!rows.some((row) => row.status === 'generated')} onClick={() => void saveAll()}>
          保存全部已生成
        </Button>
      </Space>

      {dryRunRows.length ? (
        <Alert
          type="warning"
          showIcon
          message={`有 ${dryRunRows.length} 个资产拿到的是演练结果（没有真的调用大模型），不能保存`}
          description="演练模式下不会真的调用大模型、也不花钱；要拿到可保存的结果需要先确认真实调用。"
        />
      ) : null}

      <Table<AssetRow>
        size="small"
        rowKey="key"
        pagination={false}
        dataSource={rows}
        rowSelection={{
          selectedRowKeys: selectedKeys,
          onChange: (keys) => setSelectedKeys(keys.map((key) => String(key))),
          getCheckboxProps: (row) => ({ disabled: !row.supported }),
        }}
        columns={[
          {
            title: '资产',
            dataIndex: 'name',
            width: 190,
            render: (_: unknown, row) => (
              <span className="flex flex-wrap items-center gap-1">
                <span>{describePromptRowAsset(row)}</span>
                {isGlobalAssetType(row.type) ? (
                  <Tooltip title={describeAssetScopeCopy(row.type).statement}>
                    <Tag color="geekblue" bordered={false} className="mr-0">
                      所有项目共用
                    </Tag>
                  </Tooltip>
                ) : (
                  <Tooltip title={describeAssetScopeCopy(row.type).statement}>
                    <Tag bordered={false} className="mr-0 text-gray-400">
                      仅本项目
                    </Tag>
                  </Tooltip>
                )}
              </span>
            ),
          },
          { title: '提示词位置', dataIndex: 'category', width: 130, render: (_: unknown, row) => describePromptRowSlot(row) },
          { title: '已有提示词', dataIndex: 'existing', width: 120, render: (_: unknown, row) => describePromptRowExisting(row) },
          {
            title: '质量 / 生成结果（可编辑）',
            dataIndex: 'draft',
            render: (value: string, row) => {
              const unsupportedState = describePromptRowState(row)
              if (unsupportedState) return <span className="text-[11px] text-gray-400">{unsupportedState}</span>
              /**
               * 标签必须把「本机草稿（未保存）」和绿色「已保存」分开：两者内容可能一模一样，
               * 混在一起用户会以为资产里已经有了（而实际上生图读的还是旧的那一份）。
               */
              const draftOnly = row.restoredFromDraft && row.status === 'generated'
              const label =
                row.status === 'saved'
                  ? '已保存'
                  : draftOnly
                    ? '草稿（未保存）'
                    : row.status === 'failed'
                      ? '失败'
                      : row.status === 'unavailable'
                        ? '缺资料（本次未生成）'
                        : row.status === 'stopped'
                          ? '未开始（已停止）'
                          : row.status === 'running'
                            ? '生成中'
                            : row.status === 'generated'
                              ? '已生成'
                              : '待生成'
              const color =
                row.status === 'saved'
                  ? 'green'
                  : draftOnly
                    ? 'blue'
                    : row.status === 'failed'
                      ? 'red'
                      : row.status === 'unavailable'
                        ? 'orange'
                        : row.status === 'stopped'
                          ? 'default'
                          : row.status === 'running'
                            ? 'geekblue'
                            : 'gold'
              // 这一行**实际会用**的提示词（本次草稿优先，其次已保存的那条）：质量按它判
              const verdict = describePromptPanelRowQuality(row, {
                serverQuality: row.qualityPayload,
                serverWarnings: row.warnings,
              })
              /**
               * 恢复来的草稿：正文没改过、且生成时就判不可用的，**仍然不许保存**（与生成当时同一口径）。
               * 改过正文之后这条判定自动失效 —— 见 `resolveRestoredDraftSaveGuard`。
               */
              const restoredGuard = resolveRestoredDraftSaveGuard(row)
              const generateHint = describePromptRowGenerateHint(row)
              return (
                <div className="space-y-1">
                  <Space size={4} wrap>
                    <Tag color={color}>{label}</Tag>
                    <PromptQualityTag verdict={verdict} />
                    {row.error ? <span className="text-[11px] text-amber-600">{row.error}</span> : null}
                  </Space>
                  {generateHint ? <div className="text-[11px] text-gray-500">{generateHint}</div> : null}
                  {/* 恢复来的草稿：说清"这是本机草稿、什么时候生成的"，不冒充已保存 */}
                  {row.restoredFromDraft ? (
                    <div className="text-[11px] text-gray-500">{buildRestoredDraftLine(row)}</div>
                  ) : null}
                  <Input.TextArea
                    rows={3}
                    value={value}
                    disabled={row.status === 'failed'}
                    placeholder="点上面的「生成图片提示词」后在这里检查/修改"
                    onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                      setRows((prev) => prev.map((item) => (item.key === row.key ? { ...item, draft: event.target.value } : item)))
                    }
                  />
                  {/* 质量不可用时给真实原因与怎么修（与批量出图的拦截用的是同一份文案）；
                      "缺资料"的行没有正文，但同样要把原因与怎么补显示在**这一行**上 */}
                  {row.draft.trim() || row.status === 'unavailable' ? (
                    <PromptQualityAlert verdict={verdict} />
                  ) : null}
                  <Space size={8} wrap>
                    <Button
                      size="small"
                      type="primary"
                      loading={savingKey === row.key}
                      disabled={
                        row.status !== 'generated' ||
                        !row.llmCalled ||
                        !canSavePromptToAsset(verdict, row.draft) ||
                        restoredGuard.blocked
                      }
                      onClick={() => void saveOne(row)}
                    >
                      保存到资产
                    </Button>
                    {row.status === 'generated' && !row.llmCalled ? (
                      <span className="text-[11px] text-amber-600">演练结果：未调用大模型，不可保存</span>
                    ) : null}
                    {row.status === 'generated' && row.llmCalled && !canSavePromptToAsset(verdict, row.draft) ? (
                      <span className="text-[11px] text-red-500">提示词不可用：先按上面的原因改好再保存</span>
                    ) : null}
                    {/* 恢复来的草稿：生成当时就不许保存的那种（改好正文后可保存） */}
                    {restoredGuard.blocked && canSavePromptToAsset(verdict, row.draft) ? (
                      <span className="text-[11px] text-red-500">
                        {`恢复的草稿在生成时就判为不可用：${toUserFacingText(
                          restoredGuard.reason,
                          '正文不符合要求',
                        )}（改好正文后即可保存）`}
                      </span>
                    ) : null}
                    {row.latencyMs ? <span className="text-[11px] text-gray-400">{`${row.latencyMs} ms`}</span> : null}
                  </Space>
                  {row.warnings?.length ? (
                    <ul className="list-disc pl-5 text-[11px] text-amber-600">
                      {row.warnings.slice(0, 2).map((warning, index) => (
                        <li key={`${row.key}-warn-${index}`}>{warning}</li>
                      ))}
                    </ul>
                  ) : null}
                  {/* 生成依据（默认收起）：这一行本次实际用到了什么 */}
                  <AssetGenerationBasisPanel
                    payload={row.basisPayload}
                    extras={basisExtrasFor(row)}
                    caption={`针对「${row.name}」`}
                  />
                </div>
              )
            },
          },
        ]}
      />
    </div>
  )
}

export default AssetImagePromptLlmPanel
