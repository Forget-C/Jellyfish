import { useEffect, useState } from 'react'
import { Alert, Button, Input, Modal, Radio, Space } from 'antd'
import { StudioDirectingService } from '../../../services/generated'
import type { ChapterDivisionDraft } from './chapterDivision'
import { divisionRequest } from './chapterDivision'
import type { DivisionPlan } from './divisionOperations'
import { sourceSlice } from './sourceSelection'

/** 操作级预览只修改候选结果，确认后才交给整章草稿；服务器限制不由本地推断。 */
export function DivisionOperationReview({ projectId, chapterId, raw, before, plan, title, splitKey, onRetain, onChange, onCancel, onConfirm }: {
  projectId: string; chapterId: string; raw: string; before: ChapterDivisionDraft; plan: DivisionPlan; title: string; splitKey?: string
  onRetain: (key: string, after: boolean) => void; onChange: (plan: DivisionPlan) => void; onCancel: () => void; onConfirm: () => void
}) {
  const [validated, setValidated] = useState<ChapterDivisionDraft>()
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let live = true
    setError(''); setNote(''); setChecking(true); setValidated(undefined)
    if (plan.draft.members.some(row => !row.title.trim())) { setError('请输入全部结果名称'); setChecking(false); return }
    let value
    try {
      divisionRequest({ ...plan.draft, members: plan.draft.members.filter(row => row.span) }, raw)
      if (plan.draft.members.some(row => !row.span)) {
        setNote('本章还有待定位场次；本次先加入草稿，完成定位后保存时仍需核对服务器限制。')
        setValidated(plan.draft); setChecking(false); return
      }
      value = divisionRequest(plan.draft, raw)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '候选划分无效'); setChecking(false); return }
    const request = StudioDirectingService.directingPreviewDivision({ projectId, chapterId, requestBody: value })
    void request.then(response => {
      if (!live) return
      if (!response.data) setError('没有取得校验结果，请重试')
      else { setError(response.data.blockers.join('；')); if (!response.data.blockers.length) setValidated(plan.draft) }
    }).catch(cause => { if (live) setError(cause instanceof Error ? cause.message : '校验失败，请重试') })
      .finally(() => { if (live) setChecking(false) })
    return () => { live = false; request?.cancel() }
  }, [projectId, chapterId, plan.draft, raw, retry])
  const changed = plan.draft.members.filter(row => !before.members.some(old => JSON.stringify(old) === JSON.stringify(row)))
  const exited = before.members.filter(row => !plan.draft.members.some(next => next.key === row.key))
  return <Modal className="division-operation-review" title={title} open width={760} onCancel={onCancel} footer={<Space wrap>
    <Button onClick={onCancel}>继续调整</Button>
    <Button type="primary" loading={checking} disabled={!!error || validated !== plan.draft} onClick={onConfirm}>确认加入草稿</Button>
  </Space>}>
    <p>核对范围及关联去向；确认后仍需在顶部保存为新版本。退出场次的历史成果保留，不会自动迁移。</p>
    {[...plan.fragmented, ...before.members.filter(row => row.key === splitKey)].filter(row => row.sequence_id).map(row => <div key={row.key}>
      <span>{row.title} 的关联保留在：</span><Radio.Group aria-label={`${row.title}关联保留位置`} value={plan.draft.members.find(member => member.sequence_id && member.sequence_id === row.sequence_id)?.span?.start === row.span?.start ? 'before' : 'after'}
        onChange={event => onRetain(row.key, event.target.value === 'after')} options={[{ value: 'before', label: '前段' }, { value: 'after', label: '后段' }]} />
    </div>)}
    {changed.map(row => {
      const old = before.members.find(item => item.key === row.key)
      const owner = before.members.find(item => item.sequence_id && item.sequence_id === row.sequence_id)
      return <section className="division-operation-impact" key={row.key}>
        <Input aria-label={`结果名称 ${row.key}`} value={row.title} onChange={event => onChange({ ...plan, draft: { ...plan.draft, members: plan.draft.members.map(item => item.key === row.key ? { ...item, title: event.target.value } : item) } })} />
        <small>{owner ? `沿用「${owner.title}」关联` : '新增场次，无已有场次关联'}</small>
        {old?.span && <p>原范围：{sourceSlice(raw, old.span)}</p>}
        {row.span && <p>新范围：{sourceSlice(raw, row.span)}</p>}
      </section>
    })}
    {exited.map(row => <p key={row.key}>「{row.title}」退出当前划分；历史成果保留。</p>)}
    <p>范围外释放的文字及纯空白残段保留为未分配原文。</p>
    {note && <Alert type="info" message={note} />}
    {error && <Alert type="error" message={error} action={<Button size="small" onClick={() => setRetry(value => value + 1)}>重新校验</Button>} />}
  </Modal>
}
