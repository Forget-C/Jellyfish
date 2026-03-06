import React, { useEffect, useState } from 'react'
import {
  Card,
  Table,
  Button,
  Tag,
  Statistic,
  Row,
  Col,
  message,
  Space,
  Modal,
  Input,
} from 'antd'
import type { TableColumnsType } from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  FileTextOutlined,
  VideoCameraOutlined,
  MergeCellsOutlined,
  EyeInvisibleOutlined,
  SoundOutlined,
  ArrowLeftOutlined,
  VideoCameraFilled,
} from '@ant-design/icons'
import { useParams, useNavigate, Link } from 'react-router-dom'
import api from '../../../services/aiStudioApi'
import type { Chapter, Project } from '../../../mocks/data'

const statusMap: Record<string, { color: string; text: string }> = {
  draft: { color: 'default', text: '草稿' },
  shooting: { color: 'processing', text: '拍摄中' },
  done: { color: 'success', text: '完成' },
}

const { TextArea } = Input

const ChapterManagement: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [loading, setLoading] = useState(true)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [createContent, setCreateContent] = useState('')
  const [createTitle, setCreateTitle] = useState('')
  const [smartSimplifyLoading, setSmartSimplifyLoading] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editingChapter, setEditingChapter] = useState<Chapter | null>(null)
  const [editContent, setEditContent] = useState('')
  const [extractTags, setExtractTags] = useState<{ role: string[]; scene: string[]; prop: string[] }>({ role: [], scene: [], prop: [] })
  const [extractLoading, setExtractLoading] = useState(false)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])

  const load = async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const [proj, list] = await Promise.all([
        api.projects.get(projectId),
        api.chapters.list(projectId),
      ])
      setProject(proj && typeof proj === 'object' && 'id' in proj ? proj : null)
      setChapters(Array.isArray(list) ? list : [])
    } catch {
      message.error('加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [projectId])

  const handleSmartSimplify = async () => {
    setSmartSimplifyLoading(true)
    try {
      await new Promise((r) => setTimeout(r, 800))
      setCreateContent((prev) => prev ? `${prev}\n\n[已智能精简：保留关键主线内容]` : '[智能精简结果示例]')
      message.success('智能精简完成')
    } finally {
      setSmartSimplifyLoading(false)
    }
  }

  const handleCreateChapter = () => {
    if (!createTitle.trim()) {
      message.warning('请输入章节标题')
      return
    }
    message.success('创建成功（Mock）')
    setCreateModalOpen(false)
    setCreateTitle('')
    setCreateContent('')
    void load()
  }

  const openEditModal = (record: Chapter) => {
    setEditingChapter(record)
    setEditContent(record.summary || '')
    setExtractTags({ role: [], scene: [], prop: [] })
    setEditModalOpen(true)
  }

  const handleSmartExtract = async () => {
    setExtractLoading(true)
    try {
      await new Promise((r) => setTimeout(r, 600))
      setExtractTags({
        role: ['小雨', '阿川'],
        scene: ['出租屋', '城郊小区'],
        prop: ['欠条', '风扇'],
      })
      message.success('已提取角色/场景/道具')
    } finally {
      setExtractLoading(false)
    }
  }

  const columns: TableColumnsType<Chapter> = [
    {
      title: '章节',
      dataIndex: 'index',
      key: 'index',
      width: 80,
      render: (v) => `第${v}集`,
    },
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
      render: (title: string, record) => (
        <Link
          to={`/projects/${projectId}/chapters/${record.id}/prep`}
          onClick={(e) => {
            // 避免被 Table 行选择/点击行为吞掉
            e.stopPropagation()
          }}
          className="block truncate text-blue-600 hover:text-blue-800"
          title="进入章节编辑"
        >
          {title}
        </Link>
      ),
    },
    {
      title: '内容摘要',
      dataIndex: 'summary',
      key: 'summary',
      ellipsis: true,
    },
    {
      title: '分镜数',
      dataIndex: 'storyboardCount',
      key: 'storyboardCount',
      width: 90,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: Chapter['status']) => {
        const { color, text } = statusMap[status] || statusMap.draft
        return <Tag color={color}>{text}</Tag>
      },
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 160,
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      render: (_, record) => (
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEditModal(record)}>
            编辑
          </Button>
          <Button
            type="link"
            size="small"
            icon={<FileTextOutlined />}
            onClick={() => navigate(`/projects/${projectId}/chapters/${record.id}/prep`)}
          >
            章节编辑
          </Button>
          <Button type="link" size="small" danger icon={<DeleteOutlined />}>
            删除
          </Button>
          <Button
            type="link"
            size="small"
            icon={<VideoCameraOutlined />}
            onClick={() =>
              navigate(`/projects/${projectId}/chapters/${record.id}/studio`)
            }
          >
            进入拍摄
          </Button>
        </Space>
      ),
    },
  ]

  if (!project) return null

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Link to="/projects" className="text-gray-500 hover:text-gray-700 flex items-center gap-1">
          <ArrowLeftOutlined /> 项目列表
        </Link>
        <span className="text-gray-400">/</span>
        <Link to={`/projects/${projectId}`} className="text-gray-500 hover:text-gray-700">
          项目工作台
        </Link>
        <span className="text-gray-400">/</span>
        <span className="font-medium">{project.name}</span>
        <Link
          to={`/projects/${projectId}/editor`}
          className="ml-auto text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
        >
          <VideoCameraFilled /> 视频编辑
        </Link>
      </div>
      <Card title={project.name} className="mb-4">
        <p className="text-gray-600 text-sm mb-4">{project.description}</p>
        <Row gutter={24}>
          <Col>
            <Statistic title="章节数" value={project.stats.chapters} />
          </Col>
          <Col>
            <Statistic title="角色" value={project.stats.roles} />
          </Col>
          <Col>
            <Statistic title="场景" value={project.stats.scenes} />
          </Col>
          <Col>
            <Statistic title="道具" value={project.stats.props} />
          </Col>
        </Row>
      </Card>

      <Card
        title="章节列表"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModalOpen(true)}>
            创建章节
          </Button>
        }
      >
        {selectedRowKeys.length > 0 && (
          <div className="mb-3 flex items-center gap-2 flex-wrap">
            <span className="text-gray-500 text-sm">已选 {selectedRowKeys.length} 项</span>
            <Button size="small" icon={<MergeCellsOutlined />}>合并分镜</Button>
            <Button size="small" icon={<EyeInvisibleOutlined />}>分镜隐藏（不拍摄）</Button>
            <Button size="small" icon={<SoundOutlined />}>关闭配乐/对白</Button>
          </div>
        )}
        <Table<Chapter>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={chapters}
          pagination={{ pageSize: 10 }}
          rowSelection={{
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys(keys as React.Key[]),
          }}
        />
      </Card>

      <Modal
        title="创建章节"
        open={createModalOpen}
        onCancel={() => setCreateModalOpen(false)}
        width={640}
        footer={[
          <Button key="cancel" onClick={() => setCreateModalOpen(false)}>取消</Button>,
          <Button key="simplify" loading={smartSimplifyLoading} onClick={() => void handleSmartSimplify()}>
            智能精简
          </Button>,
          <Button key="submit" type="primary" onClick={handleCreateChapter}>创建</Button>,
        ]}
      >
        <div className="mb-3">
          <span className="text-gray-600 text-sm">章节标题</span>
          <Input
            placeholder="例如：第1集 出租屋里的争吵"
            value={createTitle}
            onChange={(e) => setCreateTitle(e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <span className="text-gray-600 text-sm">章节内容（可粘贴剧本，点击「智能精简」保留关键主线）</span>
          <TextArea
            rows={8}
            placeholder="粘贴文学剧本..."
            value={createContent}
            onChange={(e) => setCreateContent(e.target.value)}
            className="mt-1 font-mono text-sm"
          />
        </div>
      </Modal>

      <Modal
        title={`编辑章节${editingChapter ? `：${editingChapter.title}` : ''}`}
        open={editModalOpen}
        onCancel={() => { setEditModalOpen(false); setEditingChapter(null) }}
        width={640}
        footer={[
          <Button key="cancel" onClick={() => { setEditModalOpen(false); setEditingChapter(null) }}>取消</Button>,
          <Button key="extract" loading={extractLoading} onClick={() => void handleSmartExtract()}>
            智能提取
          </Button>,
          <Button key="ok" type="primary" onClick={() => { message.success('已保存'); setEditModalOpen(false); setEditingChapter(null); void load() }}>保存</Button>,
        ]}
      >
        <div className="mb-3">
          <span className="text-gray-600 text-sm">内容编辑</span>
          <TextArea
            rows={6}
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="mt-1"
          />
        </div>
        <div className="mb-2 text-gray-600 text-sm">智能提取（角色 / 场景 / 道具）</div>
        <div className="flex gap-4 flex-wrap">
          <div>
            <span className="text-xs text-gray-500">角色</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {extractTags.role.map((r) => <Tag key={r}>{r}</Tag>)}
            </div>
          </div>
          <div>
            <span className="text-xs text-gray-500">场景</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {extractTags.scene.map((s) => <Tag key={s}>{s}</Tag>)}
            </div>
          </div>
          <div>
            <span className="text-xs text-gray-500">道具</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {extractTags.prop.map((p) => <Tag key={p}>{p}</Tag>)}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}

export default ChapterManagement
