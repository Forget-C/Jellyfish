import React, { useEffect, useMemo, useState } from 'react'
import {
  Badge,
  Button,
  Card,
  Collapse,
  Divider,
  Dropdown,
  Empty,
  Checkbox,
  Input,
  Layout,
  List,
  Modal,
  Select,
  Skeleton,
  Space,
  Switch,
  Tag,
  Tabs,
  Tooltip,
  message,
} from 'antd'
import type { MenuProps } from 'antd'
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  DiffOutlined,
  DownOutlined,
  EditOutlined,
  FileTextOutlined,
  HistoryOutlined,
  MergeCellsOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SaveOutlined,
  ThunderboltOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { StudioChaptersService } from '../../../services/generated'
import type { ChapterRead } from '../../../services/generated'
import type { Chapter } from '../../../mocks/data'

const { Header, Content } = Layout

type ExtractKind = 'storyboards' | 'roles' | 'scenes' | 'props'

type StoryboardSuggestion = {
  id: string
  index: number
  title: string
  preview: string
  paragraphRange: string
  duration: string
  actions: string[]
  roles: string[]
  scenes: string[]
  props: string[]
  isTransition?: boolean
}

type RoleItem = {
  id: string
  name: string
  aliases: string[]
  firstSeen: string
  description: string
  primary: boolean
}

type SceneItem = {
  id: string
  name: string
  indoorOutdoor: '室内' | '室外' | '未知'
  time: '白天' | '夜晚' | '未知'
  keywords: string[]
}

type PropItem = {
  id: string
  name: string
  owner?: string
  count: number
  key: boolean
}

type ExtractResults = {
  storyboards: StoryboardSuggestion[]
  roles: RoleItem[]
  scenes: SceneItem[]
  props: PropItem[]
}

// TODO: 后续接入“章节草稿/版本历史/智能精简”等接口后，可移除当前页面的 Mock 逻辑与预置数据。

type EntityKind = 'roles' | 'scenes' | 'props'

type ExistingEntities = {
  roles: string[]
  scenes: string[]
  props: string[]
}

function entitiesStorageKey(projectId: string) {
  return `jellyfish_project_entities_v1:${projectId}`
}

function extractMock(text: string): ExtractResults {
  const baseRoles = ['小雨', '阿川', '房东']
  const baseScenes = ['十平米出租屋', '城郊老旧小区走廊', '窗边']
  const baseProps = ['欠条', '风扇', '手机', '钥匙']
  const hasText = text.trim().length > 0

  const storyboards: StoryboardSuggestion[] = (hasText ? Array.from({ length: 8 }) : []).map((_, i) => ({
    id: `sb-${i + 1}`,
    index: i + 1,
    title:
      i === 2 ? '两人对峙' :
      i === 5 ? '门口停顿' :
      `段落推进 · ${i + 1}`,
    preview:
      i === 0 ? '夜色下的老旧小区，路灯昏黄，情绪压着。' :
      i === 1 ? '出租屋内风扇吱呀作响，欠条摊在桌上。' :
      i === 2 ? '沉默持续，目光交锋，谁也不肯先开口。' :
      '对话推进，情绪起伏，动作带出关系变化。',
    paragraphRange: `第${i * 2 + 1}–${i * 2 + 2}段`,
    duration: i % 3 === 0 ? '8–12秒' : '5–9秒',
    actions: i % 2 === 0 ? ['沉默', '转身'] : ['质问', '停顿'],
    roles: i % 2 === 0 ? ['小雨', '阿川'] : ['小雨'],
    scenes: i % 3 === 0 ? ['十平米出租屋'] : ['城郊老旧小区走廊'],
    props: i % 2 === 0 ? ['欠条'] : ['手机'],
    isTransition: i === 5,
  }))

  const roles: RoleItem[] = (hasText ? baseRoles : []).map((name, i) => ({
    id: `r-${i + 1}`,
    name,
    aliases: name === '小雨' ? ['小雨儿'] : [],
    firstSeen: `第${i + 1}段`,
    description: name === '小雨' ? '25岁互联网运营，疲惫但眼神坚定。' : '情绪克制，话少但带刺。',
    primary: name !== '房东',
  }))

  const scenes: SceneItem[] = (hasText ? baseScenes : []).map((name, i) => ({
    id: `s-${i + 1}`,
    name,
    indoorOutdoor: i === 0 ? '室内' : i === 1 ? '室外' : '未知',
    time: i === 1 ? '夜晚' : '未知',
    keywords: i === 0 ? ['狭窄', '顶灯冷白'] : ['昏黄路灯', '潮湿'],
  }))

  const props: PropItem[] = (hasText ? baseProps : []).map((name, i) => ({
    id: `p-${i + 1}`,
    name,
    owner: name === '手机' ? '小雨' : undefined,
    count: 1 + (i % 3),
    key: name === '欠条',
  }))

  return { storyboards, roles, scenes, props }
}

function isExtractKey(key: string): key is 'all' | ExtractKind {
  return key === 'all' || key === 'storyboards' || key === 'roles' || key === 'scenes' || key === 'props'
}

function toUIChapter(c: ChapterRead): Chapter {
  return {
    id: c.id,
    projectId: c.project_id,
    index: c.index,
    title: c.title,
    summary: c.summary ?? '',
    storyboardCount: c.storyboard_count ?? 0,
    status: c.status ?? 'draft',
    updatedAt: new Date().toISOString(),
  }
}

const ChapterPrep: React.FC = () => {
  const { projectId, chapterId } = useParams<{ projectId?: string; chapterId?: string }>()
  const navigate = useNavigate()

  const [chapter, setChapter] = useState<Chapter | null>(null)
  const [titleEditing, setTitleEditing] = useState(false)
  const [titleValue, setTitleValue] = useState('')

  type EditorMode = 'raw' | 'condensed' | 'compare'
  const [mode, setMode] = useState<EditorMode>('raw')
  const [rawText, setRawText] = useState('')
  const [condensedText, setCondensedText] = useState('')
  const [editorText, setEditorText] = useState('')
  const [compareRaw, setCompareRaw] = useState('')
  const [compareCondensed, setCompareCondensed] = useState('')

  const [saving, setSaving] = useState(false)

  const [editorModalOpen, setEditorModalOpen] = useState(false)
  const [historyModalOpen, setHistoryModalOpen] = useState(false)

  const [extracting, setExtracting] = useState(false)
  const [results, setResults] = useState<ExtractResults>({ storyboards: [], roles: [], scenes: [], props: [] })
  const [extractReviewOpen, setExtractReviewOpen] = useState(false)
  const [extractReviewTab, setExtractReviewTab] = useState<EntityKind>('roles')
  const [existingEntities, setExistingEntities] = useState<ExistingEntities>({ roles: [], scenes: [], props: [] })
  const [selectedEntityKeys, setSelectedEntityKeys] = useState<Record<EntityKind, string[]>>({
    roles: [],
    scenes: [],
    props: [],
  })

  const [selectedKind, setSelectedKind] = useState<ExtractKind>('storyboards')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [agent, setAgent] = useState<'default' | 'plot_v2' | 'role_v13'>('default')

  const plainWordCount = useMemo(() => editorText.trim().length, [editorText])
  const paragraphCount = useMemo(() => editorText.split(/\n\s*\n/).filter((p) => p.trim()).length, [editorText])

  useEffect(() => {
    if (!chapterId) return
    StudioChaptersService.getChapterApiV1StudioChaptersChapterIdGet({ chapterId })
      .then((res) => {
        const data = res.data
        if (!data) {
          setChapter(null)
          return
        }
        const ui = toUIChapter(data)
        setChapter(ui)
        setTitleValue(ui.title)

        const nextRaw = data.raw_text ?? ''
        const nextCondensed = data.condensed_text ?? ''
        setRawText(nextRaw)
        setCondensedText(nextCondensed)
        setMode('raw')
        setEditorText(nextRaw)
        setResults(extractMock(nextRaw))
      })
      .catch(() => {
        setChapter(null)
      })
  }, [chapterId])

  useEffect(() => {
    if (!projectId) return
    try {
      const raw = window.localStorage.getItem(entitiesStorageKey(projectId))
      const parsed = raw ? (JSON.parse(raw) as ExistingEntities) : null
      if (parsed && typeof parsed === 'object') {
        setExistingEntities({
          roles: Array.isArray(parsed.roles) ? parsed.roles : [],
          scenes: Array.isArray(parsed.scenes) ? parsed.scenes : [],
          props: Array.isArray(parsed.props) ? parsed.props : [],
        })
      }
    } catch {
      // ignore
    }
  }, [projectId])

  useEffect(() => {
    if (!projectId) return
    try {
      window.localStorage.setItem(entitiesStorageKey(projectId), JSON.stringify(existingEntities))
    } catch {
      // ignore
    }
  }, [projectId, existingEntities])

  // TODO: 后续可在此接入“章节草稿/版本历史”接口，替换掉当前预置数据与本地状态实现。

  const handleSmartSimplify = async () => {
    if (!rawText.trim()) {
      message.warning('请先粘贴或输入原文')
      return
    }
    setExtracting(true)
    try {
      // TODO: 智能精简接口未接入，后续在此替换为真实接口调用，并将返回结果写入 condensedText
      await new Promise((r) => setTimeout(r, 500))
      const simplified = '已精简'
      setCondensedText(simplified)
      if (mode === 'compare') {
        // 对比模式下不切换编辑区：只更新右侧精简内容输入框
        setCompareCondensed(simplified)
      } else {
        setMode('condensed')
        setEditorText(simplified)
      }
      message.success('智能精简完成')
    } finally {
      setExtracting(false)
    }
  }

  const handleBackToRaw = () => {
    setMode('raw')
    setEditorText(rawText)
  }

  const handleViewCondensed = () => {
    if (!condensedText.trim()) {
      message.info('暂无精简内容')
      return
    }
    setMode('condensed')
    setEditorText(condensedText)
  }

  const extractMenuItems: MenuProps['items'] = [
    { key: 'all', label: '全选（分镜/角色/场景/道具）' },
    { type: 'divider' },
    { key: 'storyboards', label: '仅提取分镜建议' },
    { key: 'roles', label: '仅提取角色' },
    { key: 'scenes', label: '仅提取场景' },
    { key: 'props', label: '仅提取道具' },
  ]

  const runExtract = async (kind: 'all' | ExtractKind) => {
    if (!rawText.trim()) {
      message.warning('请先粘贴或输入原文')
      return
    }
    setExtracting(true)
    try {
      await new Promise((r) => setTimeout(r, 900))
      const next = extractMock(rawText)
      setResults((prev) => {
        if (kind === 'all') return next
        switch (kind) {
          case 'storyboards':
            return { ...prev, storyboards: next.storyboards }
          case 'roles':
            return { ...prev, roles: next.roles }
          case 'scenes':
            return { ...prev, scenes: next.scenes }
          case 'props':
            return { ...prev, props: next.props }
          default:
            return prev
        }
      })
      message.success('提取完成（Mock）')

      // 打开提取回显浮窗
      if (kind === 'roles' || kind === 'scenes' || kind === 'props') {
        setExtractReviewTab(kind)
      } else {
        setExtractReviewTab('roles')
      }
      setSelectedEntityKeys({ roles: [], scenes: [], props: [] })
      setExtractReviewOpen(true)
    } finally {
      setExtracting(false)
    }
  }

  const existingSet = useMemo(() => {
    return {
      roles: new Set(existingEntities.roles),
      scenes: new Set(existingEntities.scenes),
      props: new Set(existingEntities.props),
    }
  }, [existingEntities])

  const addSelectedEntities = (kind: EntityKind) => {
    const selected = selectedEntityKeys[kind]
    if (selected.length === 0) {
      message.info('请先选择要添加的内容')
      return
    }
    const duplicates = selected.filter((name) => existingSet[kind].has(name))
    const uniques = selected.filter((name) => !existingSet[kind].has(name))

    const doAdd = () => {
      if (uniques.length === 0) {
        message.info('所选内容均已存在，无需添加')
        return
      }
      setExistingEntities((prev) => ({
        ...prev,
        [kind]: Array.from(new Set([...(prev[kind] as string[]), ...uniques])),
      }))
      setSelectedEntityKeys((prev) => ({ ...prev, [kind]: [] }))
      message.success(`已添加 ${uniques.length} 项`)
    }

    if (duplicates.length > 0) {
      Modal.confirm({
        title: '存在重复内容',
        content: `你选择的内容中有 ${duplicates.length} 项已存在，将自动跳过重复项，是否继续添加其余内容？`,
        okText: '继续添加',
        cancelText: '取消',
        onOk: doAdd,
      })
      return
    }
    doAdd()
  }

  const toggleSelectAllNew = (kind: EntityKind) => {
    const items =
      kind === 'roles'
        ? results.roles.map((r) => r.name)
        : kind === 'scenes'
          ? results.scenes.map((s) => s.name)
          : results.props.map((p) => p.name)
    const newOnes = items.filter((name) => !existingSet[kind].has(name))
    setSelectedEntityKeys((prev) => ({ ...prev, [kind]: newOnes }))
  }

  const currentItemsCount = useMemo(() => {
    return {
      storyboards: results.storyboards.length,
      roles: results.roles.length,
      scenes: results.scenes.length,
      props: results.props.length,
    }
  }, [results])

  const selectedStoryboard = useMemo(
    () => results.storyboards.find((x) => x.id === selectedId) ?? null,
    [results.storyboards, selectedId],
  )

  const selectedRole = useMemo(
    () => results.roles.find((x) => x.id === selectedId) ?? null,
    [results.roles, selectedId],
  )

  const selectedScene = useMemo(
    () => results.scenes.find((x) => x.id === selectedId) ?? null,
    [results.scenes, selectedId],
  )

  const selectedProp = useMemo(
    () => results.props.find((x) => x.id === selectedId) ?? null,
    [results.props, selectedId],
  )

  const handleJumpStudio = () => {
    if (!projectId || !chapterId) return
    Modal.confirm({
      title: '跳转到拍摄工作台？',
      content: '建议先完成提取与确认。是否将当前提取结果带入拍摄页（Mock）？',
      okText: '带入并跳转',
      cancelText: '仅跳转',
      onOk: () => {
        navigate(`/projects/${projectId}/chapters/${chapterId}/studio`, {
          state: { prep: results },
        })
      },
      onCancel: () => {
        navigate(`/projects/${projectId}/chapters/${chapterId}/studio`)
      },
    })
  }

  const mockHistory = useMemo(
    () => [
      {
        id: 'h-1',
        at: Date.now() - 1000 * 60 * 60 * 2,
        rawText: '【原文】示例版本 1（预置数据）',
        condensedText: '【精简】示例版本 1（预置数据）',
      },
      {
        id: 'h-2',
        at: Date.now() - 1000 * 60 * 22,
        rawText: '【原文】示例版本 2（预置数据）',
        condensedText: '【精简】示例版本 2（预置数据）',
      },
    ],
    [],
  )

  const handleSaveEditor = async () => {
    if (!chapterId) return
    if (mode === 'raw') {
      setSaving(true)
      try {
        await StudioChaptersService.updateChapterApiV1StudioChaptersChapterIdPatch({
          chapterId,
          requestBody: { raw_text: editorText },
        })
        setRawText(editorText)
        message.success('原文已保存')
      } catch {
        message.error('保存失败')
      } finally {
        setSaving(false)
      }
      return
    }

    if (mode === 'condensed') {
      setSaving(true)
      try {
        await StudioChaptersService.updateChapterApiV1StudioChaptersChapterIdPatch({
          chapterId,
          requestBody: { condensed_text: editorText },
        })
        setCondensedText(editorText)
        message.success('精简内容已保存')
      } catch {
        message.error('保存失败')
      } finally {
        setSaving(false)
      }
      return
    }

    // compare
    setSaving(true)
    try {
      await StudioChaptersService.updateChapterApiV1StudioChaptersChapterIdPatch({
        chapterId,
        requestBody: { raw_text: compareRaw, condensed_text: compareCondensed },
      })
      setRawText(compareRaw)
      setCondensedText(compareCondensed)
      message.success('已保存')
    } catch {
      message.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Layout style={{ height: '100%', minHeight: 0, background: '#eef2f7' }}>
      <Header
        style={{
          padding: '0 16px',
          background: '#fff',
          borderBottom: '1px solid #e2e8f0',
          boxShadow: '0 2px 4px rgba(0,0,0,0.04)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <Link
          to={projectId ? `/projects/${projectId}?tab=chapters` : '/projects'}
          className="text-gray-600 hover:text-blue-600 flex items-center gap-1"
        >
          <ArrowLeftOutlined /> 返回章节列表
        </Link>
        <Divider type="vertical" />

        <div className="min-w-0 flex-1 flex items-center gap-2">
          {titleEditing ? (
            <Input
              value={titleValue}
              autoFocus
              onChange={(e) => setTitleValue(e.target.value)}
              onBlur={() => setTitleEditing(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setTitleEditing(false)
                if (e.key === 'Escape') {
                  setTitleEditing(false)
                  setTitleValue(chapter?.title ?? titleValue)
                }
              }}
              style={{ maxWidth: 520 }}
            />
          ) : (
            <div
              className="font-medium text-gray-900 truncate cursor-pointer"
              title="双击编辑标题"
              onDoubleClick={() => setTitleEditing(true)}
            >
              {chapter ? `第${chapter.index}章 · ${titleValue || chapter.title}` : '章节编辑'}
            </div>
          )}
          <div className="text-xs text-gray-500 flex items-center gap-1">
            {saving ? (
              <>
                <ClockCircleOutlined /> 自动保存中…
              </>
            ) : (
              <>
                <CheckCircleOutlined /> 已保存
              </>
            )}
          </div>
        </div>

        <Space>
          <Button icon={<FileTextOutlined />} onClick={() => setEditorModalOpen(true)}>
            编辑原文
          </Button>
          <Button icon={<SaveOutlined />} type="primary" onClick={() => message.success('已保存草稿（Mock）')}>
            保存草稿
          </Button>

          <Dropdown
            menu={{
              items: extractMenuItems,
              onClick: ({ key }) => {
                const k = String(key)
                if (isExtractKey(k)) {
                  void runExtract(k)
                }
              },
            }}
          >
            <Button loading={extracting} icon={<ThunderboltOutlined />}>
              一键提取全部 <DownOutlined />
            </Button>
          </Dropdown>

          <Select
            value={agent}
            onChange={(v) => setAgent(v)}
            style={{ width: 180 }}
            options={[
              { value: 'default', label: '使用默认 Agent' },
              { value: 'plot_v2', label: '剧情提取 Agent v2' },
              { value: 'role_v13', label: '角色提取 Agent v1.3' },
            ]}
          />

          <Tooltip title="建议先完成提取与确认">
            <Button type="primary" icon={<VideoCameraOutlined />} onClick={handleJumpStudio} style={{ background: '#10b981', borderColor: '#10b981' }}>
              跳转拍摄
            </Button>
          </Tooltip>
        </Space>
      </Header>

      <Content
        style={{
          padding: 16,
          minHeight: 0,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* 左导航 + 右详情 */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 12, overflow: 'hidden' }}>
          {/* 左侧导航 */}
          <Card
            style={{ width: 340, minWidth: 280, maxWidth: 420, height: '100%', overflow: 'hidden', flexShrink: 0 }}
            bodyStyle={{ padding: 12, height: '100%', minHeight: 0, overflow: 'auto' }}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="font-medium">提取结果导航</div>
              <Badge status={extracting ? 'processing' : 'success'} text={extracting ? '提取中…' : '就绪'} />
            </div>
            <Collapse
              defaultActiveKey={['storyboards']}
              items={[
                {
                  key: 'storyboards',
                  label: `原文分镜建议（${currentItemsCount.storyboards}）`,
                  extra: (
                    <Space size="small">
                      <Tooltip title="重新提取">
                        <Button size="small" type="text" icon={<ReloadOutlined />} onClick={() => void runExtract('storyboards')} />
                      </Tooltip>
                    </Space>
                  ),
                  children: extracting ? (
                    <Skeleton active paragraph={{ rows: 4 }} />
                  ) : (
                    <List
                      size="small"
                      dataSource={results.storyboards}
                      locale={{ emptyText: <Empty description="暂无分镜建议" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
                      renderItem={(it) => (
                        <List.Item
                          onClick={() => {
                            setSelectedKind('storyboards')
                            setSelectedId(it.id)
                          }}
                          style={{
                            cursor: 'pointer',
                            borderRadius: 10,
                            padding: '8px 10px',
                            background: selectedKind === 'storyboards' && selectedId === it.id ? 'rgba(59,130,246,0.10)' : undefined,
                          }}
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">
                              {String(it.index).padStart(2, '0')} · {it.title}
                            </div>
                            <div className="text-xs text-gray-500 truncate">{it.preview}</div>
                          </div>
                        </List.Item>
                      )}
                    />
                  ),
                },
                {
                  key: 'roles',
                  label: `角色（${currentItemsCount.roles}）`,
                  children: extracting ? (
                    <Skeleton active paragraph={{ rows: 3 }} />
                  ) : (
                    <List
                      size="small"
                      dataSource={results.roles}
                      locale={{ emptyText: <Empty description="暂无角色" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
                      renderItem={(it) => (
                        <List.Item
                          onClick={() => {
                            setSelectedKind('roles')
                            setSelectedId(it.id)
                          }}
                          style={{
                            cursor: 'pointer',
                            borderRadius: 10,
                            padding: '8px 10px',
                            background: selectedKind === 'roles' && selectedId === it.id ? 'rgba(59,130,246,0.10)' : undefined,
                          }}
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">{it.name}</div>
                            <div className="text-xs text-gray-500 truncate">{it.description}</div>
                          </div>
                        </List.Item>
                      )}
                    />
                  ),
                },
                {
                  key: 'scenes',
                  label: `场景（${currentItemsCount.scenes}）`,
                  children: extracting ? (
                    <Skeleton active paragraph={{ rows: 3 }} />
                  ) : (
                    <List
                      size="small"
                      dataSource={results.scenes}
                      locale={{ emptyText: <Empty description="暂无场景" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
                      renderItem={(it) => (
                        <List.Item
                          onClick={() => {
                            setSelectedKind('scenes')
                            setSelectedId(it.id)
                          }}
                          style={{
                            cursor: 'pointer',
                            borderRadius: 10,
                            padding: '8px 10px',
                            background: selectedKind === 'scenes' && selectedId === it.id ? 'rgba(59,130,246,0.10)' : undefined,
                          }}
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">{it.name}</div>
                            <div className="text-xs text-gray-500 truncate">{it.indoorOutdoor} · {it.time}</div>
                          </div>
                        </List.Item>
                      )}
                    />
                  ),
                },
                {
                  key: 'props',
                  label: `道具（${currentItemsCount.props}）`,
                  children: extracting ? (
                    <Skeleton active paragraph={{ rows: 3 }} />
                  ) : (
                    <List
                      size="small"
                      dataSource={results.props}
                      locale={{ emptyText: <Empty description="暂无道具" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
                      renderItem={(it) => (
                        <List.Item
                          onClick={() => {
                            setSelectedKind('props')
                            setSelectedId(it.id)
                          }}
                          style={{
                            cursor: 'pointer',
                            borderRadius: 10,
                            padding: '8px 10px',
                            background: selectedKind === 'props' && selectedId === it.id ? 'rgba(59,130,246,0.10)' : undefined,
                          }}
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">{it.name}</div>
                            <div className="text-xs text-gray-500 truncate">出现 {it.count} 次{it.key ? ' · 关键道具' : ''}</div>
                          </div>
                        </List.Item>
                      )}
                    />
                  ),
                },
              ]}
            />
          </Card>

          {/* 右侧详情 */}
          <Card style={{ flex: 1, minWidth: 0, height: '100%', overflow: 'hidden' }} bodyStyle={{ padding: 12, height: '100%', minHeight: 0, overflow: 'auto' }}>
            {selectedKind === 'storyboards' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium">分镜建议</div>
                  <Space>
                    <Button icon={<MergeCellsOutlined />}>批量操作（Mock）</Button>
                    <Button icon={<PlayCircleOutlined />}>预览（Mock）</Button>
                  </Space>
                </div>
                {selectedStoryboard ? (
                  <Card size="small">
                    <div className="text-base font-semibold">
                      {String(selectedStoryboard.index).padStart(2, '0')} · {selectedStoryboard.title}
                      {selectedStoryboard.isTransition && <Tag color="purple" className="ml-2">转场点</Tag>}
                    </div>
                    <Divider />
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div><span className="text-gray-500">原文段落：</span>{selectedStoryboard.paragraphRange}</div>
                      <div><span className="text-gray-500">建议时长：</span>{selectedStoryboard.duration}</div>
                      <div><span className="text-gray-500">关键动作：</span>{selectedStoryboard.actions.join('、')}</div>
                      <div><span className="text-gray-500">涉及角色：</span>{selectedStoryboard.roles.join('、')}</div>
                      <div><span className="text-gray-500">涉及场景：</span>{selectedStoryboard.scenes.join('、')}</div>
                      <div><span className="text-gray-500">涉及道具：</span>{selectedStoryboard.props.join('、')}</div>
                    </div>
                    <Divider />
                    <Space wrap>
                      <Button icon={<EditOutlined />}>编辑标题（Mock）</Button>
                      <Button icon={<MergeCellsOutlined />}>合并到上一条（Mock）</Button>
                      <Button icon={<DeleteOutlined />} danger>删除（Mock）</Button>
                      <Button icon={<VideoCameraOutlined />}>标记为转场（Mock）</Button>
                    </Space>
                  </Card>
                ) : (
                  <Empty description="请从左侧选择一条分镜建议" />
                )}
              </div>
            )}

            {selectedKind === 'roles' && (
              <div className="space-y-3">
                <div className="font-medium">角色</div>
                {selectedRole ? (
                  <Card size="small">
                    <div className="flex items-center justify-between">
                      <div className="text-base font-semibold">{selectedRole.name}</div>
                      <Space>
                        <span className="text-sm text-gray-500">主要角色</span>
                        <Switch checked={selectedRole.primary} />
                      </Space>
                    </div>
                    <div className="text-sm text-gray-500 mt-1">首次出现：{selectedRole.firstSeen}</div>
                    <Divider />
                    <div className="text-sm">{selectedRole.description}</div>
                    <div className="mt-2">
                      {selectedRole.aliases.map((a) => (
                        <Tag key={a}>{a}</Tag>
                      ))}
                    </div>
                    <Divider />
                    <Space wrap>
                      <Button>关联资产库角色（Mock）</Button>
                      <Button type="primary">创建新角色资产（Mock）</Button>
                      <Button danger icon={<DeleteOutlined />}>删除（Mock）</Button>
                    </Space>
                  </Card>
                ) : (
                  <Empty description="请从左侧选择一个角色" />
                )}
              </div>
            )}

            {selectedKind === 'scenes' && (
              <div className="space-y-3">
                <div className="font-medium">场景</div>
                {selectedScene ? (
                  <Card size="small">
                    <div className="text-base font-semibold">{selectedScene.name}</div>
                    <div className="text-sm text-gray-500 mt-1">{selectedScene.indoorOutdoor} · {selectedScene.time}</div>
                    <Divider />
                    <div className="flex flex-wrap gap-2">
                      {selectedScene.keywords.map((k) => <Tag key={k} color="blue">{k}</Tag>)}
                    </div>
                    <Divider />
                    <Space wrap>
                      <Button>关联资产库场景（Mock）</Button>
                      <Button type="primary">创建新场景资产（Mock）</Button>
                      <Button danger icon={<DeleteOutlined />}>删除（Mock）</Button>
                    </Space>
                  </Card>
                ) : (
                  <Empty description="请从左侧选择一个场景" />
                )}
              </div>
            )}

            {selectedKind === 'props' && (
              <div className="space-y-3">
                <div className="font-medium">道具</div>
                {selectedProp ? (
                  <Card size="small">
                    <div className="flex items-center gap-2">
                      <div className="text-base font-semibold">{selectedProp.name}</div>
                      {selectedProp.key && <Tag color="gold">关键道具</Tag>}
                    </div>
                    <div className="text-sm text-gray-500 mt-1">出现次数：{selectedProp.count}</div>
                    <Divider />
                    <Space wrap>
                      <Button>关联资产库道具（Mock）</Button>
                      <Button type="primary">创建新道具资产（Mock）</Button>
                      <Button danger icon={<DeleteOutlined />}>删除（Mock）</Button>
                    </Space>
                  </Card>
                ) : (
                  <Empty description="请从左侧选择一个道具" />
                )}
              </div>
            )}
          </Card>
        </div>
      </Content>

      {/* 编辑原文弹窗 */}
      <Modal
        title={
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <FileTextOutlined />{' '}
              {mode === 'raw'
                ? '原文编辑区'
                : mode === 'condensed'
                  ? '精简内容编辑区'
                  : '对比模式'}
              <Tag color="blue">{plainWordCount} 字</Tag>
              <Tag color="default">{paragraphCount} 段</Tag>
            </div>
            <Space size="small">
              <Button
                size="small"
                type="primary"
                icon={<SaveOutlined />}
                loading={saving}
                onClick={() => void handleSaveEditor()}
              >
                保存
              </Button>
              <Button size="small" icon={<ThunderboltOutlined />} loading={extracting} onClick={() => void handleSmartSimplify()}>
                智能精简
              </Button>
              {mode === 'condensed' ? (
                <Button size="small" icon={<ReloadOutlined />} onClick={handleBackToRaw}>
                  回到原文
                </Button>
              ) : (
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  disabled={!condensedText.trim()}
                  onClick={handleViewCondensed}
                >
                  查看精简
                </Button>
              )}
              <Button
                size="small"
                icon={<DiffOutlined />}
                type={mode === 'compare' ? 'primary' : 'default'}
                onClick={() => {
                  if (mode === 'compare') {
                    setMode('raw')
                    setEditorText(rawText)
                    return
                  }
                  setCompareRaw(rawText)
                  setCompareCondensed(condensedText)
                  setMode('compare')
                }}
              >
                对比模式
              </Button>
              <Button size="small" icon={<HistoryOutlined />} onClick={() => setHistoryModalOpen(true)}>
                版本历史
              </Button>
            </Space>
          </div>
        }
        open={editorModalOpen}
        onCancel={() => setEditorModalOpen(false)}
        width={900}
        footer={
          <Button type="primary" onClick={() => setEditorModalOpen(false)}>
            关闭
          </Button>
        }
        styles={{ body: { maxHeight: '70vh', overflow: 'auto', paddingTop: 12 } }}
      >
        {mode === 'compare' ? (
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col">
              <div className="text-xs text-gray-500 mb-2">原文</div>
              <Input.TextArea
                value={compareRaw}
                onChange={(e) => setCompareRaw(e.target.value)}
                rows={14}
                style={{ resize: 'none', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
              />
            </div>
            <div className="flex flex-col">
              <div className="text-xs text-gray-500 mb-2">精简内容</div>
              <Input.TextArea
                value={compareCondensed}
                onChange={(e) => setCompareCondensed(e.target.value)}
                rows={14}
                style={{ resize: 'none', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
              />
            </div>
          </div>
        ) : (
          <Input.TextArea
            value={editorText}
            onChange={(e) => {
              const v = e.target.value
              setEditorText(v)
              if (mode === 'raw') setRawText(v)
              if (mode === 'condensed') setCondensedText(v)
            }}
            placeholder={mode === 'raw' ? '编辑章节原文…' : '编辑精简内容…'}
            rows={16}
            style={{ resize: 'none', background: '#fdfdfd' }}
          />
        )}
      </Modal>

      {/* 历史版本（Mock） */}
      <Modal
        title={
          <div className="flex items-center gap-2">
            <HistoryOutlined /> 历史版本
          </div>
        }
        open={historyModalOpen}
        onCancel={() => setHistoryModalOpen(false)}
        width={920}
        footer={
          <Button type="primary" onClick={() => setHistoryModalOpen(false)}>
            关闭
          </Button>
        }
        styles={{ body: { maxHeight: '70vh', overflow: 'auto' } }}
      >
        {/* TODO: 历史版本接口未接入，当前为预置数据；后续接入后按时间线渲染即可 */}
        <div className="text-xs text-gray-500 mb-3">内容默认折叠，仅展示时间线节点。</div>
        <div className="space-y-3">
          {mockHistory.map((h) => (
            <div key={h.id} className="border border-gray-200 rounded-lg p-3 bg-white">
              <div className="text-sm font-medium mb-2">{new Date(h.at).toLocaleString()}</div>
              <Collapse
                items={[
                  {
                    key: 'content',
                    label: '展开查看内容',
                    children: (
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <div className="text-xs text-gray-500 mb-2">原文内容</div>
                          <Input.TextArea
                            value={h.rawText}
                            readOnly
                            rows={8}
                            style={{ resize: 'none', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
                          />
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 mb-2">精简内容</div>
                          <Input.TextArea
                            value={h.condensedText}
                            readOnly
                            rows={8}
                            style={{ resize: 'none', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
                          />
                        </div>
                      </div>
                    ),
                  },
                ]}
              />
            </div>
          ))}
        </div>
      </Modal>

      {/* 提取结果回显浮窗 */}
      <Modal
        title="提取结果"
        open={extractReviewOpen}
        onCancel={() => setExtractReviewOpen(false)}
        width={860}
        footer={
          <Space>
            <Button onClick={() => setExtractReviewOpen(false)}>关闭</Button>
          </Space>
        }
        styles={{ body: { maxHeight: '70vh', overflow: 'auto' } }}
      >
        <Tabs
          activeKey={extractReviewTab}
          onChange={(k) => setExtractReviewTab(k as EntityKind)}
          items={[
            {
              key: 'roles',
              label: `角色（${results.roles.length}）`,
              children: (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-gray-500">勾选后可添加到“已存在”集合（本地 Mock）。</div>
                    <Space size="small">
                      <Button size="small" onClick={() => toggleSelectAllNew('roles')}>
                        全选新项
                      </Button>
                      <Button size="small" type="primary" onClick={() => addSelectedEntities('roles')}>
                        添加所选
                      </Button>
                    </Space>
                  </div>
                  <Checkbox.Group
                    value={selectedEntityKeys.roles}
                    onChange={(vals) => setSelectedEntityKeys((prev) => ({ ...prev, roles: vals as string[] }))}
                    className="w-full"
                  >
                    <List
                      dataSource={results.roles}
                      locale={{ emptyText: <Empty description="暂无角色" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
                      renderItem={(it) => {
                        const existed = existingSet.roles.has(it.name)
                        return (
                          <List.Item>
                            <div className="flex items-center justify-between w-full">
                              <Checkbox value={it.name}>
                                <span className="font-medium">{it.name}</span>
                                {it.aliases?.length ? (
                                  <span className="text-xs text-gray-500 ml-2">别名：{it.aliases.join('、')}</span>
                                ) : null}
                              </Checkbox>
                              {existed ? <Tag color="default">已存在</Tag> : <Tag color="green">新</Tag>}
                            </div>
                          </List.Item>
                        )
                      }}
                    />
                  </Checkbox.Group>
                </div>
              ),
            },
            {
              key: 'scenes',
              label: `场景（${results.scenes.length}）`,
              children: (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-gray-500">勾选后可添加到“已存在”集合（本地 Mock）。</div>
                    <Space size="small">
                      <Button size="small" onClick={() => toggleSelectAllNew('scenes')}>
                        全选新项
                      </Button>
                      <Button size="small" type="primary" onClick={() => addSelectedEntities('scenes')}>
                        添加所选
                      </Button>
                    </Space>
                  </div>
                  <Checkbox.Group
                    value={selectedEntityKeys.scenes}
                    onChange={(vals) => setSelectedEntityKeys((prev) => ({ ...prev, scenes: vals as string[] }))}
                    className="w-full"
                  >
                    <List
                      dataSource={results.scenes}
                      locale={{ emptyText: <Empty description="暂无场景" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
                      renderItem={(it) => {
                        const existed = existingSet.scenes.has(it.name)
                        return (
                          <List.Item>
                            <div className="flex items-center justify-between w-full">
                              <Checkbox value={it.name}>
                                <span className="font-medium">{it.name}</span>
                                <span className="text-xs text-gray-500 ml-2">
                                  {it.indoorOutdoor} · {it.time}
                                </span>
                              </Checkbox>
                              {existed ? <Tag color="default">已存在</Tag> : <Tag color="green">新</Tag>}
                            </div>
                          </List.Item>
                        )
                      }}
                    />
                  </Checkbox.Group>
                </div>
              ),
            },
            {
              key: 'props',
              label: `道具（${results.props.length}）`,
              children: (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-gray-500">勾选后可添加到“已存在”集合（本地 Mock）。</div>
                    <Space size="small">
                      <Button size="small" onClick={() => toggleSelectAllNew('props')}>
                        全选新项
                      </Button>
                      <Button size="small" type="primary" onClick={() => addSelectedEntities('props')}>
                        添加所选
                      </Button>
                    </Space>
                  </div>
                  <Checkbox.Group
                    value={selectedEntityKeys.props}
                    onChange={(vals) => setSelectedEntityKeys((prev) => ({ ...prev, props: vals as string[] }))}
                    className="w-full"
                  >
                    <List
                      dataSource={results.props}
                      locale={{ emptyText: <Empty description="暂无道具" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
                      renderItem={(it) => {
                        const existed = existingSet.props.has(it.name)
                        return (
                          <List.Item>
                            <div className="flex items-center justify-between w-full">
                              <Checkbox value={it.name}>
                                <span className="font-medium">{it.name}</span>
                                <span className="text-xs text-gray-500 ml-2">
                                  出现 {it.count} 次{it.key ? ' · 关键道具' : ''}
                                </span>
                              </Checkbox>
                              {existed ? <Tag color="default">已存在</Tag> : <Tag color="green">新</Tag>}
                            </div>
                          </List.Item>
                        )
                      }}
                    />
                  </Checkbox.Group>
                </div>
              ),
            },
          ]}
        />
      </Modal>
    </Layout>
  )
}

export default ChapterPrep

