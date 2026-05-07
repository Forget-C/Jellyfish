import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  Card,
  Checkbox,
  Col,
  Empty,
  Input,
  Modal,
  Pagination,
  Popconfirm,
  Row,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd'
import { DeleteOutlined, DownloadOutlined, FileImageOutlined, VideoCameraOutlined } from '@ant-design/icons'
import { useSearchParams } from 'react-router-dom'
import { StudioFilesService } from '../../../services/generated'
import type { FileRead } from '../../../services/generated'
import { DisplayImageCard } from '../assets/components/DisplayImageCard'
import { buildFileDownloadUrl, resolveAssetUrl } from '../assets/utils'
import { ScrollablePage } from '../components/ScrollablePage'

const { Text } = Typography
const PAGE_SIZE = 24

function openDownload(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
}

const FileManager: React.FC = () => {
  const [searchParams] = useSearchParams()
  const projectId = searchParams.get('projectId')?.trim() || undefined

  const [files, setFiles] = useState<FileRead[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [q, setQ] = useState('')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(() => new Set())
  const [previewVideo, setPreviewVideo] = useState<FileRead | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await StudioFilesService.listFilesApiApiV1StudioFilesGet({
        projectId: projectId ?? null,
        q: q.trim() || null,
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
      message.error('加载文件失败')
    } finally {
      setLoading(false)
    }
  }, [page, projectId, q])

  useEffect(() => {
    void load()
  }, [load])

  const allTags = useMemo(
    () => Array.from(new Set(files.flatMap((f) => f.tags ?? []))).sort(),
    [files],
  )

  const filteredFiles = useMemo(
    () => (!tagFilter ? files : files.filter((f) => (f.tags ?? []).includes(tagFilter))),
    [files, tagFilter],
  )

  const toggleSelect = (id: string, checked: boolean) => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const handleDeleteOne = async (file: FileRead) => {
    try {
      await StudioFilesService.deleteFileApiApiV1StudioFilesFileIdDelete({ fileId: file.id })
      setSelectedFileIds((prev) => {
        const next = new Set(prev)
        next.delete(file.id)
        return next
      })
      if (previewVideo?.id === file.id) setPreviewVideo(null)
      message.success('文件已删除')
      await load()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除文件失败')
    }
  }

  const handleBatchDelete = async () => {
    const ids = Array.from(selectedFileIds)
    if (!ids.length) return
    try {
      await Promise.all(ids.map((fileId) => StudioFilesService.deleteFileApiApiV1StudioFilesFileIdDelete({ fileId })))
      setSelectedFileIds(new Set())
      setPreviewVideo(null)
      message.success(`已删除 ${ids.length} 个文件`)
      await load()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '批量删除文件失败')
    }
  }

  const handleBatchDownload = () => {
    Array.from(selectedFileIds)
      .map((id) => buildFileDownloadUrl(id))
      .filter((url): url is string => Boolean(url))
      .forEach((url, idx) => {
        setTimeout(() => openDownload(url), idx * 250)
      })
  }

  const filePreviewUrl = (file: FileRead) =>
    file.type === 'image' ? resolveAssetUrl(file.thumbnail) ?? buildFileDownloadUrl(file.id) : undefined

  return (
    <>
      <ScrollablePage className="pr-1">
        <div className="space-y-4">
          <Card
            title="文件管理"
            extra={
              <Space wrap>
                {projectId ? <Tag color="blue">当前仅查看项目文件</Tag> : <Tag>全局文件</Tag>}
                {selectedFileIds.size > 0 ? (
                  <>
                    <Button icon={<DownloadOutlined />} onClick={handleBatchDownload}>
                      批量下载（{selectedFileIds.size}）
                    </Button>
                    <Popconfirm
                      title={`确认删除选中的 ${selectedFileIds.size} 个文件？`}
                      description="删除后将移除文件记录与存储对象。"
                      okText="删除"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => void handleBatchDelete()}
                    >
                      <Button danger icon={<DeleteOutlined />}>
                        批量删除
                      </Button>
                    </Popconfirm>
                  </>
                ) : null}
              </Space>
            }
          >
            <div className="mb-4 flex flex-wrap items-center gap-4">
              <Input.Search
                placeholder="搜索文件名"
                allowClear
                className="max-w-sm"
                value={q}
                onSearch={(value) => {
                  setPage(1)
                  setQ(value)
                }}
                onChange={(e) => setQ(e.target.value)}
              />
              <Select
                placeholder="按标签筛选"
                allowClear
                style={{ width: 180 }}
                value={tagFilter}
                onChange={(value) => setTagFilter(value ?? null)}
                options={allTags.map((tag) => ({ label: tag, value: tag }))}
              />
              <Text type="secondary">当前页 {filteredFiles.length} 条，接口总数 {total} 条</Text>
            </div>

            <Spin spinning={loading}>
              {filteredFiles.length === 0 && !loading ? (
                <Empty description="暂无文件" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                <Row gutter={[16, 16]}>
                  {filteredFiles.map((file) => {
                    const checked = selectedFileIds.has(file.id)
                    const isVideo = file.type === 'video'
                    const downloadUrl = buildFileDownloadUrl(file.id)
                    return (
                      <Col xs={24} sm={12} md={8} lg={6} key={file.id}>
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
                          imageUrl={filePreviewUrl(file)}
                          imageAlt={file.name}
                          enablePreview={!isVideo}
                          onImageClick={isVideo ? () => setPreviewVideo(file) : undefined}
                          placeholder={
                            isVideo ? (
                              <span className="flex flex-col items-center gap-1 text-gray-400">
                                <VideoCameraOutlined className="text-4xl" />
                                <span className="text-xs">点击预览</span>
                              </span>
                            ) : (
                              <FileImageOutlined className="text-5xl text-gray-300" />
                            )
                          }
                          meta={
                            <Space wrap>
                              <Tag color={isVideo ? 'purple' : 'blue'}>{isVideo ? '视频' : '图片'}</Tag>
                              {(file.tags ?? []).slice(0, 3).map((tag) => (
                                <Tag key={tag}>{tag}</Tag>
                              ))}
                            </Space>
                          }
                          footer={
                            <Space direction="vertical" className="w-full">
                              <Button
                                block
                                type="primary"
                                ghost
                                icon={<DownloadOutlined />}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (downloadUrl) openDownload(downloadUrl)
                                }}
                              >
                                下载
                              </Button>
                              <Popconfirm
                                title="确认删除该文件？"
                                description="删除后将移除文件记录与存储对象。"
                                okText="删除"
                                cancelText="取消"
                                okButtonProps={{ danger: true }}
                                onConfirm={(e) => {
                                  e?.stopPropagation()
                                  void handleDeleteOne(file)
                                }}
                              >
                                <Button
                                  block
                                  danger
                                  icon={<DeleteOutlined />}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  删除
                                </Button>
                              </Popconfirm>
                            </Space>
                          }
                        />
                      </Col>
                    )
                  })}
                </Row>
              )}
            </Spin>

            {total > 0 ? (
              <div className="mt-6 flex justify-end">
                <Pagination
                  current={page}
                  pageSize={PAGE_SIZE}
                  total={total}
                  showSizeChanger={false}
                  onChange={(nextPage) => setPage(nextPage)}
                  showTotal={(count) => `共 ${count} 条`}
                />
              </div>
            ) : null}
          </Card>
        </div>
      </ScrollablePage>
      <Modal
        title={previewVideo?.name ?? '视频预览'}
        open={previewVideo !== null}
        footer={null}
        width={720}
        onCancel={() => setPreviewVideo(null)}
        destroyOnClose
      >
        {previewVideo ? (
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

export default FileManager
