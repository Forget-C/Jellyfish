import { useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Alert, Button, Empty, Pagination, Segmented, Tag } from 'antd'
import { OpenAPI, StudioDirectingService } from '../../../services/generated'
import type { MediaRead, WorkspaceRead } from '../../../services/generated'
import { ProductionDetailContext } from './ProductionWorkbench'
import { candidateName, revisionName, takeUsage } from './workspaceUsage'
import type { ActiveCutState } from './workspaceUsage'

type CandidateContext = { filter: 'all' | 'prompt'; layout: 'grid' | 'list'; page: number; selected?: string }
const initial: CandidateContext = { filter: 'all', layout: 'grid', page: 1 }
const readContext = (key: string): CandidateContext => {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || '{}')
    return { filter: value.filter === 'prompt' ? 'prompt' : 'all', layout: value.layout === 'list' ? 'list' : 'grid', page: Number.isInteger(value.page) && value.page > 0 ? value.page : 1, selected: typeof value.selected === 'string' ? value.selected : undefined }
  } catch { return initial }
}
const duration = (media?: MediaRead) => media?.duration_ms != null ? `${(media.duration_ms / 1000).toFixed(1)} 秒` : '实际时长未知'
const reviewLabel = (take: WorkspaceRead['takes'][number]) => take.annotation.review_status === 'unreviewed' ? '待审片' : ({ pass: '审片通过', retain: '局部保留', repair: '需要修复', discard: '已废弃' } as Record<string, string>)[take.annotation.verdict || ''] || '已有审片记录'

/** 单元范围候选只读浏览；只为当页读取媒体，切换不会修改执行指令或采用。 */
export function ShootCandidates({ workspace, planId, unitId, promptId, activeCut, onCut }: {
  workspace: WorkspaceRead; planId?: string; unitId?: string; promptId?: string; activeCut: ActiveCutState; onCut: (id: string) => void;
}) {
  const detail = useContext(ProductionDetailContext)
  const projectId = workspace.sequence.project_id, sequenceId = workspace.sequence.id
  const storageKey = `directing-candidates:${JSON.stringify([projectId, sequenceId, planId, unitId])}`
  const [context, setContext] = useState(() => readContext(storageKey))
  const [media, setMedia] = useState<Record<string, MediaRead>>()
  const [failed, setFailed] = useState<string[]>([])
  const [attempt, setAttempt] = useState(0)
  const [thumbnailErrors, setThumbnailErrors] = useState<string[]>([])
  const [playbackFailed, setPlaybackFailed] = useState(false)
  const takes = workspace.takes.filter(row => row.plan_revision_id === planId && row.unit_id === unitId)
  const seen = useRef(new Set(takes.map(row => row.id)))
  const added = takes.filter(row => !seen.current.has(row.id))
  const filtered = context.filter === 'all' ? takes : takes.filter(row => row.prompt_revision_id === promptId)
  const page = Math.min(context.page, Math.max(1, Math.ceil(filtered.length / 12)))
  const visible = filtered.slice((page - 1) * 12, page * 12)
  const selected = takes.find(row => row.id === context.selected)
  const ids = [...new Set([...visible.map(row => row.id), ...(selected ? [selected.id] : [])])].join(',')
  useEffect(() => { try { sessionStorage.setItem(storageKey, JSON.stringify(context)) } catch { /* 浏览存储不可用时仍可操作。 */ } }, [storageKey, context])
  useEffect(() => {
    let current = true
    setFailed([])
    void Promise.allSettled(ids.split(',').filter(Boolean).map(takeId => StudioDirectingService.directingTakeMedia({ projectId, sequenceId, takeId }))).then(results => {
      if (!current) return
      const next: Record<string, MediaRead> = {}, unavailable: string[] = []
      results.forEach((result, index) => {
        const id = ids.split(',')[index]
        if (result.status === 'fulfilled' && result.value.data?.take_id === id) next[id] = result.value.data
        else unavailable.push(id)
      })
      setMedia(next); setFailed(unavailable)
    })
    return () => { current = false }
  }, [projectId, sequenceId, ids, attempt])
  useEffect(() => { setPlaybackFailed(false) }, [selected?.id, attempt])
  const retry = () => { setThumbnailErrors([]); setAttempt(value => value + 1) }
  const source = selected ? media?.[selected.id] : undefined
  const preview = selected && detail.request?.tab === 'candidate' && detail.request.takeId === selected.id ? <section className="shoot-candidate-preview" aria-label="候选快速预览">
    <header className="shoot-detail-heading"><h2>{candidateName(workspace, selected.id)}</h2><Button type="text" aria-label="关闭候选预览" onClick={detail.close}>×</Button></header>
    {source ? <><video key={`${selected.id}:${attempt}`} controls preload="metadata" aria-label="候选预览播放器" src={OpenAPI.BASE + source.url} onError={() => setPlaybackFailed(true)} />{playbackFailed && <Alert type="warning" message="视频暂时无法播放，候选记录仍保留" action={<Button onClick={retry}>重试播放</Button>} />}</> : <p>{failed.includes(selected.id) ? '媒体读取失败' : '正在读取媒体'}</p>}
    {failed.includes(selected.id) && <Button onClick={retry}>重试读取媒体</Button>}
    <p>{duration(source)} · 来自{revisionName(workspace.prompts, selected.prompt_revision_id, '指令')}</p>
    <p><Tag>{reviewLabel(selected)}</Tag><Tag>{takeUsage(activeCut, selected.id)}</Tag></p>
    <p className="design-secondary">这里只预览。实际覆盖、可用区间与采用在剪辑验收中处理。</p>
    <Button type="primary" onClick={() => onCut(selected.id)}>进入剪辑验收</Button>
  </section> : null
  return <section className="shoot-candidates" aria-label="本单元候选素材">
    <header><h3>候选素材 <small>{takes.length}</small></h3><Segmented aria-label="候选范围" value={context.filter} options={[{ value: 'all', label: `全部候选 ${takes.length}` }, { value: 'prompt', label: '当前指令', disabled: !promptId }]} onChange={value => setContext({ ...context, filter: value as CandidateContext['filter'], page: 1 })} /><Segmented aria-label="候选展示方式" value={context.layout} options={[{ value: 'grid', label: '网格' }, { value: 'list', label: '列表' }]} onChange={value => setContext({ ...context, layout: value as CandidateContext['layout'] })} /></header>
    {!!added.length && <Button type="link" onClick={() => { const index = takes.findIndex(row => row.id === added[0].id); seen.current = new Set(takes.map(row => row.id)); setContext({ ...context, filter: 'all', page: Math.floor(index / 12) + 1, selected: added[0].id }) }}>查看新候选 · {added.length}</Button>}
    <div className={`shoot-candidate-items is-${context.layout}`}>{visible.map(take => {
      const info = media?.[take.id], broken = thumbnailErrors.includes(take.id)
      return <article className={context.selected === take.id ? 'is-selected' : ''} key={take.id}>
        <button type="button" aria-label={`预览${candidateName(workspace, take.id)}`} aria-pressed={context.selected === take.id} onClick={() => { setContext({ ...context, selected: take.id }); detail.show({ tab: 'candidate', takeId: take.id }) }}>
          <div className="shoot-candidate-thumbnail">{info?.thumbnail_url && !broken ? <img loading="lazy" src={`${OpenAPI.BASE + info.thumbnail_url}${attempt ? `?retry=${attempt}` : ''}`} alt={`${candidateName(workspace, take.id)}的真实视频首帧`} onError={() => setThumbnailErrors(value => [...value, take.id])} /> : <span>{broken ? '缩略图暂不可用 · 仍可预览' : failed.includes(take.id) ? '媒体暂不可用' : info ? '未提供缩略图 · 仍可预览' : '正在读取素材'}</span>}<small>{duration(info)}</small></div>
          <div className="shoot-candidate-info"><strong>{candidateName(workspace, take.id)}</strong><span>来自{revisionName(workspace.prompts, take.prompt_revision_id, '指令')}</span><span>{reviewLabel(take)}</span><span>{takeUsage(activeCut, take.id)}</span></div>
        </button>
        {(broken || failed.includes(take.id)) && <Button type="link" size="small" onClick={retry}>重试预览资源</Button>}
      </article>
    })}</div>
    {!filtered.length && <Empty description={takes.length ? '当前指令暂无候选，可切换全部候选查看历史产出' : '本单元还没有候选视频，试拍成功后将在此显示'} />}
    {filtered.length > 12 && <Pagination size="small" current={page} total={filtered.length} pageSize={12} showSizeChanger={false} onChange={next => setContext({ ...context, page: next })} />}
    {detail.target && preview && createPortal(preview, detail.target)}
  </section>
}
