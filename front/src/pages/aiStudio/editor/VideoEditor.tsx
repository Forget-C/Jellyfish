import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Empty, Layout, Slider, Space, Spin, Switch, Tag, Typography, message } from 'antd'
import {
  ArrowLeftOutlined,
  CaretRightOutlined,
  ExportOutlined,
  PauseOutlined,
  SaveOutlined,
  StepBackwardOutlined,
  StepForwardOutlined,
} from '@ant-design/icons'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ApiError } from '../../../services/generated'
import { StudioChaptersService } from '../../../services/generated'
import type { ChapterTimelineRead } from '../../../services/generated/models/ChapterTimelineRead'
import type { ChapterTimelineSegmentRead } from '../../../services/generated/models/ChapterTimelineSegmentRead'
import { buildFileDownloadUrl } from '../assets/utils'
import { getProjectChaptersPath } from '../project/ProjectWorkbench/routes'

const { Content } = Layout
const { Text, Title } = Typography

const DEFAULT_ZOOM_PX_PER_SEC = 100
const MIN_CLIP_MS = 100
const HANDLE_WIDTH = 18
const EDITOR_MIN_HEIGHT = 1080

type TrimDragState = {
  index: number
  edge: 'start' | 'end'
  startClientX: number
  sourceDurationMs: number
  initialStartMs: number
  initialEndMs: number
}

type TimelineClipModel = {
  seg: ChapterTimelineSegmentRead
  idx: number
  sourceDurationMs: number
  effectiveStartMs: number
  effectiveEndMs: number
  effectiveDurationMs: number
  offsetMs: number
}

function clipStatusTag(status: string | undefined) {
  const v = status ?? ''
  if (v === 'ready') return <Tag color="success">ready</Tag>
  if (v === 'missing_video') return <Tag color="warning">missing_video</Tag>
  if (v === 'file_missing') return <Tag color="error">file_missing</Tag>
  return <Tag>{v || 'unknown'}</Tag>
}

/** 与后端一致：左闭右开 [start, end)；缺省出点表示直到片尾。 */
function playbackWindowMs(seg: ChapterTimelineSegmentRead, sourceDurationMs: number): { startMs: number; endMs: number } {
  const safeDuration = Math.max(sourceDurationMs, MIN_CLIP_MS)
  const startMs = Math.max(0, seg.trim_start_ms ?? 0)
  const endRaw = seg.trim_end_ms ?? safeDuration
  const endMs = Math.max(startMs + MIN_CLIP_MS, Math.min(endRaw, safeDuration))
  return { startMs, endMs }
}

function formatMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function buildTimelineModels(
  segments: ChapterTimelineSegmentRead[],
  durationMsByShot: Record<string, number>,
): TimelineClipModel[] {
  let offsetMs = 0
  return segments.map((seg, idx) => {
    const sourceDurationMs = Math.max(durationMsByShot[seg.shot_id] ?? 5000, MIN_CLIP_MS)
    const window = playbackWindowMs(seg, sourceDurationMs)
    const model: TimelineClipModel = {
      seg,
      idx,
      sourceDurationMs,
      effectiveStartMs: window.startMs,
      effectiveEndMs: window.endMs,
      effectiveDurationMs: Math.max(window.endMs - window.startMs, MIN_CLIP_MS),
      offsetMs,
    }
    offsetMs += model.effectiveDurationMs
    return model
  })
}

/** 单文件实现剪映式章节剪辑器：上方预览区 + 下方时间线轨道。 */
const VideoEditor: React.FC = () => {
  const { projectId, chapterId } = useParams<{ projectId: string; chapterId?: string }>()
  const [timeline, setTimeline] = useState<ChapterTimelineRead | null>(null)
  const [segments, setSegments] = useState<ChapterTimelineSegmentRead[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [losslessOnly, setLosslessOnly] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const [autoChainPlay, setAutoChainPlay] = useState(true)
  const [playing, setPlaying] = useState(false)
  const [zoomPxPerSec, setZoomPxPerSec] = useState(DEFAULT_ZOOM_PX_PER_SEC)
  const [durationMsByShot, setDurationMsByShot] = useState<Record<string, number>>({})
  const [previewTimelineMs, setPreviewTimelineMs] = useState(0)
  const [trimDrag, setTrimDrag] = useState<TrimDragState | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const activeIdxRef = useRef(0)
  const draggingIndexRef = useRef<number | null>(null)
  const probingShotsRef = useRef<Set<string>>(new Set())
  const shouldAutoResumeRef = useRef(false)
  const timelineViewportRef = useRef<HTMLDivElement | null>(null)

  activeIdxRef.current = activeIdx

  const load = useCallback(async () => {
    if (!chapterId) return
    setLoading(true)
    try {
      const res = await StudioChaptersService.getChapterTimelineApiV1StudioChaptersChapterIdTimelineGet({ chapterId })
      const data = res.data
      setTimeline(data ?? null)
      setSegments([...(data?.segments ?? [])])
      setActiveIdx(0)
    } catch {
      message.error('加载章节时间线失败')
    } finally {
      setLoading(false)
    }
  }, [chapterId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (activeIdx >= segments.length && segments.length > 0) setActiveIdx(segments.length - 1)
    if (segments.length === 0) setActiveIdx(0)
  }, [segments, activeIdx])

  if (!projectId) return <Navigate to="/projects" replace />
  if (!chapterId) return <Navigate to={getProjectChaptersPath(projectId)} replace />

  const patchSegment = useCallback(
    (shotId: string, patch: Partial<Pick<ChapterTimelineSegmentRead, 'trim_start_ms' | 'trim_end_ms'>>) => {
      setSegments((prev) => prev.map((s) => (s.shot_id === shotId ? { ...s, ...patch } : s)))
    },
    [],
  )

  const timelineModels = useMemo(() => buildTimelineModels(segments, durationMsByShot), [durationMsByShot, segments])
  const activeClip = timelineModels[activeIdx]
  const totalTimelineMs = timelineModels.length
    ? timelineModels[timelineModels.length - 1]!.offsetMs + timelineModels[timelineModels.length - 1]!.effectiveDurationMs
    : 0
  const pxPerMs = zoomPxPerSec / 1000
  const playheadPx = previewTimelineMs * pxPerMs
  const activeVideoUrl =
    activeClip?.seg.clip_status === 'ready' && activeClip.seg.file_id ? buildFileDownloadUrl(activeClip.seg.file_id) : undefined

  const findNextReadyIndex = useCallback(
    (from: number): number => {
      for (let i = from + 1; i < segments.length; i += 1) {
        if (segments[i]?.clip_status === 'ready') return i
      }
      return -1
    },
    [segments],
  )

  const reorderSegments = useCallback(
    (from: number, to: number) => {
      if (from === to || from < 0 || to < 0 || from >= segments.length || to >= segments.length) return
      const next = [...segments]
      const [item] = next.splice(from, 1)
      if (!item) return
      next.splice(to, 0, item)
      setSegments(next)
      if (activeIdx === from) setActiveIdx(to)
      else if (from < activeIdx && to >= activeIdx) setActiveIdx((v) => v - 1)
      else if (from > activeIdx && to <= activeIdx) setActiveIdx((v) => v + 1)
    },
    [activeIdx, segments],
  )

  useEffect(() => {
    const toProbe = segments.filter(
      (seg) =>
        seg.clip_status === 'ready' &&
        seg.file_id &&
        durationMsByShot[seg.shot_id] == null &&
        !probingShotsRef.current.has(seg.shot_id),
    )
    if (!toProbe.length) return
    toProbe.forEach((seg) => {
      if (!seg.file_id) return
      const url = buildFileDownloadUrl(seg.file_id)
      if (!url) return
      probingShotsRef.current.add(seg.shot_id)
      const v = document.createElement('video')
      v.preload = 'metadata'
      v.onloadedmetadata = () => {
        const durMs = Math.max(MIN_CLIP_MS, Math.round(v.duration * 1000))
        setDurationMsByShot((prev) => ({ ...prev, [seg.shot_id]: durMs }))
        probingShotsRef.current.delete(seg.shot_id)
      }
      v.onerror = () => {
        probingShotsRef.current.delete(seg.shot_id)
      }
      v.src = url
    })
  }, [durationMsByShot, segments])

  useEffect(() => {
    if (!trimDrag) return
    const handleMove = (event: MouseEvent) => {
      const deltaMs = Math.round(((event.clientX - trimDrag.startClientX) / pxPerMs) / 100) * 100
      const current = timelineModels[trimDrag.index]
      if (!current) return
      if (trimDrag.edge === 'start') {
        const nextStart = Math.max(0, Math.min(trimDrag.initialStartMs + deltaMs, trimDrag.initialEndMs - MIN_CLIP_MS))
        patchSegment(current.seg.shot_id, {
          trim_start_ms: nextStart <= 0 ? undefined : nextStart,
        })
        return
      }
      const nextEnd = Math.max(
        trimDrag.initialStartMs + MIN_CLIP_MS,
        Math.min(trimDrag.initialEndMs + deltaMs, trimDrag.sourceDurationMs),
      )
      patchSegment(current.seg.shot_id, {
        trim_end_ms: nextEnd >= trimDrag.sourceDurationMs - 2 ? undefined : nextEnd,
      })
    }
    const handleUp = () => setTrimDrag(null)
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [patchSegment, pxPerMs, timelineModels, trimDrag])

  useEffect(() => {
    if (!activeClip) {
      setPreviewTimelineMs(0)
      return
    }
    setPreviewTimelineMs(activeClip.offsetMs)
    const viewport = timelineViewportRef.current
    if (!viewport) return
    const clipLeft = activeClip.offsetMs * pxPerMs
    const clipRight = clipLeft + activeClip.effectiveDurationMs * pxPerMs
    const viewLeft = viewport.scrollLeft
    const viewRight = viewLeft + viewport.clientWidth
    if (clipLeft < viewLeft || clipRight > viewRight) {
      viewport.scrollTo({
        left: Math.max(0, clipLeft - viewport.clientWidth * 0.25),
        behavior: 'smooth',
      })
    }
  }, [activeClip, pxPerMs])

  const save = async () => {
    setSaving(true)
    try {
      const res = await StudioChaptersService.putChapterTimelineApiV1StudioChaptersChapterIdTimelinePut({
        chapterId,
        requestBody: {
          layout_version: timeline?.layout_version ?? undefined,
          segments: segments.map((s) => ({
            shot_id: s.shot_id,
            trim_start_ms: s.trim_start_ms ?? undefined,
            trim_end_ms: s.trim_end_ms ?? undefined,
          })),
        },
      })
      const data = res.data
      setTimeline(data ?? null)
      setSegments([...(data?.segments ?? [])])
      message.success('已保存时间线')
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        message.warning('版本冲突，请刷新后重试')
        await load()
      } else {
        message.error(err instanceof Error ? err.message : '保存失败')
      }
    } finally {
      setSaving(false)
    }
  }

  const exportMaster = async () => {
    setExporting(true)
    try {
      const res = await StudioChaptersService.postChapterTimelineExportApiV1StudioChaptersChapterIdTimelineExportPost({
        chapterId,
        requestBody: {
          encode_mode: losslessOnly ? 'lossless_concat_only' : 'uniform_transcode',
        },
      })
      const tid = res.data?.task_id
      message.success(tid ? `已创建导出任务：${tid}` : '已创建导出任务')
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 400) {
          const body = err.body as { message?: string; detail?: string } | undefined
          message.error(body?.message ?? body?.detail ?? '导出条件不满足')
          return
        }
        if (err.status === 409) {
          message.warning('已有导出任务进行中')
          return
        }
      }
      message.error('导出请求失败')
    } finally {
      setExporting(false)
    }
  }

  const jumpToClipStart = () => {
    const v = videoRef.current
    if (!v || !activeClip) return
    v.currentTime = activeClip.effectiveStartMs / 1000
    setPreviewTimelineMs(activeClip.offsetMs)
  }

  const handleLoadedMetadata = () => {
    const v = videoRef.current
    if (!v || !activeClip) return
    const durMs = Math.max(MIN_CLIP_MS, Math.round(v.duration * 1000))
    setDurationMsByShot((prev) => ({ ...prev, [activeClip.seg.shot_id]: durMs }))
    v.currentTime = activeClip.effectiveStartMs / 1000
    setPreviewTimelineMs(activeClip.offsetMs)
    if (shouldAutoResumeRef.current || playing) {
      shouldAutoResumeRef.current = false
      void v.play().catch(() => {
        setPlaying(false)
        message.warning('自动播放失败，请手动点击播放')
      })
    }
  }

  const handleTimeUpdate = () => {
    const v = videoRef.current
    const current = timelineModels[activeIdxRef.current]
    if (!v || !current || current.seg.clip_status !== 'ready') return
    const elapsedWithinClipMs = Math.max(0, Math.round(v.currentTime * 1000) - current.effectiveStartMs)
    setPreviewTimelineMs(current.offsetMs + Math.min(elapsedWithinClipMs, current.effectiveDurationMs))
    if (v.currentTime * 1000 < current.effectiveEndMs - 40) return
    v.pause()
    if (autoChainPlay) {
      const nextReady = findNextReadyIndex(activeIdxRef.current)
      if (nextReady >= 0) {
        shouldAutoResumeRef.current = true
        setActiveIdx(nextReady)
        return
      }
    }
    setPlaying(false)
  }

  const handleEnded = () => {
    if (autoChainPlay) {
      const nextReady = findNextReadyIndex(activeIdxRef.current)
      if (nextReady >= 0) {
        shouldAutoResumeRef.current = true
        setActiveIdx(nextReady)
        return
      }
    }
    setPlaying(false)
  }

  const startPlay = () => {
    if (!timelineModels.some((clip) => clip.seg.clip_status === 'ready')) {
      message.warning('没有可预览的片段')
      return
    }
    if (!activeClip || activeClip.seg.clip_status !== 'ready') {
      const firstReady = timelineModels.find((clip) => clip.seg.clip_status === 'ready')
      if (!firstReady) return
      shouldAutoResumeRef.current = true
      setActiveIdx(firstReady.idx)
      return
    }
    setPlaying(true)
    void videoRef.current?.play().catch(() => {
      setPlaying(false)
      message.warning('播放失败，请手动点击播放器')
    })
  }

  const stopPlay = () => {
    setPlaying(false)
    videoRef.current?.pause()
  }

  const rulerMarks = useMemo(() => {
    const marks: number[] = []
    for (let ms = 0; ms <= totalTimelineMs; ms += 1000) marks.push(ms)
    if (marks[marks.length - 1] !== totalTimelineMs) marks.push(totalTimelineMs)
    return marks
  }, [totalTimelineMs])

  return (
    <div className="h-full min-h-0 overflow-y-auto overflow-x-hidden rounded-xl bg-[#0f1115] text-white shadow-sm">
      <div className="min-h-full flex min-w-0 flex-col" style={{ minHeight: EDITOR_MIN_HEIGHT }}>
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <Link
              to={getProjectChaptersPath(projectId)}
              className="inline-flex items-center gap-1 text-xs text-slate-300 hover:text-white"
            >
              <ArrowLeftOutlined /> 返回章节列表
            </Link>
            <Title level={5} className="!mb-0 !mt-2 !text-white">
              章节剪辑时间线
            </Title>
          </div>
          <Space wrap>
            <Checkbox checked={losslessOnly} onChange={(e) => setLosslessOnly(e.target.checked)} className="text-slate-300">
              <span className="text-slate-300">无损拼接（不支持裁剪）</span>
            </Checkbox>
            <Button icon={<SaveOutlined />} loading={saving} onClick={() => void save()}>
              保存顺序与裁剪
            </Button>
            <Button type="primary" icon={<ExportOutlined />} loading={exporting} onClick={() => void exportMaster()}>
              导出成片
            </Button>
          </Space>
        </div>

        {timeline?.preview_note ? (
          <Alert
            type="info"
            showIcon
            className="m-3 mb-0"
            message={timeline.preview_note}
          />
        ) : null}

        <Spin spinning={loading} className="flex-1 min-h-0">
          <Layout className="min-h-full bg-transparent">
            <Content className="min-h-full p-3 flex flex-col gap-3 overflow-visible">
              <div className="grid min-h-[420px] flex-[0_0_420px] grid-cols-1 gap-3 lg:grid-cols-[220px_minmax(0,1fr)_240px] xl:grid-cols-[240px_minmax(0,1fr)_280px]">
                <section className="min-h-0 rounded-xl border border-white/10 bg-[#151922] overflow-hidden">
                  <div className="border-b border-white/10 px-3 py-2 text-sm font-medium text-slate-200">片段列表</div>
                  <div className="h-full max-h-full overflow-auto p-2 space-y-2">
                    {timelineModels.length === 0 ? (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span className="text-slate-400">暂无片段</span>} />
                    ) : (
                      timelineModels.map((clip) => (
                        <button
                          key={`left-${clip.seg.shot_id}-${clip.idx}`}
                          type="button"
                          className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                            clip.idx === activeIdx
                              ? 'border-cyan-400 bg-cyan-500/15'
                              : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10'
                          }`}
                          onClick={() => setActiveIdx(clip.idx)}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <Text className="!text-white" strong>
                              #{clip.idx + 1} {clip.seg.label || clip.seg.shot_id}
                            </Text>
                            {clipStatusTag(clip.seg.clip_status)}
                          </div>
                          <div className="mt-2 text-xs text-slate-400">
                            有效时长 {formatMs(clip.effectiveDurationMs)} / 源时长 {formatMs(clip.sourceDurationMs)}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </section>

                <section className="min-h-0 rounded-xl border border-white/10 bg-[#151922] overflow-hidden flex flex-col">
                  <div className="border-b border-white/10 px-3 py-2 text-sm font-medium text-slate-200">预览播放器</div>
                  <div className="flex-1 min-h-0 p-3 flex flex-col">
                    <div className="flex-1 min-h-0 rounded-xl bg-black overflow-hidden flex items-center justify-center">
                      {activeVideoUrl ? (
                        <video
                          ref={videoRef}
                          key={`${activeIdx}-${activeClip?.seg.shot_id ?? ''}`}
                          className="h-full w-full object-contain"
                          src={activeVideoUrl}
                          controls
                          playsInline
                          preload="metadata"
                          onLoadedMetadata={handleLoadedMetadata}
                          onTimeUpdate={handleTimeUpdate}
                          onEnded={handleEnded}
                        >
                          您的浏览器不支持视频播放
                        </video>
                      ) : (
                        <Text type="secondary">当前片段没有可预览视频</Text>
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button size="small" icon={<StepBackwardOutlined />} disabled={activeIdx <= 0} onClick={() => setActiveIdx((v) => Math.max(0, v - 1))}>
                        上一段
                      </Button>
                      <Button size="small" icon={<StepForwardOutlined />} disabled={activeIdx >= Math.max(segments.length - 1, 0)} onClick={() => setActiveIdx((v) => Math.min(Math.max(segments.length - 1, 0), v + 1))}>
                        下一段
                      </Button>
                      <Button size="small" type={playing ? 'primary' : 'default'} icon={<CaretRightOutlined />} onClick={startPlay}>
                        播放
                      </Button>
                      <Button size="small" icon={<PauseOutlined />} onClick={stopPlay}>
                        暂停
                      </Button>
                      <Button size="small" onClick={jumpToClipStart}>
                        跳到入点
                      </Button>
                      <Space size={4}>
                        <Switch size="small" checked={autoChainPlay} onChange={setAutoChainPlay} />
                        <Text className="!text-slate-400 text-xs">自动衔接下一段</Text>
                      </Space>
                    </div>
                  </div>
                </section>

                <section className="min-h-0 rounded-xl border border-white/10 bg-[#151922] overflow-hidden">
                  <div className="border-b border-white/10 px-3 py-2 text-sm font-medium text-slate-200">草稿参数</div>
                  <div className="space-y-4 p-3 text-sm">
                    <div>
                      <Text className="!text-slate-400 text-xs">当前片段</Text>
                      <div className="mt-1 text-white">{activeClip?.seg.label || activeClip?.seg.shot_id || '未选择'}</div>
                    </div>
                    <div>
                      <Text className="!text-slate-400 text-xs">片段状态</Text>
                      <div className="mt-1">{clipStatusTag(activeClip?.seg.clip_status)}</div>
                    </div>
                    <div>
                      <Text className="!text-slate-400 text-xs">裁剪区间</Text>
                      <div className="mt-1 text-white">
                        {activeClip ? `${formatMs(activeClip.effectiveStartMs)} - ${formatMs(activeClip.effectiveEndMs)}` : '—'}
                      </div>
                    </div>
                    <div>
                      <Text className="!text-slate-400 text-xs">当前章节总时长</Text>
                      <div className="mt-1 text-white">{formatMs(totalTimelineMs)}</div>
                    </div>
                    <div>
                      <Text className="!text-slate-400 text-xs">时间线缩放</Text>
                      <div className="mt-3">
                        <Slider
                          min={40}
                          max={220}
                          step={10}
                          value={zoomPxPerSec}
                          onChange={(v) => setZoomPxPerSec(Number(v))}
                        />
                      </div>
                    </div>
                  </div>
                </section>
              </div>

              <section className="min-h-[460px] flex-[1_0_460px] rounded-xl border border-white/10 bg-[#151922] overflow-hidden flex flex-col">
                <div className="flex items-center justify-between gap-3 border-b border-white/10 px-3 py-2">
                  <div>
                    <div className="text-sm font-medium text-slate-200">时间线编辑区</div>
                    <div className="text-xs text-slate-400">拖动片段左上角“⋮⋮”重排；拖动左右亮色边缘裁剪单个片段。支持横向滚动与滚轮滚动。</div>
                  </div>
                  <Text className="!text-slate-400 text-xs">layout_version={timeline?.layout_version ?? '—'}</Text>
                </div>

                <div className="flex-1 min-h-0 overflow-hidden">
                  <div ref={timelineViewportRef} className="h-full overflow-auto px-3 pb-3">
                    <div style={{ width: Math.max(totalTimelineMs * pxPerMs + 160, 960) }} className="relative min-h-full">
                      <div className="sticky top-0 z-10 h-9 border-b border-white/10 bg-[#151922]/95 backdrop-blur">
                        {rulerMarks.map((ms) => (
                          <div
                            key={`tick-${ms}`}
                            className="absolute top-0 bottom-0 border-l border-white/10"
                            style={{ left: ms * pxPerMs }}
                          >
                            <span className="absolute left-1 top-1 text-[10px] text-slate-400">{formatMs(ms)}</span>
                          </div>
                        ))}
                      </div>

                      <div className="relative mt-4 h-32 rounded-xl border border-white/10 bg-[#0f1115]">
                        <div
                          className="pointer-events-none absolute top-0 bottom-0 z-20 w-0.5 bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.65)]"
                          style={{ left: playheadPx }}
                        />
                        <div className="flex h-full items-center px-4">
                          {timelineModels.map((clip) => {
                            const width = Math.max(clip.effectiveDurationMs * pxPerMs, 90)
                            const ready = clip.seg.clip_status === 'ready'
                            return (
                              <div
                                key={`clip-${clip.seg.shot_id}-${clip.idx}`}
                                onDragOver={(event) => {
                                  event.preventDefault()
                                }}
                                onDrop={() => {
                                  const from = draggingIndexRef.current
                                  if (from == null) return
                                  reorderSegments(from, clip.idx)
                                  draggingIndexRef.current = null
                                }}
                                className={`group relative mr-3 h-20 shrink-0 overflow-hidden rounded-lg border transition ${
                                  clip.idx === activeIdx
                                    ? 'border-cyan-400 shadow-[0_0_0_1px_rgba(34,211,238,0.45)]'
                                    : 'border-white/10'
                                } ${
                                  ready ? 'bg-gradient-to-b from-cyan-600/75 to-cyan-900/80' : 'bg-gradient-to-b from-rose-700/75 to-rose-950/90'
                                }`}
                                style={{ width }}
                                onClick={() => setActiveIdx(clip.idx)}
                              >
                                <div className="absolute inset-x-0 top-0 h-5 border-b border-white/10 bg-black/15" />
                                <div className="absolute inset-0 opacity-20">
                                  {Array.from({ length: Math.max(4, Math.floor(width / 28)) }).map((_, stripeIdx) => (
                                    <div
                                      key={`stripe-${clip.idx}-${stripeIdx}`}
                                      className="absolute top-0 bottom-0 border-r border-white/20"
                                      style={{ left: stripeIdx * 28 }}
                                    />
                                  ))}
                                </div>
                                {ready ? (
                                  <>
                                    <div
                                      draggable
                                      onDragStart={(event) => {
                                        event.stopPropagation()
                                        draggingIndexRef.current = clip.idx
                                      }}
                                      onDragEnd={() => {
                                        draggingIndexRef.current = null
                                      }}
                                      className="absolute left-1 top-1 z-30 flex h-5 w-8 cursor-grab select-none items-center justify-center rounded bg-black/35 text-[12px] text-white/90 hover:bg-black/45 active:cursor-grabbing"
                                      title="拖动重排片段"
                                    >
                                      ⋮⋮
                                    </div>
                                    <button
                                      type="button"
                                      aria-label="裁剪片段开始位置"
                                      className="absolute left-0 top-0 bottom-0 z-20 cursor-ew-resize border-r border-white/40 bg-white/20 hover:bg-white/35"
                                      style={{ width: HANDLE_WIDTH }}
                                      onMouseDown={(event) => {
                                        event.preventDefault()
                                        event.stopPropagation()
                                        setTrimDrag({
                                          index: clip.idx,
                                          edge: 'start',
                                          startClientX: event.clientX,
                                          sourceDurationMs: clip.sourceDurationMs,
                                          initialStartMs: clip.effectiveStartMs,
                                          initialEndMs: clip.effectiveEndMs,
                                        })
                                      }}
                                    />
                                    <button
                                      type="button"
                                      aria-label="裁剪片段结束位置"
                                      className="absolute right-0 top-0 bottom-0 z-20 cursor-ew-resize border-l border-white/40 bg-white/20 hover:bg-white/35"
                                      style={{ width: HANDLE_WIDTH }}
                                      onMouseDown={(event) => {
                                        event.preventDefault()
                                        event.stopPropagation()
                                        setTrimDrag({
                                          index: clip.idx,
                                          edge: 'end',
                                          startClientX: event.clientX,
                                          sourceDurationMs: clip.sourceDurationMs,
                                          initialStartMs: clip.effectiveStartMs,
                                          initialEndMs: clip.effectiveEndMs,
                                        })
                                      }}
                                    />
                                  </>
                                ) : null}
                                <div className="relative z-10 flex h-full flex-col justify-between p-3">
                                  <div className="flex items-center justify-between gap-2">
                                    <Text className="!text-white text-xs" strong>
                                      #{clip.idx + 1}
                                    </Text>
                                    {clipStatusTag(clip.seg.clip_status)}
                                  </div>
                                  <div>
                                    <div className="truncate text-sm font-medium text-white">{clip.seg.label || clip.seg.shot_id}</div>
                                    <div className="mt-1 text-[11px] text-white/80">
                                      {formatMs(clip.effectiveDurationMs)} / {formatMs(clip.sourceDurationMs)}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>

                      <div className="mt-3 rounded-lg border border-white/10 bg-[#10141c] p-3">
                        {activeClip ? (
                          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300">
                            <span>当前片段：{activeClip.seg.label || activeClip.seg.shot_id}</span>
                            <span>开始：{activeClip.effectiveStartMs}ms</span>
                            <span>结束：{activeClip.effectiveEndMs}ms</span>
                            <span>有效时长：{activeClip.effectiveDurationMs}ms</span>
                            <span>操作：拖左上角“⋮⋮”重排，拖左右边缘裁剪</span>
                            <Button
                              size="small"
                              onClick={() =>
                                patchSegment(activeClip.seg.shot_id, {
                                  trim_start_ms: undefined,
                                  trim_end_ms: undefined,
                                })
                              }
                            >
                              清除当前裁剪
                            </Button>
                          </div>
                        ) : (
                          <Text className="!text-slate-400 text-xs">请选择片段</Text>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            </Content>
          </Layout>
        </Spin>
      </div>
    </div>
  )
}

export default VideoEditor
