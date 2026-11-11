import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Alert, Button, Card, Checkbox, Modal, Space, Spin } from 'antd'
import { ApiError, StudioDirectingService, type ChapterSequences, type DivisionAnalysisDetail, type DivisionPreview, type DivisionSave, type DivisionSaved, type DivisionVersionDetail } from '../../../services/generated'
import { directingError } from './common'
import { sourceSlice } from './sourceSelection'
import { analysisDivision, divisionBaselineMatches, divisionRequest, initialDivision, versionDivision, type ChapterDivisionDraft } from './chapterDivision'
import { ChapterDivisionEditor } from './ChapterDivisionEditor'
import { DivisionHistoryModal, type DivisionHistorySelection } from './DivisionHistoryModal'
import { useWorkspaceDraft, WorkspaceWriteBoundary } from './WorkspaceDrafts'

type Editor = { chapter: ChapterSequences; draft: ChapterDivisionDraft; history?: DivisionVersionDetail }
type RunningAnalysis = { id: string; epoch: number; chapter: ChapterSequences }
const changes = { added: '新增', title: '名称', position: '顺序', range: '范围', source: '重新确认来源', exited: '退出当前划分', restored: '恢复历史身份' }
const newKey = () => crypto.randomUUID()

/** 单一草稿承接手动、AI 和历史方案；保存后才切换正式版本。 */
export function ChapterSourcePanel({ projectId, chapterId, onChanged, onEdit, refreshKey, sequenceId, embedded = false, targetTask, onCloseTask, mobileView, onMobileView }: {
  projectId: string; chapterId: string; onChanged: (sequenceId: string, count: number) => void; onEdit: () => void; refreshKey: number; sequenceId?: string
  targetTask?: string | null; onCloseTask?: () => void
  mobileView: string; onMobileView: (view: string) => void
  embedded?: boolean
}) {
  const [chapter, setChapter] = useState<ChapterSequences>()
  const [editor, setEditor] = useState<Editor>()
  const [activeId, setActiveId] = useState(sequenceId)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyRefresh, setHistoryRefresh] = useState(0)
  const [viewing, setViewing] = useState<DivisionVersionDetail>()
  const [historyActiveId, setHistoryActiveId] = useState<string>()
  const [running, setRunning] = useState<RunningAnalysis>()
  const [analysisError, setAnalysisError] = useState('')
  const [activeTasks, setActiveTasks] = useState<string[]>([])
  const [tasksReady, setTasksReady] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [preview, setPreview] = useState<{ value: DivisionPreview; draft: DivisionSave['draft'] }>()
  const [identityConfirmed, setIdentityConfirmed] = useState(false)
  const [pendingSave, setPendingSave] = useState<DivisionSave>()
  const [retryReady, setRetryReady] = useState(false)
  const identity = useRef('')
  const writing = useRef(false)
  const epoch = useRef(0)
  const live = useRef({ editor, viewing })
  live.current = { editor, viewing }
  const reload = useCallback(async () => {
    const key = `${projectId}:${chapterId}`
    try {
      const response = await StudioDirectingService.directingChapter({ projectId, chapterId })
      if (!response.data) throw new Error('章节原文读取失败')
      if (identity.current === key) { setChapter(response.data); setLoadError('') }
      return response.data
    } catch (cause) { if (identity.current === key) setLoadError(directingError(cause)); return undefined }
  }, [projectId, chapterId])
  useEffect(() => {
    const editingEpoch = epoch
    identity.current = `${projectId}:${chapterId}`
    void reload()
    return () => { identity.current = ''; editingEpoch.current++ }
  }, [reload, refreshKey, projectId, chapterId])
  useEffect(() => {
    if (chapter && !editor) {
      setEditor({ chapter, draft: initialDivision(chapter) }); setActiveId(embedded ? sequenceId : sequenceId || chapter.sequences[0]?.id)
      if (sequenceId && !chapter.sequences.some(row => row.id === sequenceId)) setError('场次不存在或已退出当前划分')
    }
  }, [chapter, editor, sequenceId, embedded])
  useEffect(() => {
    if (embedded) {
      setActiveId(sequenceId)
      if (sequenceId) onMobileView('source')
    }
  }, [embedded, sequenceId, onMobileView])
  const draftDirty = !!editor && JSON.stringify(editor.draft) !== JSON.stringify(initialDivision(editor.chapter))
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const read = async () => {
      try {
        const response = await StudioDirectingService.directingDivisionHistory({ projectId, chapterId, pageSize: 1 })
        if (!response.data) throw new Error('进行中的分析记录读取失败')
        if (!active) return
        setActiveTasks(response.data.active_task_ids || []); setTasksReady(true)
        if (response.data.active_task_ids?.length) timer = setTimeout(() => { void read() }, 2500)
      } catch (cause) { if (active) { setAnalysisError(directingError(cause)); timer = setTimeout(() => { void read() }, 5000) } }
    }
    void read()
    return () => { active = false; clearTimeout(timer) }
  }, [projectId, chapterId, historyRefresh])
  const editDraft = (draft: ChapterDivisionDraft) => {
    if (!editor) return
    epoch.current++; setEditor({ ...editor, draft }); setPreview(undefined); setIdentityConfirmed(false); setError(''); setNotice('')
  }
  const acceptSaved = (saved: DivisionSaved) => {
    epoch.current++
    const selected = saved.created_sequence_ids[activeId || ''] || (saved.chapter.sequences.some(row => row.id === activeId) ? activeId : saved.chapter.sequences[0]?.id)
    flushSync(() => {
      setChapter(saved.chapter); setEditor({ chapter: saved.chapter, draft: initialDivision(saved.chapter) }); setActiveId(selected)
      setPendingSave(undefined); setRetryReady(false); setPreview(undefined); setBusy(false); setIdentityConfirmed(false); setViewing(undefined)
      setHistoryRefresh(value => value + 1); setNotice(''); setError('')
    })
    onChanged(selected || '', saved.chapter.sequences.length)
    void reload().then(latest => {
      if (latest && latest.current_version?.id !== saved.chapter.current_version?.id) setNotice('本次保存已成功；当前划分随后已有新版本。已保留本次结果，请核对最新划分。')
    })
  }
  const submit = async (body: DivisionSave) => {
    if (writing.current) return false
    writing.current = true
    setBusy(true); setError(''); setPendingSave(body); setRetryReady(false)
    try {
      const response = await StudioDirectingService.directingSaveDivision({ projectId, chapterId, requestBody: body })
      if (!response.data) throw new Error('未收到保存回执，请核对提交结果')
      acceptSaved(response.data); return true
    } catch (cause) {
      if (cause instanceof ApiError && cause.status >= 400 && cause.status < 500) {
        setPendingSave(undefined); setPreview(undefined); setIdentityConfirmed(false); void reload()
      }
      setError(directingError(cause)); return false
    } finally { writing.current = false; setBusy(false) }
  }
  const save = async () => {
    if (!preview || !editor || JSON.stringify(divisionRequest(editor.draft, editor.chapter.raw_text)) !== JSON.stringify(preview.draft)) {
      setError('请先取消离开，在本页预览并确认整章划分变更。'); return false
    }
    if (preview.value.blockers.length || (preview.value.identity_confirmation_required && !identityConfirmed)) return false
    return submit({ request_id: newKey(), draft: preview.draft, preview_token: preview.value.preview_token, identity_changes_confirmed: identityConfirmed })
  }
  const guard = useWorkspaceDraft({ name: '本章划分草稿', dirty: draftDirty, busy: busy || !!pendingSave, save,
    saveWarning: '整章划分必须先在本页预览影响并确认；未预览时请取消离开。',
    discard: () => { if (editor) { epoch.current++; setEditor({ chapter: editor.chapter, draft: initialDivision(editor.chapter) }); setPreview(undefined) } } })
  const previewChanges = async () => {
    if (!editor || !chapter || busy || !draftDirty) return
    setBusy(true); setError('')
    try {
      if (editor.chapter.source_version !== chapter.source_version || !divisionBaselineMatches(editor.draft, chapter)) throw new Error('原文或场次集合已变化，草稿已保留。请对照最新划分后处理。')
      const draft = divisionRequest(editor.draft, editor.chapter.raw_text)
      const response = await StudioDirectingService.directingPreviewDivision({ projectId, chapterId, requestBody: draft })
      if (!response.data) throw new Error('没有取得划分预览，请重试')
      setPreview({ value: response.data, draft }); setIdentityConfirmed(false)
    } catch (cause) { setError(directingError(cause)); if (cause instanceof ApiError && cause.status === 409) void reload() }
    finally { setBusy(false) }
  }
  const recover = async () => {
    if (!pendingSave || busy) return
    setBusy(true); setError('')
    try {
      const response = await StudioDirectingService.directingDivisionReceipt({ projectId, chapterId, requestId: pendingSave.request_id })
      if (response.data) acceptSaved(response.data)
      else { setRetryReady(true); setNotice('尚无提交回执，可以使用同一请求安全重试。') }
    } catch (cause) { setError(directingError(cause)) } finally { setBusy(false) }
  }
  const startAnalysis = async () => {
    if (!editor || busy || running || activeTasks.length || !tasksReady || writing.current) return
    writing.current = true; setBusy(true); setError('')
    const startedEpoch = epoch.current, startedChapter = editor.chapter
    try {
      const response = await StudioDirectingService.directingAnalyzeChapter({ projectId, chapterId, requestBody: {} })
      if (!response.data) throw new Error('未收到分析任务，请从历史版本核对受理情况')
      setRunning({ id: response.data.task_id, epoch: startedEpoch, chapter: startedChapter }); setHistoryRefresh(value => value + 1)
      setNotice('正在分析，可以继续编辑；分析期间有新修改时，结果会保留到历史版本。')
    } catch (cause) { setError(directingError(cause)) }
    finally { writing.current = false; setBusy(false) }
  }
  useEffect(() => {
    if (!running) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const response = await StudioDirectingService.directingDivisionAnalysis({ projectId, chapterId, taskId: running.id })
        if (!active) return
        if (!response.data) throw new Error('分析状态读取失败')
        const detail = response.data
        setAnalysisError('')
        if (['queued', 'running'].includes(detail.analysis.status)) { timer = setTimeout(() => { void poll() }, 2500); return }
        if (detail.analysis.status === 'succeeded') {
          const latest = await reload()
          if (!active) return
          const safe = latest && epoch.current === running.epoch && !live.current.viewing &&
            running.chapter.source_version === latest.source_version &&
            divisionBaselineMatches(initialDivision(running.chapter), latest) &&
            live.current.editor?.chapter.source_version === running.chapter.source_version && !detail.source_changed && !detail.baseline_changed
          if (safe && !detail.issues.length) {
            const draft = analysisDivision(latest, detail)
            epoch.current++; setEditor({ chapter: latest, draft }); setActiveId(draft.members[0]?.key); setPreview(undefined)
            setNotice('AI 生成 · 未保存。请核对场次范围与身份，保存后形成新版本。')
          } else setNotice('新 AI 方案已保留到历史版本；当前草稿未被覆盖，可展开核对后载入编辑。')
        } else setNotice(detail.analysis.status === 'cancelled' ? '分析已取消，原草稿保持不变。' : '分析失败，原草稿保持不变；可在历史版本查看记录。')
        setRunning(undefined); setHistoryRefresh(value => value + 1)
      } catch (cause) { if (active) { setAnalysisError(directingError(cause)); timer = setTimeout(() => { void poll() }, 5000) } }
    }
    void poll()
    return () => { active = false; clearTimeout(timer) }
  }, [running, projectId, chapterId, reload])
  const loadHistory = (selection: DivisionHistorySelection) => {
    if (busy || pendingSave || writing.current) return
    const apply = async () => {
      if (writing.current) return
      writing.current = true; epoch.current++; setBusy(true)
      try {
        const latest = await reload()
        if (!latest) throw new Error('最新划分读取失败，草稿保持不变')
        // 展开后可能发生并发变更；载入时重新读取来源与待恢复对象版本。
        const detail = selection.kind === 'version'
          ? (await StudioDirectingService.directingDivisionVersion({ projectId, chapterId, versionId: selection.detail.version.id })).data
          : (await StudioDirectingService.directingDivisionAnalysis({ projectId, chapterId, taskId: selection.detail.analysis.id })).data
        if (!detail) throw new Error('历史详情读取失败')
        const version = 'version' in detail ? detail : undefined
        const draft = version ? versionDivision(latest, version) : analysisDivision(latest, detail as DivisionAnalysisDetail)
        epoch.current++; setEditor({ chapter: latest, draft, history: version }); setActiveId(draft.members[0]?.key)
        setViewing(undefined); setHistoryOpen(false); setPreview(undefined); setError(''); setNotice('历史方案已载入草稿。请核对范围与身份，保存将形成新版本。')
        if (targetTask) onCloseTask?.()
      } catch (cause) { setError(directingError(cause)) } finally { writing.current = false; setBusy(false) }
    }
    if (draftDirty) Modal.confirm({ title: '替换当前未保存草稿？', content: '载入历史方案会替换当前输入；正式版本保持不变。', okText: '替换草稿', cancelText: '取消', onOk: apply })
    else void apply()
  }
  const readFailure = loadError && <Alert type="error" message={loadError} action={<Button onClick={() => void reload()}>重试</Button>} />
  if (!chapter || !editor) return <Space>{loadError ? readFailure : <Spin />}</Space>
  const draft = editor.draft
  const stale = editor.chapter.source_version !== chapter.source_version || !divisionBaselineMatches(draft, chapter) || editor.chapter.current_version?.id !== chapter.current_version?.id
  return <div className="chapter-division" onKeyDownCapture={event => {
    if (historyOpen && event.key === 'Escape') { event.stopPropagation(); setHistoryOpen(false) }
  }}>
    {readFailure}{error && <Alert type="error" showIcon message={error} />}{notice && <Alert type="info" message={notice} />}
    {analysisError && <Alert type="warning" message={`分析状态读取失败，正在重试读取：${analysisError}`} />}
    {pendingSave && <Alert type="warning" message="保存结果尚未确认。草稿与请求身份已保留，核对后才能继续编辑或离开。" action={<Space wrap>
      <Button loading={busy} onClick={() => void recover()}>核对上次保存</Button>{retryReady && <Button disabled={busy} onClick={() => void submit(pendingSave)}>重试同一提交</Button>}
    </Space>} />}
    {stale && <Alert type="warning" message="原文或场次集合已变化，当前仍显示编辑时的原文和完整草稿，未自动覆盖。" action={<Button disabled={busy || !!pendingSave} onClick={() => setDiscardOpen(true)}>查看最新划分</Button>} />}
    {!chapter.raw_text.trim() && <Alert type="info" message={embedded ? '本章尚未填写原文' : '请先添加章节原文。'}
      action={<Button onClick={() => guard(onEdit)}>填写章节原文</Button>} />}
    <WorkspaceWriteBoundary busy={busy || !!pendingSave}>
            {!viewing && <Space wrap className="chapter-division-save">
        <Button type="primary" disabled={!draftDirty || stale} onClick={() => void previewChanges()}>保存新版本</Button>
        <Button disabled={!draftDirty} onClick={() => setDiscardOpen(true)}>放弃修改</Button>
        <span>{draftDirty ? '整章草稿尚未保存' : '本章划分没有未保存变更'}</span>
      </Space>}
      <div className="chapter-division-toolbar">
        <div><strong>{chapter.title}</strong><span> · {chapter.current_version ? `当前 v${chapter.current_version.number}` : '尚未保存版本'}{draftDirty ? ' · 有未保存草稿' : ''}</span></div>
        <Space wrap><Button disabled={!chapter.raw_text.trim() || !!running || !!activeTasks.length || !tasksReady || stale || !!viewing} onClick={() => {
          if (draftDirty) Modal.confirm({ title: '使用 AI 智能划分？', content: '分析成功后将替换当前草稿；若分析期间继续编辑，结果会保留到历史版本。', okText: '开始分析', cancelText: '取消', onOk: startAnalysis })
          else void startAnalysis()
        }}>{running || activeTasks.length ? '划分中…' : 'AI智能划分'}</Button><Button onClick={() => { epoch.current++; setHistoryOpen(true) }}>历史版本</Button>
          {embedded && !!chapter.raw_text.trim() && <Button onClick={() => guard(onEdit)}>编辑章节原文</Button>}
        </Space>
      </div>
      {viewing && <Alert type="info" message={`正在查看 v${viewing.version.number}（只读） · 当前${chapter.current_version ? ` v${chapter.current_version.number}` : '尚无版本'}，当前草稿已保留。`} action={<Space wrap>
        <Button onClick={() => { epoch.current++; setViewing(undefined) }}>返回当前编辑</Button><Button onClick={() => loadHistory({ kind: 'version', detail: viewing })}>基于此版本编辑</Button>
      </Space>} />}
      {viewing && viewing.chapter.source_version !== chapter.source_version && <Alert type="warning" message="此版本基于旧原文；当前显示保存时的原文，基于此版本编辑时需要重新定位。" />}
      <ChapterDivisionEditor management={embedded} key={viewing ? `history:${viewing.version.id}` : 'editor'} projectId={projectId}
        chapter={viewing?.chapter || editor.chapter} draft={viewing ? initialDivision(viewing.chapter) : draft}
        activeId={viewing ? historyActiveId : activeId} onActive={viewing ? setHistoryActiveId : setActiveId}
        mobileView={mobileView} onMobileView={onMobileView} onChange={editDraft} readOnly={!!viewing} historicalMembers={editor.history?.chapter.sequences} restoredBaseline={editor.history?.restored_baseline} />

    </WorkspaceWriteBoundary>
    <DivisionHistoryModal open={historyOpen || !!targetTask} targetTask={targetTask} projectId={projectId} chapterId={chapterId} refreshKey={historyRefresh}
      onClose={() => { setHistoryOpen(false); if (targetTask) onCloseTask?.() }}
      onView={detail => { if (busy || pendingSave) return; epoch.current++; setViewing(detail); setHistoryActiveId(detail.chapter.sequences[0]?.id); setHistoryOpen(false) }} onLoad={loadHistory} />
    <Modal title="划分变更预览" open={!!preview && !pendingSave} width={800} onCancel={() => setPreview(undefined)} footer={<Space wrap>
      <Button onClick={() => setPreview(undefined)}>继续编辑</Button><Button type="primary" disabled={!!preview?.value.blockers.length || (!!preview?.value.identity_confirmation_required && !identityConfirmed)} onClick={() => void save()}>保存本章划分</Button>
    </Space>}>
      {preview && <><p>原文不会改变。未变化的场次保持版本和来源；退出只移出当前划分，历史成果保留，不自动迁移。</p>
        {preview.value.impacts.map((impact, index) => <Card key={`${impact.key}:${index}`} size="small" title={`${impact.after?.title || impact.before?.title} · ${impact.changes.map(change => changes[change]).join('、') || '保留（无变化）'}`}>
          {impact.before && <p>原身份：{impact.before.id} · 原顺序 {impact.before.position + 1}</p>}
          {impact.after && <p>保存后身份：{impact.after.sequence_id || '新增'} · 顺序 {preview.draft.members.findIndex(row => row.key === impact.key) + 1}</p>}
          {impact.before && <p className="chapter-source-excerpt">变更前：{impact.before.source_text}</p>}
          {impact.after && <p className="chapter-source-excerpt">变更后：{sourceSlice(editor.chapter.raw_text, impact.after.span)}</p>}
          <p>保留成果：设计 {impact.design_count} · 计划 {impact.plan_count} · 素材 {impact.take_count} · 剪辑 {impact.cut_count}{impact.active_cut_revision_id ? ' · 有当前采用' : ''}</p>
        </Card>)}
        <p>未分配原文：{preview.value.unassigned_character_count} 字</p>
        {preview.draft.lineage.map(origin => <p key={origin.sequence_id}>{editor.chapter.sequences.find(row => row.id === origin.sequence_id)?.title} → {origin.target_keys.map(key => preview.draft.members.find(row => row.key === key)?.title).join('、') || '退出当前划分'}</p>)}
        {preview.value.blockers.map(blocker => <Alert key={blocker} type="error" message={blocker} />)}
        {preview.value.identity_confirmation_required && <Checkbox checked={identityConfirmed} onChange={event => setIdentityConfirmed(event.target.checked)}>我已核对拆分、合并、退出和恢复的身份去向；已有成果不自动迁移。</Checkbox>}
      </>}
    </Modal>
    <Modal cancelText="取消" title={stale ? '对照最新划分' : '放弃整章草稿'} open={discardOpen} onCancel={() => setDiscardOpen(false)} okText="放弃草稿并载入最新划分" onOk={() => {
      epoch.current++; setEditor({ chapter, draft: initialDivision(chapter) }); setActiveId(chapter.sequences[0]?.id); setPreview(undefined); setDiscardOpen(false); setViewing(undefined); setError(''); setNotice('已载入最新划分。')
    }}>
      <p>将放弃本章尚未保存的全部修改，正式数据不会变化。</p>{stale && <><p>草稿基线：{editor.chapter.sequences.map(row => row.title).join('、')}</p><p>最新划分：{chapter.sequences.map(row => row.title).join('、')}</p><details><summary>对照最新原文</summary><p className="chapter-source-excerpt">{chapter.raw_text}</p></details></>}
    </Modal>
  </div>
}
