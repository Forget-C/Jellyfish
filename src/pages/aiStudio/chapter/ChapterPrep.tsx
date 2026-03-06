import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Badge,
  Button,
  Card,
  Collapse,
  Divider,
  Dropdown,
  Empty,
  Input,
  Layout,
  List,
  Modal,
  Select,
  Skeleton,
  Space,
  Switch,
  Tag,
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
import api from '../../../services/aiStudioApi'
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

type Version = {
  id: string
  label: string
  at: number
  text: string
}

function nowLabel() {
  const d = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function storageKey(chapterId: string) {
  return `jellyfish_chapter_prep_v1:${chapterId}`
}

function versionsKey(chapterId: string) {
  return `jellyfish_chapter_prep_versions_v1:${chapterId}`
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

const ChapterPrep: React.FC = () => {
  const { projectId, chapterId } = useParams<{ projectId?: string; chapterId?: string }>()
  const navigate = useNavigate()

  const [chapter, setChapter] = useState<Chapter | null>(null)
  const [titleEditing, setTitleEditing] = useState(false)
  const [titleValue, setTitleValue] = useState('')

  const [text, setText] = useState('')
  const [originalText, setOriginalText] = useState('')
  const [simplifiedText, setSimplifiedText] = useState<string | null>(null)
  const [compareMode, setCompareMode] = useState(false)

  const [saving, setSaving] = useState(false)
  const saveTimerRef = useRef<number | null>(null)

  const [editorModalOpen, setEditorModalOpen] = useState(false)

  const [versions, setVersions] = useState<Version[]>([])
  const [extracting, setExtracting] = useState(false)
  const [results, setResults] = useState<ExtractResults>({ storyboards: [], roles: [], scenes: [], props: [] })

  const [selectedKind, setSelectedKind] = useState<ExtractKind>('storyboards')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [agent, setAgent] = useState<'default' | 'plot_v2' | 'role_v13'>('default')

  const plainWordCount = useMemo(() => text.trim().length, [text])
  const paragraphCount = useMemo(() => text.split(/\n\s*\n/).filter((p) => p.trim()).length, [text])

  useEffect(() => {
    if (!projectId || !chapterId) return
    api.chapters
      .list(projectId)
      .then((list) => {
        const found = Array.isArray(list) ? list.find((c) => c.id === chapterId) ?? null : null
        setChapter(found)
        setTitleValue(found?.title ?? '')
      })
      .catch(() => setChapter(null))
  }, [projectId, chapterId])

  // load draft
  useEffect(() => {
    if (!chapterId) return
    try {
      const raw = window.localStorage.getItem(storageKey(chapterId))
      const vraw = window.localStorage.getItem(versionsKey(chapterId))
      const savedText = raw ? String(raw) : ''
      const savedVersions = vraw ? (JSON.parse(vraw) as Version[]) : []
      setText(savedText)
      setOriginalText(savedText)
      setVersions(Array.isArray(savedVersions) ? savedVersions : [])
      setResults(extractMock(savedText))
    } catch {
      // ignore
    }
  }, [chapterId])

  // auto save
  useEffect(() => {
    if (!chapterId) return
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    setSaving(true)
    saveTimerRef.current = window.setTimeout(() => {
      try {
        window.localStorage.setItem(storageKey(chapterId), text)
        window.localStorage.setItem(versionsKey(chapterId), JSON.stringify(versions.slice(0, 20)))
      } catch {
        // ignore
      }
      setSaving(false)
      saveTimerRef.current = null
    }, 3200)
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
  }, [chapterId, text, versions])

  const pushVersion = (label: string, nextText: string) => {
    const v: Version = {
      id: `v-${Date.now()}`,
      label,
      at: Date.now(),
      text: nextText,
    }
    setVersions((prev) => [v, ...prev].slice(0, 20))
  }

  const handleSmartSimplify = async () => {
    if (!text.trim()) {
      message.warning('请先粘贴或输入原文')
      return
    }
    setExtracting(true)
    try {
      await new Promise((r) => setTimeout(r, 800))
      const simplified =
        text.length > 320
          ? `${text.slice(0, 320)}\n\n[已智能精简：保留关键主线内容 · Agent：${agent}]`
          : `${text}\n\n[已智能精简：Agent：${agent}]`
      setSimplifiedText(simplified)
      pushVersion(`智能精简（${nowLabel()}）`, simplified)
      setText(simplified)
      message.success('智能精简完成')
    } finally {
      setExtracting(false)
    }
  }

  const handleRestoreOriginal = () => {
    if (!originalText.trim()) {
      message.info('暂无可恢复的原文')
      return
    }
    pushVersion(`恢复原文（${nowLabel()}）`, originalText)
    setText(originalText)
    setSimplifiedText(null)
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
    if (!text.trim()) {
      message.warning('请先粘贴或输入原文')
      return
    }
    setExtracting(true)
    try {
      await new Promise((r) => setTimeout(r, 900))
      const next = extractMock(text)
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
    } finally {
      setExtracting(false)
    }
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

  const versionsMenuItems: MenuProps['items'] = versions.map((v) => ({
    key: v.id,
    label: (
      <div className="min-w-[260px]">
        <div className="text-sm font-medium">{v.label}</div>
        <div className="text-xs text-gray-500">{new Date(v.at).toLocaleString()}</div>
      </div>
    ),
    onClick: () => {
      setText(v.text)
      message.success('已回滚到该版本')
    },
  }))

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
        <Link to={projectId ? `/projects/${projectId}/chapters` : '/projects'} className="text-gray-600 hover:text-blue-600 flex items-center gap-1">
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
              <FileTextOutlined /> 原文编辑区
              <Tag color="blue">{plainWordCount} 字</Tag>
              <Tag color="default">{paragraphCount} 段</Tag>
            </div>
            <Space size="small">
              <Button size="small" icon={<ThunderboltOutlined />} loading={extracting} onClick={() => void handleSmartSimplify()}>
                智能精简
              </Button>
              <Button size="small" icon={<ReloadOutlined />} onClick={handleRestoreOriginal}>
                恢复原文
              </Button>
              <Button size="small" icon={<DiffOutlined />} type={compareMode ? 'primary' : 'default'} onClick={() => setCompareMode(!compareMode)}>
                对比模式
              </Button>
              <Dropdown menu={{ items: versionsMenuItems.length ? versionsMenuItems : [{ key: 'empty', label: '暂无版本', disabled: true }] }}>
                <Button size="small" icon={<HistoryOutlined />}>
                  版本历史 <DownOutlined />
                </Button>
              </Dropdown>
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
        {compareMode ? (
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col">
              <div className="text-xs text-gray-500 mb-2">原文</div>
              <Input.TextArea
                value={originalText}
                onChange={(e) => {
                  setOriginalText(e.target.value)
                  setText(e.target.value)
                }}
                rows={14}
                style={{ resize: 'none', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
              />
            </div>
            <div className="flex flex-col">
              <div className="text-xs text-gray-500 mb-2">精简版</div>
              <Input.TextArea
                value={simplifiedText ?? ''}
                onChange={(e) => setSimplifiedText(e.target.value)}
                rows={14}
                style={{ resize: 'none', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
              />
            </div>
          </div>
        ) : (
          <Input.TextArea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="粘贴或输入章节原文…"
            rows={16}
            style={{ resize: 'none', background: '#fdfdfd' }}
          />
        )}
      </Modal>
    </Layout>
  )
}

export default ChapterPrep

