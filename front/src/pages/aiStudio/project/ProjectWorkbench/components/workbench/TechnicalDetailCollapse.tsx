/**
 * 工作台的「技术详情」：**默认收起**，而且是内部信息**唯一**允许出现的地方。
 *
 * 用户点名：候选多少条、聚合多少组、检查中、槽位、项目内资产 / 全局资产、
 * 提示词质量未知、最终提示词及差异、生成依据的内部计数与字段名、每项调用哪个接口、
 * 模型 / 供应商 / 任务号 / 内部状态 / `file_id` —— 全部只在这里出现。
 *
 * 主界面组件源码的禁词测试会把这一条钉住：除本文件外，工作台其它组件里
 * 出现上述任何一个词都会直接失败（见 `workbenchState.test.ts`）。
 * 所以本文件是全目录唯一豁免文件，改动时**不要**把这里的内部字段名搬出去。
 */

import type { ReactNode } from 'react'
import { Button, Collapse, Descriptions, Space, Tag, Typography } from 'antd'

import {
  assembleTechnicalView,
  type TechnicalView,
  type TechnicalViewInput,
} from './technicalView.ts'

export type TechnicalDetailCollapseProps = {
  input: TechnicalViewInput
  /** 由工作台注入的既有「生成配置原始状态」条（模型 / 演练开关原文） */
  gateBanner?: ReactNode
  /** 保留入口：改版前的提取确认页（写入前逐条人工确认） */
  onOpenLegacyExtractConfirm?: () => void
}

/* --------------------------------------------------------------- 统一的折叠壳 */

/**
 * 全仓**唯一**的「技术详情」折叠壳（阶段 B ①：三处自建折叠区合并到这里）。
 *
 * 为什么要有这个壳（审计 §9 第 2 项）：改版前一共有 3 处自建折叠区
 * （`ProjectDevInfo.tsx:179`、`AssetImagePromptLlmPanel.tsx`、
 * `AssetProductionArea.tsx`），而源码级禁词测试**只能给一个文件开口子**——
 * 多套实现等于「技术详情」的豁免范围失控，谁都能自己写一个折叠块把内部字段放进去。
 * 合并后：**折叠壳与本文件里的技术层标签都只在本文件出现**，
 * 调用方只传数据，不传任何内部字段名。
 *
 * 口径（审计 §2.1 判定铁律）：折叠区的标题在**收起状态下也可见**，
 * 所以标题文案本身必须干净 —— 因此这里把标题写死成
 * 「技术详情（默认收起）」，不开放 `title` 参数，从结构上杜绝
 * 「某个调用方自己在标题里写内部字段名」（旧实现里 `提示词来源`、
 * `本次请求带上了哪些字段` 这类标题就是各页自己拼的）。
 */
export type TechnicalDetailSectionProps = {
  children: ReactNode
  /**
   * 收起态可见的补充说明。
   *
   * ⚠️ 这里的内容**用户不展开也看得见**，所以只允许写业务说法，
   * 不许写字段名 / 模型名 / 供应商名 / 任务号。
   */
  hint?: ReactNode
  /** 便于测试与排障定位是哪一块（不是用户可见文案） */
  testId?: string
  /** 外层追加 class（默认样式来自本组件） */
  className?: string
}

export function TechnicalDetailSection(props: TechnicalDetailSectionProps) {
  const { children, hint, testId = 'technical-detail', className } = props
  return (
    <details
      className={`rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 ${className ?? ''}`.trim()}
      data-testid={testId}
    >
      <summary className="cursor-pointer text-[11px] text-gray-500">技术详情（默认收起）</summary>
      <div className="mt-2 space-y-3">
        {hint ? <div className="text-[11px] leading-5 text-slate-500">{hint}</div> : null}
        {children}
      </div>
    </details>
  )
}

/* ------------------------------------- 技术层的可复用块（内部字段名只在本文件） */

export type TechnicalModelRow = {
  /** 出口的业务名（例如「图片（出图）」） */
  outletLabel: string
  /** 原始模型名（技术层允许） */
  modelName: string
  /** 模型内部 id（技术层允许） */
  modelId: string
  /** 生成服务的原始名字（技术层允许） */
  providerName: string
  /** 生成服务的原始状态值（技术层允许） */
  providerStatus: string
  /** 页面状态条给出的原始状态值（技术层允许） */
  rawState: string
  /** 原始状态值附带的原因（技术层允许） */
  rawReason: string
}

/**
 * 技术详情：模型、生成服务与原始状态值。
 *
 * 「模型与供应商」「原始状态值」这些字样**只能出现在本文件**；
 * 调用方（例如 `ProjectDevInfo.tsx`）只负责把数据取出来传进来。
 */
export function TechnicalModelProviderBlock(props: { rows: TechnicalModelRow[]; loadError?: string }) {
  const { rows, loadError } = props
  return (
    <div>
      <div className="mb-1 font-medium text-gray-500">模型与供应商（内部标识）</div>
      {loadError ? (
        <div className="text-amber-600">{loadError}（读不到时不影响上面的步骤判定与操作）</div>
      ) : (
        <div className="space-y-0.5">
          {rows.map((row) => (
            <div key={row.outletLabel} className="flex flex-wrap items-center gap-1">
              <span className="text-gray-500">{row.outletLabel}：</span>
              <code>{row.modelName}</code>
              {row.modelId ? <span className="text-gray-400">（id={row.modelId}）</span> : null}
              <span className="text-gray-500">供应商：</span>
              <code>{row.providerName}</code>
              {row.providerStatus ? (
                <Tag
                  bordered={false}
                  color={row.providerStatus.toLowerCase() === 'disabled' ? 'red' : 'green'}
                  className="mr-0"
                >
                  {row.providerStatus}
                </Tag>
              ) : null}
              <span className="text-gray-500">原始状态值：</span>
              <code>{row.rawState}</code>
              {row.rawReason ? <span className="text-gray-400">（{row.rawReason}）</span> : null}
            </div>
          ))}
        </div>
      )}
      <div className="mt-1 text-gray-400">出于安全，这里不取、不存、不显示任何密钥或令牌。</div>
    </div>
  )
}

/** 技术详情：任务号 / 文件编号（审计 §6.1 唯一允许出现的第一种形态）。 */
export function TechnicalIdBlock(props: { taskIds: readonly string[]; fileIds: readonly string[] }) {
  const { taskIds, fileIds } = props
  return (
    <div>
      <div className="mb-1 font-medium text-gray-500">任务编号与文件编号</div>
      <div>
        <span className="text-gray-500">任务编号：</span>
        {taskIds.length > 0 ? <code>{taskIds.join('、')}</code> : <span className="text-gray-400">本页暂无</span>}
      </div>
      <div>
        <span className="text-gray-500">文件编号：</span>
        {fileIds.length > 0 ? <code>{fileIds.join('、')}</code> : <span className="text-gray-400">本页暂无</span>}
      </div>
    </div>
  )
}

/* ------------------------------------------------- 「信号来源接口」与步骤判定 */

/**
 * 各步骤信号的**来源接口与字段口径**。
 *
 * 审计 §4.2（模式 2 / 模式 4）点名 `ProjectDevInfo.tsx:10-14,294-298`：
 * 这张表本身内容合规（属于技术详情层），但它是**第二套技术详情实现**，
 * 而源码级禁词测试只能给**一个文件**开口子 —— 多一套实现等于豁免范围失控。
 *
 * 所以表**整体搬进本文件**（本文件是全目录唯一允许出现内部字段名 / 接口路径的地方），
 * 调用方只传动态数据（哪些信号没取到），不传任何字段名。
 */
const SIGNAL_ENDPOINTS: ReadonlyArray<readonly [string, string]> = [
  ['章节与原文', 'GET /api/v1/studio/chapters?project_id=…（字段 shot_count / raw_text）'],
  ['镜头与视频提示词', 'GET /api/v1/studio/prompt-delivery/{project_id}?scope=episodes（字段 shot_id / chapter_id / video_prompt）'],
  ['项目角色', 'GET /api/v1/studio/entities/character?page_size=100（字段 project_id / thumbnail / image_prompts）'],
  ['项目场景/道具/服装', 'GET /api/v1/studio/shot-links/{scene|prop|costume}?project_id=…（字段 shot_id / chapter_id / thumbnail）'],
  ['角色镜头绑定', 'GET /api/v1/studio/shots/{shot_id}/preparation-state（字段 assets_overview.summary.linked_count，按镜头抽样）'],
]

export function TechnicalSignalSourceBlock(props: { failedSources: readonly string[] }) {
  const { failedSources } = props
  return (
    <div>
      <div className="mb-1 font-medium text-gray-500">信号来源接口</div>
      <ul className="m-0 list-disc space-y-0.5 pl-4">
        {SIGNAL_ENDPOINTS.map(([name, endpoint]) => (
          <li key={name}>
            <span className="text-gray-500">{name}：</span>
            <code>{endpoint}</code>
          </li>
        ))}
      </ul>
      {failedSources.length > 0 ? (
        <div className="mt-1 text-amber-600">
          未取到的信号（已按 0/未知降级，判定会停在更靠前的步骤）：
          {failedSources.join('、')}
        </div>
      ) : (
        <div className="mt-1 text-emerald-600">全部信号抓取成功。</div>
      )}
    </div>
  )
}

/**
 * 步骤判定的优先级表。
 *
 * 里面写的是后端 6 个步骤 key（`script` / `extract_assets` / …），属于内部枚举原值，
 * 与上一条同理由，**只允许出现在本文件**。
 */
const STEP_PRECEDENCE = [
  '1. 没有章节或没有任何章节原文            → script（剧本）',
  '2. 有章节原文但当前集分镜数为 0           → script（剧本）',
  '3. 已有分镜但项目资产（角色/场景/道具）为空 → extract_assets（提取资产）',
  '4. 有资产但没有参考图片/图片提示词        → image_prep（图片准备）',
  '5. 有图片但当前集镜头都没有 video_prompt  → video_prompt（视频提示词）',
  '6. 有提示词但当前集镜头都没有关联资产      → binding（关联绑定）',
  '7. 以上都满足                            → generate_deliver（生成与交付）',
].join('\n')

export function TechnicalStepPrecedenceBlock(props: { modelInput: unknown }) {
  const { modelInput } = props
  return (
    <>
      <div>
        <div className="mb-1 font-medium text-gray-500">步骤判定的原始入参（计数）</div>
        <pre className="m-0 overflow-x-auto rounded bg-gray-50 p-2 text-[11px] leading-5">
          {JSON.stringify(modelInput, null, 2)}
        </pre>
      </div>
      <div>
        <div className="mb-1 font-medium text-gray-500">步骤判定优先级（内部 7 条判定 → 用户可见 5 步）</div>
        <pre className="m-0 overflow-x-auto rounded bg-gray-50 p-2 text-[11px] leading-5">{STEP_PRECEDENCE}</pre>
      </div>
    </>
  )
}

function renderLines(lines: string[]): ReactNode {
  if (lines.length === 0) return <span className="text-[11px] text-gray-400">（后端没有给出内容）</span>
  return (
    <ul className="list-disc space-y-0.5 pl-5 text-[11px] leading-5 text-gray-500">
      {lines.map((line, index) => (
        <li key={`${index}-${line}`}>{line}</li>
      ))}
    </ul>
  )
}

export function TechnicalDetailCollapse(props: TechnicalDetailCollapseProps) {
  const { input, gateBanner, onOpenLegacyExtractConfirm } = props
  const view: TechnicalView = assembleTechnicalView(input)
  return (
    <TechnicalDetailSection
      hint={
        /* 默认收起：内部维度清单放在这里，不放在收起时可见的标题上 */
        <>接口名、候选条数、聚合组、匹配诊断、字段名、模型 / 供应商 / 任务号 / 文件编号</>
      }
    >
      <div className="space-y-3">
        {gateBanner}

        <Descriptions size="small" column={1} bordered>
          {/* 中文显示标签统一在本文件拼：`technicalView.ts` 只给结构（路径 / 是否正式数据 / 裸槽位码），
              不拼任何内部标签 —— 否则「技术详情」的实现会散落成多处，单点豁免就守不住了（审计 §9 第 2 项）。 */}
          <Descriptions.Item label="接口名">
            {view.chapterId ? `${view.endpointPath}（本章：${view.chapterId}）` : view.endpointPath}
          </Descriptions.Item>
          <Descriptions.Item label="数据来源">
            {view.fromContract ? '本章资产资料（正式数据）' : '本章资产资料（先用已有数据展示）'}
          </Descriptions.Item>
          <Descriptions.Item label="读取失败原因">
            {view.loadError || '（没有失败）'}
          </Descriptions.Item>
          <Descriptions.Item label="候选条数 / 聚合组">
            {`${view.candidatesTotal} 条 / ${view.candidateGroups} 组`}
          </Descriptions.Item>
          <Descriptions.Item label="每类候选的关联状态">
            {view.candidateStatusLines.length > 0 ? renderLines(view.candidateStatusLines) : '（后端没有给出内容）'}
          </Descriptions.Item>
          <Descriptions.Item label="匹配诊断">
            {view.matchDiagnostics.length > 0 ? renderLines(view.matchDiagnostics) : '（后端没有给出内容）'}
          </Descriptions.Item>
          <Descriptions.Item label="后端备注">
            {view.notes.length > 0 ? renderLines(view.notes) : '（后端没有给出内容）'}
          </Descriptions.Item>
          <Descriptions.Item label="本次用到的模型 / 供应商">
            {view.modelLines.length > 0 ? renderLines(view.modelLines) : '见上面的生成配置原始状态'}
          </Descriptions.Item>
          <Descriptions.Item label="每项资产的槽位与字段名">
            {renderLines(view.slotValues.map((slot) => `槽位 ${slot}`))}
          </Descriptions.Item>
          <Descriptions.Item label="任务号 / 文件编号">
            每一项的原始编号在结果卡片「查看详情」里；这里不重复列，避免一屏几百个编号。
          </Descriptions.Item>
        </Descriptions>

        <Collapse
          ghost
          size="small"
          items={[
            {
              key: 'per-asset',
              label: <span className="text-[11px] text-gray-500">{`每项资产本次用的槽位与提示词质量判定（${view.assetLines.length} 项）`}</span>,
              children: (
                <div className="space-y-1">
                  {view.assetLines.length > 0 ? (
                    view.assetLines.map((row) => (
                      <div key={row.key} className="text-[11px] leading-5">
                        <span className="font-medium text-slate-700">{row.name}</span>
                        <span className="text-gray-500">{`（${row.assetType}）`}</span>
                        <div className="text-gray-500">{`槽位 ${row.slot || '（未给出）'} · 质量判定 ${row.qualityVerdict || '（未给出）'} · 资料来自 ${row.profileSource || '（未给出）'}`}</div>
                        <div className="text-gray-400">{`字段名：${row.fieldNames.length > 0 ? row.fieldNames.join(', ') : '（无）'}`}</div>
                      </div>
                    ))
                  ) : (
                    <span className="text-[11px] text-gray-400">（后端没有给出内容）</span>
                  )}
                </div>
              ),
            },
          ]}
        />

        <Space size={6} wrap>
          <Tag bordered={false}>{`asset_id / file_id / service_task_id 一律只在技术详情与结果详情里出现`}</Tag>
          {onOpenLegacyExtractConfirm ? (
            <Button size="small" onClick={onOpenLegacyExtractConfirm} data-testid="open-legacy-extract">
              打开改版前的提取确认页（写入前逐条人工确认）
            </Button>
          ) : null}
        </Space>

        <Typography.Text type="secondary" className="text-[11px]">
          这一块默认收起：日常操作（选资产 → 生成 → 看进度 → 采纳 → 定版）不需要看它。
        </Typography.Text>
      </div>
    </TechnicalDetailSection>
  )
}

export default TechnicalDetailCollapse
