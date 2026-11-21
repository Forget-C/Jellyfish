import { useUiText } from '../../../uiText'
import { useState } from 'react'
import { Alert, Button, Checkbox, Input, Modal, Select, Space, Tag } from 'antd'
import type { ShootingCheckRead, ShootingIssue, ShootingNote, SourceSpan } from '../../../services/generated'
import { excerptMatches } from './common'
import { sameSpan, sourceSlice, textareaSpan } from './sourceSelection'
import { explanationScopes, intersectingScopes } from './ShootingExplanationSource'
import { WorkbenchDialogActions } from '../../../components/workbench/WorkbenchModal'

type Row = {
  issue: ShootingIssue
  target?: ShootingNote
  scope?: SourceSpan | null
  text: string
  selected: boolean
}

const kinds = { supported: '原文可支持的解释', conflict: '待确认的矛盾', insufficient_basis: '待创作者确认', optional: '可选拍法' }

function candidate(row: Row): boolean {
  return row.issue.category !== 'source' && !!row.issue.suggestion?.trim()
    && !!row.issue.proposed_change
    && (row.issue.proposed_change !== 'update' || !!row.target)
}

export function ShootingExplanationReview({ check, notes, readOnly, handled, onClose, onDiscard, onApply }: {
  check: ShootingCheckRead; notes: ShootingNote[]; readOnly: boolean; handled: string[]
  onClose: () => void; onDiscard: () => void; onApply: (notes: ShootingNote[], issueIds: string[], keepOpen: boolean) => void
}) {
  const uiText = useUiText()
  const text = check.source_text
  const [rows, setRows] = useState<Row[]>(() => (check.report?.issues || []).filter(issue => !handled.includes(issue.id)).map(issue => {
    const target = issue.proposed_change === 'update' ? notes.find(note => note.id === issue.note_id) : undefined
    const matches = issue.excerpt ? excerptMatches(text, issue.excerpt) : []
    return { issue, target, text: issue.suggestion || '', selected: false,
      scope: target ? target.scope ?? null : matches.length === 1 ? matches[0] : undefined }
  }))
  const [picking, setPicking] = useState<string>()
  const [picked, setPicked] = useState<SourceSpan>()
  const [located, setLocated] = useState<{ id: string; span: SourceSpan }>()
  const update = (id: string, patch: Partial<Row>) => setRows(current => current.map(row => row.issue.id === id ? { ...row, ...patch } : row))
  const selected = rows.filter(row => row.selected)
  const selectedNotes = (exclude: Row) => selected.filter(row => row !== exclude && row.scope).map(row => ({
    id: row.issue.id, text: row.text, scope: row.scope,
  }))
  const conflicts = (row: Row) => {
    if (!row.scope || (row.target && sameSpan(row.scope, row.target.scope))) return []
    const peerNotes = notes.filter(note => note.id !== row.target?.id)
    const existing = intersectingScopes(peerNotes, row.scope)
    const pending = selectedNotes(row).filter(note => note.scope!.start < row.scope!.end &&
      row.scope!.start < note.scope!.end && !sameSpan(note.scope, row.scope))
    return explanationScopes([...existing.map((scope, index) => ({ id: String(index), text: '', scope })), ...pending])
  }
  const valid = (row: Row) => row.scope !== undefined && !!row.text.trim() && !conflicts(row).length
  const applicable = selected.filter(valid)
  const apply = () => {
    const result = [...notes]
    for (const row of applicable) {
      const note: ShootingNote = { ...row.target, id: row.target?.id || crypto.randomUUID(), text: row.text.trim(),
        excerpt: row.issue.excerpt || row.target?.excerpt || '', scope: row.scope, previous_scope_text: '',
        source: 'check', choice: row.target?.choice ?? 'adopt' }
      const index = result.findIndex(item => item.id === note.id)
      if (index >= 0) result[index] = note
      else result.push(note)
    }
    const ids = applicable.map(row => row.issue.id)
    const keepOpen = applicable.length !== selected.length
    if (keepOpen) setRows(current => current.map(row => ids.includes(row.issue.id) ? { ...row, selected: false } : row))
    onApply(result, ids, keepOpen)
  }
  return <Modal open centered width={840} zIndex={1980} className="management-scene-dialog shooting-review-modal"
    title={uiText("核对 AI 拍摄解释")} onCancel={onClose} maskClosable={false}
    footer={<WorkbenchDialogActions secondary={<Space wrap><Button onClick={onClose}>{uiText("返回解释")}</Button>
      {!readOnly && <Button type="text" danger onClick={onDiscard}>{uiText("丢弃剩余结果")}</Button>}</Space>}>
      {!readOnly && <Button type="primary" disabled={!applicable.length} onClick={apply}>{uiText("将选中项加入草稿（{{count}}）", { count: applicable.length })}</Button>}
    </WorkbenchDialogActions>}>
    <div className="shooting-stack">
      {selected.length > applicable.length && <Alert showIcon type="info"
        message={uiText("{{value1}} 个已选项仍需补充内容或确认范围", { value1: selected.length - applicable.length })} />}
      {rows.map(row => {
        const { issue, target, scope } = row
        const already = handled.includes(issue.id)
        const selectable = candidate(row) && !readOnly && !already
        const previous = check.preparation.notes?.find(note => note.id === issue.note_id)
        const changed = issue.proposed_change === 'update' && (!target || previous?.text !== target.text || !sameSpan(previous?.scope, target.scope))
        const overlaps = conflicts(row)
        const matches = issue.excerpt ? excerptMatches(text, issue.excerpt) : []
        const location = matches.length === 1 ? matches[0] : !issue.excerpt ? previous?.scope : undefined
        const locationOptions = matches.map(span => ({ value: span.start, label: uiText("第 {{value1}} 字附近 · {{value2}}", { value1: span.start + 1, value2: sourceSlice(text, { start: Math.max(0, span.start - 12), end: span.end + 12 }) }) }))
        return <section className="shooting-card" key={issue.id}>
          <Space wrap>
            {selectable && <Checkbox aria-label={uiText("采用建议：{{problem}}", { problem: issue.problem })} checked={row.selected} onChange={event => update(issue.id, { selected: event.target.checked })}>{uiText("采用本项")}</Checkbox>}
            <Tag>{already ? uiText("已加入草稿") : candidate(row) ? target ? uiText("建议修改") : uiText("新增") : uiText("待判断")}</Tag>
            <Tag>{uiText(kinds[issue.kind])}</Tag>
          </Space>
          <p><strong>{issue.problem}</strong></p>
          {issue.excerpt && <blockquote>{issue.excerpt}</blockquote>}
          {location && <div><Button type="link" onClick={() => setLocated({ id: issue.id, span: location })}>{uiText("定位原文")}</Button></div>}
          {matches.length > 1 && <Select aria-label={uiText("选择引文位置")} placeholder={uiText("选择引文位置")} options={locationOptions}
            onChange={start => {
              const span = matches.find(item => item.start === start)
              if (!span) return
              setLocated({ id: issue.id, span })
              if (selectable && !target) update(issue.id, { scope: span })
            }} />}
          {located?.id === issue.id && <blockquote className="shooting-source-context">
            {sourceSlice(text, { start: Math.max(0, located.span.start - 30), end: located.span.start })}
            <mark>{sourceSlice(text, located.span)}</mark>
            {sourceSlice(text, { start: located.span.end, end: located.span.end + 30 })}
          </blockquote>}
          {changed && <Alert showIcon type="warning" message={target ? uiText("分析后原解释已有改动，请核对最新文字") : uiText("原解释已不在当前草稿中")} />}
          {(target || row.text) && <div className="shooting-review-compare">
            <div><strong>{uiText("当前解释")}</strong><p>{target?.text || uiText("暂无")}</p></div>
            <div><strong>{uiText("AI 建议")}</strong>{selectable ? <Input.TextArea aria-label={uiText("编辑建议：{{problem}}", { problem: issue.problem })} autoSize={{ minRows: 2, maxRows: 6 }}
              value={row.text} onChange={event => update(issue.id, { text: event.target.value })} /> : <p>{row.text}</p>}</div>
          </div>}
          {selectable && <>
            <p>{scope ? uiText("适用范围：{{value1}}", { value1: sourceSlice(text, scope) }) : scope === null ? uiText("适用范围：全章") : uiText("请选择适用范围")}</p>
            {overlaps.length > 0 && <Alert type="warning" showIcon message={uiText("所选文字与已有选段相交")} />}
            <Space wrap>
              {overlaps.length > 0 && <Select aria-label={uiText("使用已有选段")} placeholder={uiText("使用已有选段")}
                options={overlaps.map(span => ({ value: `${span.start}:${span.end}`, label: sourceSlice(text, span) }))}
                onChange={key => update(issue.id, { scope: overlaps.find(span => `${span.start}:${span.end}` === key) })} />}
              <Button onClick={() => { setPicking(issue.id); setPicked(undefined) }}>{scope ? uiText("重新选择") : uiText("选择原文")}</Button>
              {scope !== null && <Button onClick={() => update(issue.id, { scope: null })}>{uiText("适用全章")}</Button>}
            </Space>
            {picking === issue.id && <div className="shooting-stack">
              <Input.TextArea aria-label={uiText("建议适用原文选区")} readOnly value={text} rows={4}
                onSelect={event => setPicked(textareaSpan(text, event.currentTarget.selectionStart, event.currentTarget.selectionEnd))} />
              <Space wrap><Button disabled={!picked} onClick={() => { update(issue.id, { scope: picked }); setPicking(undefined) }}>{uiText("使用所选文字")}</Button>
                <Button onClick={() => setPicking(undefined)}>{uiText("取消选择")}</Button></Space>
            </div>}
          </>}
        </section>
      })}
      {rows.length === 0 && <p>{uiText("本次分析没有发现需要确认的内容。")}</p>}
    </div>
  </Modal>
}
