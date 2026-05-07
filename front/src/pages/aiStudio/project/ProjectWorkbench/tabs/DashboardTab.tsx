import { Card, Button, Statistic, Row, Col, Progress, Space, Spin, message } from 'antd'
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  FileSearchOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { TabKey } from '../constants'
import { getChapterShotsPath, getChapterStudioPath, getChapterTimelinePath, getProjectChaptersPath } from '../routes'
import { useProject, useChapters } from '../hooks/useProjectData'
import { ScrollablePage } from '../../../components/ScrollablePage'
import { ensureHasShotsBeforeShooting } from '../ensureHasShotsBeforeShooting'
import { getChapterPreparationState } from '../chapterPreparation'
import {
  loadChapterFlowStats,
  loadProjectFlowStatsForChapters,
  type ChapterFlowStats,
  type ProjectFlowStats,
} from '../projectFlowStats'

export function DashboardTab({ onSelectTab }: { onSelectTab: (tab: TabKey) => void }) {
  const navigate = useNavigate()
  const { projectId } = useParams<{ projectId: string }>()
  const { project, loading: projectLoading } = useProject(projectId)
  const { chapters, loading: chaptersLoading } = useChapters(projectId)
  const [flowStats, setFlowStats] = useState<ProjectFlowStats>({
    totalShots: 0,
    pendingConfirmShots: 0,
    readyShots: 0,
    generatingShots: 0,
  })
  const [chapterFlowStats, setChapterFlowStats] = useState<ChapterFlowStats[]>([])
  const [flowStatsLoading, setFlowStatsLoading] = useState(false)

  const loading = projectLoading || chaptersLoading
  const chaptersByIndex = [...chapters].sort((a, b) => a.index - b.index)
  const incompleteChapters = chaptersByIndex.filter((c) => c.status !== 'done')
  const recommendedChapter =
    chaptersByIndex.find((chapter) => getChapterPreparationState(chapter).key === 'edit_raw') ??
    chaptersByIndex.find((chapter) => getChapterPreparationState(chapter).key === 'extract_shots') ??
    chaptersByIndex.find((chapter) => getChapterPreparationState(chapter).key === 'prepare_shots') ??
    chaptersByIndex.find((chapter) => getChapterPreparationState(chapter).key === 'shoot') ??
    chaptersByIndex[0] ??
    null

  useEffect(() => {
    let cancelled = false
    if (!projectId || !chapters.length) {
      setFlowStats({
        totalShots: 0,
        pendingConfirmShots: 0,
        readyShots: 0,
        generatingShots: 0,
      })
      setChapterFlowStats([])
      return () => {
        cancelled = true
      }
    }

    const run = async () => {
      setFlowStatsLoading(true)
      try {
        const [stats, chapterStats] = await Promise.all([
          loadProjectFlowStatsForChapters(chapters),
          loadChapterFlowStats(chapters),
        ])
        if (!cancelled) setFlowStats(stats)
        if (!cancelled) setChapterFlowStats(chapterStats)
      } catch {
        if (!cancelled) {
          setFlowStats({
            totalShots: 0,
            pendingConfirmShots: 0,
            readyShots: 0,
            generatingShots: 0,
          })
          setChapterFlowStats([])
        }
      } finally {
        if (!cancelled) setFlowStatsLoading(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [chapters, projectId])

  if (loading && !project) {
    return (
      <div className="flex justify-center items-center py-16">
        <Spin size="large" tip="加载中…" />
      </div>
    )
  }
  if (!project) {
    return null
  }

  const incompleteCount = incompleteChapters.length
  const recommendedState = recommendedChapter ? getChapterPreparationState(recommendedChapter) : null
  const chaptersNeedingRawText = chaptersByIndex.filter((chapter) => getChapterPreparationState(chapter).key === 'edit_raw').length
  const chaptersNeedingShotExtract = chaptersByIndex.filter((chapter) => getChapterPreparationState(chapter).key === 'extract_shots').length
  const chaptersNeedingShotPrep = chaptersByIndex.filter((chapter) => getChapterPreparationState(chapter).key === 'prepare_shots').length
  const chaptersReadyForShoot = chaptersByIndex.filter((chapter) => getChapterPreparationState(chapter).key === 'shoot').length
  const topPendingChapter = [...chapterFlowStats].sort((a, b) => b.pendingConfirmShots - a.pendingConfirmShots)[0]
  const topGeneratingChapter = [...chapterFlowStats].sort((a, b) => b.generatingShots - a.generatingShots)[0]
  const topReadyChapter = [...chapterFlowStats].sort((a, b) => b.readyShots - a.readyShots)[0]

  const handleRecommendedAction = () => {
    if (!projectId) return
    if (!recommendedChapter || !recommendedState) {
      onSelectTab('chapters')
      return
    }
    if (recommendedState.key === 'edit_raw') {
      onSelectTab('chapters')
      navigate(`/projects/${projectId}?tab=chapters&edit=${recommendedChapter.id}`, { replace: false })
      return
    }
    if (recommendedState.key === 'extract_shots') {
      navigate(getChapterShotsPath(projectId, recommendedChapter.id))
      return
    }
    if (recommendedState.key === 'prepare_shots') {
      navigate(getChapterStudioPath(projectId, recommendedChapter.id))
      return
    }
    void ensureHasShotsBeforeShooting({
      projectId,
      chapterId: recommendedChapter.id,
      storyboardCount: recommendedChapter.storyboardCount,
      navigate,
    })
  }

  const chapterTodoCards = [
    {
      key: 'edit_raw',
      title: '待补原文',
      count: chaptersNeedingRawText,
      hint: '这些章节还没进入分镜流程',
      icon: <ClockCircleOutlined />,
    },
    {
      key: 'extract_shots',
      title: '待提取分镜',
      count: chaptersNeedingShotExtract,
      hint: '已有原文，可直接进入分镜提取',
      icon: <ClockCircleOutlined />,
    },
    {
      key: 'prepare_shots',
      title: '待准备镜头',
      count: chaptersNeedingShotPrep,
      hint: '已有分镜，建议进入工作室继续处理',
      icon: <ClockCircleOutlined />,
    },
    {
      key: 'shoot',
      title: '可继续拍摄',
      count: chaptersReadyForShoot,
      hint: '这部分章节已具备继续拍摄条件',
      icon: <CheckCircleOutlined />,
    },
  ] as const

  return (
    <ScrollablePage className="pr-1">
      <div className="space-y-6">
      <Card size="small">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="font-medium">当前推荐动作</div>
            <div className="text-xs text-gray-500">
              {recommendedChapter && recommendedState
                ? `第${recommendedChapter.index}章 · ${recommendedState.hint}`
                : '暂无章节，可先创建第一章'}
            </div>
          </div>
          <Space wrap>
            <Button onClick={() => onSelectTab('chapters')}>进入章节管理</Button>
            <Button
              onClick={() => {
                if (!projectId) return
                const target = recommendedChapter ?? chaptersByIndex[0]
                if (!target) {
                  message.warning('请先创建章节，再进入章节剪辑')
                  onSelectTab('chapters')
                  return
                }
                navigate(getChapterTimelinePath(projectId, target.id))
              }}
            >
              进入后期剪辑
            </Button>
            <Button
              type="primary"
              icon={recommendedState?.primaryIcon ?? <VideoCameraOutlined />}
              onClick={handleRecommendedAction}
            >
              {recommendedChapter && recommendedState ? recommendedState.primaryAction : '创建第一章'}
            </Button>
          </Space>
        </div>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" className="h-full">
            <Statistic title="未完成章节" value={incompleteCount} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" className="h-full">
            <Statistic
              title="待确认分镜"
              value={flowStats.pendingConfirmShots}
              suffix={flowStats.totalShots ? `/ ${flowStats.totalShots}` : undefined}
              loading={flowStatsLoading}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" className="h-full">
            <Statistic
              title="已就绪分镜"
              value={flowStats.readyShots}
              loading={flowStatsLoading}
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" className="h-full">
            <Statistic
              title="生成中分镜"
              value={flowStats.generatingShots}
              loading={flowStatsLoading}
              prefix={<ClockCircleOutlined />}
            />
            <Progress
              percent={flowStats.totalShots ? Math.round((flowStats.readyShots / flowStats.totalShots) * 100) : project.progress}
              showInfo={false}
              size="small"
              strokeColor={{ from: '#6366f1', to: '#a855f7' }}
              className="mt-1"
            />
          </Card>
        </Col>
      </Row>

      <Card
        title="当前待办"
        size="small"
        extra={
          <Button type="link" onClick={() => projectId && navigate(getProjectChaptersPath(projectId))}>
            查看全部
          </Button>
        }
      >
        <div className="flex gap-3 overflow-x-auto pb-2" style={{ minHeight: 140 }}>
          {chapters.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-gray-500 py-8">
              还没有任何章节，
              <Button type="link" className="p-0" onClick={() => onSelectTab('chapters')}>
                立即创建第一章
              </Button>
            </div>
          ) : (
            chapterTodoCards.map((item) => (
              <Card
                key={item.key}
                size="small"
                hoverable
                className="shrink-0 cursor-pointer"
                style={{ width: 280 }}
                onClick={() => onSelectTab('chapters')}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium truncate">{item.title}</div>
                  <span className="text-gray-400">{item.icon}</span>
                </div>
                <div className="mt-1 text-2xl font-semibold">{item.count}</div>
                <div className="text-xs text-gray-500 mt-1">
                  {item.hint}
                </div>
              </Card>
            ))
          )}
        </div>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={14}>
          <Card title="动态摘要" size="small">
            <div className="space-y-3 text-sm">
              <div className="rounded-md border border-amber-100 bg-amber-50 px-3 py-2">
                <div className="flex items-center gap-2 font-medium text-amber-800">
                  <ClockCircleOutlined />
                  待确认压力最大
                </div>
                <div className="mt-1 text-gray-700">
                  {topPendingChapter && topPendingChapter.pendingConfirmShots > 0
                    ? `第${topPendingChapter.chapterIndex ?? '-'}章还有 ${topPendingChapter.pendingConfirmShots} 条分镜待确认，建议优先处理。`
                    : '当前没有待确认分镜积压。'}
                </div>
              </div>

              <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2">
                <div className="flex items-center gap-2 font-medium text-blue-800">
                  <VideoCameraOutlined />
                  当前生成最活跃
                </div>
                <div className="mt-1 text-gray-700">
                  {topGeneratingChapter && topGeneratingChapter.generatingShots > 0
                    ? `第${topGeneratingChapter.chapterIndex ?? '-'}章有 ${topGeneratingChapter.generatingShots} 条分镜正在生成，可以继续关注结果。`
                    : '当前没有分镜处于生成中。'}
                </div>
              </div>

              <div className="rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2">
                <div className="flex items-center gap-2 font-medium text-emerald-800">
                  <CheckCircleOutlined />
                  最适合继续推进
                </div>
                <div className="mt-1 text-gray-700">
                  {topReadyChapter && topReadyChapter.readyShots > 0
                    ? `第${topReadyChapter.chapterIndex ?? '-'}章已有 ${topReadyChapter.readyShots} 条已就绪分镜，适合继续推进视频生成。`
                    : '当前还没有明显可继续推进的视频生成批次。'}
                </div>
              </div>
            </div>
            <Button
              type="link"
              className="p-0 mt-3"
              icon={<FileSearchOutlined />}
              onClick={() => onSelectTab('chapters')}
            >
              去章节里继续推进
            </Button>
          </Card>
        </Col>
        <Col xs={24} md={10}>
          <Card title="资产健康快照" size="small">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>角色</span>
                <span className="text-gray-500">{project.stats.roles} 项</span>
              </div>
              <Progress percent={80} size="small" showInfo={false} />
              <div className="flex justify-between text-sm">
                <span>场景</span>
                <span className="text-gray-500">{project.stats.scenes} 项</span>
              </div>
              <Progress percent={60} size="small" showInfo={false} />
              <div className="flex justify-between text-sm">
                <span>道具</span>
                <span className="text-gray-500">{project.stats.props} 项</span>
              </div>
              <Progress percent={75} size="small" showInfo={false} />
            </div>
            <Button type="link" className="p-0 mt-2" onClick={() => navigate('/assets')}>
              管理资产
            </Button>
          </Card>
        </Col>
      </Row>
      </div>
    </ScrollablePage>
  )
}
