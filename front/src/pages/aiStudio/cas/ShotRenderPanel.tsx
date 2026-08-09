/**
 * 单镜头渲染面板（Step 7）。
 *
 * 纪律：
 * - 状态**全部来自后端**：刷新后靠 fetchProductionJob / fetchProductionArtifacts 恢复；
 * - 轮询用「上一次请求完成后再排下一次」的递归 setTimeout，并配合 in-flight 守卫，
 *   因此请求不可能重叠；终态、卸载、切换镜头都会停止；
 * - 播放只用后端给的 download_url，绝不由 storage_key 拼地址。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Progress,
  Radio,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd'

import {
  RENDER_POLL_INTERVAL_MS,
  artifactsForShot,
  fetchProductionArtifacts,
  fetchProductionJob,
  startShotRender,
  type RenderArtifactView,
  type RenderProfile,
  type RenderTaskView,
} from '../../../services/casWorkspaceApi'

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled'])

/** 供应商处理中：有任务在跑但拿不到确定进度。 */
function isProviderProcessing(task: RenderTaskView | null): boolean {
  if (!task || TERMINAL.has(task.status)) return false
  return (task.progress ?? 0) >= 20 && (task.progress ?? 0) < 80
}

function statusColor(status: string): string {
  if (status === 'succeeded') return 'green'
  if (status === 'failed') return 'red'
  if (status === 'cancelled') return 'default'
  return 'blue'
}

export interface ShotRenderPanelProps {
  jobId: string
  productionShotId: string
}

export default function ShotRenderPanel({ jobId, productionShotId }: ShotRenderPanelProps) {
  const [task, setTask] = useState<RenderTaskView | null>(null)
  const [artifacts, setArtifacts] = useState<RenderArtifactView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // 默认预览档：低分辨率试跑，避免误触发高负载的成片渲染。
  const [profile, setProfile] = useState<RenderProfile>('preview')

  const mountedRef = useRef(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef = useRef(false)
  /** 请求代次：切换镜头后旧响应会被丢弃，不能覆盖当前状态。 */
  const generationRef = useRef(0)

  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  /** 拉取一次后端状态；返回是否已到终态。 */
  const loadOnce = useCallback(
    async (generation: number): Promise<boolean> => {
      if (inFlightRef.current) return false // 上一次仍在进行 → 不并发
      inFlightRef.current = true
      try {
        const [job, allArtifacts] = await Promise.all([
          fetchProductionJob(jobId),
          fetchProductionArtifacts(jobId),
        ])
        // 卸载、或已切换到别的镜头 → 丢弃这次响应
        if (!mountedRef.current || generation !== generationRef.current) return true
        const nextTask = job.render_task ?? null
        setTask(nextTask)
        setArtifacts(artifactsForShot(allArtifacts, productionShotId))
        setError(null)
        return !nextTask || nextTask.is_terminal
      } catch (err) {
        if (mountedRef.current && generation === generationRef.current) {
          setError((err as Error)?.message || '读取渲染状态失败')
        }
        return true // 出错即停止，避免不受控的紧密重试循环
      } finally {
        inFlightRef.current = false
        if (mountedRef.current && generation === generationRef.current) setLoading(false)
      }
    },
    [jobId, productionShotId],
  )

  const scheduleNext = useCallback(
    (generation: number) => {
      stopPolling()
      timerRef.current = setTimeout(async () => {
        const done = await loadOnce(generation)
        if (!done && mountedRef.current && generation === generationRef.current) {
          scheduleNext(generation)
        }
      }, RENDER_POLL_INTERVAL_MS)
    },
    [loadOnce, stopPolling],
  )

  // 初次加载 / 切换镜头：重置代次并从后端恢复状态
  useEffect(() => {
    mountedRef.current = true
    generationRef.current += 1
    const generation = generationRef.current
    setLoading(true)
    setTask(null)
    setArtifacts([])
    setError(null)
    stopPolling()

    void (async () => {
      const done = await loadOnce(generation)
      if (!done && mountedRef.current && generation === generationRef.current) {
        scheduleNext(generation)
      }
    })()

    return () => {
      mountedRef.current = false
      generationRef.current += 1 // 使在途响应失效
      stopPolling()
    }
  }, [jobId, productionShotId, loadOnce, scheduleNext, stopPolling])

  const handleGenerate = useCallback(async () => {
    setSubmitting(true)
    setError(null)
    try {
      const accepted = await startShotRender(jobId, productionShotId, profile)
      if (!mountedRef.current) return
      setTask(accepted)
      const generation = generationRef.current
      if (!accepted.is_terminal) scheduleNext(generation)
    } catch (err) {
      if (mountedRef.current) setError((err as Error)?.message || '发起渲染失败')
    } finally {
      if (mountedRef.current) setSubmitting(false)
    }
  }, [jobId, productionShotId, profile, scheduleNext])

  const active = !!task && !task.is_terminal
  const failed = task?.status === 'failed'

  if (loading) {
    return (
      <Card title="镜头渲染" data-testid="render-panel">
        <Spin data-testid="render-loading">
          <div style={{ minHeight: 80 }} />
        </Spin>
      </Card>
    )
  }

  return (
    <Card title="镜头渲染" data-testid="render-panel">
      {error && (
        <Alert
          className="mb-3"
          type="error"
          showIcon
          message="渲染状态不可用"
          description={error}
          data-testid="render-api-error"
        />
      )}

      <Space direction="vertical" className="mb-3" style={{ width: '100%' }}>
        <Radio.Group
          value={profile}
          onChange={(e) => setProfile(e.target.value as RenderProfile)}
          disabled={active}
          data-testid="render-profile"
        >
          <Radio.Button value="preview" data-testid="profile-preview">
            预览渲染 · 432×768
          </Radio.Button>
          <Radio.Button value="final" data-testid="profile-final">
            正式渲染 · 1080×1920（高负载）
          </Radio.Button>
        </Radio.Group>
        <Typography.Text type="secondary" data-testid="profile-hint">
          {profile === 'preview'
            ? '预览档：精确 9:16，像素量约为成片的 16%，适合核显试跑。'
            : '正式档：完整成片规格，耗时与显存占用显著更高。'}
        </Typography.Text>
      </Space>

      <Space className="mb-3">
        <Button
          type="primary"
          loading={submitting}
          disabled={active}
          onClick={() => void handleGenerate()}
          data-testid="generate-video"
        >
          生成视频
        </Button>
        {failed && (
          <Button onClick={() => void handleGenerate()} data-testid="retry-render">
            重新渲染
          </Button>
        )}
      </Space>

      {!task ? (
        <Empty description="尚未发起渲染" image={Empty.PRESENTED_IMAGE_SIMPLE} data-testid="render-empty" />
      ) : (
        <Descriptions column={1} size="small" data-testid="render-status">
          <Descriptions.Item label="状态">
            <Tag color={statusColor(task.status)} data-testid="render-status-tag">
              {task.status}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="阶段">
            <span data-testid="render-stage">{task.stage_message || '—'}</span>
          </Descriptions.Item>
          <Descriptions.Item label="进度">
            {typeof task.progress === 'number' ? (
              <Progress percent={task.progress} data-testid="render-progress-determinate" />
            ) : (
              <span data-testid="render-progress-indeterminate">处理中…</span>
            )}
          </Descriptions.Item>
          {isProviderProcessing(task) && (
            <Descriptions.Item label="供应商">
              <span data-testid="provider-processing">供应商处理中</span>
            </Descriptions.Item>
          )}
          <Descriptions.Item label="尝试">{task.attempt ?? '—'}</Descriptions.Item>
          {task.provider_task_id && (
            <Descriptions.Item label="供应商任务">
              <span data-testid="provider-job-id">{task.provider_task_id}</span>
            </Descriptions.Item>
          )}
          {failed && (
            <Descriptions.Item label="失败原因">
              <span data-testid="render-failure">{task.error_reason || '渲染失败'}</span>
            </Descriptions.Item>
          )}
        </Descriptions>
      )}

      <Typography.Title level={5} className="mt-3">
        产物
      </Typography.Title>
      {artifacts.length === 0 ? (
        <Empty description="暂无渲染产物" image={Empty.PRESENTED_IMAGE_SIMPLE} data-testid="artifacts-empty" />
      ) : (
        <ul className="m-0 pl-0" style={{ listStyle: 'none' }} data-testid="artifact-list">
          {artifacts.map((artifact) => (
            <li key={artifact.id} className="mb-3" data-testid="artifact-item">
              <div>
                尝试 {artifact.attempt ?? '—'} · {artifact.mime_type} ·{' '}
                <span data-testid="artifact-size">
                  {typeof artifact.size_bytes === 'number' ? `${artifact.size_bytes} B` : '大小未知'}
                </span>
              </div>
              {artifact.download_url ? (
                <video
                  controls
                  preload="metadata"
                  width={320}
                  src={artifact.download_url}
                  data-testid="artifact-video"
                >
                  <track kind="captions" />
                </video>
              ) : (
                <span data-testid="artifact-unplayable">该产物暂无可用播放地址</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
