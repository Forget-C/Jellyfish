/**
 * 剧情策划页（「广告剧情流程」MVP 的最小入口）。
 *
 * 一条链路走完：填商品信息（免费）→ 生成剧情方案（**调用 1 次模型**）→ 编辑草稿 →
 * 点「确认落成正式内容」→ 回项目工作台，用既有五步流程接着做。
 *
 * 三条界面口径（都是"不给用户惊喜"的做法）：
 *
 * 1. **生成按钮明确标出会花钱**：文案写「将调用 1 次模型」，并且只在**后端自己回报**
 *    `meta.dry_run === true` 时才显示"演练模式"标签 —— 演练与否由后端说了算，
 *    页面不去猜环境变量（猜错会让用户以为不花钱、实际花钱）。
 * 2. **确认之前一切都不影响正式数据**：草稿只进 `drama_plan_drafts`，
 *    页面顶部常驻这行说明；确认按钮是唯一写正式产物的入口，并二次确认。
 * 3. **刷新不丢**：brief 与草稿都存服务端，刷新后按 (projectId, chapterId) 读回；
 *    所以页面把 chapterId 放进 URL query，刷新能回到同一集。
 *
 * 本批**没有**做「按段重生成」（重新生成单个镜头/单个资产）：后端没有这个端点，
 * 现有契约里"重新生成"就是整份重来（租约保护，同一章并发只跑一次）。
 * 宁可如实不做，也不放一个点了没反应的按钮。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Divider,
  Empty,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Typography,
  message as antdMessage,
} from 'antd'
import { Link, useSearchParams } from 'react-router-dom'

import { StudioProjectsService } from '../../../services/generated'
import {
  type DramaBrief,
  type DramaPlan,
  type DramaPlanRead,
  type DramaPlanShot,
  confirmDramaPlan,
  emptyBrief,
  fetchDramaPlanAvailability,
  generateDramaPlan,
  getDramaPlan,
  resolveWorkingChapter,
  saveDramaBrief,
  saveDramaDraft,
} from '../../../services/dramaPlanApi'

const { Title, Paragraph, Text } = Typography

/** 与后端 `shot_details` 的 code 列一一对应（下拉里只给合法值，避免写脏数据）。 */
const CAMERA_SHOT_OPTIONS = ['ECU', 'CU', 'MCU', 'MS', 'MLS', 'LS', 'ELS']
const ANGLE_OPTIONS = ['EYE_LEVEL', 'HIGH_ANGLE', 'LOW_ANGLE', 'BIRD_EYE', 'DUTCH', 'OVER_SHOULDER']
const MOVEMENT_OPTIONS = [
  'STATIC',
  'PAN',
  'TILT',
  'DOLLY_IN',
  'DOLLY_OUT',
  'TRACK',
  'CRANE',
  'HANDHELD',
  'STEADICAM',
  'ZOOM_IN',
  'ZOOM_OUT',
]

type ProjectOption = { id: string; name: string }

/** 多行文本 ↔ 字符串数组（卖点 / 动作拍点这类"一行一条"的字段）。 */
const linesToArray = (value: string): string[] =>
  value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)

const arrayToLines = (value: string[] | undefined): string => (value ?? []).join('\n')

/** 台词 ↔ 文本：一行一句，格式 `说话人：台词`。 */
const dialogueToText = (shot: DramaPlanShot): string =>
  shot.dialogue.map((line) => (line.speaker ? `${line.speaker}：${line.text}` : line.text)).join('\n')

const textToDialogue = (value: string) =>
  value
    .split('\n')
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => {
      const index = row.indexOf('：')
      if (index <= 0) return { speaker: '', text: row, mode: 'DIALOGUE' }
      return { speaker: row.slice(0, index).trim(), text: row.slice(index + 1).trim(), mode: 'DIALOGUE' }
    })

const DramaPlanPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [available, setAvailable] = useState<boolean | null>(null)
  const [projectId, setProjectId] = useState(searchParams.get('projectId') ?? '')
  const [chapterId, setChapterId] = useState(searchParams.get('chapterId') ?? '')
  const [chapterTitle, setChapterTitle] = useState('')
  const [read, setRead] = useState<DramaPlanRead | null>(null)
  const [brief, setBrief] = useState<DramaBrief>(emptyBrief())
  const [plan, setPlan] = useState<DramaPlan | null>(null)
  const [busy, setBusy] = useState<'idle' | 'load' | 'save' | 'generate' | 'confirm'>('idle')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const status = read?.status ?? 'none'
  const generating = status === 'running'

  // ---- 项目列表 + 端点可用性（读 /openapi.json 判断，不试调） ----
  useEffect(() => {
    let alive = true
    void (async () => {
      const ok = await fetchDramaPlanAvailability()
      if (alive) setAvailable(ok)
      try {
        const resp = await StudioProjectsService.listProjectsApiV1StudioProjectsGet({ page: 1, pageSize: 100 })
        if (!alive) return
        setProjects((resp.data?.items ?? []).map((item) => ({ id: String(item.id), name: String(item.name ?? '') })))
      } catch {
        /* 列表失败不阻断：用户仍可直接用 URL 里的 projectId */
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const applyRead = useCallback((payload: DramaPlanRead) => {
    setRead(payload)
    setBrief({ ...emptyBrief(), ...payload.brief })
    setPlan(payload.plan ?? null)
  }, [])

  // ---- 选项目 → 取可用空章节 → 读草稿 ----
  const openChapter = useCallback(
    async (nextProjectId: string, productName: string) => {
      setBusy('load')
      setError('')
      try {
        const working = await resolveWorkingChapter(nextProjectId, productName)
        setChapterId(working.chapter_id)
        setChapterTitle(working.title)
        setSearchParams({ projectId: nextProjectId, chapterId: working.chapter_id }, { replace: true })
        applyRead(await getDramaPlan(working.chapter_id))
      } catch (exc) {
        setError(exc instanceof Error ? exc.message : String(exc))
      } finally {
        setBusy('idle')
      }
    },
    [applyRead, setSearchParams],
  )

  // ---- 带 chapterId 直接进页面（刷新/分享）时读回 ----
  useEffect(() => {
    if (!chapterId) return
    let alive = true
    setBusy('load')
    void (async () => {
      try {
        const payload = await getDramaPlan(chapterId)
        if (alive) applyRead(payload)
      } catch (exc) {
        if (alive) setError(exc instanceof Error ? exc.message : String(exc))
      } finally {
        if (alive) setBusy('idle')
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId])

  const characterNames = useMemo(() => (plan?.characters ?? []).map((item) => item.name), [plan])

  const updateShot = (index: number, patch: Partial<DramaPlanShot>) => {
    setPlan((current) => {
      if (!current) return current
      return {
        ...current,
        shots: current.shots.map((shot) => (shot.index === index ? { ...shot, ...patch } : shot)),
      }
    })
  }

  const run = async (
    kind: 'save' | 'generate' | 'confirm',
    action: () => Promise<void>,
  ) => {
    setBusy(kind)
    setError('')
    setNotice('')
    try {
      await action()
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc))
    } finally {
      setBusy('idle')
    }
  }

  const onSaveBrief = () =>
    run('save', async () => {
      const payload = await saveDramaBrief(chapterId, brief)
      setRead(payload)
      setNotice('商品信息已保存（没有调用模型）。可以点「生成剧情方案」。')
    })

  const onGenerate = () =>
    run('generate', async () => {
      const payload = await generateDramaPlan(chapterId)
      applyRead(payload)
      setNotice(payload.plan ? '已生成草稿：下面可以逐字段修改，改完记得保存。' : payload.note)
      if (!payload.plan) {
        antdMessage.info('本次没有生成草稿（通常是演练模式）。')
      }
    })

  const onSaveDraft = () =>
    run('save', async () => {
      if (!plan) return
      const payload = await saveDramaDraft(chapterId, plan)
      applyRead(payload)
      setNotice('草稿已保存（免费）。刷新或换设备回来还能看到。')
    })

  const onConfirm = () =>
    run('confirm', async () => {
      const result = await confirmDramaPlan(chapterId)
      setNotice(
        `已落成正式内容：${result.shots_created} 个镜头、${result.dialog_lines_created} 句台词、` +
          `${result.characters_created} 个角色、${result.scenes_created} 个场景` +
          `${result.product_created ? '、1 个商品' : ''}；带商品的镜头 ${result.shot_product_links} 个。`,
      )
    })

  return (
    <div className="p-6" style={{ maxWidth: 1180, margin: '0 auto' }}>
      <Title level={3} style={{ marginBottom: 4 }}>
        剧情策划
      </Title>
      <Paragraph type="secondary" style={{ marginBottom: 16 }}>
        填商品卖点 → 生成剧情方案（调用 1 次模型）→ 手工改 → 确认落成正式内容 → 回项目工作台接着做。
        <Text strong> 确认之前不会改动章节、分镜与任何资产。</Text>
      </Paragraph>

      {available === false && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="后端还没有这组接口"
          description="当前部署的后端 /openapi.json 里没有 /drama-plan/generate。请先升级后端（或确认新表已迁移）后再用本页。"
        />
      )}

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap align="end">
          <div>
            <div style={{ marginBottom: 4 }}>项目</div>
            <Select
              style={{ width: 280 }}
              placeholder="选择一个项目"
              value={projectId || undefined}
              options={projects.map((item) => ({ value: item.id, label: item.name || item.id }))}
              onChange={(value) => {
                setProjectId(value)
                setChapterId('')
                setRead(null)
                setPlan(null)
                void openChapter(value, brief.product_name)
              }}
            />
          </div>
          {chapterId && (
            <Text type="secondary">
              当前集：{chapterTitle || chapterId}（{chapterId}）
            </Text>
          )}
          {status !== 'none' && <Tag color={status === 'ok' ? 'green' : status === 'failed' ? 'red' : 'blue'}>{status}</Tag>}
        </Space>
      </Card>

      {error && <Alert type="error" showIcon style={{ marginBottom: 16 }} message="出错了" description={error} />}
      {notice && <Alert type="success" showIcon style={{ marginBottom: 16 }} message={notice} />}
      {read?.error && <Alert type="warning" showIcon style={{ marginBottom: 16 }} message="上次生成失败" description={read.error} />}

      {!chapterId ? (
        <Empty description="先选一个项目（会自动取一集没有分镜的空章节，没有就新建一集）" />
      ) : (
        <Spin spinning={busy !== 'idle'}>
          <Card title="1. 商品与要求（保存免费，不会调用模型）" size="small" style={{ marginBottom: 16 }}>
            <Form layout="vertical">
              <Space wrap size="large" align="start">
                <Form.Item label="商品名称" required style={{ minWidth: 260 }}>
                  <Input
                    value={brief.product_name}
                    placeholder="例：紧致焕颜精华"
                    onChange={(event) => setBrief({ ...brief, product_name: event.target.value })}
                  />
                </Form.Item>
                <Form.Item label="目标人群" style={{ minWidth: 220 }}>
                  <Input
                    value={brief.target_audience}
                    placeholder="例：25-35 岁通勤女性"
                    onChange={(event) => setBrief({ ...brief, target_audience: event.target.value })}
                  />
                </Form.Item>
                <Form.Item label="镜头数">
                  <InputNumber
                    min={1}
                    max={16}
                    value={brief.shot_count}
                    onChange={(value) => setBrief({ ...brief, shot_count: Number(value ?? 6) })}
                  />
                </Form.Item>
                <Form.Item label="整片时长（秒，0 = 自动）">
                  <InputNumber
                    min={0}
                    max={600}
                    value={brief.duration_seconds}
                    onChange={(value) => setBrief({ ...brief, duration_seconds: Number(value ?? 0) })}
                  />
                </Form.Item>
              </Space>
              <Form.Item label="商品外观描述（会写进商品资产的外观描述；不要写空话）">
                <Input.TextArea
                  rows={3}
                  value={brief.product_description}
                  placeholder="例：白色磨砂塑料瓶身，金色压泵，正面居中金色字标"
                  onChange={(event) => setBrief({ ...brief, product_description: event.target.value })}
                />
              </Form.Item>
              <Form.Item label="卖点（一行一条；提示词会要求把它们转成冲突，而不是念参数）">
                <Input.TextArea
                  rows={3}
                  value={arrayToLines(brief.selling_points)}
                  onChange={(event) => setBrief({ ...brief, selling_points: linesToArray(event.target.value) })}
                />
              </Form.Item>
              <Space wrap size="large" align="start">
                <Form.Item label="题材（留空沿用项目）" style={{ minWidth: 200 }}>
                  <Input value={brief.genre} onChange={(event) => setBrief({ ...brief, genre: event.target.value })} />
                </Form.Item>
                <Form.Item label="调性" style={{ minWidth: 200 }}>
                  <Input
                    value={brief.tone}
                    placeholder="例：一本正经地荒诞"
                    onChange={(event) => setBrief({ ...brief, tone: event.target.value })}
                  />
                </Form.Item>
                <Form.Item label="品牌调性 / 规则" style={{ minWidth: 240 }}>
                  <Input value={brief.brand_voice} onChange={(event) => setBrief({ ...brief, brand_voice: event.target.value })} />
                </Form.Item>
              </Space>
              <Space wrap size="large" align="start">
                <Form.Item label="必须出现（一行一条）" style={{ minWidth: 260 }}>
                  <Input.TextArea
                    rows={2}
                    value={arrayToLines(brief.mandatory_elements)}
                    onChange={(event) => setBrief({ ...brief, mandatory_elements: linesToArray(event.target.value) })}
                  />
                </Form.Item>
                <Form.Item label="禁止出现（一行一条）" style={{ minWidth: 260 }}>
                  <Input.TextArea
                    rows={2}
                    value={arrayToLines(brief.forbidden_elements)}
                    onChange={(event) => setBrief({ ...brief, forbidden_elements: linesToArray(event.target.value) })}
                  />
                </Form.Item>
                <Form.Item label="导演备注" style={{ minWidth: 260 }}>
                  <Input.TextArea
                    rows={2}
                    value={brief.director_notes}
                    placeholder="例：不要旁白、结尾不要硬 CTA"
                    onChange={(event) => setBrief({ ...brief, director_notes: event.target.value })}
                  />
                </Form.Item>
              </Space>
            </Form>
            <Divider style={{ margin: '12px 0' }} />
            <Space wrap>
              <Button onClick={onSaveBrief} disabled={busy !== 'idle' || !brief.product_name.trim()}>
                保存商品信息
              </Button>
              <Button
                type="primary"
                onClick={onGenerate}
                disabled={busy !== 'idle' || generating || !brief.product_name.trim()}
                loading={busy === 'generate'}
              >
                生成剧情方案（将调用 1 次模型）
              </Button>
              {read?.meta?.dry_run === true && <Tag color="orange">演练模式：这次不会真实调用模型</Tag>}
            </Space>
          </Card>

          {plan && (
            <Card
              title="2. 草稿（确认之前不影响任何正式数据）"
              size="small"
              extra={
                <Space>
                  <Button onClick={onSaveDraft} disabled={busy !== 'idle'}>
                    保存草稿
                  </Button>
                  <Button
                    type="primary"
                    danger
                    disabled={busy !== 'idle' || generating}
                    onClick={() => {
                      void onConfirm()
                    }}
                  >
                    确认落成正式内容
                  </Button>
                </Space>
              }
            >
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                <Space wrap size="large" align="start">
                  <div>
                    <div style={{ marginBottom: 4 }}>标题（落章节标题）</div>
                    <Input
                      style={{ width: 320 }}
                      value={plan.title}
                      onChange={(event) => setPlan({ ...plan, title: event.target.value })}
                    />
                  </div>
                  <div>
                    <div style={{ marginBottom: 4 }}>一句话主线（落章节摘要）</div>
                    <Input
                      style={{ width: 460 }}
                      value={plan.logline}
                      onChange={(event) => setPlan({ ...plan, logline: event.target.value })}
                    />
                  </div>
                </Space>
                <div>
                  <div style={{ marginBottom: 4 }}>卖点（剧情化之后）</div>
                  <Input.TextArea
                    rows={2}
                    value={arrayToLines(plan.selling_points)}
                    onChange={(event) => setPlan({ ...plan, selling_points: linesToArray(event.target.value) })}
                  />
                </div>
                <div>
                  <div style={{ marginBottom: 4 }}>结尾反转 / 购买暗示</div>
                  <Input.TextArea
                    rows={2}
                    value={plan.climax}
                    onChange={(event) => setPlan({ ...plan, climax: event.target.value })}
                  />
                </div>

                <Space wrap size="large" align="start">
                  <div>
                    <div style={{ marginBottom: 4 }}>角色（一行一个，镜头里必须引用这里出现过的名字）</div>
                    <Input.TextArea
                      style={{ width: 320 }}
                      rows={3}
                      value={arrayToLines(plan.characters.map((item) => item.name))}
                      onChange={(event) =>
                        setPlan({
                          ...plan,
                          characters: linesToArray(event.target.value).map((name) => {
                            const old = plan.characters.find((item) => item.name === name)
                            return old ?? { name, profile: {}, shot_indexes: [] }
                          }),
                        })
                      }
                    />
                  </div>
                  <div>
                    <div style={{ marginBottom: 4 }}>场景（一行一个）</div>
                    <Input.TextArea
                      style={{ width: 320 }}
                      rows={3}
                      value={arrayToLines(plan.scenes.map((item) => item.name))}
                      onChange={(event) =>
                        setPlan({
                          ...plan,
                          scenes: linesToArray(event.target.value).map((name) => {
                            const old = plan.scenes.find((item) => item.name === name)
                            return old ?? { name, profile: {}, shot_indexes: [] }
                          }),
                        })
                      }
                    />
                  </div>
                  <div>
                    <div style={{ marginBottom: 4 }}>商品</div>
                    <Input
                      style={{ width: 260 }}
                      placeholder="商品名称（留空表示这一版没有商品）"
                      value={plan.product?.name ?? ''}
                      onChange={(event) =>
                        setPlan({
                          ...plan,
                          product: event.target.value.trim()
                            ? {
                                name: event.target.value,
                                description: plan.product?.description ?? '',
                                profile: plan.product?.profile ?? {},
                                shot_indexes: plan.product?.shot_indexes ?? [],
                              }
                            : null,
                        })
                      }
                    />
                  </div>
                </Space>

                {(plan.warnings ?? []).length > 0 && (
                  <Alert
                    type="info"
                    showIcon
                    message="生成与归一化过程中的提示"
                    description={
                      <ul style={{ marginBottom: 0 }}>
                        {plan.warnings.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    }
                  />
                )}

                <Table<DramaPlanShot>
                  rowKey="index"
                  size="small"
                  pagination={false}
                  dataSource={plan.shots}
                  scroll={{ x: 1400 }}
                  columns={[
                    { title: '#', dataIndex: 'index', width: 48 },
                    {
                      title: '标题',
                      width: 180,
                      render: (_value, shot) => (
                        <Input value={shot.title} onChange={(event) => updateShot(shot.index, { title: event.target.value })} />
                      ),
                    },
                    {
                      title: '出场角色',
                      width: 200,
                      render: (_value, shot) => (
                        <Select
                          mode="multiple"
                          style={{ width: '100%' }}
                          value={shot.characters}
                          options={characterNames.map((name) => ({ value: name, label: name }))}
                          onChange={(value) => updateShot(shot.index, { characters: value })}
                        />
                      ),
                    },
                    {
                      title: '时长(秒)',
                      width: 96,
                      render: (_value, shot) => (
                        <InputNumber
                          min={4}
                          max={15}
                          value={shot.duration}
                          onChange={(value) => updateShot(shot.index, { duration: Number(value ?? 8) })}
                        />
                      ),
                    },
                    {
                      title: '景别',
                      width: 104,
                      render: (_value, shot) => (
                        <Select
                          style={{ width: '100%' }}
                          value={shot.camera_shot}
                          options={CAMERA_SHOT_OPTIONS.map((code) => ({ value: code, label: code }))}
                          onChange={(value) => updateShot(shot.index, { camera_shot: value })}
                        />
                      ),
                    },
                    {
                      title: '机位',
                      width: 148,
                      render: (_value, shot) => (
                        <Select
                          style={{ width: '100%' }}
                          value={shot.angle}
                          options={ANGLE_OPTIONS.map((code) => ({ value: code, label: code }))}
                          onChange={(value) => updateShot(shot.index, { angle: value })}
                        />
                      ),
                    },
                    {
                      title: '运镜',
                      width: 132,
                      render: (_value, shot) => (
                        <Select
                          style={{ width: '100%' }}
                          value={shot.movement}
                          options={MOVEMENT_OPTIONS.map((code) => ({ value: code, label: code }))}
                          onChange={(value) => updateShot(shot.index, { movement: value })}
                        />
                      ),
                    },
                    {
                      title: '动作拍点（一行一拍）',
                      width: 220,
                      render: (_value, shot) => (
                        <Input.TextArea
                          rows={3}
                          value={arrayToLines(shot.action_beats)}
                          onChange={(event) => updateShot(shot.index, { action_beats: linesToArray(event.target.value) })}
                        />
                      ),
                    },
                    {
                      title: '台词（一行一句，说话人：台词）',
                      width: 240,
                      render: (_value, shot) => (
                        <Input.TextArea
                          rows={3}
                          value={dialogueToText(shot)}
                          onChange={(event) => updateShot(shot.index, { dialogue: textToDialogue(event.target.value) })}
                        />
                      ),
                    },
                    {
                      title: '出现商品',
                      width: 108,
                      render: (_value, shot) => (
                        <Switch
                          checked={shot.product_present}
                          disabled={!plan.product}
                          onChange={(checked) => updateShot(shot.index, { product_present: checked })}
                        />
                      ),
                    },
                  ]}
                />
                <Text type="secondary">
                  规则：商品必须出现在**至少一半**镜头里，否则确认会被拒绝（后端按关联行数判定，不信模型自述）。
                </Text>
                <Divider style={{ margin: '4px 0' }} />
                <Space>
                  <Button
                    disabled={busy !== 'idle' || generating}
                    onClick={() => {
                      void onGenerate()
                    }}
                  >
                    整体重新生成
                  </Button>
                  <Text type="secondary">重新生成会再调用 1 次模型（同一集并发只跑一次）。</Text>
                </Space>
              </Space>
            </Card>
          )}

          {read && read.has_draft && !plan && (
            <Alert
              type="info"
              showIcon
              message="还没有草稿"
              description="商品信息已保存。点上面的「生成剧情方案」让模型出一版，或者等演练模式下先看流程。"
            />
          )}

          {notice && status === 'ok' && (
            <Card size="small" style={{ marginTop: 16 }}>
              <Space>
                <Text>落库完成后，去项目工作台按既有五步继续：</Text>
                <Link to={`/projects/${projectId}`}>回项目工作台</Link>
              </Space>
            </Card>
          )}
        </Spin>
      )}
    </div>
  )
}

export default DramaPlanPage
