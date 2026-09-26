/**
 * 「演练模式 / 真实模式」角标 + 被拦截时的「原因 + 怎么开」。
 *
 * 为什么挂在顶部外壳上：守卫管的是**所有**付费出口（大模型 / 出图 / 出视频 / OSS 上传），
 * 每个页面都可能踩到，放在全局壳上才不会出现「这页显示演练、那页看不出来」。
 *
 * 内容分四块（全部中文、可照做）：
 *   1. 当前模式：演练模式 / 真实模式（未确认）/ 真实模式 + 一句话说明；
 *   2. 四个出口各自放行还是拦截、拦截原因；
 *   3. 怎么切到真实模式与怎么关回演练（主区一句话，分步命令在「技术详情」里）；
 *   4. 最近被拦截的记录（后端 dry_run_audit）。
 *
 * ## 三层口径（阶段 B 第 4 批 · 审计 §4.4 模式 2/3/4/6）
 *
 * 审计点名了本文件的四处主区泄漏，全部按「**主区只留中文结论，原文进默认收起的
 * 技术详情**」重组：
 *   - `:189` 读取失败时把接口地址 (`端点：http://…/api/v1/…`) 摆进 Alert 正文；
 *   - `:201` 「守卫原文：… ；开关：`JELLYFISH_DRY_RUN`」整行进主区；
 *   - `:209`/`:283` 「由 backend/.env 打开真实付费模式」「说明文档：docs/real-run-mode.md」
 *     （仓库文件路径，属模式 4）；
 *   - `:64-65` 明文标注「后端原文：」的整块直渲；
 *   - `:237-241` 分步命令（`export …` / `curl -s http://localhost:8000/api/v1/…`）整段在主区；
 *   - `:268` `{event.detail || event.target}`（测试夹具里就是
 *     `POST /api/v1/script-processing/divide 会真实调用大模型` 与 `target: 'llm'`）。
 *
 * 技术详情折叠壳复用全仓唯一的 `TechnicalDetailSection`
 * （审计 §8.1.1：别处自建第二套 `<details>` / 「技术详情」标签一律判违规）。
 *
 * 数据来源是一个只读端点，不写库、不触网、不花钱；真实调用是否放行以后端为准。
 */

import { useCallback, useEffect, useState } from 'react'
import { Alert, Badge, Button, Popover, Space, Table, Tag, Tooltip, Typography } from 'antd'
import { ExperimentOutlined, ReloadOutlined, ThunderboltOutlined } from '@ant-design/icons'
import {
  ORCHESTRATION_REFRESH_EVENT,
  fetchOrchestrationStatusData,
  orchestrationStatusUrl,
} from '../../../services/orchestrationStatusApi'
// 阶段 B ①：技术详情折叠壳全仓唯一实现（不再各页自建折叠区）
import { TechnicalDetailSection } from '../project/ProjectWorkbench/components/workbench/TechnicalDetailCollapse'
import {
  describeBlockedError,
  outletTargetText,
  parseRealRunMode,
  readModePayloadOrNull,
  type BlockedErrorDetails,
  type OutletAllowState,
  type RealRunModeView,
} from './realRunModeCore'

const { Paragraph, Text } = Typography

type RealRunModeBadgeProps = {
  /** 轮询间隔（毫秒）；0 表示只在挂载/手动刷新时读取 */
  refreshIntervalMs?: number
  /** 直接把一次守卫拦截错误传进来，角标会展开显示「原因 + 怎么开」 */
  error?: unknown
  className?: string
}

/**
 * 可复用的「守卫拦截」提示块：原因 + 怎么开。
 *
 * 主区只有中文结论（标题 + 原因）；后端原文、HTTP 状态码、环境变量名、分步命令
 * 全部进默认收起的「技术详情」。
 */
export function RealRunBlockedAlert({ details }: { details: BlockedErrorDetails }): React.ReactElement {
  return (
    <Alert
      type={details.isBlocked ? 'warning' : 'error'}
      showIcon
      message={details.title}
      description={
        <div className="text-xs">
          <div>
            <Text strong>原因：</Text>
            {details.reasonText}
          </div>
          {details.isBlocked ? (
            <div className="mt-1">
              <Text strong>怎么开启真实模式：</Text>
              改完配置并重启后端进程，角标回到「真实模式」即为成功。
            </div>
          ) : null}
          {details.technicalDetail ? (
            <div className="mt-1">
              <TechnicalDetailSection testId="real-run-blocked-technical-detail">
                <pre className="m-0 overflow-x-auto whitespace-pre-wrap text-[11px] leading-5 text-gray-600">
                  {details.technicalDetail}
                </pre>
              </TechnicalDetailSection>
            </div>
          ) : null}
        </div>
      }
    />
  )
}

function outletColumns() {
  return [
    {
      title: '出口',
      dataIndex: 'label',
      key: 'label',
      width: 96,
      render: (label: string, row: OutletAllowState) => (
        <Tooltip title={outletTargetText(row.outlet)}>
          <span>{label}</span>
        </Tooltip>
      ),
    },
    {
      title: '状态',
      dataIndex: 'allowed',
      key: 'allowed',
      width: 96,
      render: (allowed: boolean) =>
        allowed ? <Tag color="red">放行（会花钱）</Tag> : <Tag color="gold">拦截</Tag>,
    },
    {
      title: '原因 / 说明',
      dataIndex: 'reasonText',
      key: 'reasonText',
      /* 审计 §4.4 模式 3：这里原来还渲染 `row.reason`（`dry_run` / `real_call_not_confirmed`
         的**机器值**，当 Tag 直接上屏）。原值现在只进「技术详情」的原始值清单。 */
      render: (text: string) => <span className="text-xs">{text}</span>,
    },
  ]
}

export function RealRunModeBadge({
  refreshIntervalMs = 30000,
  error,
  className,
}: RealRunModeBadgeProps): React.ReactElement {
  const [view, setView] = useState<RealRunModeView | null>(null)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchOrchestrationStatusData()
      const payload = readModePayloadOrNull(data)
      if (payload === null) {
        setView(null)
        setLoadError('状态接口没有返回 guard 字段，无法确认当前是演练还是真实模式。')
      } else {
        setView(parseRealRunMode(payload))
        setLoadError('')
      }
    } catch (exc) {
      setView(null)
      setLoadError(exc instanceof Error ? exc.message : String(exc))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!refreshIntervalMs) return undefined
    const timer = window.setInterval(() => {
      void load()
    }, refreshIntervalMs)
    return () => window.clearInterval(timer)
  }, [load, refreshIntervalMs])

  useEffect(() => {
    const handler = () => {
      void load()
    }
    window.addEventListener(ORCHESTRATION_REFRESH_EVENT, handler)
    return () => window.removeEventListener(ORCHESTRATION_REFRESH_EVENT, handler)
  }, [load])

  const blocked = error === undefined || error === null ? null : describeBlockedError(error)
  /* 折叠区外的条件只判布尔：第三层原文（`loadError` / `startupWarning`）的**渲染点**
     必须在默认收起的折叠区里，这样「原文在折叠区外又渲了一遍」会立刻被区域护栏抓到。 */
  const hasLoadError = loadError !== ''
  const hasStartupWarning = Boolean(view?.dotenvRealMode && view.startupWarning)
  const blockedCount = view?.blockedEvents.length ?? 0

  const tagColor = view === null ? 'default' : view.mode === 'real' ? 'red' : view.mode === 'real_unconfirmed' ? 'orange' : 'gold'
  const tagIcon = view?.mode === 'real' ? <ThunderboltOutlined /> : <ExperimentOutlined />
  const tagText = loading && view === null ? '读取模式…' : view?.label ?? '模式未知'

  const content = (
    <div style={{ width: 520, maxHeight: 460, overflow: 'auto' }} data-testid="real-run-mode-detail">
      {hasLoadError ? (
        <Alert
          type="error"
          showIcon
          message="读不到后端运行状态"
          description={
            <div className="text-xs">
              <div>在确认之前，请按「当前不会真实调用」对待。</div>
              <div className="mt-1">
                <TechnicalDetailSection testId="real-run-mode-load-error-detail">
                  <div className="text-[11px] leading-5 text-gray-600">
                    {`读取失败原文：${loadError}`}
                    <br />
                    {`请求地址：${orchestrationStatusUrl()}`}
                  </div>
                </TechnicalDetailSection>
              </div>
            </div>
          }
          style={{ marginBottom: 8 }}
        />
      ) : null}

      {view ? (
        <>
          <Paragraph className="mb-2 text-xs">
            <Tag color={tagColor}>{view.label}</Tag>
            {view.description}
          </Paragraph>
          {/* 配置来源只读展示：切模式必须改配置 + 重启，页面不提供任何「一键切真实」开关 */}
          <Paragraph className="mb-2 text-xs" data-testid="real-run-mode-source">
            配置来源：<Text strong>{view.switchSourceMainLabel}</Text>
            {view.dotenvRealMode ? (
              <Tag color="volcano" style={{ marginLeft: 6 }}>
                真实付费模式已由它打开
              </Tag>
            ) : null}
            <Text type="secondary">
              （这里只做展示：切模式要改配置并重启后端进程，页面不提供切换开关）
            </Text>
          </Paragraph>
          {hasStartupWarning ? (
            <Alert
              type="warning"
              showIcon
              message="后端启动时已就「真实付费模式」告警"
              description={
                <div className="text-xs">
                  <div>请确认这是你有意开启的；不确定就按下面的步骤关回演练模式。</div>
                  <div className="mt-1">
                    <TechnicalDetailSection testId="real-run-mode-startup-warning-detail">
                      <div className="text-[11px] leading-5 text-gray-600">{view.startupWarning}</div>
                    </TechnicalDetailSection>
                  </div>
                </div>
              }
              style={{ marginBottom: 8 }}
            />
          ) : null}

          <Table<OutletAllowState>
            size="small"
            rowKey="outlet"
            pagination={false}
            columns={outletColumns()}
            dataSource={view.outlets}
          />

          <div className="mt-3 text-xs">
            <Text strong>{view.isRealMode ? '当前已是真实模式（仍受成本确认/限额/去重约束）' : '怎么切换到真实模式'}</Text>
            <div className="mt-1">{view.enableSummary}</div>
          </div>

          <div className="mt-2 text-xs">
            <Text strong>怎么关回演练模式</Text>
            <div className="mt-1">{view.restoreSummary}</div>
          </div>

          {/* ---------------------------------------------------------------
              技术详情层（默认收起）：守卫原文 / 环境变量名 / 分步命令 / 文档路径 /
              四个出口的原始状态值 —— 审计 §4.4 模式 2/3/4 要求整段下沉的就是这些。
              --------------------------------------------------------------- */}
          <div className="mt-3">
            <TechnicalDetailSection testId="real-run-mode-technical-detail">
              <div className="space-y-2">
                <div>
                  <div className="mb-1 font-medium text-gray-500">运行状态原始值</div>
                  <div className="text-[11px] leading-5 text-gray-600">
                    <div>{`模式原始值：${view.mode}`}</div>
                    <div>{`守卫原文：${view.guardText || '（未提供）'}`}</div>
                    <div>{`开关：${view.env} / ${view.confirmEnv}`}</div>
                    <div>{`来源原始标签：${view.switchSourceLabel}（来源码：${view.switchSource}）`}</div>
                    <div>{`改完是否必须重启后端进程：${view.restartRequired ? '是' : '否'}`}</div>
                  </div>
                </div>

                <div>
                  <div className="mb-1 font-medium text-gray-500">四个出口的原始状态值</div>
                  <div className="space-y-0.5">
                    {view.outlets.map((row) => (
                      <div key={row.outlet}>
                        <code>{`${row.outlet}: allowed=${String(row.allowed)} reason=${row.reason || '(空)'}`}</code>
                        {row.reasonDetail ? (
                          <span className="text-gray-400">{` ｜ 服务端原文：${row.reasonDetail}`}</span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-1 font-medium text-gray-500">切换到真实模式的原始步骤</div>
                  <ol className="m-0 list-decimal pl-5 text-[11px] leading-5 text-gray-600">
                    {view.enableSteps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                  <div className="text-[11px] leading-5 text-gray-500">{view.howToEnable}</div>
                </div>

                <div>
                  <div className="mb-1 font-medium text-gray-500">关回演练模式的原始步骤</div>
                  <ol className="m-0 list-decimal pl-5 text-[11px] leading-5 text-gray-600">
                    {view.restoreSteps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                  <div className="text-[11px] leading-5 text-gray-500">{view.howToRestore}</div>
                </div>

                <div className="text-[11px] leading-5 text-gray-500">{`说明文档：${view.doc}`}</div>
              </div>
            </TechnicalDetailSection>
          </div>
        </>
      ) : null}

      {blocked ? (
        <div className="mt-3">
          <RealRunBlockedAlert details={blocked} />
        </div>
      ) : null}

      {blockedCount ? (
        <div className="mt-3 text-xs">
          <Text strong>最近被拦截的记录（{blockedCount} 条）</Text>
          <ul className="ml-4 mt-1 list-disc">
            {view?.blockedEvents.map((event, index) => (
              <li key={`blocked-event-${index}`}>
                <Tag bordered={false}>{event.actionLabel}</Tag>
                {/* 审计 §4.4 模式 6 第 2 条：原来这里渲染 `event.detail || event.target`
                    （接口路径 / `llm` 原值），改用已中文的 `reasonText`；
                    原始值一律进这个默认收起的折叠区。 */}
                {event.reasonText}
                <TechnicalDetailSection testId={`real-run-blocked-event-${index}`}>
                  <div className="text-[11px] leading-5 text-gray-600">
                    <div>{`动作原始值：${event.action}`}</div>
                    <div>{`拦截原因码：${event.reason}`}</div>
                    <div>{`明细原文：${event.detail || '（未提供）'}`}</div>
                    <div>{`拦截目标原文：${event.target || '（未提供）'}`}</div>
                  </div>
                </TechnicalDetailSection>
              </li>
            ))}
          </ul>
          <Text type="secondary">需要真实调用时按上面的步骤开真实模式；演练模式下的拦截不是故障。</Text>
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-between">
        <Space size={6}>
          <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
            刷新模式
          </Button>
        </Space>
      </div>
    </div>
  )

  return (
    <Popover content={content} title="当前运行模式（是否真实付费）" trigger="click" placement="bottomRight">
      <span className={className} style={{ cursor: 'pointer' }} title={view?.description ?? '正在读取当前运行模式'}>
        <Badge count={blockedCount} size="small" offset={[2, -2]}>
          <Tag color={tagColor} icon={tagIcon} data-testid="real-run-mode-tag">
            {tagText}
          </Tag>
        </Badge>
      </span>
    </Popover>
  )
}

export default RealRunModeBadge
