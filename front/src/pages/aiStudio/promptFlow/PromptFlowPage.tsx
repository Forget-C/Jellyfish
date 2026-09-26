import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Collapse,
  Descriptions,
  Divider,
  Empty,
  Input,
  Modal,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
/* 主区文案出口一律走共享管道（审计 §7.1-5/6）：原文进「技术详情」，主区只出中文结论。 */
import { maskInternalIds } from '../components/maskInternalIds'
/* 模型原始名不许进主区（审计 §6.2）：主区只说「模型方案」的业务名 */
import { textModelBusinessName } from '../components/enumLabels'
import { rememberTechnicalDetail, toUserFacingText } from '../components/userFacingMessage'
import {
  CloudDownloadOutlined,
  CloudUploadOutlined,
  PlusOutlined,
  ReloadOutlined,
  EyeOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import {
  OpenAPI,
  StudioChaptersService,
  StudioJuriluImportService,
  StudioProjectsService,
  StudioPromptDeliveryService,
  StudioQuickSkillService,
  StudioShotsService,
} from '../../../services/generated'
import { nextChapterIndex } from '../chapter/chapterIndexing'
/* 「技术详情」折叠壳**全仓只有一份**（审计 §9 第 2 项）：错误原文的屏幕出口走它。 */
import { TechnicalDetailSection } from '../project/ProjectWorkbench/components/workbench/TechnicalDetailCollapse'
import {
  deleteShotDrafts,
  fetchPromptBoardDrafts,
  saveShotDraft,
  type PromptBoardDraft,
} from '../../../services/llmPipelineApi'
import type {
  JuriluPlanRowRead,
  JuriluPreviewRead,
  PromptDeliveryRead,
  PromptDeliveryRowRead,
  QuickSkillGenerateRead,
  QuickSkillItem,
} from '../../../services/generated'

const { Text } = Typography

/**
 * 后端基址沿用生成客户端的配置（默认 http://localhost:8000，可由
 * window.__ENV.BACKEND_URL 或 VITE_BACKEND_URL 覆盖）。
 * 下载走原生 fetch 是因为要拿到原始字节（TXT 带 UTF-8 BOM），
 * 经客户端封装会被当作文本解码，BOM 可能被吃掉。
 */
const apiBase = () => OpenAPI.BASE

interface ProjectOption {
  label: string
  value: string
}
interface ChapterOption {
  label: string
  value: string
}
interface ShotOption {
  label: string
  value: string
}

/**
 * 把后端的统一错误信封渲染成可读文本。
 *
 * 后端约定：错误也走 `{ code, message, data, meta }`（见 app/main.py 的全局异常处理器）。
 * 巨日禄抓取失败的诊断信息放在 `meta.diagnostics` / `meta.warnings` 里，
 * 这里把它们展开，方便直接看出"是哪一步断了"。
 */
const renderEnvelope = (body: unknown, fallback: string): string => {
  if (!body || typeof body !== 'object') return fallback
  const envelope = body as Record<string, unknown>
  const message = String(envelope.message ?? fallback)
  const meta = (envelope.meta ?? {}) as Record<string, unknown>
  const warnings = Array.isArray(meta.warnings) ? (meta.warnings as string[]) : []
  const diagnostics = (meta.diagnostics ?? {}) as Record<string, unknown>
  const lines = Object.entries(diagnostics).map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
  const detail = envelope.detail
  if (lines.length === 0 && warnings.length === 0 && detail) {
    return typeof detail === 'string' ? detail : `${message}\n${JSON.stringify(detail)}`
  }
  return [message, ...warnings, ...lines].join('\n')
}

/**
 * 后端错误**原文**（含 `meta.diagnostics` / `meta.warnings` 展开）。
 *
 * ⚠️ 它只允许进默认收起的「技术详情」层 —— 以前它是**主区**文案的来源
 * （审计 §4.6 模式 4：`describeError` 的展开结果直接上 toast）。
 */
const describeErrorRaw = (error: unknown): string => {
  const err = error as { status?: number; body?: unknown; message?: string }
  if (err?.body) return renderEnvelope(err.body, err.message ?? '')
  return String(err?.message ?? '')
}

/**
 * 主区用的错误结论 —— **本页所有错误出口的唯一咽喉**（20 处调用点自动受益，审计 §7.1-5）。
 *
 * 三步口径：
 *   1. 只取原文的**第一行**（后端信封的 `message`）——多行诊断是技术层内容，不上主区；
 *   2. 过共享管道 `toUserFacingText`（掩码 + 去内部术语 + 业务化改写，脏了退回中文兜底）；
 *   3. 完整原文（脱敏后）写进「技术详情」可查处（`rememberTechnicalDetail`）。
 *
 * 这样主区永远是**一句中文**，而「到底哪一步断了」仍然查得到。
 */
const describeError = (error: unknown, fallback = '这一步没有成功，请稍后重试'): string => {
  const raw = describeErrorRaw(error)
  const firstLine = raw.split('\n').map((line) => line.trim()).find((line) => line.length > 0) ?? ''
  const conclusion = toUserFacingText(firstLine, fallback)
  if (raw.trim()) {
    rememberTechnicalDetail({ title: conclusion, detail: maskInternalIds(raw), scope: '提示词看板' })
  }
  return conclusion
}

/** 未命名章节的中文占位（审计 §4.6 模式 1：原来回退成章节 UUID）。 */
const untitledChapterLabel = (index: number): string => `第 ${index > 0 ? index : 1} 章`

/**
 * 后端分页上限是每页 100（`page_size ≤ 100`，传更大会 422），
 * 所以这里先取第一页拿到 max_page，再把剩下的页依次取回来。
 */
const PAGE_SIZE = 100

async function loadAll<T>(
  loader: (page: number, pageSize: number) => Promise<{ items: T[]; maxPage: number }>
): Promise<T[]> {
  const first = await loader(1, PAGE_SIZE)
  const all = [...first.items]
  for (let page = 2; page <= first.maxPage; page += 1) {
    const next = await loader(page, PAGE_SIZE)
    all.push(...next.items)
  }
  return all
}

/** 动作 → 展示标签与配色。 */
const ACTION_META: Record<string, { text: string; color: string }> = {
  update: { text: '写入', color: 'blue' },
  overwrite: { text: '覆盖', color: 'orange' },
  create: { text: '新建镜头', color: 'green' },
  unchanged: { text: '无变化', color: 'default' },
  conflict: { text: '冲突跳过', color: 'red' },
  skip_empty: { text: '空正文跳过', color: 'default' },
  skip_no_shot: { text: '镜头不足跳过', color: 'default' },
}

const PromptFlowPage: React.FC = () => {
  type TabKey = 'import' | 'export' | 'skill'
  const TAB_KEYS: TabKey[] = ['import', 'export', 'skill']

  // 项目与标签页同步到 URL 查询串：链接可直接分享/收藏，也便于自动化打开。
  const [searchParams, setSearchParams] = useSearchParams()
  const [projectId, setProjectIdRaw] = useState<string | undefined>(
    searchParams.get('project') ?? undefined
  )
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [tab, setTabRaw] = useState<TabKey>(() => {
    const raw = searchParams.get('tab') ?? ''
    return (TAB_KEYS as string[]).includes(raw) ? (raw as TabKey) : 'import'
  })
  /**
   * **最近一次失败的原始信息**（审计 §9.1-8 的屏幕出口）。
   *
   * 为什么要有它：本页有 18 处错误出口，全部走 `describeError` 这一个咽喉；
   * 主区只出一句中文（这是对的），但原文过去**只写进 `rememberTechnicalDetail` 的内存日志**
   * —— 全仓没有任何组件渲染那份日志，等于「屏幕上无处可查」。
   * 现在把原文经 `maskInternalIds` 渲染进页级默认收起的「技术详情」，
   * **主区一个字都不多**（折叠区的标题在收起态可见，那是共享壳固定的干净的标签）。
   *
   * ⚠️ 这里**不是**订阅机制：只是把每次失败时 `describeError` 已经算出来的原文往 state 里放一份，
   * 三个子面板通过一个回调 prop 上报（`onErrorOriginal`）。
   */
  const [lastErrorOriginal, setLastErrorOriginal] = useState('')
  /** 本页错误出口：主区一句中文（`describeError` 产出）+ 原文上报给页面级「技术详情」。 */
  const reportError = useCallback(
    (error: unknown): string => {
      setLastErrorOriginal(describeErrorRaw(error))
      return describeError(error)
    },
    [],
  )

  const syncQuery = useCallback(
    (nextProject?: string, nextTab?: TabKey) => {
      const params = new URLSearchParams(searchParams)
      const project = nextProject ?? projectId
      const currentTab = nextTab ?? tab
      if (project) params.set('project', project)
      else params.delete('project')
      if (currentTab === 'import') params.delete('tab')
      else params.set('tab', currentTab)
      setSearchParams(params, { replace: true })
    },
    [projectId, searchParams, setSearchParams, tab]
  )

  const setProjectId = useCallback(
    (value?: string) => {
      setProjectIdRaw(value)
      syncQuery(value, undefined)
    },
    [syncQuery]
  )

  const setTab = useCallback(
    (value: TabKey) => {
      setTabRaw(value)
      syncQuery(undefined, value)
    },
    [syncQuery]
  )

  const loadProjects = useCallback(async () => {
    setLoadingProjects(true)
    try {
      const items = await loadAll(async (page, pageSize) => {
        const res = await StudioProjectsService.listProjectsApiV1StudioProjectsGet({ page, pageSize })
        return {
          items: res.data?.items ?? [],
          maxPage: res.data?.pagination?.max_page ?? 1,
        }
      })
      setProjects(items.map((p) => ({ label: p.name, value: p.id })))
    } catch (error) {
      message.error(`加载项目失败：${reportError(error)}`)
    } finally {
      setLoadingProjects(false)
    }
  }, [reportError])

  useEffect(() => {
    void loadProjects()
  }, [loadProjects])

  return (
    <div style={{ padding: 16 }}>
      <Card
        title="提示词导入 / 交付"
        extra={
          <Space>
            <Select
              style={{ width: 320 }}
              placeholder="选择项目"
              value={projectId}
              onChange={setProjectId}
              options={projects}
              loading={loadingProjects}
              showSearch
              optionFilterProp="label"
            />
            <Button icon={<ReloadOutlined />} onClick={() => void loadProjects()}>
              刷新项目
            </Button>
          </Space>
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="三条链路"
          description={
            <div>
              <div>
                {/* §9.1-1：枚举原名 `jurilu` 必须换成显示名「巨日禄导入」；同一个判定的同型残留。 */}
                <b>导入</b>：粘贴巨日禄 Cookie，把分镜提示词拉下来写到指定章节的镜头上（来源记为「巨日禄导入」）。
              </div>
              <div>
                <b>交付</b>：把「巨日禄导入」的提示词导出成 TXT（带 BOM），拿去其他平台生成视频。
              </div>
              <div>
                <b>生成</b>：选一个导演技能，填需求，让模型产出一条成品提示词；可导出 TXT，也可写回镜头（来源记为「一键技能生成」）。
              </div>
            </div>
          }
        />
        <Segmented
          value={tab}
          onChange={(value) => setTab(value as TabKey)}
          options={[
            { label: '巨日禄导入', value: 'import' },
            { label: '提示词交付（出口 A）', value: 'export' },
            { label: '一键技能', value: 'skill', icon: <ThunderboltOutlined /> },
          ]}
          style={{ marginBottom: 16 }}
        />
        {tab === 'import' && <JuriluImportPanel projectId={projectId} onErrorOriginal={setLastErrorOriginal} />}
        {tab === 'export' && <PromptDeliveryPanel projectId={projectId} onErrorOriginal={setLastErrorOriginal} />}
        {tab === 'skill' && <QuickSkillPanel projectId={projectId} onErrorOriginal={setLastErrorOriginal} />}
      </Card>

      {/* 第三层（默认收起）：最近一次失败的原始信息。
          主区只给中文结论（见各面板的 `message.*`），原文在这里可查 —— 展开才看得到。
          没有失败过时不渲染，避免页面上挂一个空壳。 */}
      {lastErrorOriginal ? (
        <TechnicalDetailSection
          testId="prompt-flow-error-technical-detail"
          hint="最近一次失败的原始信息（含服务端返回的诊断明细），只在排查问题时需要看。"
        >
          <div className="whitespace-pre-wrap break-all">{maskInternalIds(lastErrorOriginal)}</div>
        </TechnicalDetailSection>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 标签页一：巨日禄导入                                                  */
/* ------------------------------------------------------------------ */

const JuriluImportPanel: React.FC<{ projectId?: string; onErrorOriginal?: (raw: string) => void }> = ({
  projectId,
  onErrorOriginal,
}) => {
  /** 本面板错误出口：主区一句中文 + 原文上报给页面级「技术详情」（审计 §9.1-8）。 */
  const reportError = useCallback(
    (error: unknown): string => {
      onErrorOriginal?.(describeErrorRaw(error))
      return describeError(error)
    },
    [onErrorOriginal],
  )
  const [chapters, setChapters] = useState<ChapterOption[]>([])
  const [chapterId, setChapterId] = useState<string>()
  const [url, setUrl] = useState('')
  const [cookie, setCookie] = useState('')
  const [authorization, setAuthorization] = useState('')
  const [authMode, setAuthMode] = useState('auto')
  // 完整 Cookie 自带 Authorization= 项时，只看 Cookie 头（与工作台导入抽屉同一口径）
  const [authModeTouched, setAuthModeTouched] = useState(false)
  const [referer, setReferer] = useState('')
  const [apiOverride, setApiOverride] = useState('')
  const [createMissing, setCreateMissing] = useState(true)
  const [overwrite, setOverwrite] = useState(false)
  const [preview, setPreview] = useState<JuriluPreviewRead>()
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [loadingApply, setLoadingApply] = useState(false)

  /** 内联新建章节：本页要求在既有章节上写提示词，缺章节时必须能就地补出来，不能只给一句灰按钮。 */
  const [createChapterOpen, setCreateChapterOpen] = useState(false)
  /** 章节原始行（含 index）：新建章节的序号要用 max(index)+1，不能只存 label/value。 */
  const [chapterRows, setChapterRows] = useState<{ id: string; title: string; index: number }[]>([])
  const [createChapterTitle, setCreateChapterTitle] = useState('')
  const [createChapterText, setCreateChapterText] = useState('')
  const [creatingChapter, setCreatingChapter] = useState(false)

  const reloadChapters = useCallback(
    async (autoSelectId?: string) => {
      if (!projectId) {
        setChapters([])
        setChapterRows([])
        return
      }
      const items = await loadAll(async (page, pageSize) => {
        const res = await StudioChaptersService.listChaptersApiV1StudioChaptersGet({
          projectId,
          page,
          pageSize,
        })
        return {
          items: res.data?.items ?? [],
          maxPage: res.data?.pagination?.max_page ?? 1,
        }
      })
      const options = items.map((c, i) => ({
        label: c.title || untitledChapterLabel(c.index ?? i + 1),
        value: c.id,
      }))
      setChapterRows(
        items.map((c, i) => ({
          id: c.id,
          title: c.title || untitledChapterLabel(c.index ?? i + 1),
          index: typeof c.index === 'number' && Number.isFinite(c.index) ? c.index : 0,
        })),
      )
      setChapters(options)
      if (autoSelectId && options.some((option) => option.value === autoSelectId)) {
        setChapterId(autoSelectId)
        setPreview(undefined)
      }
      return options
    },
    [projectId],
  )

  const handleCreateChapter = useCallback(async () => {
    if (!projectId) return
    const title = createChapterTitle.trim()
    if (!title) {
      message.warning('请填写章节标题')
      return
    }
    setCreatingChapter(true)
    try {
      // id 是 ChapterCreate 的必填字段（与工作台建章节用的是同一套字段）
      const createdId = `c_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`
      // 序号口径：现有章节最大 index + 1（不是章节数量 + 1）
      const nextIndex = nextChapterIndex(chapterRows.map((row) => row.index))
      const created = await StudioChaptersService.createChapterApiV1StudioChaptersPost({
        requestBody: {
          id: createdId,
          project_id: projectId,
          index: nextIndex,
          title,
          summary: '',
          raw_text: createChapterText || undefined,
          storyboard_count: 0,
          status: 'draft',
        } as never,
      })
      const newId = String((created.data as { id?: string } | undefined)?.id ?? '')
      message.success('章节已创建，并已自动选中；现在可以预览与确认写入')
      setCreateChapterOpen(false)
      setCreateChapterTitle('')
      setCreateChapterText('')
      await reloadChapters(newId || undefined)
    } catch (error) {
      message.error(`新建章节失败：${reportError(error)}`)
    } finally {
      setCreatingChapter(false)
    }
  }, [chapterRows, createChapterText, createChapterTitle, projectId, reloadChapters, reportError])

  useEffect(() => {
    setChapterId(undefined)
    setPreview(undefined)
    if (!projectId) {
      setChapters([])
      return
    }
    void (async () => {
      try {
        const items = await loadAll(async (page, pageSize) => {
          const res = await StudioChaptersService.listChaptersApiV1StudioChaptersGet({
            projectId,
            page,
            pageSize,
          })
          return {
            items: res.data?.items ?? [],
            maxPage: res.data?.pagination?.max_page ?? 1,
          }
        })
        setChapters(
          items.map((c, i) => ({ label: c.title || untitledChapterLabel(c.index ?? i + 1), value: c.id })),
        )
      } catch (error) {
        message.error(`加载章节失败：${reportError(error)}`)
      }
    })()
  }, [projectId, reportError])

  const canSubmit = Boolean(projectId && chapterId && url.trim())

  /**
   * 提交前的凭证填写护栏：登录凭证框只接**单个**凭证值，整串 Cookie 属于 Cookie 框。
   *
   * 审计 §4.5 模式 4（`:402`）：改前主区文案里直接写 `Authorization` / `Referer`
   * 这类原始请求头名。按建议口径统一换成用户语言（登录凭证 / 来源页）；
   * 代码里判断的仍然是真实请求头（`Authorization=`），只有**给用户看的那一句**变了。
   */
  const juriluCredentialBlocked = useCallback(() => {
    const raw = authorization.trim()
    if (raw.includes('Authorization=') || raw.includes(';')) {
      message.error('登录凭证框收到的是整串 Cookie：请把它放进上面的 Cookie 框，登录凭证框留空（发送方式选「不发送（仅 Cookie）」）')
      return true
    }
    if (!referer.trim()) {
      // 来源页留空也能跑（后端会用页面 URL 兜底），这里只提示更稳的填法
      message.info('来源页留空将默认使用上面的页面 URL')
    }
    return false
  }, [authorization, referer])

  const buildRequest = () => ({
    projectId: projectId as string,
    requestBody: {
      chapter_id: chapterId as string,
      url: url.trim(),
      cookie,
      authorization,
      auth_mode: authMode,
      referer,
      api_url_override: apiOverride,
      create_missing: createMissing,
      overwrite,
    },
  })

  const handlePreview = async () => {
    if (!canSubmit) {
      message.warning('请先选择项目、章节，并填写巨日禄页面 URL')
      return
    }
    setLoadingPreview(true)
    try {
      const res = await StudioJuriluImportService.previewJuriluImportApiV1StudioJuriluImportProjectIdPreviewPost(
        buildRequest()
      )
      setPreview(res.data ?? undefined)
      message.success('预览完成，尚未写入数据库')
    } catch (error) {
      setPreview(undefined)
      message.error(reportError(error), 8)
    } finally {
      setLoadingPreview(false)
    }
  }

  const handleApply = async () => {
    if (!canSubmit) {
      message.warning('请先选择项目、章节，并填写巨日禄页面 URL')
      return
    }
    setLoadingApply(true)
    try {
      const res =
        await StudioJuriluImportService.applyJuriluImportApiV1StudioJuriluImportProjectIdApplyPost(
          buildRequest()
        )
      const data = res.data
      message.success(`写入完成：更新 ${data?.updated ?? 0} 条，新建镜头 ${data?.created ?? 0} 个`)
      await handlePreview()
    } catch (error) {
      message.error(reportError(error), 8)
    } finally {
      setLoadingApply(false)
    }
  }

  const columns: ColumnsType<JuriluPlanRowRead> = [
    {
      title: '分镜',
      dataIndex: 'order',
      width: 70,
      render: (value: number) => <Text strong>#{value}</Text>,
    },
    {
      title: '动作',
      dataIndex: 'action',
      width: 120,
      render: (value: string) => {
        const meta = ACTION_META[value] ?? { text: value, color: 'default' }
        return <Tag color={meta.color}>{meta.text}</Tag>
      },
    },
    {
      title: '目标镜头',
      dataIndex: 'index',
      width: 110,
      render: (value: number, row) =>
        row.shot_id ? (
          <Text>
            S{String(value).padStart(3, '0')} <Text type="secondary">· {row.title || '未命名'}</Text>
          </Text>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: '分镜名称',
      dataIndex: 'label',
      width: 160,
      ellipsis: true,
    },
    {
      title: '提示词预览',
      dataIndex: 'prompt',
      ellipsis: true,
      render: (value: string) =>
        value ? <Text>{value.slice(0, 90)}</Text> : <Text type="secondary">（空）</Text>,
    },
    {
      title: '说明',
      dataIndex: 'reason',
      width: 220,
      ellipsis: true,
      render: (value: string) => <Text type="secondary">{value}</Text>,
    },
  ]

  const counts = preview?.counts ?? {}
  const writable =
    (counts.update ?? 0) + (counts.overwrite ?? 0) + (counts.create ?? 0)

  return (
    <>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Row gutter={16}>
        <Col span={12}>
          <Text strong>目标章节</Text>
          <Select
            style={{ width: '100%', marginTop: 4 }}
            placeholder={projectId ? '选择要写入的章节' : '请先选择项目'}
            value={chapterId}
            onChange={(value) => {
              setChapterId(value)
              setPreview(undefined)
            }}
            options={chapters}
            disabled={!projectId}
            showSearch
            optionFilterProp="label"
            notFoundContent={
              projectId ? (
                <div className="p-2 text-xs text-gray-500">
                  该项目还没有章节
                  <div className="mt-1 text-[11px] text-gray-400">
                    提示词要写到章节的镜头上，所以必须先有章节。
                  </div>
                </div>
              ) : null
            }
          />
          {projectId && chapters.length === 0 ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 8 }}
              message="该项目还没有章节"
              description={
                <span className="text-xs">
                  提示词要写到章节的镜头上，没有章节就无法继续。请先创建章节（也可以回到项目工作台第 1 步创建）。
                </span>
              }
              action={
                <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setCreateChapterOpen(true)}>
                  新建章节
                </Button>
              }
            />
          ) : null}
        </Col>
        <Col span={12}>
          <Text strong>巨日禄页面 URL</Text>
          {/* 审计 §4.6 模式 4：placeholder 也在用户可见面（悬停即见），不许带参数名 */}
          <Input
            style={{ marginTop: 4 }}
            placeholder="例如：https://…/agent"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            allowClear
          />
        </Col>
      </Row>

      <div>
        <Text strong>Cookie</Text>
        <Text type="secondary" style={{ marginLeft: 8 }}>
          从浏览器复制「全部 Cookie」整段粘贴。不保存、不写库、不写日志。
        </Text>
        <Input.TextArea
          style={{ marginTop: 4 }}
          rows={3}
          placeholder="粘贴整段 Cookie 字符串（应包含开头的登录凭证项）"
          value={cookie}
          onChange={(e) => {
            const next = e.target.value
            setCookie(next)
            if (!authModeTouched && next.includes('Authorization=')) setAuthMode('none')
            if (next && !next.includes('Authorization=')) {
              /* 审计 §4.5 模式 4：用户可见的那一句不写原始请求头名。 */
              message.warning('Cookie 里没有登录凭证项，可能不是完整 Cookie（请用「复制全部 Cookie」）')
            }
          }}
          autoComplete="off"
        />
      </div>

      <Collapse
        size="small"
        items={[
          {
            key: 'advanced',
            label: '高级选项（登录凭证 / 来源页 / 接口地址覆盖 / 是否写回）',
            children: (
              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                <Row gutter={16}>
                  <Col span={12}>
                    <Text>登录凭证（可留空）</Text>
                    <Input.Password
                      style={{ marginTop: 4 }}
                      placeholder="单个登录凭证值（整串 Cookie 请放上面的 Cookie 框，这里留空）"
                      value={authorization}
                      onChange={(e) => setAuthorization(e.target.value)}
                      autoComplete="off"
                    />
                  </Col>
                  <Col span={12}>
                    <Text>登录凭证发送方式</Text>
                    <Select
                      style={{ width: '100%', marginTop: 4 }}
                      value={authMode}
                      onChange={(value) => {
                        setAuthModeTouched(true)
                        setAuthMode(value)
                      }}
                      options={[
                        { label: '自动（有值就原样发送）', value: 'auto' },
                        { label: '不发送', value: 'none' },
                        { label: '原样发送', value: 'raw' },
                        { label: '按 Bearer 发送', value: 'bearer' },
                      ]}
                    />
                  </Col>
                </Row>
                <Row gutter={16}>
                  <Col span={12}>
                    <Text>来源页覆盖（可留空）</Text>
                    <Input
                      style={{ marginTop: 4 }}
                      value={referer}
                      onChange={(e) => setReferer(e.target.value)}
                      allowClear
                    />
                  </Col>
                  <Col span={12}>
                    <Text>接口地址覆盖（可留空）</Text>
                    <Input
                      style={{ marginTop: 4 }}
                      placeholder="默认从页面 URL 推断"
                      value={apiOverride}
                      onChange={(e) => setApiOverride(e.target.value)}
                      allowClear
                    />
                  </Col>
                </Row>
                <Space size="large">
                  <Space>
                    <span>分镜多于镜头时新建镜头</span>
                    <Select
                      size="small"
                      style={{ width: 110 }}
                      value={createMissing}
                      onChange={setCreateMissing}
                      options={[
                        { label: '允许新建', value: true },
                        { label: '不新建', value: false },
                      ]}
                    />
                  </Space>
                  <Space>
                    <span>镜头已有提示词时</span>
                    <Select
                      size="small"
                      style={{ width: 110 }}
                      value={overwrite}
                      onChange={setOverwrite}
                      options={[
                        { label: '不覆盖', value: false },
                        { label: '允许覆盖', value: true },
                      ]}
                    />
                  </Space>
                </Space>
              </Space>
            ),
          },
        ]}
      />

      <Space>
        <Button
          type="primary"
          icon={<EyeOutlined />}
          loading={loadingPreview}
          disabled={!canSubmit}
          onClick={() => {
            if (juriluCredentialBlocked()) return
            void handlePreview()
          }}
        >
          预览（不写库）
        </Button>
        <Button
          icon={<CloudUploadOutlined />}
          loading={loadingApply}
          disabled={!canSubmit || !preview || writable === 0}
          onClick={() => {
            if (juriluCredentialBlocked()) return
            void handleApply()
          }}
        >
          确认写入
        </Button>
        {preview && (
          <Text type="secondary">
            可写入 {writable} 条 · 章节现有镜头 {preview.chapter_shot_count} 个 · 抓到分镜{' '}
            {preview.entry_count} 条
          </Text>
        )}
      </Space>

      {preview?.warnings && preview.warnings.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message="抓取告警"
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {preview.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          }
        />
      )}

      {preview ? (
        <>
          <Alert type="success" showIcon message={preview.plan_summary} />
          <Table<JuriluPlanRowRead>
            size="small"
            rowKey={(row) => `${row.order}-${row.action}`}
            columns={columns}
            dataSource={preview.rows}
            pagination={{ pageSize: 20, showSizeChanger: false }}
            scroll={{ x: 900 }}
          />
          {preview.diagnostics && Object.keys(preview.diagnostics).length > 0 && (
            <Collapse
              size="small"
              items={[
                {
                  key: 'diag',
                  label: '抓取诊断（已脱敏，Cookie 不会出现在这里）',
                  children: (
                    <Descriptions size="small" column={1} bordered>
                      {Object.entries(preview.diagnostics).map(([k, v]) => (
                        <Descriptions.Item key={k} label={k}>
                          <Text code>{JSON.stringify(v)}</Text>
                        </Descriptions.Item>
                      ))}
                    </Descriptions>
                  ),
                },
              ]}
            />
          )}
        </>
      ) : (
        <Empty description="还没有预览结果" />
      )}
    </Space>

    {/* 内联新建章节：本页需要在既有章节上写提示词，缺章节时不能只留一条死路 */}
    <Modal
      title="新建章节"
      open={createChapterOpen}
      onCancel={() => setCreateChapterOpen(false)}
      onOk={() => void handleCreateChapter()}
      okText="创建并选中"
      cancelText="取消"
      confirmLoading={creatingChapter}
      destroyOnClose
    >
      <Space direction="vertical" size="small" style={{ width: '100%' }}>
        <Text strong>章节标题</Text>
        <Input
          placeholder="例如：第 1 集"
          value={createChapterTitle}
          onChange={(e) => setCreateChapterTitle(e.target.value)}
        />
        <Text strong>章节内容（可粘贴剧本，选填）</Text>
        <Input.TextArea
          rows={6}
          placeholder="可留空：提示词导入只需要章节作为镜头的载体"
          value={createChapterText}
          onChange={(e) => setCreateChapterText(e.target.value)}
        />
        <Text type="secondary" className="text-xs">
          创建后会自动选中该章节并恢复「预览 / 确认写入」按钮；镜头不足时导入会按既有规则补建。
        </Text>
      </Space>
    </Modal>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* 标签页二：出口 A（仅提示词导出）                                       */
/* ------------------------------------------------------------------ */

/**
 * 交付行 + 本次后端新增的交付字段。
 *
 * `bound_assets` / `export_sources` / `include_bindings` 是后端本次新增的，
 * 而 `src/services/generated/**` 是自动产物（生成链依赖 pnpm，本机未安装），
 * 尚未包含它们——所以这里做一处局部类型扩展，而不是手改生成目录。
 */
type DeliveryRowWithBindings = PromptDeliveryRowRead & {
  bound_assets?: Record<string, string[]>
}

const BINDING_SLOT_LABELS: Array<[string, string]> = [
  ['characters', '角色'],
  ['scene', '场景'],
  ['props', '道具'],
  ['costumes', '服装'],
]

function renderBoundAssets(bound?: Record<string, string[]>): React.ReactNode {
  if (!bound) return <Text type="secondary">—</Text>
  const parts = BINDING_SLOT_LABELS.map(([key, label]) => {
    const names = bound[key] ?? []
    return names.length ? `${label}：${names.join('、')}` : ''
  }).filter(Boolean)
  if (!parts.length) return <Text type="secondary">未绑定</Text>
  return <Text>{parts.join('；')}</Text>
}

const PromptDeliveryPanel: React.FC<{ projectId?: string; onErrorOriginal?: (raw: string) => void }> = ({
  projectId,
  onErrorOriginal,
}) => {
  /** 本面板错误出口：主区一句中文 + 原文上报给页面级「技术详情」（审计 §9.1-8）。 */
  const reportError = useCallback(
    (error: unknown): string => {
      onErrorOriginal?.(describeErrorRaw(error))
      return describeError(error)
    },
    [onErrorOriginal],
  )
  const [scope, setScope] = useState<'episodes' | 'episode' | 'current_shot'>('episodes')
  const [chapters, setChapters] = useState<ChapterOption[]>([])
  const [chapterId, setChapterId] = useState<string>()
  const [shots, setShots] = useState<ShotOption[]>([])
  const [shotId, setShotId] = useState<string>()
  const [data, setData] = useState<PromptDeliveryRead>()
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  // 交付文本是否带出绑定资产（后端本次新增，默认开）
  const [includeBindings, setIncludeBindings] = useState(true)

  useEffect(() => {
    setChapterId(undefined)
    setShotId(undefined)
    setData(undefined)
    if (!projectId) {
      setChapters([])
      return
    }
    void (async () => {
      try {
        const items = await loadAll(async (page, pageSize) => {
          const res = await StudioChaptersService.listChaptersApiV1StudioChaptersGet({
            projectId,
            page,
            pageSize,
          })
          return {
            items: res.data?.items ?? [],
            maxPage: res.data?.pagination?.max_page ?? 1,
          }
        })
        setChapters(
          items.map((c, i) => ({ label: c.title || untitledChapterLabel(c.index ?? i + 1), value: c.id })),
        )
      } catch (error) {
        message.error(`加载章节失败：${reportError(error)}`)
      }
    })()
  }, [projectId, reportError])

  useEffect(() => {
    setShotId(undefined)
    if (!chapterId || scope !== 'current_shot') {
      setShots([])
      return
    }
    void (async () => {
      try {
        const items = await loadAll(async (page, pageSize) => {
          const res = await StudioShotsService.listShotsApiV1StudioShotsGet({
            chapterId,
            page,
            pageSize,
          })
          return {
            items: res.data?.items ?? [],
            maxPage: res.data?.pagination?.max_page ?? 1,
          }
        })
        setShots(
          items.map((s) => ({
            label: `S${String(s.index).padStart(3, '0')} · ${s.title}`,
            value: s.id,
          }))
        )
      } catch (error) {
        message.error(`加载镜头失败：${reportError(error)}`)
      }
    })()
  }, [chapterId, scope, reportError])

  const query = useMemo(() => {
    const params: { projectId: string; scope: string; chapterId?: string; shotId?: string } = {
      projectId: projectId as string,
      scope,
    }
    if (scope === 'episode' || scope === 'current_shot') params.chapterId = chapterId
    if (scope === 'current_shot') params.shotId = shotId
    return params
  }, [projectId, scope, chapterId, shotId])

  const scopeReady =
    Boolean(projectId) &&
    (scope === 'episodes' ||
      ((scope === 'episode' || scope === 'current_shot') && Boolean(chapterId)) &&
      (scope !== 'current_shot' || Boolean(shotId)))

  const handlePreview = async () => {
    if (!scopeReady) {
      message.warning('请先补全选择范围')
      return
    }
    setLoading(true)
    try {
      const res =
        await StudioPromptDeliveryService.previewPromptDeliveryApiV1StudioPromptDeliveryProjectIdGet(
          query
        )
      setData(res.data ?? undefined)
    } catch (error) {
      setData(undefined)
      message.error(reportError(error), 8)
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = async () => {
    if (!scopeReady) {
      message.warning('请先补全选择范围')
      return
    }
    setDownloading(true)
    try {
      const search = new URLSearchParams()
      search.set('scope', scope)
      if (query.chapterId) search.set('chapter_id', query.chapterId)
      if (query.shotId) search.set('shot_id', query.shotId)
      search.set('include_bindings', includeBindings ? 'true' : 'false')
      const response = await fetch(
        `${apiBase()}/api/v1/studio/prompt-delivery/${encodeURIComponent(
          projectId as string
        )}/export?${search.toString()}`
      )
      if (!response.ok) {
        const text = await response.text()
        let parsed: unknown
        try {
          parsed = JSON.parse(text)
        } catch {
          parsed = undefined
        }
        /* 审计 §4.6 模式 4：原来抛的是 `renderEnvelope(...)` 的展开结果（含 `meta.diagnostics` /
           `meta.warnings` / HTTP 状态码），它会被 `message.error` 直接打到主区。
           现在主区只给一句中文，原文（脱敏后）进「技术详情」。 */
        rememberTechnicalDetail({
          title: '下载失败',
          detail: maskInternalIds(renderEnvelope(parsed, text || '服务端没有返回可读说明')),
          scope: '导出提示词',
        })
        throw new Error('下载失败，请稍后重试')
      }
      const blob = await response.blob()
      const disposition = response.headers.get('Content-Disposition') ?? ''
      const matched = /filename="?([^"]+)"?/.exec(disposition)
      const filename = matched?.[1] ?? 'prompts.txt'
      const link = document.createElement('a')
      const objectUrl = URL.createObjectURL(blob)
      link.href = objectUrl
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(objectUrl)
      message.success(`已下载 ${filename}`)
    } catch (error) {
      message.error(reportError(error), 8)
    } finally {
      setDownloading(false)
    }
  }

  const handleCopy = async () => {
    if (!data?.text) return
    try {
      await navigator.clipboard.writeText(data.text)
      message.success('提示词正文已复制到剪贴板')
    } catch {
      message.warning('浏览器拒绝了剪贴板访问，请手动选中下方文本复制')
    }
  }

  const columns: ColumnsType<DeliveryRowWithBindings> = [
    {
      title: '镜头',
      dataIndex: 'shot_code',
      width: 100,
      render: (value: string) => <Text strong>{value}</Text>,
    },
    {
      title: '章节',
      dataIndex: 'chapter_label',
      width: 130,
      render: (value: string) => <Text>{value}</Text>,
    },
    { title: '标题', dataIndex: 'shot_title', width: 180, ellipsis: true },
    {
      title: '可交付',
      dataIndex: 'exportable',
      width: 90,
      render: (value: boolean) =>
        value ? <Tag color="green">可导出</Tag> : <Tag>跳过</Tag>,
    },
    {
      title: '提示词',
      dataIndex: 'video_prompt',
      ellipsis: true,
      render: (value: string) =>
        value ? <Text>{value.slice(0, 80)}</Text> : <Text type="secondary">（空）</Text>,
    },
    {
      title: '绑定资产',
      dataIndex: 'bound_assets',
      width: 240,
      render: (value: Record<string, string[]> | undefined) => renderBoundAssets(value),
    },
    {
      title: '说明',
      dataIndex: 'issue',
      width: 160,
      render: (value: string) =>
        value ? <Text type="secondary">{value}</Text> : <Text type="secondary">—</Text>,
    },
  ]

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Row gutter={16} align="bottom">
        <Col>
          <Text strong>导出范围</Text>
          <div style={{ marginTop: 4 }}>
            <Segmented
              value={scope}
              onChange={(value) => {
                setScope(value as 'episodes' | 'episode' | 'current_shot')
                setData(undefined)
              }}
              options={[
                { label: '整个项目', value: 'episodes' },
                { label: '指定章节', value: 'episode' },
                { label: '指定镜头', value: 'current_shot' },
              ]}
            />
          </div>
        </Col>
        {scope !== 'episodes' && (
          <Col>
            <Text strong>章节</Text>
            <Select
              style={{ width: 240, marginTop: 4 }}
              placeholder={projectId ? '选择章节' : '请先选择项目'}
              value={chapterId}
              onChange={(value) => {
                setChapterId(value)
                setData(undefined)
              }}
              options={chapters}
              disabled={!projectId}
              showSearch
              optionFilterProp="label"
            />
          </Col>
        )}
        {scope === 'current_shot' && (
          <Col>
            <Text strong>镜头</Text>
            <Select
              style={{ width: 240, marginTop: 4 }}
              placeholder={chapterId ? '选择镜头' : '请先选择章节'}
              value={shotId}
              onChange={(value) => {
                setShotId(value)
                setData(undefined)
              }}
              options={shots}
              disabled={!chapterId}
              showSearch
              optionFilterProp="label"
            />
          </Col>
        )}
        <Col>
          <Space>
            <Button
              type="primary"
              icon={<EyeOutlined />}
              loading={loading}
              disabled={!scopeReady}
              onClick={() => void handlePreview()}
            >
              预览
            </Button>
            <Checkbox
              checked={includeBindings}
              onChange={(e) => setIncludeBindings(e.target.checked)}
            >
              带出绑定资产
            </Checkbox>
            <Button
              icon={<CloudDownloadOutlined />}
              loading={downloading}
              disabled={!scopeReady}
              onClick={() => void handleDownload()}
            >
              下载 TXT
            </Button>
            <Button onClick={() => void handleCopy()} disabled={!data?.text}>
              复制正文
            </Button>
          </Space>
        </Col>
      </Row>

      {data ? (
        <>
          <Row gutter={16}>
            <Col span={6}>
              <Card size="small">
                <Statistic title="可导出" value={data.exportable_count} suffix="条" />
              </Card>
            </Col>
            <Col span={6}>
              <Card size="small">
                <Statistic title="跳过" value={data.skipped_count} suffix="条" />
              </Card>
            </Col>
            <Col span={6}>
              <Card size="small">
                <Statistic title="范围" value={data.scope_label} />
              </Card>
            </Col>
            <Col span={6}>
              <Card size="small">
                <Statistic title="来源口径" value={data.export_source} />
              </Card>
            </Col>
          </Row>

          {data.note && <Alert type="info" showIcon message={data.note} />}
          {!data.has_content && (
            <Alert
              type="warning"
              showIcon
              message="这个范围内没有可导出的提示词（只导出「巨日禄导入」且有正文的那些）"
            />
          )}

          <Table<DeliveryRowWithBindings>
            size="small"
            rowKey="shot_id"
            columns={columns}
            dataSource={data.rows}
            pagination={{ pageSize: 20, showSizeChanger: false }}
            scroll={{ x: 900 }}
          />

          <Divider style={{ margin: '8px 0' }}>交付文本预览</Divider>
          <Input.TextArea value={data.text} readOnly rows={12} />
        </>
      ) : (
        <Empty description="选择范围后点「预览」" />
      )}
    </Space>
  )
}

/* ------------------------------------------------------------------ */
/* 标签页三：一键技能（导演 Skill 生成 + 导出 + 写回镜头）                 */
/* ------------------------------------------------------------------ */

const QuickSkillPanel: React.FC<{ projectId?: string; onErrorOriginal?: (raw: string) => void }> = ({
  projectId,
  onErrorOriginal,
}) => {
  /** 本面板错误出口：主区一句中文 + 原文上报给页面级「技术详情」（审计 §9.1-8）。 */
  const reportError = useCallback(
    (error: unknown): string => {
      onErrorOriginal?.(describeErrorRaw(error))
      return describeError(error)
    },
    [onErrorOriginal],
  )
  const [skills, setSkills] = useState<QuickSkillItem[]>([])
  const [skillId, setSkillId] = useState<string>()
  const [chapters, setChapters] = useState<ChapterOption[]>([])
  const [chapterId, setChapterId] = useState<string>()
  const [shots, setShots] = useState<ShotOption[]>([])
  const [shotId, setShotId] = useState<string>()
  const [request, setRequest] = useState('')
  const [extraContext, setExtraContext] = useState('')
  const [contextText, setContextText] = useState('')
  const [result, setResult] = useState<QuickSkillGenerateRead>()
  const [promptDraft, setPromptDraft] = useState('')
  const [overwrite, setOverwrite] = useState(false)
  const [loadingContext, setLoadingContext] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [downloading, setDownloading] = useState(false)

  /**
   * 服务端草稿（修「一键技能生成后只在浏览器内存里」）。
   *
   * 这里生成的是**真实付费**的文字模型产出，此前刷新/切标签页就没了。
   * 现在：生成成功且已选镜头 → 立刻 `POST /drafts` 暂存服务端（source=skill，**不写正式列**）；
   * 换镜头/重进页面 → `GET /drafts` 自动恢复"上次生成到哪了"；
   * 只有点「写入镜头」确认后，才清掉对应草稿（草稿使命完成）。
   */
  const [draftInfo, setDraftInfo] = useState<PromptBoardDraft | null>(null)
  /** 本次会话是否已经把这份草稿写进正式列（页面据此区分"草稿 vs 已保存"） */
  const [writtenToShot, setWrittenToShot] = useState(false)
  const [draftBusy, setDraftBusy] = useState(false)
  /** 自动恢复只在"输入框还是空的"时做，绝不能覆盖用户正在编辑的正文 */
  const promptDraftRef = React.useRef('')

  useEffect(() => {
    void (async () => {
      try {
        const res = await StudioQuickSkillService.listQuickSkillsApiV1StudioQuickSkillSkillsGet()
        setSkills(res.data?.skills ?? [])
      } catch (error) {
        /* 审计 §9.1-1 / §9.1-19：枚举原名 `skill` 不进主区，且同一份数据全仓只允许一个名字
           （本页已经在用「导演技能」）—— 原来这里写的是「导演 Skill」，两种说法打架。 */
        message.error(`加载导演技能失败：${reportError(error)}`)
      }
    })()
  }, [reportError])

  useEffect(() => {
    setChapterId(undefined)
    setShotId(undefined)
    setContextText('')
    if (!projectId) {
      setChapters([])
      return
    }
    void (async () => {
      try {
        const items = await loadAll(async (page, pageSize) => {
          const res = await StudioChaptersService.listChaptersApiV1StudioChaptersGet({
            projectId,
            page,
            pageSize,
          })
          return {
            items: res.data?.items ?? [],
            maxPage: res.data?.pagination?.max_page ?? 1,
          }
        })
        setChapters(
          items.map((c, i) => ({ label: c.title || untitledChapterLabel(c.index ?? i + 1), value: c.id })),
        )
      } catch (error) {
        message.error(`加载章节失败：${reportError(error)}`)
      }
    })()
  }, [projectId, reportError])

  useEffect(() => {
    setShotId(undefined)
    setContextText('')
    if (!chapterId) {
      setShots([])
      return
    }
    void (async () => {
      try {
        const items = await loadAll(async (page, pageSize) => {
          const res = await StudioShotsService.listShotsApiV1StudioShotsGet({
            chapterId,
            page,
            pageSize,
          })
          return {
            items: res.data?.items ?? [],
            maxPage: res.data?.pagination?.max_page ?? 1,
          }
        })
        setShots(
          items.map((s) => ({
            label: `S${String(s.index).padStart(3, '0')} · ${s.title}`,
            value: s.id,
          }))
        )
      } catch (error) {
        message.error(`加载镜头失败：${reportError(error)}`)
      }
    })()
  }, [chapterId, reportError])

  /** 输入框正文镜像：自动恢复时用它判断"用户是不是已经在编辑了"。 */
  useEffect(() => {
    promptDraftRef.current = promptDraft
  }, [promptDraft])

  /** 读这一镜的服务端草稿（只读、不花钱）；读不到返回 null，不影响生成。 */
  const loadShotDraft = useCallback(
    async (chapter: string, shot: string): Promise<PromptBoardDraft | null> => {
      const state = await fetchPromptBoardDrafts(chapter)
      return (state.shots ?? []).find((item) => String(item.shot_id) === String(shot)) ?? null
    },
    [],
  )

  /**
   * 换镜头 / 重进页面时恢复草稿。
   *
   * 自动恢复只在**输入框为空**时发生：用户在编辑的正文一旦被覆盖，
   * 就变成"修一个丢数据的问题、引入另一个丢数据的问题"了。
   */
  useEffect(() => {
    let cancelled = false
    if (!chapterId || !shotId) {
      setDraftInfo(null)
      setWrittenToShot(false)
      return () => {
        cancelled = true
      }
    }
    void (async () => {
      try {
        const found = await loadShotDraft(chapterId, shotId)
        if (cancelled) return
        setDraftInfo(found)
        setWrittenToShot(false)
        const body = String(found?.prompt ?? '').trim()
        if (body && !promptDraftRef.current.trim()) {
          setPromptDraft(found?.prompt ?? '')
          message.info(`已恢复该镜头上次生成的服务端草稿（${body.length} 字，刷新/中断都不丢）`, 5)
        } else if (body) {
          message.warning('该镜头在服务端还有一份草稿：点「恢复该镜草稿」可载入（不会覆盖你正在编辑的正文）', 6)
        }
      } catch {
        if (!cancelled) setDraftInfo(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [chapterId, loadShotDraft, shotId])

  /** 把当前正文暂存到服务端草稿（幂等 upsert；**绝不写正式列**）。 */
  const persistDraft = async (prompt: string, model = ''): Promise<PromptBoardDraft | null> => {
    if (!chapterId || !shotId || !prompt.trim()) return null
    const saved = await saveShotDraft(chapterId, {
      shot_id: shotId,
      status: 'ok',
      prompt,
      source: 'skill',
      // 模型名要由调用方显式传进来：setResult 是异步的，读 result 会拿到上一次的值
      model: model || result?.model_used || '',
    })
    const draft = saved.draft ?? null
    setDraftInfo(draft)
    return draft
  }

  const handleRestoreDraft = () => {
    if (!draftInfo?.prompt?.trim()) {
      message.warning('这一镜在服务端没有草稿')
      return
    }
    setPromptDraft(draftInfo.prompt)
    message.success('已载入该镜头的服务端草稿（还没有写入正式列）')
  }

  const handleStashDraft = async () => {
    if (!promptDraft.trim()) {
      message.warning('提示词为空，没什么可暂存')
      return
    }
    setDraftBusy(true)
    try {
      await persistDraft(promptDraft)
      message.success('已暂存到服务端草稿（刷新/中断都不丢；正式列仍未被修改）')
    } catch (error) {
      message.error(`暂存失败：${reportError(error)}`, 8)
    } finally {
      setDraftBusy(false)
    }
  }

  const selectedSkill = skills.find((s) => s.skill_id === skillId)
  const canGenerate = Boolean(skillId && request.trim())

  const handlePreviewContext = async () => {
    if (!shotId && !chapterId) {
      message.warning('先选章节或镜头，才能装配上下文')
      return
    }
    setLoadingContext(true)
    try {
      const res = await StudioQuickSkillService.previewQuickSkillContextApiV1StudioQuickSkillContextGet({
        chapterId,
        shotId,
      })
      setContextText(res.data?.text ?? '')
      message.success('上下文已装配（未调用模型）')
    } catch (error) {
      message.error(reportError(error), 8)
    } finally {
      setLoadingContext(false)
    }
  }

  const handleGenerate = async () => {
    if (!canGenerate) {
      message.warning('请先选择导演技能并写清楚需求')
      return
    }
    setGenerating(true)
    try {
      const res =
        await StudioQuickSkillService.generateQuickSkillApiV1StudioQuickSkillGeneratePost({
          requestBody: {
            skill_id: skillId as string,
            request: request.trim(),
            context: extraContext,
            project_id: projectId,
            chapter_id: chapterId,
            shot_id: shotId,
            save_to_shot: false,
          },
        })
      const data = res.data ?? undefined
      setResult(data)
      setPromptDraft(data?.prompt ?? '')
      setContextText(data?.context ?? '')
      const body = String(data?.prompt ?? '')
      if (!chapterId || !shotId) {
        // 没有镜头就无处可放草稿：必须说清楚，别让用户以为已经存好了
        message.warning(
          '生成完成。未选镜头：这次结果只在本页内存里，刷新会丢 —— 选中镜头后生成会自动暂存到服务端。',
          8,
        )
        return
      }
      try {
        // 生成成功立刻落服务端草稿（不写正式列）：这是"刷新不丢"的关键一步
        await persistDraft(body, data?.model_used ?? '')
        setWrittenToShot(false)
        message.success('生成完成 · 草稿已暂存服务端（未写正式列）')
      } catch (error) {
        message.warning(`生成完成，但草稿暂存服务端失败（刷新会丢）：${reportError(error)}`, 10)
      }
    } catch (error) {
      message.error(reportError(error), 10)
    } finally {
      setGenerating(false)
    }
  }

  const handleCopy = async () => {
    if (!promptDraft.trim()) return
    try {
      await navigator.clipboard.writeText(promptDraft)
      message.success('提示词已复制到剪贴板')
    } catch {
      message.warning('浏览器拒绝了剪贴板访问，请手动选中文本框复制')
    }
  }

  const handleDownload = async () => {
    if (!promptDraft.trim() || !skillId) {
      message.warning('还没有可导出的提示词')
      return
    }
    setDownloading(true)
    try {
      const response = await fetch(`${apiBase()}/api/v1/studio/quick-skill/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skill_id: skillId,
          project_id: projectId ?? '',
          /* 审计 §4.6 模式 1：原来把 `skill_id` 拼进标题（内部编号上屏）→ 只保留中文名 */
          title: selectedSkill?.display_name || '提示词生成',
          entries: [
            {
              label: shotId
                ? `S${String(shots.findIndex((s) => s.value === shotId) + 1).padStart(3, '0')} · ${
                    shots.find((s) => s.value === shotId)?.label ?? shotId
                  }`
                : selectedSkill?.display_name ?? '提示词生成',
              prompt: promptDraft,
              note: extraContext ? `附加上下文：${extraContext.slice(0, 120)}` : '',
            },
          ],
        }),
      })
      if (!response.ok) {
        const text = await response.text()
        let parsed: unknown
        try {
          parsed = JSON.parse(text)
        } catch {
          parsed = undefined
        }
        /* 审计 §4.6 模式 4：原来抛的是 `renderEnvelope(...)` 的展开结果（含 `meta.diagnostics` /
           `meta.warnings` / HTTP 状态码），它会被 `message.error` 直接打到主区。
           现在主区只给一句中文，原文（脱敏后）进「技术详情」。 */
        rememberTechnicalDetail({
          title: '下载失败',
          detail: maskInternalIds(renderEnvelope(parsed, text || '服务端没有返回可读说明')),
          scope: '导出提示词',
        })
        throw new Error('下载失败，请稍后重试')
      }
      const blob = await response.blob()
      const disposition = response.headers.get('Content-Disposition') ?? ''
      const matched = /filename="?([^"]+)"/.exec(disposition)
      const filename = matched?.[1] ?? 'skill-prompt.txt'
      const link = document.createElement('a')
      const objectUrl = URL.createObjectURL(blob)
      link.href = objectUrl
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(objectUrl)
      message.success(`已下载 ${filename}`)
    } catch (error) {
      message.error(reportError(error), 8)
    } finally {
      setDownloading(false)
    }
  }

  const handleSaveToShot = async () => {
    if (!shotId) {
      message.warning('先选一个镜头，才能写回')
      return
    }
    if (!promptDraft.trim()) {
      message.warning('提示词为空')
      return
    }
    setSaving(true)
    try {
      const res =
        await StudioQuickSkillService.saveQuickSkillToShotApiV1StudioQuickSkillSaveToShotPost({
          requestBody: { shot_id: shotId, prompt: promptDraft, overwrite },
        })
      const data = res.data
      if (data?.saved) {
        message.success('已写入镜头视频提示词（来源记为「一键技能生成」）')
        setWrittenToShot(true)
        // **只有确认写入正式列之后**才清对应草稿：草稿的使命到此结束
        if (chapterId) {
          try {
            const cleared = await deleteShotDrafts(chapterId, [shotId])
            setDraftInfo(null)
            if (cleared.cleared) {
              message.info(`已清掉该镜头 ${cleared.cleared} 份服务端草稿（已保存的正式提示词不受影响）`)
            }
          } catch {
            // 清理失败不影响写入结果：草稿还留着，下次进来最多是"多恢复一次"
          }
        }
      } else {
        message.warning(data?.message || '未写入', 8)
      }
    } catch (error) {
      message.error(reportError(error), 8)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Row gutter={16} align="bottom">
        <Col span={8}>
          <Text strong>导演技能</Text>
          <Select
            style={{ width: '100%', marginTop: 4 }}
            placeholder="选择一个导演技能"
            value={skillId}
            onChange={(value) => {
              setSkillId(value)
              setResult(undefined)
              setPromptDraft('')
            }}
            options={skills.map((s) => ({
              label: `${s.display_name} · ${s.stage_label}${s.pinned ? ' ★' : ''}`,
              value: s.skill_id,
              disabled: !s.source_present,
            }))}
            showSearch
            optionFilterProp="label"
          />
        </Col>
        <Col span={8}>
          <Text strong>章节（可选，用于自动带上下文）</Text>
          <Select
            style={{ width: '100%', marginTop: 4 }}
            placeholder={projectId ? '选择章节' : '请先选择项目'}
            value={chapterId}
            onChange={setChapterId}
            options={chapters}
            disabled={!projectId}
            allowClear
            showSearch
            optionFilterProp="label"
          />
        </Col>
        <Col span={8}>
          <Text strong>镜头（可选；填了才能写回）</Text>
          <Select
            style={{ width: '100%', marginTop: 4 }}
            placeholder={chapterId ? '选择镜头' : '请先选择章节'}
            value={shotId}
            onChange={setShotId}
            options={shots}
            disabled={!chapterId}
            allowClear
            showSearch
            optionFilterProp="label"
          />
        </Col>
      </Row>

      {selectedSkill && (
        <Alert type="info" showIcon message={selectedSkill.summary} description={
          <Text type="secondary">
            规则正文 {selectedSkill.rule_chars} 字，来自 {selectedSkill.source_name}
            {selectedSkill.load_error ? `（读取异常：${selectedSkill.load_error}）` : ''}
          </Text>
        } />
      )}

      <div>
        <Text strong>本次要生成什么</Text>
        <Input.TextArea
          style={{ marginTop: 4 }}
          rows={3}
          placeholder="例如：把这一镜做成可直接提交的 5 秒视频提示词，保持人物服装不变。"
          value={request}
          onChange={(e) => setRequest(e.target.value)}
        />
      </div>

      <Collapse
        size="small"
        items={[
          {
            key: 'ctx',
            label: '附加上下文与中台上下文（可选）',
            children: (
              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                <Input.TextArea
                  rows={3}
                  placeholder="补充要求，例如：人物服装保持不变、镜头不要快切、避免出现字幕。"
                  value={extraContext}
                  onChange={(e) => setExtraContext(e.target.value)}
                />
                <Space>
                  <Button
                    size="small"
                    icon={<EyeOutlined />}
                    loading={loadingContext}
                    onClick={() => void handlePreviewContext()}
                  >
                    预览中台上下文
                  </Button>
                  <Text type="secondary">从项目/章节/镜头自动装配，只读、不调模型</Text>
                </Space>
                <Input.TextArea value={contextText} readOnly rows={6} placeholder="（还没有上下文）" />
              </Space>
            ),
          },
        ]}
      />

      <Space>
        <Button
          type="primary"
          icon={<ThunderboltOutlined />}
          loading={generating}
          disabled={!canGenerate}
          onClick={() => void handleGenerate()}
        >
          生成提示词（调用文字模型）
        </Button>
        {result && (
          <Text type="secondary">
            {/* 审计 §4.6 模式 5 / §6.2：原来直渲后端原始模型名（`deepseek-chat` 这类）。
                主区只说业务方案名，原始名只留在技术详情层。 */}
            模型方案：{textModelBusinessName(result.model_used)} · 结果 {promptDraft.length} 字
          </Text>
        )}
        {/* 草稿 vs 已保存：两件事分开显示，不让人误以为"生成了就等于写进镜头了" */}
        {writtenToShot ? (
          <Tag color="green" data-testid="quick-skill-written">已写入镜头（正式列）</Tag>
        ) : draftInfo?.has_draft ? (
          <Tag color="blue" data-testid="quick-skill-draft">服务端草稿（未保存到镜头）</Tag>
        ) : promptDraft ? (
          <Tag color="orange" data-testid="quick-skill-draft">仅本页内存（未暂存服务端）</Tag>
        ) : null}
      </Space>

      {shotId && draftInfo?.has_draft && draftInfo.prompt.trim() !== promptDraft.trim() ? (
        <Alert
          type="info"
          showIcon
          message="这一镜在服务端还有一份草稿"
          description={
            <Space wrap>
              <Text type="secondary">
                {`${draftInfo.prompt.trim().length} 字 · 更新于 ${draftInfo.updated_at ? new Date(draftInfo.updated_at).toLocaleString('zh-CN') : '未知'}`}
              </Text>
              <Button size="small" icon={<ReloadOutlined />} onClick={handleRestoreDraft}>
                恢复该镜草稿（覆盖当前输入框）
              </Button>
            </Space>
          }
        />
      ) : null}

      {result?.warnings && result.warnings.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message="提示"
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          }
        />
      )}

      {promptDraft ? (
        <>
          <Divider style={{ margin: '8px 0' }}>生成结果（可直接微调后再导出/写回）</Divider>
          <Input.TextArea
            value={promptDraft}
            onChange={(e) => setPromptDraft(e.target.value)}
            rows={14}
          />
          <Space wrap>
            <Button onClick={() => void handleCopy()}>复制</Button>
            <Button
              icon={<CloudDownloadOutlined />}
              loading={downloading}
              onClick={() => void handleDownload()}
            >
              下载 TXT
            </Button>
            <Button
              icon={<CloudUploadOutlined />}
              loading={saving}
              disabled={!shotId}
              onClick={() => void handleSaveToShot()}
            >
              写入镜头（写正式列）
            </Button>
            <Button
              loading={draftBusy}
              disabled={!shotId || !promptDraft.trim()}
              data-testid="quick-skill-stash-draft"
              onClick={() => void handleStashDraft()}
            >
              暂存到服务端草稿
            </Button>
            <Space>
              <span>镜头已有提示词时</span>
              <Select
                size="small"
                style={{ width: 110 }}
                value={overwrite}
                onChange={setOverwrite}
                options={[
                  { label: '不覆盖', value: false },
                  { label: '允许覆盖', value: true },
                ]}
              />
            </Space>
            {!shotId && <Text type="secondary">选中镜头后才能写回；没选镜头时生成结果不会暂存服务端（刷新会丢）</Text>}
          </Space>
        </>
      ) : (
        <Empty description="选好导演技能与镜头、写好需求后点「生成提示词」" />
      )}
    </Space>
  )
}

export default PromptFlowPage