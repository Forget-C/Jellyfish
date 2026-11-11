import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Drawer, Grid, Input, Radio, Select, Space } from 'antd'
import type { ChapterSequences, DivisionBaseline, SequenceRead, SourceSpan } from '../../../services/generated'
import { ChapterSourceSelection } from './ChapterSourceSelection'
import { WorkspaceWriteBoundary } from './WorkspaceDrafts'
import { excerptMatches } from './common'
import { changeDivisionSpan, removeDivisionMember, type ChapterDivisionDraft, type DraftMember } from './chapterDivision'
import { sameSpan, sourceSlice } from './sourceSelection'

/** 手动、AI 和历史方案共用原文选区与场次编辑；历史浏览只改变选中项。 */
export function ChapterDivisionEditor({ projectId, chapter, draft, activeId, onActive, mobileView, onMobileView, onChange, readOnly = false, management = false, busy = false, historicalMembers = [], restoredBaseline = [] }: {
  projectId: string; chapter: ChapterSequences; draft: ChapterDivisionDraft; activeId?: string
  onActive: (id?: string) => void; mobileView: string; onMobileView: (view: string) => void
  onChange: (draft: ChapterDivisionDraft) => void; readOnly?: boolean; management?: boolean; busy?: boolean; historicalMembers?: SequenceRead[]; restoredBaseline?: DivisionBaseline[]
}) {
  const layoutRef = useRef<HTMLDivElement>(null)
  const editTrigger = useRef<HTMLButtonElement>(null)
  const [width, setWidth] = useState(0)
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (!management || !layoutRef.current) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(layoutRef.current)
    return () => observer.disconnect()
  }, [management])
  const screens = Grid.useBreakpoint()
  const drawerMode = management && screens.md === true && width > 0 && width < 1280
  useEffect(() => { if (!drawerMode) setEditing(false) }, [drawerMode])
  const current = draft.members.find(row => row.key === activeId)
  const identities = [...chapter.sequences, ...historicalMembers.filter(row => !chapter.sequences.some(current => current.id === row.id))]
  const old = identities.find(row => row.id === current?.sequence_id)
  const excerpt = current?.suggested_excerpt || old?.source_text
  const matches = excerpt ? excerptMatches(chapter.raw_text, excerpt) : []
  const update = (patch: Partial<DraftMember>) => {
    if (current && !readOnly) onChange({ ...draft, members: draft.members.map(row => row.key === current.key ? { ...row, ...patch } : row) })
  }
  const selectSpan = (span: SourceSpan) => {
    if (readOnly) return
    if (current) onChange(changeDivisionSpan(draft, current.key, span))
    else {
      const key = crypto.randomUUID(); onChange({ ...draft, members: [...draft.members, { key, title: '', span }] }); onActive(key)
    }
  }
  const retainIdentity = (id: string) => {
    if (!current) return
    const members = draft.members.map(row => row.key === current.key ? { ...row, sequence_id: id || undefined,
      reconfirm_source: row.reconfirm_source || identities.find(old => old.id === id)?.source_changed || undefined } : row)
    const retained = new Set(members.map(row => row.sequence_id))
    onChange({ ...draft, members,
      exited_sequence_ids: draft.baseline.filter(row => !retained.has(row.sequence_id)).map(row => row.sequence_id),
      restored_baseline: restoredBaseline.filter(row => retained.has(row.sequence_id)),
      lineage: draft.lineage.map(origin => ({ ...origin, target_keys: origin.sequence_id === id
        ? [...new Set([...origin.target_keys, current.key])]
        : origin.sequence_id === current.sequence_id ? origin.target_keys.filter(key => key !== current.key) : origin.target_keys })) })
  }
  const editorPanel = <aside className="chapter-division-editor" aria-label="当前选区"><h3>{readOnly ? '查看历史场次' : '编辑本章场次'}</h3>
        {!current ? <p>选择场次或框选原文新建；所有操作先保留在本章草稿。</p> : <Space direction="vertical" style={{ width: '100%' }}>
          {old?.source_changed && <><Alert type="warning" message="需要重新定位：旧范围未绘制到当前原文，确认范围后才能更新来源。" /><p className="chapter-source-excerpt">{old.source_text}</p></>}
          <label>场次名称<Input aria-label="场次标题" readOnly={readOnly} value={current.title} onChange={event => update({ title: event.target.value })} /></label>
          {!readOnly && <>
            <label>场次身份<Select aria-label="保留场次身份" style={{ width: '100%' }} value={current.sequence_id || ''}
              options={[{ value: '', label: '新增场次身份' }, ...identities.filter(row => draft.baseline.some(item => item.sequence_id === row.id) || restoredBaseline.some(item => item.sequence_id === row.id)).map(row => ({ value: row.id, label: `保留：${row.title}`, disabled: draft.members.some(other => other.key !== current.key && other.sequence_id === row.id) }))]}
              onChange={retainIdentity} /></label>
            {current.suggested_excerpt && <p className="chapter-source-excerpt">来源摘录：{current.suggested_excerpt}</p>}
            {matches.length > 0 && <Select aria-label="原文出现位置" placeholder="选择并核对原文位置" value={matches.some(item => sameSpan(item, current.span)) ? current.span?.start : undefined}
              style={{ width: '100%' }} options={matches.map((item, index) => ({ value: item.start, label: `第 ${index + 1} 次出现 · ${sourceSlice(chapter.raw_text, { start: Math.max(0, item.start - 8), end: item.end + 8 })}` }))} onChange={start => selectSpan(matches.find(item => item.start === start)!)} />}
          </>}
          <strong>选中原文</strong><p className="chapter-source-excerpt" aria-label="选中原文" data-start={current.span?.start} data-end={current.span?.end}>{current.span ? sourceSlice(chapter.raw_text, current.span) : '尚未选择，请在完整原文中框选。'}</p>
          {!readOnly && <><p>调整共用边界会同步改变相邻两场，保存前核对前后摘录。</p>
            <label>来源场次（拆分／合并映射）<Select mode="multiple" aria-label="来源场次映射" style={{ width: '100%' }} value={draft.lineage.filter(row => row.target_keys.includes(current.key)).map(row => row.sequence_id)}
              options={chapter.sequences.map(row => ({ value: row.id, label: row.title }))} onChange={origins => onChange({ ...draft,
                lineage: draft.lineage.map(row => ({ ...row, target_keys: origins.includes(row.sequence_id) || row.sequence_id === current.sequence_id
                  ? [...new Set([...row.target_keys, current.key])] : row.target_keys.filter(key => key !== current.key) })) })} /></label>
            <Space wrap>{[-1, 1].map(offset => <Button key={offset} disabled={draft.members.findIndex(row => row.key === current.key) + offset < 0 || draft.members.findIndex(row => row.key === current.key) + offset >= draft.members.length} onClick={() => {
              const members = [...draft.members], index = members.findIndex(row => row.key === current.key); [members[index], members[index + offset]] = [members[index + offset], members[index]]; onChange({ ...draft, members })
            }}>{offset < 0 ? '上移' : '下移'}</Button>)}<Button danger onClick={() => { onChange(removeDivisionMember(draft, current.key)); onActive(draft.members.find(row => row.key !== current.key)?.key) }}>移出本章草稿</Button></Space>
          </>}
          <Button className="chapter-division-mobile" onClick={() => onMobileView('source')}>返回完整原文选区</Button>
        </Space>}
      </aside>
  return <>
    <Radio.Group className="chapter-division-mobile" aria-label="划场内容" value={mobileView} onChange={event => onMobileView(event.target.value)} optionType="button" options={[{ value: 'list', label: '本章场次' }, { value: 'source', label: '完整原文' }, { value: 'editor', label: '当前选区' }]} />
    {drawerMode && <Button ref={editTrigger} onClick={() => setEditing(true)}>编辑当前场次</Button>}
    <div ref={layoutRef} className={`chapter-division-layout show-${mobileView}${drawerMode ? ' with-editor-drawer' : ''}`}>
      <aside className="chapter-division-list" aria-label="划场场次列表"><div className="chapter-division-members"><h3>{readOnly ? '历史场次' : '本章草稿'}</h3>
        {draft.members.map((row, index) => <Button block key={row.key} aria-pressed={current?.key === row.key} onClick={() => { onActive(row.key); onMobileView('source') }}>{index + 1}. {row.title || '未命名'}{!row.span ? ' · 待定位' : ''}</Button>)}
        {!draft.members.length && <p>尚无场次，可框选原文新建。</p>}
        {!readOnly && <Button block disabled={!chapter.raw_text.trim()} onClick={() => {
          const key = crypto.randomUUID(); onChange({ ...draft, members: [...draft.members, { key, title: '' }] }); onActive(key); onMobileView('source')
        }}>新增场次</Button>}
        <p>普通底色为未分配原文，可保留缺口。</p>
      </div></aside>
      <ChapterSourceSelection projectId={projectId} chapterId={readOnly ? `${chapter.chapter_id}:history:${chapter.current_version?.id}` : chapter.chapter_id} raw={chapter.raw_text}
        marks={draft.members.filter(row => row.span).map((row, index) => ({ id: row.key, label: `${index + 1} · ${row.title || '未命名'}`, span: row.span! }))}
        span={current?.span} focusId={current?.key} onScene={onActive} onSelect={selectSpan} readOnly={readOnly} />
      {!drawerMode && editorPanel}

    </div>
    <Button className="chapter-division-mobile" onClick={() => onMobileView('editor')}>查看当前选区</Button>
    {drawerMode && <Drawer className="management-division-drawer" title={current?.title || '编辑当前场次'} width="min(340px, 100vw)" open={editing} onClose={() => setEditing(false)}
      afterOpenChange={open => { if (!open) editTrigger.current?.focus({ preventScroll: true }) }}><WorkspaceWriteBoundary busy={busy}>{editorPanel}</WorkspaceWriteBoundary></Drawer>}
  </>
}
