import { Button, Card, Empty, Spin, Table, Typography } from 'antd'
import { ScissorOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { useChapters } from '../hooks/useProjectData'
import { getChapterTimelinePath, getProjectChaptersPath } from '../routes'
import { ScrollablePage } from '../../../components/ScrollablePage'

/**
 * 「剪辑」Tab：列出各章节入口，跳转到真实路由 `/projects/:projectId/chapters/:chapterId/timeline`。
 */
export function EditTab() {
  const navigate = useNavigate()
  const { projectId } = useParams<{ projectId: string }>()
  const { chapters, loading } = useChapters(projectId)
  const sorted = [...chapters].sort((a, b) => a.index - b.index)

  if (!projectId) {
    return null
  }

  if (loading) {
    return (
      <ScrollablePage className="pr-1">
        <div className="flex justify-center items-center py-16">
          <Spin size="large" tip="加载章节…" />
        </div>
      </ScrollablePage>
    )
  }

  if (sorted.length === 0) {
    return (
      <ScrollablePage className="pr-1">
        <Card>
          <Empty description="暂无章节。请先创建章节，再为每一章打开「章节剪辑」编排镜头顺序并导出成片。">
            <Button type="primary" onClick={() => navigate(getProjectChaptersPath(projectId))}>
              前往章节管理
            </Button>
          </Empty>
        </Card>
      </ScrollablePage>
    )
  }

  return (
    <ScrollablePage className="pr-1">
      <div className="space-y-4">
        <Typography.Paragraph type="secondary" className="!mb-0">
          以下为各章节的<strong>章节剪辑</strong>入口（镜头顺序与导出成片）。与「章节」Tab
          里的列表一致；若某章尚无分镜，时间线可能为空，可先完成分镜与成片生成。
        </Typography.Paragraph>
        <Card size="small">
          <Table
            rowKey="id"
            dataSource={sorted}
            pagination={false}
            size="small"
            columns={[
              { title: '章节', dataIndex: 'index', width: 100, render: (v: number) => `第${v}集` },
              { title: '标题', dataIndex: 'title', ellipsis: true, render: (t: string) => t || '未命名' },
              {
                title: '操作',
                width: 160,
                render: (_, row) => (
                  <Button
                    type="primary"
                    size="small"
                    icon={<ScissorOutlined />}
                    onClick={() => navigate(getChapterTimelinePath(projectId, row.id))}
                  >
                    章节剪辑
                  </Button>
                ),
              },
            ]}
          />
        </Card>
      </div>
    </ScrollablePage>
  )
}
