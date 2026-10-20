import { WorkbenchDetails, useWorkbenchDetailsAvailable } from './ui/WorkbenchDetails'
import { WorkbenchReadingContext } from './ui/WorkbenchReadingContext'
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert, Button, Image, Modal, Spin, Typography } from 'antd'
import { StudioDirectingService } from '../../../services/generated'
import type { DirectingTaskRead, Source, SourceRead } from '../../../services/generated'
import { buildFileDownloadUrl } from '../assets/utils'
import { directingError } from './common'
import { createSourceResolver, sourceKey } from './sourceResolver'

const labels = { human: '人工填写', model: 'AI建议', chapter: '章节原文', file: '参考文件', revision: '历史版本' }
const SourceContext = createContext<{ resolve: (source: Source) => Promise<SourceRead>; task: (id: string) => Promise<DirectingTaskRead | undefined>; revision: (source: SourceRead) => ReactNode } | undefined>(undefined)
const InspectionContext = createContext<((source: Source) => void) | undefined>(undefined)

/** 缓存只属于当前项目/场次；各字段共用查询，不把来源回跳写入编辑基线。 */
export function SourceProvider({ projectId, sequenceId, children, renderRevision }: { projectId: string; sequenceId: string; children: ReactNode; renderRevision: (source: SourceRead) => ReactNode }) {
  const resolve = useMemo(() => createSourceResolver(async sources => {
    const response = await StudioDirectingService.directingResolveSources({ projectId, sequenceId, requestBody: { sources } })
    if (!Array.isArray(response.data)) throw new Error('来源查询未返回有效记录')
    return response.data
  }), [projectId, sequenceId])
  return <SourceContext.Provider value={{ resolve, task: async taskId => (await StudioDirectingService.directingTask({ projectId, taskId })).data ?? undefined, revision: renderRevision }}>{children}</SourceContext.Provider>
}

function useSource(source: Source) {
  const context = useContext(SourceContext)
  const [result, setResult] = useState<{ key: string; row?: SourceRead; error?: string }>()
  const [attempt, setAttempt] = useState(0)
  const key = sourceKey(source), resolve = context?.resolve
  useEffect(() => {
    let active = true
    setResult(previous => previous?.key === key ? { ...previous, error: undefined } : undefined)
    if (resolve) void resolve(source).then(row => { if (active) setResult({ key, row }) }, error => { if (active) setResult(previous => ({ key, row: previous?.key === key ? previous.row : undefined, error: directingError(error) })) })
    else setResult({ key, row: { source, status: source.kind === 'human' ? 'ready' : 'unavailable', label: labels[source.kind], description: source.kind === 'human' ? (source.reference === 'local-user' ? '由本机用户填写。' : '人工记录；未记录可核实的填写者和时间。') : '请进入此来源所属的场次工作区查看历史记录。原始来源身份仍可在技术详情中核对。' } })
    return () => { active = false }
  }, [key, resolve, attempt])
  return { ...(result?.key === key ? result : {}), retry: () => setAttempt(value => value + 1) }
}

/** 原字段保持挂载和滚动位置，来源详情占用同一检查区。 */
export function SourceInspector({ children, identity }: { children: ReactNode; identity?: string }) {
  const [source, setSource] = useState<Source>()
  const content = useRef<HTMLDivElement>(null)
  const scroll = useRef(0)
  const trigger = useRef<HTMLElement>()
  useEffect(() => { setSource(undefined) }, [identity])
  const close = () => { setSource(undefined); requestAnimationFrame(() => { if (content.current?.parentElement) content.current.parentElement.scrollTop = scroll.current; trigger.current?.focus({ preventScroll: true }) }) }
  return <InspectionContext.Provider value={next => { trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : undefined; scroll.current = content.current?.parentElement?.scrollTop || 0; setSource(next); if (content.current?.parentElement) content.current.parentElement.scrollTop = 0 }}>
    <div ref={content} hidden={!!source}>{children}</div>
    {source && <section className="source-inspection"><Button onClick={close}>返回字段</Button><h2>这条内容从哪里来</h2><SourceCard key={sourceKey(source)} source={source} /></section>}
  </InspectionContext.Provider>
}

function SourceLink({ source, index }: { source: Source; index: number }) {
  const open = useContext(InspectionContext)
  const { row } = useSource(source)
  const [expanded, setExpanded] = useState(false)
  return <div><Button type="link" size="small" aria-label={`查看来源 ${index + 1}：${row?.label || labels[source.kind]}`} onClick={() => open ? open(source) : setExpanded(value => !value)}>{row?.label || labels[source.kind]}</Button>{expanded && <SourceCard source={source} />}</div>
}

export function SourceLinks({ sources }: { sources: Source[] }) {
  return <div className="source-links" aria-label="内容来源">{sources.map((source, index) => <SourceLink key={`${sourceKey(source)}:${index}`} source={source} index={index} />)}</div>
}

function SourceCard({ source }: { source: Source }) {
  const withinReader = useContext(WorkbenchReadingContext)
  const workbench = useWorkbenchDetailsAvailable()
  const context = useContext(SourceContext)
  const { row, error, retry } = useSource(source)
  const [task, setTask] = useState<DirectingTaskRead>()
  const [taskError, setTaskError] = useState('')
  const [taskLoading, setTaskLoading] = useState(false)
  const [history, setHistory] = useState(false)
  const [mediaError, setMediaError] = useState(false)
  const [mediaAttempt, setMediaAttempt] = useState(0)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const showTask = async () => {
    if (!row?.task_id || !context) return
    setTaskLoading(true); setTaskError('')
    try { const next = await context.task(row.task_id); if (alive.current) { if (!next) throw new Error('生成记录暂不可用'); setTask(next) } }
    catch (cause) { if (alive.current) setTaskError(directingError(cause)) }
    finally { if (alive.current) setTaskLoading(false) }
  }
  const range = source.media_range
  const media = useRef<HTMLMediaElement | null>(null)
  return <div className="source-card">
    {error && <Alert type="error" message="来源读取失败" description={error} action={<Button aria-label="重试" onClick={retry}>重试</Button>} />}{!row ? !error && <Spin size="small" /> : <>
      <h3>{row.label}</h3><p>{row.description}</p>
      {row.model_name && <p>生成时模型：{row.model_name}</p>}
      {row.created_at && <p>生成记录时间：{row.created_at.replace('T', ' ')}</p>}
      {row.chapter_name && <p>章节：{row.chapter_name}</p>}
      {row.context_text && <details><summary>{source.kind === 'model' ? '查看生成时原文上下文' : '查看当时原文摘录'}</summary><blockquote>{row.context_text}</blockquote></details>}
      {row.file_id && <><p>{row.file_name}{range && ` · ${(range.source_in_ms / 1000).toFixed(3)}–${(range.source_out_ms / 1000).toFixed(3)} 秒`}</p>{row.media_kind === 'image' ? <Image preview={!withinReader} key={mediaAttempt} onError={() => setMediaError(true)} src={buildFileDownloadUrl(row.file_id)} alt={row.file_name || '来源图片'} /> : ['audio', 'video'].includes(row.media_kind || '') ? <>
        {row.media_kind === 'video' ? <video key={mediaAttempt} onError={() => setMediaError(true)} ref={node => { media.current = node }} controls preload="metadata" src={buildFileDownloadUrl(row.file_id)} onLoadedMetadata={() => { if (media.current && range) media.current.currentTime = range.source_in_ms / 1000 }} onTimeUpdate={() => { if (media.current && range && media.current.currentTime >= range.source_out_ms / 1000) media.current.pause() }} /> : <audio key={mediaAttempt} onError={() => setMediaError(true)} ref={node => { media.current = node }} controls preload="metadata" src={buildFileDownloadUrl(row.file_id)} onLoadedMetadata={() => { if (media.current && range) media.current.currentTime = range.source_in_ms / 1000 }} onTimeUpdate={() => { if (media.current && range && media.current.currentTime >= range.source_out_ms / 1000) media.current.pause() }} />}
        {range && <Button onClick={() => { if (media.current) { media.current.currentTime = range.source_in_ms / 1000; void media.current.play().catch(() => {}) } }}>播放记录区间</Button>}
      </> : <a href={buildFileDownloadUrl(row.file_id)} target="_blank" rel="noreferrer">查看来源文件</a>}</>}
      {mediaError && <Alert type="warning" message="来源媒体暂时无法读取，可能已删除或无法访问" action={<Button onClick={() => { setMediaError(false); setMediaAttempt(value => value + 1) }}>重试预览</Button>} />}
      {row.task_id && <Button loading={taskLoading} onClick={() => { void showTask() }}>查看生成记录</Button>}
      {taskError && <Alert type="error" message={taskError} />}
      {task && <section aria-label="来源生成记录"><p>状态：{({ queued: '排队中', running: '运行中', succeeded: '已完成', failed: '失败', cancelled: '已取消' } as Record<string, string>)[task.status] || task.status}</p>{task.error && <p>{task.error}</p>}<p>此记录仅供追溯，当前编辑内容保持不变。</p></section>}
      {row.revision_id && <Button onClick={() => setHistory(value => !value)}>{history ? '收起历史版本' : '查看只读历史'}</Button>}
      {history && (withinReader ? <section aria-label="来源版本 · 只读"><Button onClick={() => setHistory(false)}>返回来源</Button>{context?.revision(row)}</section> : workbench ? <WorkbenchDetails open title="来源版本 · 只读" status="只读" onClose={() => setHistory(false)}>{context?.revision(row)}</WorkbenchDetails> : <Modal open title="来源版本 · 只读" width={1200} footer={null} onCancel={() => setHistory(false)}>{context?.revision(row)}</Modal>)}
    </>}
    <details className="source-technical"><summary>技术详情</summary><p>来源类型：{source.kind}</p><p>来源标识：<Typography.Text copyable>{source.reference}</Typography.Text></p><p>版本：<Typography.Text copyable>{source.version}</Typography.Text></p>{source.file_id && <p>文件标识：<Typography.Text copyable>{source.file_id}</Typography.Text></p>}</details>
  </div>
}
