import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Alert, Button, Card, Input, Radio, Select, Space, Spin } from 'antd'
import { StudioDirectingService, type ChapterSequences, type DirectingTaskRead, type SequenceRead, type SourceSpan } from '../../../services/generated'
import { directingError, excerptMatches } from './common'
import { DirectingTasks } from './DirectingTasks'
import { ChapterSourceSelection, type SourceMark } from './ChapterSourceSelection'
import { rangeConflicts, sameSpan, sourceSlice } from './sourceSelection'
import { useWorkspaceDraft, WorkspaceWriteBoundary } from './WorkspaceDrafts'

type RangeDraft = { chapter: ChapterSequences; sequence?: SequenceRead; title: string; span?: SourceSpan; candidate?: string }

/** 手动划场、范围调整与 AI 建议共用完整原文；保存仅确认当前一场。 */
export function ChapterSourcePanel({ projectId, chapterId, onChanged, onEdit, refreshKey, sequenceId }: {
  projectId: string; chapterId: string; onChanged: (sequenceId: string) => void; onEdit: () => void; refreshKey: number; sequenceId?: string
}) {
  const [chapter, setChapter] = useState<ChapterSequences>()
  const [draft, setDraft] = useState<RangeDraft>()
  const [selectionEpoch, setSelectionEpoch] = useState(0)
  const [activeId, setActiveId] = useState(sequenceId)
  const [mode, setMode] = useState('manual')
  const [mobileView, setMobileView] = useState('source')
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<DirectingTaskRead>()
  const [tasks, setTasks] = useState<DirectingTaskRead[]>([])
  const [activities, setActivities] = useState(false)
  const [confirmed, setConfirmed] = useState<string[]>([])
  const identity = useRef('')
  const initial = useRef(false)
  const reload = useCallback(async () => {
    const key = `${projectId}:${chapterId}`
    try {
      const response = await StudioDirectingService.directingChapter({ projectId, chapterId })
      if (!response.data) throw new Error('章节原文读取失败')
      if (identity.current === key) { setChapter(response.data); setLoadError('') }
      return response.data
    } catch (cause) { if (identity.current === key) setLoadError(directingError(cause)); return undefined }
  }, [projectId, chapterId])
  useEffect(() => { identity.current = `${projectId}:${chapterId}`; void reload(); return () => { identity.current = '' } }, [reload, refreshKey, projectId, chapterId])
  useEffect(() => {
    if (chapter && !initial.current) {
      initial.current = true
      const row = chapter.sequences.find(item => item.id === sequenceId)
      if (row) setDraft({ chapter, sequence: row, title: row.title, span: row.source_changed ? undefined : row.span || undefined })
      else if (sequenceId) setError('场次不存在或不属于当前章节')
    }
  }, [chapter, sequenceId])
  const dirty = !!draft && (draft.sequence
    ? draft.title !== draft.sequence.title || !sameSpan(draft.span, draft.sequence.source_changed ? undefined : draft.sequence.span)
    : !!(draft.title || draft.span))
  const save = async () => {
    if (!draft || !chapter || busy) return false
    setBusy(true); setError('')
    try {
      if (draft.chapter.source_version !== chapter.source_version) throw new Error('原文已变化，请重新载入并框选范围')
      if (!draft.title.trim()) throw new Error('请输入场次标题')
      if (!draft.span || !sourceSlice(draft.chapter.raw_text, draft.span).trim()) throw new Error('请先在原文中选择连续范围')
      const unchanged = draft.sequence && !draft.sequence.source_changed && sameSpan(draft.span, draft.sequence.span)
      const conflicts = rangeConflicts(chapter.sequences, draft.span, draft.sequence?.id)
      if (!unchanged && conflicts.length) throw new Error(`原文范围与场次「${conflicts.map(row => row.title).join('、')}」重叠，请调整范围`)
      const body = { title: draft.title.trim(), position: draft.sequence?.position ?? Math.max(-1, ...chapter.sequences.map(row => row.position)) + 1,
        source_version: draft.chapter.source_version, span: draft.span }
      const response = draft.sequence
        ? await StudioDirectingService.directingUpdateSequence({ projectId, chapterId, sequenceId: draft.sequence.id,
          requestBody: { ...body, expected_version: draft.sequence.version } })
        : await StudioDirectingService.directingCreateSequence({ projectId, chapterId, requestBody: body })
      if (!response.data) throw new Error('保存未返回场次，请核对后重试')
      const saved = response.data
      const updated = { ...chapter, sequences: [...chapter.sequences.filter(row => row.id !== saved.id), saved].sort((a, b) => a.position - b.position) }
      flushSync(() => {
        setChapter(updated); setActiveId(saved.id); setBusy(false)
        setDraft({ chapter: updated, sequence: saved, title: saved.title, span: saved.span || undefined })
        if (draft.candidate) setConfirmed(values => [...values, draft.candidate!])
      })
      onChanged(saved.id); void reload()
      return true
    } catch (cause) { setError(directingError(cause)); return false }
    finally { setBusy(false) }
  }
  const guard = useWorkspaceDraft({ name: '场次原文范围', dirty, busy, save, discard: () => setDraft(undefined) })
  const pickScene = (id: string) => guard(() => {
    const row = chapter?.sequences.find(item => item.id === id)
    if (!row || !chapter) return
    setSelectionEpoch(value => value + 1); setActiveId(id); setError(''); setMobileView('source')
    setDraft({ chapter, sequence: row, title: row.title, span: row.source_changed ? undefined : row.span || undefined })
  })
  const newScene = () => guard(() => { if (chapter) { setSelectionEpoch(value => value + 1); setDraft({ chapter, title: '' }); setActiveId(undefined); setError(''); setMode('manual'); setMobileView('source') } })
  const showResult = (task: DirectingTaskRead) => guard(() => { setResult(task); setMode('ai'); setActivities(false); setMobileView('list') })
  const readFailure = loadError && <Alert type="error" message={loadError} action={<Button onClick={() => { void reload() }}>重试</Button>} />
  if (!chapter) return <Space>{loadError ? readFailure : <Spin />}</Space>
  const displayed = draft?.chapter || chapter
  const stale = displayed.source_version !== chapter.source_version
  const pending = tasks.filter(task => task.status === 'running' || task.status === 'queued').length
  const latest = [...tasks].reverse().find(task => task.division)
  const candidates = result?.division?.scenes || []
  const candidateKey = (index: number) => `${result?.task_id}:${index}`
  const candidateCurrent = result?.source_version === chapter.source_version
  const marks: SourceMark[] = displayed.sequences.filter(row => !row.source_changed && row.span).map(row => ({ id: row.id, label: `场次 ${row.position + 1} · ${row.title}`, span: row.span! }))
  if (mode === 'ai' && candidateCurrent && !stale) candidates.forEach((row, index) => {
    const matches = excerptMatches(displayed.raw_text, row.excerpt)
    if (matches.length === 1 && !confirmed.includes(candidateKey(index))) marks.push({ id: candidateKey(index), label: `AI 候选 ${index + 1}`, span: matches[0], candidate: true })
  })
  const chooseCandidate = (index: number) => guard(() => {
    if (!candidateCurrent) return
    const row = candidates[index], matches = excerptMatches(chapter.raw_text, row.excerpt)
    setDraft({ chapter, title: row.title, span: matches.length === 1 ? matches[0] : undefined, candidate: candidateKey(index) })
    setSelectionEpoch(value => value + 1); setActiveId(candidateKey(index)); setError(''); setMobileView('source')
  })
  const oldMatches = draft?.sequence?.source_changed ? excerptMatches(displayed.raw_text, draft.sequence.source_text) : []
  const candidateIndex = candidates.findIndex((_, index) => candidateKey(index) === draft?.candidate)
  const matches = candidateIndex >= 0 ? excerptMatches(displayed.raw_text, candidates[candidateIndex].excerpt) : oldMatches
  const conflicts = rangeConflicts(displayed.sequences, draft?.span, draft?.sequence?.id)
  return <div className="chapter-division">
    {readFailure}{error && <Alert type="error" showIcon message={error} />}
    {stale && <Alert type="warning" message="原文已变化，当前显示编辑时的版本；请重新载入并框选范围。" action={<Button onClick={() => guard(() => {
      setDraft(draft ? { chapter, sequence: chapter.sequences.find(row => row.id === draft.sequence?.id), title: draft.title } : undefined)
    })}>重新载入原文</Button>} />}
    {!chapter.raw_text.trim() && <Alert type="info" message="请先添加章节原文。" action={<Button onClick={() => guard(onEdit)}>填写章节原文</Button>} />}
    <WorkspaceWriteBoundary busy={busy}>
      <Space wrap className="chapter-division-toolbar">
        <Radio.Group aria-label="划场模式" value={mode} onChange={event => guard(() => setMode(event.target.value))} optionType="button"
          options={[{ value: 'manual', label: '手动划分' }, { value: 'ai', label: 'AI 划分' }]} />
        {mode === 'manual' ? <Button disabled={!chapter.raw_text.trim()} onClick={newScene}>手动新建场次</Button>
          : <Button disabled={!chapter.raw_text.trim() || pending > 0} onClick={() => guard(() => { void (async () => {
            setBusy(true); setError('')
            try { await StudioDirectingService.directingAnalyzeChapter({ projectId, chapterId, requestBody: {} }); await reload() }
            catch (cause) { setError(directingError(cause)) } finally { setBusy(false) }
          })() })}>开始 AI 分析</Button>}
        {pending > 0 && <span role="status">{pending} 个分析任务进行中</span>}
        {tasks.some(task => task.status === 'failed') && <span>有失败记录待核对</span>}
        {latest && <Button onClick={() => showResult(latest)}>查看划场建议</Button>}
        <Button onClick={() => setActivities(value => !value)}>章节活动</Button>
      </Space>
      <div hidden={!activities}><Card title="章节活动"><DirectingTasks projectId={projectId} taskIds={chapter.task_ids || []} onTasks={setTasks}
        onResult={showResult} onSettled={reload} /></Card></div>
      <Radio.Group className="chapter-division-mobile" aria-label="划场内容" value={mobileView} onChange={event => setMobileView(event.target.value)} optionType="button"
        options={[{ value: 'list', label: '场次与候选' }, { value: 'source', label: '完整原文' }, { value: 'editor', label: '当前选区' }]} />
      <div className={`chapter-division-layout show-${mobileView}`}>
        <aside className="chapter-division-list" aria-label="划场场次列表">
          <h3>本章场次</h3>
          {!chapter.sequences.length && <p>尚未划分场次，请选择原文或使用 AI 分析。</p>}
          {chapter.sequences.map(row => <Button block key={row.id} aria-pressed={activeId === row.id} onClick={() => pickScene(row.id)}>
            {row.position + 1}. {row.title}{row.source_changed ? ' · 需要重新定位' : ''}
          </Button>)}
          <p className="text-gray-500">普通底色为未分配原文；有待定位场次时，无法确定全部范围。</p>
          {mode === 'ai' && result?.division && <section aria-label="AI 场次建议">
            <h3>AI 候选</h3>
            {!candidateCurrent && <Alert type="warning" message="原文已变化，请重新分析；旧建议保留供参考。" />}
            {candidates.map((row, index) => {
              const locations = excerptMatches(chapter.raw_text, row.excerpt)
              const done = confirmed.includes(candidateKey(index))
              return <Card key={index} size="small" title={row.title}>
                <p>{row.purpose}</p><p className="chapter-source-excerpt">{row.excerpt}</p>
                <p>{!locations.length ? '无法定位，请在原文中重新选择' : locations.length > 1 ? '多处匹配，请选择对应位置' : '可在原文中预览并调整'}{done ? ' · 已创建' : ''}</p>
                <Button disabled={!candidateCurrent || done} onClick={() => chooseCandidate(index)}>核对并创建场次</Button>
              </Card>
            })}
          </section>}
        </aside>
        <ChapterSourceSelection key={selectionEpoch} projectId={projectId} chapterId={chapterId} raw={displayed.raw_text} marks={marks} span={draft?.span} focusId={activeId}
          onScene={id => { const index = candidates.findIndex((_, i) => candidateKey(i) === id); if (index >= 0) chooseCandidate(index); else pickScene(id) }}
          onSelect={span => setDraft(current => sameSpan(current?.span, span) ? current : current ? { ...current, span } : { chapter, title: '', span })} />
        <aside className="chapter-division-editor" aria-label="当前选区">
          <h3>{draft?.sequence ? '调整场次范围' : '新建场次'}</h3>
          {!draft ? <p>框选原文后新建场次，或选择左侧场次调整范围。</p> : <Space direction="vertical" style={{ width: '100%' }}>
            {draft.sequence?.source_changed && <><Alert type="warning" message="需要重新定位：旧范围未绘制到当前原文，确认范围后才能更新来源。" /><p className="chapter-source-excerpt">{draft.sequence.source_text}</p></>}
            <label>场次名称<Input aria-label="场次标题" value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
            {matches.length > 0 && <Select aria-label="原文出现位置" placeholder="选择并核对原文位置" value={matches.some(item => sameSpan(item, draft.span)) ? draft.span?.start : undefined}
              style={{ width: '100%' }} options={matches.map((item, index) => ({ value: item.start, label: `第 ${index + 1} 次出现 · ${sourceSlice(displayed.raw_text, { start: Math.max(0, item.start - 8), end: item.end + 8 })}` }))}
              onChange={start => setDraft({ ...draft, span: matches.find(item => item.start === start) })} />}
            <strong>选中原文</strong><p className="chapter-source-excerpt" aria-label="选中原文" data-start={draft.span?.start} data-end={draft.span?.end}>{draft.span ? sourceSlice(displayed.raw_text, draft.span) : '尚未选择，请在完整原文中框选。'}</p>
            {!!conflicts.length && <Alert type="warning" message={`与「${conflicts.map(row => row.title).join('、')}」范围重叠，请调整。`} />}
            <Button className="chapter-division-mobile" onClick={() => setMobileView('source')}>返回完整原文选区</Button>
            <Space wrap><Button type="primary" disabled={!draft.span || stale} onClick={() => { void save() }}>{draft.sequence ? '确认保存范围' : '确认创建场次'}</Button>
              <Button onClick={() => guard(() => { setSelectionEpoch(value => value + 1); setDraft(undefined); setActiveId(undefined) })}>取消选区</Button></Space>
          </Space>}
        </aside>
      </div>
      <Button className="chapter-division-mobile" onClick={() => setMobileView('editor')}>查看并确认当前选区</Button>
    </WorkspaceWriteBoundary>
  </div>
}
