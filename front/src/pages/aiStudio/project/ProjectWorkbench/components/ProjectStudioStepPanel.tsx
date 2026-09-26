import { useEffect, useState } from 'react'
import { Alert, Button, Card, Empty, Space, Table, Tag, Tooltip, Typography, message } from 'antd'
import type { TableColumnsType } from 'antd'
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  ReloadOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons'
import {
  previewPromptDelivery,
  type PromptDeliveryPreview,
  type PromptDeliveryRow,
} from '../../../../../services/llmPipelineApi'
import {
  getPrevProjectStepKey,
  getProjectStepIndex,
  getProjectStepMeta,
  PROJECT_STEPS,
  type ProjectStepKey,
} from '../projectSteps'
import { buildUserFacingMessage, showUserError, toUserFacingText } from '../../../components/userFacingMessage'
import { TechnicalDetailSection } from './workbench/TechnicalDetailCollapse'

type ProjectStudioStepPanelProps = {
  step: ProjectStepKey
  /** 当前集显示名（没有则为 null） */
  chapterLabel: string | null
  hasChapter: boolean
  /** 第 6 步内联交付预览需要；缺省时只显示跳转入口。 */
  projectId?: string | null
  chapterId?: string | null
  onEnterStudio: (step: ProjectStepKey) => void
  onGoStep: (step: ProjectStepKey) => void
}

const SOURCE_LABELS: Record<string, string> = {
  llm: '大模型生成',
  /* 「巨日禄」是本项目导入剧本的外部工具名，全站统一用它（`EpisodeVideoPromptBoard` 的来源标签、
     `PromptFlowPage` 的页签、工作台的抓取面板都叫「巨日禄导入」），审计 §4.5 给的也是这个名字
     （只要求把枚举原名 `jurilu` 换掉，不是把工具名换掉）。**不要在这里另起别名。** */
  jurilu: '巨日禄导入',
  manual: '人工编辑',
  skill: '一键技能生成',
  manual_workspace: '工作室手工维护（历史值）',
  internal: '中控台内部导入（历史值）',
  shot_description: '由镜头描述生成（历史值）',
  '': '来源未记录',
}

/**
 * 来源码 → 主区中文。
 *
 * ⚠️ 审计 §4.2 模式 3 点名：原实现是 `SOURCE_LABELS[key] ?? (key || '未设定来源')`
 * —— **未登记时回显后端原值**（`external_import` 之类就会这样上屏，
 * 运行时实测「可交付来源：… / external_import / …」就是这么来的）。
 * 未登记一律给中文兜底，**绝不回显原值**。
 */
function sourceLabel(source: string): string {
  const key = (source ?? '').trim()
  return SOURCE_LABELS[key] ?? '来源未记录'
}

/**
 * 交付预览的后端补充说明。
 *
 * 审计 §4.2 模式 2 点名：`delivery.note` 是**后端动态原文**，原先是
 * `{delivery.note}` 直渲在主区，运行时实测上屏的是
 * 「imported_size / imported_resolution / recommended_duration 元信息在 Jellyfish 侧
 * 没有等价列，因此未提供」—— 字段名 + 「元信息 / 等价列」全是开发说法。
 *
 * ## 为什么不是「把 note 过一遍管道再放主区」（2026-09-26 复核修正）
 *
 * 上一版做法是 `buildUserFacingMessage(note).title` 上主区，指望管道把它改成中文结论。
 * **运行时复测证明这个指望不成立**：`note` 是一段**多句后端长文本**，
 * 管道只对「已知的那一句」做了整句改写，其余部分**原样留下**，于是主区实测上屏的是
 * 「本端点只做「仅提示词」出口：导出**来源在白名单内且有正文**的提示词（大模型生成 /
 * 巨日禄导入 / …）」—— 里面同时命中模式 2（`端点`/`白名单`）、渲染缺陷（字面 `**` 星号）,
 * 而且和同一屏的来源列口径打架（来源列已显示中文，「巨日禄导入」又出现一次）。
 *
 * 口径修正（对齐 §7.1-6 的第三层收敛原则）：**主区一律不渲后端长文本**，
 * 只出「本出口固定行为」的中文结论（下面这句是产品固定说法，不随后端措辞漂移）；
 * 后端原文的**唯一落点**是默认收起的「技术详情」。
 *
 * ⚠️ 同类写法（把后端长文本过一遍管道就当主区文案）在别处也可能踩同一个坑；
 * 判断依据是「主区文案必须是产品自己写的句子，而不是后端句子的改写结果」。
 */
const DELIVERY_NOTE_MAIN = '导出只带「有正文」的提示词：模板拼装只是预览，不算来源，也不进交付；默认会带出这些提示词绑定的素材。'

function DeliveryNoteBlock({ note }: { note: string }) {
  const message = buildUserFacingMessage(note, '本次交付有一条补充说明')
  return (
    <div className="space-y-1">
      <Typography.Text type="secondary" className="text-[11px]">
        {DELIVERY_NOTE_MAIN}
      </Typography.Text>
      {message.detail ? (
        <TechnicalDetailSection
          testId="delivery-note-technical"
          hint="这里放的是交付预览返回的原始说明（排查问题时才需要看）。"
        >
          <Typography.Text type="secondary" className="text-[11px]">
            {message.detail}
          </Typography.Text>
        </TechnicalDetailSection>
      ) : null}
    </div>
  )
}

function bindingCount(row: PromptDeliveryRow): number {
  const assets = Object.values(row.bound_assets ?? {}).reduce((sum, list) => sum + (list?.length ?? 0), 0)
  return assets + (row.bound_files?.length ?? 0)
}

/**
 * 第 4-6 步的入口面板。
 *
 * 这三步的实际 UI 仍在章节工作室里（本轮不重建），所以这里只做三件事：
 * 1. 说明这一步在做什么、要在哪完成；
 * 2. 带上 `?studio=<step>` 跳进工作室，供下一轮把工作室拆成三步；
 * 3. 没有可用集时给出明确空状态（先回第 1 步创建/选择一集）。
 */
export function ProjectStudioStepPanel({
  step,
  chapterLabel,
  hasChapter,
  projectId,
  chapterId,
  onEnterStudio,
  onGoStep,
}: ProjectStudioStepPanelProps) {
  const meta = getProjectStepMeta(step)
  const index = getProjectStepIndex(step)
  const prevStep = getPrevProjectStepKey(step)

  // 第 4-6 步都内联一块**只读**进度面板（同一份交付清单数据，不写库、不触网、不花钱）：
  // - 第 4 步：逐镜头的视频提示词来源/正文状态 —— 用户能看出还差哪些镜头；
  // - 第 5 步：逐镜头的绑定资产与绑定素材（含声音）—— 同样是"还差哪些镜头"；
  // - 第 6 步：完整交付预览（可导出条数 + 交付文本）。
  // 理由：六步里后三步不该只是"跳去工作室"的按钮，否则用户在工作台看不到任何进度。
  const [delivery, setDelivery] = useState<PromptDeliveryPreview | null>(null)
  const [deliveryLoading, setDeliveryLoading] = useState(false)
  const [deliveryError, setDeliveryError] = useState('')
  const showDelivery = step === 'generate_deliver' && Boolean(projectId) && hasChapter
  const showProgress = (step === 'video_prompt' || step === 'binding') && Boolean(projectId) && hasChapter
  const shouldLoadDelivery = showDelivery || showProgress

  const loadDelivery = async () => {
    if (!projectId) return
    setDeliveryLoading(true)
    setDeliveryError('')
    try {
      setDelivery(await previewPromptDelivery(projectId, chapterId ?? null, 'episode'))
    } catch (e) {
      /**
       * 审计 §4.2 模式 6：`error.message` 是后端原文，原先直渲在 Alert 的 `description` 上。
       * 入 state 前先过统一管道（掩码 → 去术语 → 业务化 → 中文兜底），
       * 主区只留中文结论；原文进默认收起的「技术详情」。
       */
      const raw = (e as Error)?.message || ''
      void showUserError(raw, '交付预览加载失败：请稍后重试', '交付预览')
      setDeliveryError(toUserFacingText(raw, '交付预览加载失败：请稍后重试'))
    } finally {
      setDeliveryLoading(false)
    }
  }

  useEffect(() => {
    if (!shouldLoadDelivery) return
    void loadDelivery()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldLoadDelivery, projectId, chapterId])

  const deliveryRows = delivery?.rows ?? []
  const withPromptCount = deliveryRows.filter((row) => (row.video_prompt ?? '').trim() !== '').length
  const withSourceCount = deliveryRows.filter((row) => (row.video_prompt_source ?? '').trim() !== '').length
  const withBindingCount = deliveryRows.filter((row) => bindingCount(row) > 0).length
  const withAudioCount = deliveryRows.filter((row) =>
    (row.bound_files ?? []).some((file) => String(file?.slot ?? '') === 'audio'),
  ).length

  /** 缺口优先：没有来源 / 没有绑定的镜头排前面，用户一眼看到还差什么。 */
  const promptSortedRows = [...deliveryRows].sort((a, b) => {
    const score = (row: PromptDeliveryRow) =>
      ((row.video_prompt_source ?? '').trim() ? 0 : 2) + (row.exportable ? 0 : 1)
    return score(b) - score(a)
  })
  const bindingSortedRows = [...deliveryRows].sort((a, b) => bindingCount(a) - bindingCount(b))

  const progressColumns: TableColumnsType<PromptDeliveryRow> =
    step === 'binding'
      ? [
          { title: '镜头', dataIndex: 'shot_code', width: 76 },
          { title: '标题', dataIndex: 'shot_title', ellipsis: true },
          {
            title: '绑定资产',
            key: 'assets',
            width: 170,
            render: (_: unknown, row) => {
              const names = Object.values(row.bound_assets ?? {}).flat().filter(Boolean)
              if (names.length === 0) return <Tag color="gold" bordered={false}>未绑定</Tag>
              return (
                <Tooltip title={names.join(' / ')}>
                  <Tag color="blue" bordered={false}>{`${names.length} 个：${names.slice(0, 2).join('、')}${names.length > 2 ? '…' : ''}`}</Tag>
                </Tooltip>
              )
            },
          },
          {
            title: '实际文件',
            key: 'files',
            width: 120,
            render: (_: unknown, row) => {
              const files = (row.bound_files ?? []).filter((f) => String(f?.slot ?? '') !== 'audio')
              return files.length > 0 ? (
                <Tag color="geekblue" bordered={false}>{`${files.length} 个`}</Tag>
              ) : (
                <span className="text-slate-400 text-xs">无</span>
              )
            },
          },
          {
            title: '声音',
            key: 'audio',
            width: 92,
            render: (_: unknown, row) =>
              (row.bound_files ?? []).some((f) => String(f?.slot ?? '') === 'audio') ? (
                <Tag color="cyan" bordered={false}>已绑定</Tag>
              ) : (
                <span className="text-slate-400 text-xs">未绑定</span>
              ),
          },
        ]
      : [
          { title: '镜头', dataIndex: 'shot_code', width: 76 },
          { title: '标题', dataIndex: 'shot_title', ellipsis: true },
          {
            title: '提示词来源',
            dataIndex: 'video_prompt_source',
            width: 140,
            render: (value: string) => (
              <Tag color={(value ?? '').trim() ? 'blue' : 'gold'} bordered={false}>
                {sourceLabel(value)}
              </Tag>
            ),
          },
          {
            title: '正文',
            key: 'prompt',
            width: 92,
            render: (_: unknown, row) =>
              (row.video_prompt ?? '').trim() ? (
                <Tooltip title={<div className="max-w-[380px] whitespace-pre-wrap">{row.video_prompt}</div>}>
                  <Tag color="green" bordered={false}>{`${(row.video_prompt ?? '').length} 字`}</Tag>
                </Tooltip>
              ) : (
                <Tag color="gold" bordered={false}>空</Tag>
              ),
          },
          {
            title: '绑定素材',
            key: 'bindings',
            width: 100,
            render: (_: unknown, row) =>
              bindingCount(row) > 0 ? (
                <Tag color="geekblue" bordered={false}>{`${bindingCount(row)} 项`}</Tag>
              ) : (
                <span className="text-slate-400 text-xs">无</span>
              ),
          },
        ]

  return (
    <Card
      title={
        <Space size="small" wrap>
          <span>
            第 {index + 1} 步 / 共 {PROJECT_STEPS.length} 步 · {meta.label}
          </span>
          <Tag color="purple" className="mr-0">
            在章节工作室完成
          </Tag>
        </Space>
      }
      extra={
        prevStep ? (
          <Button size="small" type="text" icon={<ArrowLeftOutlined />} onClick={() => onGoStep(prevStep)}>
            返回修改（{getProjectStepMeta(prevStep).label}）
          </Button>
        ) : null
      }
    >
      <div className="mb-3 text-xs text-gray-500">{meta.description}</div>

      {hasChapter ? (
        <div className="space-y-3">
          <div className="text-sm text-gray-700">
            当前集：<span className="font-medium">{chapterLabel ?? '未命名'}</span>
          </div>
          <Button type="primary" icon={<VideoCameraOutlined />} onClick={() => onEnterStudio(step)}>
            进入章节工作室（{meta.label}）
          </Button>
          <div className="text-xs text-gray-500">
            进入后会直接落在本步骤：工作室已按「视频提示词 / 关联绑定 / 生成与交付」分成三步，
            步骤标识写在地址栏，刷新后仍停在同一步，切换步骤时当前分镜不会丢。
          </div>

          {showProgress ? (
            <Card
              size="small"
              title={
                step === 'binding'
                  ? '本集镜头 · 关联绑定进度（只读，不写库）'
                  : '本集镜头 · 视频提示词进度（只读，不写库）'
              }
              extra={
                <Button size="small" icon={<ReloadOutlined />} loading={deliveryLoading} onClick={() => void loadDelivery()}>
                  刷新
                </Button>
              }
            >
              {deliveryError ? <Alert type="error" showIcon message="加载失败" description={deliveryError} /> : null}
              {delivery ? (
                <div className="space-y-3">
                  <Space size={8} wrap>
                    <Tag bordered={false}>{`共 ${deliveryRows.length} 条镜头`}</Tag>
                    {step === 'binding' ? (
                      <>
                        <Tag color={withBindingCount < deliveryRows.length ? 'gold' : 'green'} bordered={false}>
                          {`已绑定 ${withBindingCount} 条`}
                        </Tag>
                        <Tag color={withAudioCount > 0 ? 'cyan' : 'default'} bordered={false}>
                          {`已绑声音 ${withAudioCount} 条`}
                        </Tag>
                        {withBindingCount < deliveryRows.length ? (
                          <Tag color="orange" bordered={false}>
                            {`还有 ${deliveryRows.length - withBindingCount} 条镜头没有绑定任何资产`}
                          </Tag>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <Tag color={withPromptCount < deliveryRows.length ? 'gold' : 'green'} bordered={false}>
                          {`有正文 ${withPromptCount} 条`}
                        </Tag>
                        <Tag color={withSourceCount < deliveryRows.length ? 'gold' : 'green'} bordered={false}>
                          {`来源已确认 ${withSourceCount} 条`}
                        </Tag>
                        {withSourceCount < deliveryRows.length ? (
                          <Tag color="orange" bordered={false}>
                            {`还有 ${deliveryRows.length - withSourceCount} 条镜头没有确认提示词来源`}
                          </Tag>
                        ) : null}
                      </>
                    )}
                  </Space>
                  <Typography.Text type="secondary" className="text-[11px]">
                    {step === 'binding'
                      ? '「实际文件」= 该镜头绑定资产解析到的定版图（生成请求会用它们当参考图）；「声音」= 该镜头绑定并已保存的配音音频。未绑定的镜头排在前面。'
                      : '来源必须是 大模型生成 / 巨日禄导入 / 人工编辑 / 一键技能生成；模板拼装只是本地预览，不计为来源，也不会进交付导出。缺口镜头排在前面。'}
                  </Typography.Text>
                  <Table<PromptDeliveryRow>
                    rowKey="shot_id"
                    size="small"
                    loading={deliveryLoading}
                    columns={progressColumns}
                    dataSource={step === 'binding' ? bindingSortedRows : promptSortedRows}
                    pagination={{ pageSize: 8, size: 'small' }}
                  />
                  <Button size="small" type="primary" ghost icon={<VideoCameraOutlined />} onClick={() => onEnterStudio(step)}>
                    去工作室处理这一步
                  </Button>
                </div>
              ) : (
                <Typography.Text type="secondary" className="text-[11px]">
                  {deliveryLoading ? '加载中…' : '暂无镜头数据'}
                </Typography.Text>
              )}
            </Card>
          ) : null}

          {showDelivery ? (
            <Card
              size="small"
              title="出口A · 交付预览（仅提示词，纯读不花钱）"
              extra={
                <Space size={8}>
                  <Button size="small" icon={<ReloadOutlined />} loading={deliveryLoading} onClick={() => void loadDelivery()}>
                    刷新
                  </Button>
                  <Button
                    size="small"
                    onClick={() => {
                      const text = delivery?.text ?? ''
                      if (!text) {
                        message.warning('当前没有可复制的交付文本')
                        return
                      }
                      void navigator.clipboard
                        .writeText(text)
                        .then(() => message.success(`已复制交付文本（${text.length} 字）`))
                        .catch(() => message.error('复制失败，请在下方文本框中手动全选复制'))
                    }}
                  >
                    复制交付文本
                  </Button>
                </Space>
              }
            >
              {deliveryError ? <Alert type="error" showIcon message="交付预览加载失败" description={deliveryError} /> : null}
              {delivery ? (
                <div className="space-y-3">
                  <Space size={8} wrap>
                    <Tag color="blue">{`可交付 ${delivery.exportable_count} 条`}</Tag>
                    <Tag color={delivery.skipped_count > 0 ? 'orange' : 'default'}>{`跳过 ${delivery.skipped_count} 条`}</Tag>
                    <Tag>{`范围：${delivery.scope_label}`}</Tag>
                    <Tag color="purple">{`可交付来源：${delivery.export_sources.map(sourceLabel).join(' / ')}`}</Tag>
                    <Tag color={delivery.include_bindings ? 'green' : 'default'}>
                      {delivery.include_bindings ? '带出绑定素材' : '不带绑定素材'}
                    </Tag>
                  </Space>
                  {delivery.note ? <DeliveryNoteBlock note={delivery.note} /> : null}
                  <Table<PromptDeliveryRow>
                    rowKey="shot_id"
                    size="small"
                    loading={deliveryLoading}
                    dataSource={delivery.rows}
                    pagination={{ pageSize: 8, size: 'small' }}
                    columns={
                      [
                        { title: '镜头', dataIndex: 'shot_code', width: 76 },
                        { title: '标题', dataIndex: 'shot_title', ellipsis: true },
                        {
                          title: '提示词来源',
                          dataIndex: 'video_prompt_source',
                          width: 140,
                          render: (value: string) => (
                            <Tag color={(value ?? '').trim() ? 'blue' : 'orange'}>{sourceLabel(value)}</Tag>
                          ),
                        },
                        {
                          title: '可交付',
                          dataIndex: 'exportable',
                          width: 92,
                          render: (ok: boolean, row) =>
                            ok ? <Tag color="green">是</Tag> : <Tag color="red">{row.issue || '否'}</Tag>,
                        },
                        {
                          title: '绑定素材',
                          key: 'bindings',
                          width: 110,
                          render: (_: unknown, row) =>
                            bindingCount(row) > 0 ? (
                              <Tag color="geekblue">{`${bindingCount(row)} 项`}</Tag>
                            ) : (
                              <span className="text-slate-400 text-xs">无</span>
                            ),
                        },
                      ] as TableColumnsType<PromptDeliveryRow>
                    }
                  />
                  <div>
                    <div className="mb-1 text-xs text-gray-500">
                      {`交付文本预览（共 ${(delivery.text ?? '').length} 字，含【绑定素材·实际文件】）`}
                    </div>
                    <pre className="max-h-64 overflow-auto rounded border border-slate-200 bg-slate-50 p-2 text-[11px] leading-5 whitespace-pre-wrap">
                      {(delivery.text ?? '').slice(0, 4000) || '（当前范围内没有可导出的提示词）'}
                    </pre>
                  </div>
                </div>
              ) : (
                <Typography.Text type="secondary" className="text-[11px]">
                  {deliveryLoading ? '加载中…' : '暂无交付数据'}
                </Typography.Text>
              )}
            </Card>
          ) : null}
        </div>
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="当前项目还没有可用的集，请先回到第 1 步「剧本」创建或选择一集"
        >
          <Space>
            <Button type="primary" icon={<ArrowRightOutlined />} onClick={() => onGoStep('script')}>
              去第 1 步：剧本
            </Button>
          </Space>
        </Empty>
      )}
    </Card>
  )
}
