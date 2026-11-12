import { cloneElement, useEffect, useRef, useState, type ReactElement } from 'react'
import { Button, Drawer, Dropdown, Input, Modal, Radio, Select, Space } from 'antd'
import { PlusOutlined, SelectOutlined, ScissorOutlined, MergeCellsOutlined, DownOutlined } from '@ant-design/icons'
import type { ChapterSequences, DivisionBaseline, SequenceRead, SourceSpan } from '../../../services/generated'
import { ChapterSourceSelection } from './ChapterSourceSelection'
import { WorkspaceWriteBoundary } from './WorkspaceDrafts'
import { excerptMatches } from './common'
import { changeDivisionSpan, orderedDivisionMembers, removeDivisionMember, type ChapterDivisionDraft, type DraftMember } from './chapterDivision'
import { sameSpan, sourceSlice } from './sourceSelection'

/** 手动、AI 和历史方案共用原文选区与场次编辑；历史浏览只改变选中项。 */
export function ChapterDivisionEditor({ projectId, chapter, draft: inputDraft, activeId, onActive, onChange, readOnly = false, management = false, busy = false, historicalMembers = [], restoredBaseline = [] }: {
  projectId: string; chapter: ChapterSequences; draft: ChapterDivisionDraft; activeId?: string
  onActive: (id?: string) => void
  onChange: (draft: ChapterDivisionDraft) => void; readOnly?: boolean; management?: boolean; busy?: boolean; historicalMembers?: SequenceRead[]; restoredBaseline?: DivisionBaseline[]
}) {
  const draft = { ...inputDraft, members: orderedDivisionMembers(inputDraft.members) }
  const [selection, setSelection] = useState<SourceSpan>()
  useEffect(() => { setSelection(undefined) }, [activeId, chapter.source_version, chapter.current_version?.id])
  const [operation, setOperation] = useState<'split' | 'merge'>()
  const [retain, setRetain] = useState('first')
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
  const drawerMode = management && width > 0 && width < 900
  useEffect(() => { if (!drawerMode) setEditing(false) }, [drawerMode])
  const current = draft.members.find(row => row.key === activeId)
  const identities = [...chapter.sequences, ...historicalMembers.filter(row => !chapter.sequences.some(current => current.id === row.id))]
  const old = identities.find(row => row.id === current?.sequence_id)
  const excerpt = current?.suggested_excerpt || old?.source_text
  const matches = excerpt ? excerptMatches(chapter.raw_text, excerpt) : []
  const update = (patch: Partial<DraftMember>) => {
    if (current && !readOnly) onChange({ ...draft, members: draft.members.map(row => row.key === current.key ? { ...row, ...patch } : row) })
  }
  const applySpan = (span: SourceSpan) => {
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
  const index = draft.members.findIndex(row => row.key === current?.key)
  const next = draft.members[index + 1]
  const canSplit = !!current?.span && !!selection && selection.start > current.span.start && selection.start < current.span.end
  const canMerge = !!current?.span && !!next?.span && current.span.end <= next.span.start
  // 身份只由明确选择沿用；来源映射跟随拆分／合并，已有成果不迁移。
  const applyOperation = () => {
    if (!current?.span || readOnly || busy) return
    if (operation === 'split' && selection && canSplit) {
      const key = crypto.randomUUID()
      const first = { ...current, span: { start: current.span.start, end: selection.start }, sequence_id: retain === 'first' ? current.sequence_id : undefined }
      const second = { ...current, key, title: `${current.title}（拆分）`, span: { start: selection.start, end: current.span.end }, sequence_id: retain === 'second' ? current.sequence_id : undefined }
      onChange({ ...draft, members: draft.members.flatMap(row => row.key === current.key ? [first, second] : [row]),
        lineage: draft.lineage.map(origin => ({ ...origin, target_keys: origin.target_keys.includes(current.key) ? [...new Set([...origin.target_keys, key])] : origin.target_keys })) })
    } else if (operation === 'merge' && next?.span && canMerge) {
      const retained = retain === 'second' ? next : current
      const merged = { ...retained, key: current.key, title: current.title, span: { start: current.span.start, end: next.span.end } }
      const members = draft.members.filter(row => row.key !== next.key).map(row => row.key === current.key ? merged : row)
      const ids = new Set(members.map(row => row.sequence_id))
      onChange({ ...draft, members, exited_sequence_ids: draft.baseline.filter(row => !ids.has(row.sequence_id)).map(row => row.sequence_id),
        restored_baseline: draft.restored_baseline?.filter(row => ids.has(row.sequence_id)),
        lineage: draft.lineage.map(origin => ({ ...origin, target_keys: [...new Set(origin.target_keys.map(key => key === next.key ? current.key : key))] })) })
    }
    setOperation(undefined); setSelection(undefined)
  }
  const canCreate = !!selection && !draft.members.some(row => row.span && selection.start < row.span.end && row.span.start < selection.end)
  const createFromSelection = () => {
    if (!selection || !canCreate) return
    const key = crypto.randomUUID(); onChange({ ...draft, members: [...draft.members, { key, title: '', span: selection }] }); onActive(key); setSelection(undefined); if (drawerMode) setEditing(true)
  }
  const selectionLabel = !selection ? '应用选区' : !current ? '新建场次' : !current.span ? '定位当前场次' : '更新场次范围'
  const sourceActions = !readOnly && <Space wrap className="chapter-source-actions">
    <Dropdown.Button buttonsRender={([left, right]) => [left, cloneElement(right as ReactElement<{ 'aria-label': string }>, { 'aria-label': '选区更多操作' })]} trigger={['click']} className="chapter-selection-action" icon={<DownOutlined aria-hidden />} disabled={!selection || (!current && !canCreate)} menu={{ items: [
      { key: 'create', icon: <PlusOutlined aria-hidden />, label: canCreate ? '新建场次' : '新建场次 · 选区与已有场次重叠', disabled: !canCreate, onClick: createFromSelection },
    ] }} onClick={() => {
      if (current && selection) { applySpan(selection); setSelection(undefined) } else createFromSelection()
    }}><SelectOutlined aria-hidden />{selectionLabel}</Dropdown.Button>
    <Dropdown trigger={['click']} menu={{ items: [
      { key: 'split', icon: <ScissorOutlined aria-hidden />, label: <span>从选区起点拆分{!canSplit && <small> · 请先选择场内原文</small>}</span>, disabled: !canSplit, onClick: () => { setRetain('first'); setOperation('split') } },
      { key: 'merge', icon: <MergeCellsOutlined aria-hidden />, label: <span>与下一场合并{!canMerge && <small> · 没有可合并的下一场</small>}</span>, disabled: !canMerge, onClick: () => { setRetain('first'); setOperation('merge') } },
    ] }}><Button icon={<ScissorOutlined aria-hidden />}>调整划分<DownOutlined aria-hidden /></Button></Dropdown>
  </Space>
  const editorPanel = <aside className="chapter-division-list" aria-label="划场场次列表">
    <div className="chapter-division-members">{!drawerMode && <h3>{readOnly ? '历史场次' : '本章场次'}</h3>}
      {draft.members.map((row, index) => <div className="chapter-division-member" key={row.key}>
        <Button block aria-pressed={current?.key === row.key} onClick={() => { onActive(row.key); setSelection(undefined) }}>{index + 1}. {row.title || '未命名'}{!row.span ? ' · 待定位' : ''}</Button>
        {current?.key === row.key && <Space direction="vertical" style={{ width: '100%' }}>
          <Input aria-label="场次标题" readOnly={readOnly} value={current.title} onChange={event => update({ title: event.target.value })} />
          {!readOnly && <Button type="text" danger onClick={() => { onChange(removeDivisionMember(draft, current.key)); onActive(draft.members.find(row => row.key !== current.key)?.key) }}>移出本章草稿</Button>}
        </Space>}
      </div>)}
      {!draft.members.length && <p>尚无场次，可框选原文新建。</p>}
      {!readOnly && <Button block disabled={!chapter.raw_text.trim()} onClick={() => {
        const key = crypto.randomUUID(); onChange({ ...draft, members: [...draft.members, { key, title: '' }] }); onActive(key)
      }}>新增场次</Button>}
      {current && !readOnly && (old?.source_changed || current.suggested_excerpt || !current.sequence_id) && <details>
        <summary>核对来源与关联</summary>
        {excerpt && <p className="chapter-source-excerpt">{excerpt}</p>}
        {!!matches.length && <Select aria-label="原文出现位置" placeholder="选择原文位置" value={matches.some(item => sameSpan(item, current.span)) ? current.span?.start : undefined}
          style={{ width: '100%' }} options={matches.map((item, index) => ({ value: item.start, label: `第 ${index + 1} 次出现 · ${sourceSlice(chapter.raw_text, item)}` }))} onChange={start => applySpan(matches.find(item => item.start === start)!)} />}
        <Select aria-label="保留场次身份" style={{ width: '100%' }} value={current.sequence_id || ''}
          options={[{ value: '', label: '新增场次' }, ...identities.filter(row => draft.baseline.some(item => item.sequence_id === row.id) || restoredBaseline.some(item => item.sequence_id === row.id)).map(row => ({ value: row.id, label: `沿用：${row.title}`, disabled: draft.members.some(other => other.key !== current.key && other.sequence_id === row.id) }))]} onChange={retainIdentity} />
      </details>}
    </div>
  </aside>
  return <>
    {drawerMode && <Button ref={editTrigger} onClick={() => setEditing(true)}>本章场次</Button>}
    <div ref={layoutRef} className={`chapter-division-layout${drawerMode ? ' with-editor-drawer' : ''}`}>
      <ChapterSourceSelection projectId={projectId} chapterId={readOnly ? `${chapter.chapter_id}:history:${chapter.current_version?.id}` : chapter.chapter_id} raw={chapter.raw_text}
        marks={draft.members.filter(row => row.span).map((row, index) => ({ id: row.key, label: `${index + 1} · ${row.title || '未命名'}`, span: row.span! }))}
        span={selection || current?.span} focusId={current?.key} onScene={id => { onActive(id); setSelection(undefined) }} onSelect={setSelection} readOnly={readOnly} actions={sourceActions} />
      {!drawerMode && editorPanel}

    </div>
    <Modal title={operation === 'split' ? '拆分场次' : '合并场次'} open={!!operation} onCancel={() => setOperation(undefined)} onOk={applyOperation} okText={operation === 'split' ? '确认拆分' : '确认合并'} cancelText="取消">
      <p>{operation === 'split' ? '选择哪一场沿用原场次的关联，另一场将新增。' : '选择沿用哪一场的关联；其他场次退出当前划分，已有成果不会自动迁移。'}</p>
      {operation === 'merge' && current?.span && next?.span && current.span.end < next.span.start && <p>两场之间的未分配原文将纳入合并范围。</p>}
      <Radio.Group aria-label="沿用场次关联" value={retain} onChange={event => setRetain(event.target.value)} options={[
        { value: 'first', label: operation === 'split' ? '前一场沿用' : current?.title },
        { value: 'second', label: operation === 'split' ? '后一场沿用' : next?.title },
      ]} />
    </Modal>
    {drawerMode && <Drawer aria-label="本章场次" className="management-division-drawer" title="本章场次" width="min(340px, 100vw)" open={editing} onClose={() => setEditing(false)}
      afterOpenChange={open => { if (!open) editTrigger.current?.focus({ preventScroll: true }) }}><WorkspaceWriteBoundary busy={busy}>{editorPanel}</WorkspaceWriteBoundary></Drawer>}
  </>
}
