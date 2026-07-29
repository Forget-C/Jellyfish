/**
 * EP001 生产工作台（只读检视 + 本地异步导入入口）。
 *
 * 纪律：
 * - 复用既有 Project/Chapter/Shot/File/任务中心接口，不新增并行模型；
 * - 字幕为只读产物：可预览、可下载，不提供原生编辑；
 * - 轮询仅在任务非终态时进行，卸载与终态都会停止。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Alert,
  Button,
  Card,
  Collapse,
  Descriptions,
  Empty,
  Input,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd'

import {
  fetchChapter,
  fetchShotBundles,
  fetchSubtitleFiles,
  fetchSubtitleText,
  fetchTaskResult,
  fetchTaskStatus,
  isTerminalStatus,
  startAsyncImport,
  subtitleDownloadUrl,
  WEBVTT_MIME_TYPE,
  type ChapterRead,
  type FileRead,
  type ImportResult,
  type ShotBundle,
  type SubtitleArtifact,
  type TaskStatusView,
} from '../../../services/casWorkspaceApi'
import { parseWebVtt, type ParsedVtt } from './webvtt'

const POLL_INTERVAL_MS = 2000
const MAX_POLLS = 90 // 有界轮询：约 3 分钟后停止，避免无限请求

function asText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

export default function Ep001Workspace() {
  const { projectId = '', chapterId = '' } = useParams()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [chapter, setChapter] = useState<ChapterRead | null>(null)
  const [shots, setShots] = useState<ShotBundle[]>([])

  const [subtitleFiles, setSubtitleFiles] = useState<FileRead[]>([])
  const [subtitleLoading, setSubtitleLoading] = useState(false)
  const [subtitleError, setSubtitleError] = useState<string | null>(null)
  const [preview, setPreview] = useState<ParsedVtt | null>(null)
  const [artifactFromImport, setArtifactFromImport] = useState<SubtitleArtifact | null>(null)

  const [task, setTask] = useState<TaskStatusView | null>(null)
  const [taskReused, setTaskReused] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [jsonText, setJsonText] = useState('')
  const [idemKey, setIdemKey] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const loadWorkspace = useCallback(async () => {
    if (!chapterId) return
    setLoading(true)
    setLoadError(null)
    try {
      const [chapterData, shotData] = await Promise.all([
        fetchChapter(chapterId),
        fetchShotBundles(chapterId),
      ])
      if (!mountedRef.current) return
      setChapter(chapterData)
      setShots(shotData)
    } catch (err) {
      if (mountedRef.current) setLoadError((err as Error)?.message || '加载失败')
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [chapterId])

  const loadSubtitle = useCallback(async () => {
    if (!projectId || !chapterId) return
    setSubtitleLoading(true)
    setSubtitleError(null)
    try {
      const files = await fetchSubtitleFiles(projectId, chapterId)
      if (!mountedRef.current) return
      setSubtitleFiles(files)
      if (files.length > 0) {
        const text = await fetchSubtitleText(files[0].id)
        if (!mountedRef.current) return
        setPreview(parseWebVtt(text))
      } else {
        setPreview(null)
      }
    } catch (err) {
      if (mountedRef.current) setSubtitleError((err as Error)?.message || '字幕读取失败')
    } finally {
      if (mountedRef.current) setSubtitleLoading(false)
    }
  }, [projectId, chapterId])

  useEffect(() => {
    mountedRef.current = true
    void loadWorkspace()
    void loadSubtitle()
    return () => {
      mountedRef.current = false
      stopPolling()
    }
  }, [loadWorkspace, loadSubtitle, stopPolling])

  // 有界轮询：仅在非终态时继续，卸载/终态即停止。
  const pollTask = useCallback(
    async (taskId: string, attempt: number) => {
      if (!mountedRef.current || attempt > MAX_POLLS) return
      try {
        const status = await fetchTaskStatus(taskId)
        if (!mountedRef.current) return
        setTask(status)
        if (isTerminalStatus(status.status)) {
          stopPolling()
          if (status.status === 'succeeded') {
            const result = await fetchTaskResult(taskId)
            if (!mountedRef.current) return
            setImportResult(result)
            const artifact = result?.subtitle_artifacts?.[0] ?? null
            setArtifactFromImport(artifact)
            await loadWorkspace()
            await loadSubtitle()
          }
          return
        }
        timerRef.current = setTimeout(() => void pollTask(taskId, attempt + 1), POLL_INTERVAL_MS)
      } catch (err) {
        if (!mountedRef.current) return
        setImportError((err as Error)?.message || '任务状态查询失败')
        stopPolling()
      }
    },
    [loadSubtitle, loadWorkspace, stopPolling],
  )

  const handleImport = useCallback(async () => {
    setImportError(null)
    setImportResult(null)
    setTaskReused(false)

    let parsed: unknown
    try {
      parsed = JSON.parse(jsonText)
    } catch {
      setImportError('Episode Package JSON 格式不正确（客户端校验；后端校验为准）')
      return
    }
    if (!idemKey.trim()) {
      setImportError('请填写 idempotency_key')
      return
    }

    setSubmitting(true)
    try {
      const accepted = await startAsyncImport({
        project_id: projectId,
        idempotency_key: idemKey.trim(),
        episode_package: parsed,
      })
      if (!mountedRef.current) return
      setTaskReused(!!accepted.reused)
      setTask({ id: accepted.task_id, status: accepted.status as TaskStatusView['status'] })
      stopPolling()
      void pollTask(accepted.task_id, 1)
    } catch (err) {
      if (mountedRef.current) {
        const body = (err as { body?: { message?: string; detail?: string } })?.body
        setImportError(body?.message || body?.detail || (err as Error)?.message || '导入失败')
      }
    } finally {
      if (mountedRef.current) setSubmitting(false)
    }
  }, [idemKey, jsonText, pollTask, projectId, stopPolling])

  const subtitleFile = subtitleFiles[0]
  const totalDurationSeconds = useMemo(() => {
    return shots.reduce((sum, bundle) => {
      const duration = Number(bundle.detail?.duration ?? 0)
      return sum + (Number.isFinite(duration) ? duration : 0)
    }, 0)
  }, [shots])

  if (loading) {
    return (
      <div className="p-6" data-testid="ep001-loading">
        <Spin tip="加载 EP001 工作台…">
          <div style={{ minHeight: 120 }} />
        </Spin>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="p-6">
        <Alert
          type="error"
          showIcon
          message="工作台加载失败"
          description={loadError}
          action={
            <Button size="small" onClick={() => void loadWorkspace()}>
              重试
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="p-6" data-testid="ep001-workspace">
      <Typography.Title level={3}>EP001 生产工作台</Typography.Title>

      {/* --- 剧集摘要 --- */}
      <Card title="剧集摘要" className="mb-4" data-testid="episode-summary">
        <Descriptions column={2} size="small">
          <Descriptions.Item label="章节标题">{chapter?.title || '—'}</Descriptions.Item>
          <Descriptions.Item label="章节摘要">{chapter?.summary || '—'}</Descriptions.Item>
          <Descriptions.Item label="Project ID">{chapter?.project_id || projectId}</Descriptions.Item>
          <Descriptions.Item label="Chapter ID">{chapter?.id || chapterId}</Descriptions.Item>
          <Descriptions.Item label="镜头数">
            {chapter?.storyboard_count ?? shots.length}
          </Descriptions.Item>
          <Descriptions.Item label="合计时长（来自 ShotDetail.duration）">
            {totalDurationSeconds > 0 ? `${totalDurationSeconds.toFixed(1)} 秒` : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="章节状态">{chapter?.status || '—'}</Descriptions.Item>
          <Descriptions.Item label="导入状态">
            {task?.status ? <Tag>{task.status}</Tag> : <span>—</span>}
          </Descriptions.Item>
        </Descriptions>
        <Alert
          className="mt-3"
          type="info"
          showIcon
          message="契约缺口"
          description={
            'episode_id（CAS-EP001）与 9:16 输出规格未持久化到 Jellyfish 实体，' +
            '仅存在于 Episode Package 与导入结果中，因此此处不展示推测值。' +
            'ShotDetail.duration 为整数秒，合计为 24 秒，但 24.0 秒的精确时长同样只存在于契约侧。'
          }
        />
      </Card>

      {/* --- 镜头列表 --- */}
      <Card title={`镜头（${shots.length}）`} className="mb-4" data-testid="shot-list">
        {shots.length === 0 ? (
          <Empty description="暂无镜头" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Collapse
            accordion
            items={shots.map(({ shot, detail, dialogLines }) => ({
              key: shot.id,
              label: (
                <span data-testid="shot-row">
                  #{shot.index} {shot.title || '(untitled)'}
                </span>
              ),
              children: (
                <Descriptions column={1} size="small">
                  <Descriptions.Item label="状态">{asText(shot.status) || '—'}</Descriptions.Item>
                  <Descriptions.Item label="时长（秒）">
                    {asText(detail?.duration) || '—'}
                  </Descriptions.Item>
                  <Descriptions.Item label="镜头景别 / 角度 / 运动">
                    {[
                      asText(detail?.camera_shot),
                      asText(detail?.angle),
                      asText(detail?.movement),
                    ]
                      .filter(Boolean)
                      .join(' / ') || '—'}
                  </Descriptions.Item>
                  <Descriptions.Item label="氛围 / 动作节拍">
                    {[asText(detail?.atmosphere), (detail?.action_beats ?? []).join('；')]
                      .filter(Boolean)
                      .join(' | ') || '—'}
                  </Descriptions.Item>
                  <Descriptions.Item label="剧本摘录">
                    {asText(shot.script_excerpt) || '—'}
                  </Descriptions.Item>
                  <Descriptions.Item label="关键帧提示词">
                    {asText(detail?.key_frame_prompt) || '—'}
                  </Descriptions.Item>
                  <Descriptions.Item label="英文对白">
                    {dialogLines.length === 0 ? (
                      '—'
                    ) : (
                      <ul className="m-0 pl-4">
                        {dialogLines.map((line) => (
                          <li key={line.id} data-testid="dialogue-line">
                            <strong>{asText(line.speaker_name) || '—'}: </strong>
                            {asText(line.text)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Descriptions.Item>
                </Descriptions>
              ),
            }))}
          />
        )}
      </Card>

      {/* --- 字幕产物 --- */}
      <Card title="zh-Hant 字幕产物（只读）" className="mb-4" data-testid="subtitle-panel">
        {subtitleLoading ? (
          <Spin data-testid="subtitle-loading">
            <div style={{ minHeight: 80 }} />
          </Spin>
        ) : subtitleError ? (
          <Alert
            type="error"
            showIcon
            message="字幕读取失败"
            description={subtitleError}
            action={
              <Button size="small" onClick={() => void loadSubtitle()}>
                重试
              </Button>
            }
          />
        ) : !subtitleFile ? (
          <Empty
            description="尚未生成字幕产物（导入 v1.1 Episode Package 后生成）"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          <>
            <Descriptions column={2} size="small" data-testid="subtitle-meta">
              <Descriptions.Item label="语言标签">
                {artifactFromImport?.language_tag || preview?.language || 'zh-Hant'}
              </Descriptions.Item>
              <Descriptions.Item label="文件类型">{subtitleFile.type}</Descriptions.Item>
              <Descriptions.Item label="MIME">{WEBVTT_MIME_TYPE}</Descriptions.Item>
              <Descriptions.Item label="cue 数">
                {artifactFromImport?.cue_count ?? preview?.cues.length ?? '—'}
              </Descriptions.Item>
              <Descriptions.Item label="字节数">
                {artifactFromImport?.byte_size ?? '—'}
              </Descriptions.Item>
              <Descriptions.Item label="新建 / 复用">
                {artifactFromImport
                  ? artifactFromImport.created
                    ? 'created'
                    : 'reused'
                  : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="File ID">{subtitleFile.id}</Descriptions.Item>
              <Descriptions.Item label="文件名">{subtitleFile.name}</Descriptions.Item>
              <Descriptions.Item label="Storage key">
                {/* FileRead 不暴露 storage_key，仅导入结果里有 */}
                {artifactFromImport?.storage_key || '—'}
              </Descriptions.Item>
            </Descriptions>

            <Space className="mb-3">
              <Button
                type="primary"
                href={subtitleDownloadUrl(subtitleFile.id)}
                target="_blank"
                rel="noreferrer"
                data-testid="subtitle-download"
              >
                下载 WebVTT
              </Button>
            </Space>

            {preview && !preview.valid && (
              <Alert type="warning" showIcon message="字幕内容不是有效的 WebVTT，无法预览" />
            )}
            {preview?.valid && (
              <Table
                size="small"
                rowKey={(row) => row.id || `${row.start}-${row.end}`}
                dataSource={preview.cues}
                pagination={false}
                data-testid="subtitle-preview"
                columns={[
                  { title: 'Cue', dataIndex: 'id', width: 90 },
                  { title: '入点', dataIndex: 'start', width: 130 },
                  { title: '出点', dataIndex: 'end', width: 130 },
                  { title: '镜头', dataIndex: 'shotId', width: 100 },
                  // 纯文本渲染：React 会转义，字幕内容不会作为 HTML 执行。
                  { title: '译文', dataIndex: 'text' },
                ]}
              />
            )}
          </>
        )}
      </Card>

      {/* --- 异步导入 --- */}
      <Card title="异步导入 Episode Package" data-testid="import-panel">
        {importError && (
          <Alert
            className="mb-3"
            type="error"
            showIcon
            message="导入失败"
            description={importError}
            data-testid="import-error"
          />
        )}
        {taskReused && (
          <Alert
            className="mb-3"
            type="info"
            showIcon
            message="已复用同一剧集的进行中任务（未重复登记）"
            data-testid="task-reused"
          />
        )}
        {task && (
          <div className="mb-3" data-testid="task-status">
            任务 <code>{task.id}</code> 状态：<Tag>{task.status}</Tag>
            {task.error ? <span data-testid="task-error"> 错误：{task.error}</span> : null}
          </div>
        )}
        {importResult && (
          <Alert
            className="mb-3"
            type="success"
            showIcon
            message={`导入完成：${importResult.status}`}
            description={`章节 ${importResult.chapter_id ?? '—'}，字幕产物 ${
              importResult.subtitle_artifacts?.length ?? 0
            } 个`}
            data-testid="import-result"
          />
        )}

        <Space direction="vertical" className="w-full" style={{ width: '100%' }}>
          <Input
            placeholder="idempotency_key"
            value={idemKey}
            onChange={(e) => setIdemKey(e.target.value)}
            aria-label="idempotency_key"
          />
          <Input.TextArea
            rows={6}
            placeholder="粘贴 Episode Package JSON"
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            aria-label="Episode Package JSON"
          />
          <Button
            type="primary"
            loading={submitting}
            onClick={() => void handleImport()}
            data-testid="import-submit"
          >
            异步导入
          </Button>
        </Space>
      </Card>
    </div>
  )
}
