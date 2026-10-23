import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Checkbox, Col, Empty, Modal, Pagination, Row, Select, Space, Spin, Tag } from 'antd'
import { DownloadOutlined, FileImageOutlined, VideoCameraOutlined, SoundOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { StudioFilesService } from '../../../../../services/generated'
import type { FileRead } from '../../../../../services/generated'
import { DisplayImageCard } from '../../../assets/components/DisplayImageCard'
import { useChapters } from '../hooks/useProjectData'
import { buildFileDownloadUrl } from '../../../assets/utils'

const PAGE_SIZE = 10

function openDownload(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
}

function batchOpenDownloads(urls: string[]) {
  urls.forEach((url, i) => {
    if (!url) return
    setTimeout(() => window.open(url, '_blank', 'noopener,noreferrer'), i * 350)
  })
}

export function FilesTab() {
  const navigate = useNavigate()
  const { projectId } = useParams<{ projectId: string }>()

  const { chapters, loading: chaptersLoading } = useChapters(projectId)

  const [chapterTitle, setChapterTitle] = useState<string | undefined>(undefined)
  const [page, setPage] = useState(1)
  const [files, setFiles] = useState<FileRead[]>([])
  const [total, setTotal] = useState(0)
  const [filesLoading, setFilesLoading] = useState(false)

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [previewVideo, setPreviewVideo] = useState<FileRead | null>(null)

  const loadFiles = useCallback(async () => {
    if (!projectId) return
    setFilesLoading(true)
    try {
      const res = await StudioFilesService.listFilesApiApiV1StudioFilesGet({
        projectId,
        chapterTitle: chapterTitle ?? null,
        page,
        pageSize: PAGE_SIZE,
        order: 'updated_at',
        isDesc: true,
      })
      setFiles(res.data?.items ?? [])
      setTotal(res.data?.pagination?.total ?? 0)
    } catch {
      setFiles([])
      setTotal(0)
    } finally {
      setFilesLoading(false)
    }
  }, [projectId, chapterTitle, page])

  useEffect(() => {
    void loadFiles()
  }, [loadFiles])

  const toggleSelect = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  /** 展示与下载均使用 `/api/v1/studio/files/{id}/download`（由 buildFileDownloadUrl 拼接）。 */
  const fileResourceUrl = (file: FileRead) => buildFileDownloadUrl(file.id)

  const downloadOne = (file: FileRead) => {
    const url = fileResourceUrl(file)
    if (url) openDownload(url)
  }

  const handleBatchDownload = () => {
    const urls = Array.from(selectedIds)
      .map((id) => buildFileDownloadUrl(id))
      .filter((u): u is string => Boolean(u))
    batchOpenDownloads(urls)
  }

  return (
    <>
      <Card
        title="项目文件"
        extra={
          <Space wrap>
            {selectedIds.size > 0 ? (
              <Button type="primary" icon={<DownloadOutlined />} onClick={handleBatchDownload}>
                批量下载（{selectedIds.size}）
              </Button>
            ) : null}
            <Button onClick={() => navigate('/files')}>前往文件管理</Button>
          </Space>
        }
      >
        <div className="mb-4">
          <Space wrap>
            <Select
              allowClear
              placeholder="章节标题"
              style={{ minWidth: 220 }}
              value={chapterTitle}
              options={chapters.map((c) => ({ value: c.title, label: `${c.title}（第${c.index}章）` }))}
              onChange={(v) => {
                setChapterTitle(v ?? undefined)
                setPage(1)
              }}
              loading={chaptersLoading}
            />

          </Space>
        </div>

        <Spin spinning={filesLoading}>
          {files.length === 0 && !filesLoading ? (
            <Empty
              description="暂无文件（仅展示已在项目中产生过关联记录的文件）"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          ) : (
            <Row gutter={[16, 16]}>
              {files.map((file) => {
                const url = fileResourceUrl(file)
                const checked = selectedIds.has(file.id)
                const isVideo = file.type === 'video'
                const isAudio = file.type === 'audio'

                return (
                  <Col key={file.id} xs={24} sm={12} md={8} lg={6}>
                    <DisplayImageCard
                      title={
                        <div className="flex items-start gap-2 pr-1 min-w-0">
                          <Checkbox
                            checked={checked}
                            onChange={(e) => {
                              e.stopPropagation()
                              toggleSelect(file.id, e.target.checked)
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span className="truncate flex-1 min-w-0 text-sm font-normal" title={file.name}>
                            {file.name}
                          </span>
                        </div>
                      }
                      imageUrl={isAudio ? undefined : url}
                      imageAlt={file.name}
                      enablePreview={!isVideo && !isAudio}
                      onImageClick={isVideo || isAudio ? () => setPreviewVideo(file) : undefined}
                      placeholder={
                        isAudio ? <SoundOutlined className="text-4xl" /> : isVideo ? (
                          <span className="flex flex-col items-center gap-1 text-gray-400">
                            <VideoCameraOutlined className="text-4xl" />
                            <span className="text-xs">点击预览</span>
                          </span>
                        ) : (
                          <FileImageOutlined className="text-5xl text-gray-300" />
                        )
                      }
                      meta={<Tag color={isVideo ? 'purple' : 'blue'}>{isVideo ? '视频' : isAudio ? '音频' : '图片'}</Tag>}
                      footer={
                        <Button
                          block
                          type="primary"
                          ghost
                          icon={<DownloadOutlined />}
                          onClick={(e) => {
                            e.stopPropagation()
                            downloadOne(file)
                          }}
                        >
                          下载
                        </Button>
                      }
                    />
                  </Col>
                )
              })}
            </Row>
          )}
        </Spin>

        {total > 0 && (
          <div className="mt-6 flex justify-end">
            <Pagination
              current={page}
              pageSize={PAGE_SIZE}
              total={total}
              showSizeChanger={false}
              onChange={(p) => setPage(p)}
              showTotal={(t) => `共 ${t} 条`}
            />
          </div>
        )}
      </Card>

      <Modal
        title={previewVideo?.name ?? '媒体预览'}
        open={previewVideo !== null}
        footer={null}
        width={720}
        onCancel={() => setPreviewVideo(null)}
        destroyOnClose
      >
        {previewVideo?.type === 'audio' ? <audio aria-label="音频预览" src={buildFileDownloadUrl(previewVideo.id)} controls style={{ width: '100%' }} /> : previewVideo ? (
          <video
            className="w-full max-h-[70vh] bg-black rounded"
            src={buildFileDownloadUrl(previewVideo.id)}
            controls
            playsInline
          >
            您的浏览器不支持视频播放
          </video>
        ) : null}
      </Modal>
    </>
  )
}
