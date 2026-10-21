import { useEffect, useRef, useState } from 'react'
import { Alert, Button } from 'antd'
import { ApiError, StudioDirectingService } from '../../../services/generated'
import type { SceneTakeLibraryRead, SceneTakeReviewRead, SceneVersionContent_Output } from '../../../services/generated'
import { directingError } from './common'

// 沿用工作台保存比较：省略 nullable／空列表默认值不代表依据变化，数组顺序仍保留。
const comparable = (value: unknown) => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).filter(([key, value]) => value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0 && key !== 'participant_ids')).sort(([left], [right]) => left.localeCompare(right))) : item)

/** 固定记录只读，适用性同时核对当前未保存编辑，不把读取失败显示为已通过。 */
export function SceneTakeReviews({ projectId, sequenceId, versionId, revision, take, content, dirty, disabled, evidence, onEvidenceChanged, focusRecordId, focusSerial }: {
  evidence?: unknown; onEvidenceChanged?: () => void; focusRecordId?: string; focusSerial?: number
  projectId: string; sequenceId: string; versionId: string; revision: number; take: SceneTakeLibraryRead; content: SceneVersionContent_Output; dirty: boolean; disabled: boolean
}) {
  const [records, setRecords] = useState<SceneTakeReviewRead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [confirming, setConfirming] = useState(false)
  const [pendingRevision, setPendingRevision] = useState<number>()
  const [confirmationError, setConfirmationError] = useState('')
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const confirm = async (expectedRevision: number) => {
    if (disabled || confirming) return
    setConfirming(true); setPendingRevision(expectedRevision); setConfirmationError('')
    try {
      const response = await StudioDirectingService.directingConfirmSceneTakeReview({ projectId, sequenceId, versionId,
        requestBody: { expected_revision: expectedRevision, take_kind: take.take_kind, take_id: take.take_id } })
      if (!response.data) throw new Error('复核记录尚未核实')
      if (mounted.current) { setPendingRevision(undefined); setAttempt(value => value + 1); onEvidenceChanged?.() }
    } catch (cause) {
      if (mounted.current) {
        setConfirmationError(directingError(cause))
        if (cause instanceof ApiError && [400, 409, 422].includes(cause.status)) setPendingRevision(undefined)
      }
    } finally { if (mounted.current) setConfirming(false) }
  }

  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    void StudioDirectingService.directingSceneTakeReviews({ projectId, sequenceId, versionId }).then(response => {
      if (active) setRecords(response.data || [])
    }).catch(cause => { if (active) setError(directingError(cause)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [projectId, sequenceId, versionId, revision, attempt, evidence])
  const focusedRecord = useRef('')
  useEffect(() => {
    const request = `${focusRecordId}:${focusSerial}`
    if (!focusRecordId || focusedRecord.current === request) return
    const details = document.getElementById(`scene-take-review-${focusRecordId}`)
    if (details instanceof HTMLDetailsElement) { focusedRecord.current = request; details.open = true; details.querySelector('summary')?.focus() }
  }, [focusRecordId, focusSerial, records])
  const selected = records.filter(row => row.take_kind === take.take_kind && row.take_id === take.take_id)
  const current = { ...content, timeline: { items: [] }, take_judgments: content.take_judgments.filter(row => row.take_kind === take.take_kind && row.take_id === take.take_id) }
  const matching = [...selected].reverse().find(row => comparable({ ...row.content, timeline: { items: [] } }) === comparable(current))
  const matches = !!matching
  return <section aria-label="固定素材审片记录">
    <h3>固定审片记录</h3>
    {loading && <p>正在读取审片记录</p>}
    {error && <Alert type="warning" message="审片记录读取失败" description={error} action={<Button onClick={() => setAttempt(value => value + 1)}>重读审片记录</Button>} />}
    {!loading && !error && (selected.length
      ? <Alert type={matches ? 'success' : 'warning'} message={matches ? '当前判断与固定审片依据一致' : '审片依据已变，请重新核对当前判断'} />
      : <p>尚无固定审片记录；保存已审查的判断时记录当时依据。</p>)}
    {!loading && !error && matching && matching.version_id !== versionId && <p>引用原版本素材审查：{matching.version_id}</p>}
    <Button loading={confirming} disabled={disabled || dirty || loading || !!error || confirming || pendingRevision != null || matches
      || current.take_judgments[0]?.annotation.review_status !== 'reviewed'} onClick={() => void confirm(revision)}>确认已按当前依据复核</Button>
    {dirty && <p>先保存当前内容，再明确复核这份依据；无需改写原结论。</p>}
    {confirmationError && <Alert type="warning" message={pendingRevision != null ? '复核结果待核实' : '复核未完成'} description={confirmationError}
      action={pendingRevision != null && <Button disabled={disabled || confirming} onClick={() => void confirm(pendingRevision)}>核实原复核记录</Button>} />}
    {selected.map((row, index) => {
      const judgment = row.content.take_judgments[0]
      return <details key={row.id} id={`scene-take-review-${row.id}`}><summary tabIndex={-1}>查看审片记录 {index + 1}</summary>
        <p>实际审查版本：{row.version_id}{row.version_id !== versionId ? '（另存时保留的历史依据）' : ''}</p>
        <p>形成时间：{new Date(row.created_at).toLocaleString()}</p>
        <p>当时结论：{judgment.annotation.verdict ? ({ pass: '通过', retain: '保留', repair: '需修复', discard: '弃用' })[judgment.annotation.verdict] : '未填写'}</p>
        <p>{judgment.annotation.rationale.text || '未填写说明'}</p>
        <p>当时原文：{row.content.basis.text}</p>
        <details><summary>查看当时完整依据与观察</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(row.content, null, 2)}</pre></details>
        <p>历史记录只读；当前编辑不改写此结论与依据。</p>
      </details>
    })}
  </section>
}
