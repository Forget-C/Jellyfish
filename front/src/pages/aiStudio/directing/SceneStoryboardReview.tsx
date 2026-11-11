import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert, Checkbox, Spin } from 'antd'
import { ApiError, StudioDirectingService as Directing } from '../../../services/generated'
import type { StoryboardApplication, StoryboardCandidate, StoryboardConflictChoice, StoryboardDiff, StoryboardDiffCard,
  StoryboardReviewIssue, StoryboardReviewReport, StoryboardRetry, StoryboardTaskRead } from '../../../services/generated'
import type { StoryboardReviewPreparation, StoryboardScope } from '../generationCanvas/useGenerationCanvasEditor'
import { directingError } from './common'
import { WorkbenchButton as Button } from './ui/WorkbenchButton'
import { WorkbenchDialogActions, WorkbenchModal } from './ui/WorkbenchModal'

function Changes({ title, cards, selected, choose }: {
  title: string; cards: StoryboardDiffCard[]; selected: string[]; choose: (id: string, overwrite: boolean) => void;
}) {
  const types = new Map<string, number>()
  for (const card of cards) types.set(card.type_name, (types.get(card.type_name) || 0) + 1)
  return <section>
    <h3>{title} {cards.length} 张</h3>
    {!!cards.length && <>
      <small>{[...types].map(([type, count]) => `${type} ${count}`).join(' · ')}</small>
      <ul>{cards.map(card => <li key={card.id}>
        {card.name} {card.manually_edited && <Checkbox checked={selected.includes(card.id)}
          aria-label={`覆盖${card.name}`} onChange={event => choose(card.id, event.target.checked)}>覆盖人工修改</Checkbox>}
      </li>)}</ul>
    </>}
  </section>
}

export function StoryboardReviewFindings({ report, candidate, action }: {
  report: StoryboardReviewReport; candidate?: StoryboardCandidate | null; action?: (issue: StoryboardReviewIssue) => ReactNode
}) {
  const storyboard = candidate?.document.storyboard
  const names = new Map(storyboard?.shots.map((shot, index) => [
    storyboard.origins[shot.card_id]?.semantic_key?.replace(/^shot:/, ''), '镜头 ' + String(index + 1).padStart(2, '0'),
  ]))
  return <ul>{report.issues.map((issue, index) => <li key={index}>
    <strong>{issue.kind === 'conflict' ? '设计冲突' : '依据不足'} · {issue.shot_ids.map(id => names.get(id) ?? id).join('、')}</strong>
    <p>{issue.requirements}</p><p>{issue.suggestion}</p>{action?.(issue)}
  </li>)}</ul>
}

/** Compare the saved revision and exact overwrite selection before applying. */
export function SceneStoryboardReview({ scope, editable, prepare, reload, apply, applying, saveError, report, candidate, onRepaired, savedCheck, reviewedOverwrite, repairDetails, structureIssues }: {
  scope: StoryboardScope & { projectId: string }; editable: boolean; prepare: () => Promise<StoryboardReviewPreparation | undefined>;
  reload: () => Promise<boolean>; apply: (choice: StoryboardApplication) => Promise<boolean>; applying: boolean; saveError?: string;
  report?: StoryboardReviewReport | null; candidate?: StoryboardCandidate | null;
  repairDetails?: StoryboardTaskRead['repair_details'];
  structureIssues?: string[];
  onRepaired: (result: StoryboardTaskRead) => void;
  savedCheck?: boolean;
  reviewedOverwrite?: string[];
}) {
  const [baseline, setBaseline] = useState<number>()
  const [opening, setOpening] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [review, setReview] = useState<{ choice: StoryboardApplication; diff: StoryboardDiff }>()
  const [error, setError] = useState('')
  const [accepted, setAccepted] = useState<string[]>([])
  const [repairing, setRepairing] = useState(false)
  const [repairIntent, setRepairIntent] = useState<StoryboardRetry>()
  const [repairTask, setRepairTask] = useState<StoryboardTaskRead>()
  const { projectId, chapterId, sequenceId, taskId } = scope
  useEffect(() => {
    if (baseline === undefined) return
    const choice = { expected_revision: baseline, overwrite_card_ids: selected }
    const request = Directing.directingStoryboardDiff({ projectId, chapterId, sequenceId, taskId, requestBody: choice })
    let active = true
    setError('')
    void request.then(response => {
      if (!response.data) throw new Error('无法读取分镜差异')
      if (active) setReview({ choice, diff: response.data })
    }).catch(cause => { if (active) setError(directingError(cause)) })
    return () => { active = false; request.cancel() }
  }, [baseline, selected, projectId, chapterId, sequenceId, taskId])
  const open = async (refresh = false) => {
    setOpening(true); setError('')
    const prepared = await prepare()
    if (prepared?.appliedTaskId === taskId) {
      // 可能刚重放了结果未知的应用。保留该回执建立的撤销记录。
      close()
    } else if (prepared && (!refresh || await reload())) {
      if (refresh) setReview(undefined)
      setBaseline(refresh ? (await prepare())?.revision : prepared.revision); setSelected(reviewedOverwrite ?? []); setAccepted([])
    } else setError('请先解决画布保存问题，再核对提取差异。')
    setOpening(false)
  }
  const close = () => {
    if (!applying && !repairing && !repairTask) { setBaseline(undefined); setReview(undefined); setError(''); setAccepted([]) }
  }
  const diff = review?.diff
  const ready = review?.choice.expected_revision === baseline && review?.choice.overwrite_card_ids === selected
  const automaticStacks = diff?.automatic_stacks || []
  const manualStacks = diff?.manual_stacks || []
  const continuity = diff?.continuity_review
  const conflicts = continuity?.conflicts ?? []
  const hasConflicts = report?.issues.some(issue => issue.kind === 'conflict')
  const blocked = !!continuity?.stale || !!hasConflicts && (!conflicts.length ||
    conflicts.some(conflict => !conflict.previously_accepted && !accepted.includes(conflict.id)))
  const busy = applying || repairing || !!repairTask
  useEffect(() => {
    if (!repairTask) return
    let cancelled = false
    const read = async () => {
      try {
        const response = await Directing.directingStoryboardGet({ projectId, chapterId, sequenceId, taskId: repairTask.task_id })
        if (cancelled || !response.data) return
        const result = response.data
        if (result.status === 'succeeded' && result.candidate) {
          setRepairTask(undefined)
          onRepaired(result)
        } else if (result.status === 'failed' || result.status === 'cancelled') {
          setRepairTask(undefined)
          setError(result.error || '分镜审查未完成，请在工作台管理中查看任务。')
        } else if (result.stage !== repairTask.stage) {
          setRepairTask(result)
        }
      } catch (cause) { if (!cancelled) setError(directingError(cause)) }
    }
    const timer = window.setInterval(() => void read(), 700)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [repairTask, projectId, chapterId, sequenceId, onRepaired])

  const submitReview = async (intent: StoryboardRetry) => {
    setRepairing(true); setRepairIntent(intent); setError('')
    try {
      const response = await Directing.directingStoryboardRetry({ projectId, chapterId, sequenceId, taskId, requestBody: intent })
      if (!response.data) throw new Error('审查提交待核实')
      setRepairTask(response.data); setRepairIntent(undefined)
    } catch (cause) {
      setError(directingError(cause))
      if (cause instanceof ApiError && [400, 404, 409, 422].includes(cause.status)) {
        setRepairIntent(undefined)
      }
    } finally { setRepairing(false) }
  }
  const repair = (conflict: StoryboardConflictChoice) => {
    if (busy || !ready || !review || !continuity || continuity.stale) return
    const intent = repairIntent ?? { request_id: crypto.randomUUID(), targeted_repair: {
      conflict_id: conflict.id, review_token: continuity.token, expected_revision: review.choice.expected_revision,
      overwrite_card_ids: review.choice.overwrite_card_ids,
    } }
    if (intent.targeted_repair?.conflict_id === conflict.id) void submitReview(intent)
  }
  const recheckPlan = () => {
    if (busy || !ready || !review || !continuity?.can_review_plan) return
    const intent = repairIntent ?? { request_id: crypto.randomUUID(), review_plan: review.choice }
    if (intent.review_plan) void submitReview(intent)
  }
  const applyReview = async () => {
    if (!review || busy || repairIntent || !ready || manualStacks.length || blocked) return
    const confirmedStacks = automaticStacks.map(stack => stack.id)
    const choice: StoryboardApplication = { ...review.choice }
    if (confirmedStacks.length) choice.confirmed_auto_stack_ids = confirmedStacks
    if (continuity && (conflicts.length || savedCheck)) {
      choice.review_token = continuity.token
      choice.accepted_conflict_ids = accepted.filter(id => conflicts.some(conflict => conflict.id === id))
    }
    if (await apply(choice)) close()
    else setError('应用尚未完成。请核对画布提示；结果未知时使用原选择再次核实。')
  }
  const choose = (id: string, overwrite: boolean) => {
    if (busy || repairIntent) return
    setAccepted([])
    setSelected(values => overwrite ? [...values, id] : values.filter(value => value !== id))
  }
  return <>
    {!!structureIssues?.length && <details><summary>已完成结构纠错，查看原问题</summary>
      <ul>{structureIssues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></details>}
    {repairDetails && <details>
      <summary>{repairDetails.status === 'applied' ? `已修正 ${repairDetails.changes?.length ?? 0} 个字段` : '查看修正结果'} · 剩余 {report?.issues.filter(issue => issue.kind === 'conflict').length ?? 0} 项冲突</summary>
      <p>{repairDetails.reason}</p>
      {repairDetails.changes?.map((change, index) => <div key={index}>
        <strong>{change.shot_id || '共享设计'} · {change.design_id} · {change.field_id}</strong>
        <p>修改前：{change.before}</p><p>修改后：{change.after}</p>
      </div>)}
      <details><summary>修正前的审查意见</summary><StoryboardReviewFindings report={repairDetails.before_review} candidate={candidate} /></details>
    </details>}
    {savedCheck ? <Button disabled={!editable} loading={opening} onClick={() => void open()}>核对检查差异</Button> :
    <Alert type="warning" showIcon message={baseline === undefined && error ? error :
      hasConflicts ? '分镜存在设计冲突，现有画布内容已保留。' : '分镜结果待应用，现有画布内容已保留。'}
      action={<Button disabled={!editable} loading={opening} onClick={() => void open()}>核对差异</Button>} />}
    <WorkbenchModal title="核对分镜差异" open={baseline !== undefined} width={640}
      closable={!busy} keyboard={!busy} maskClosable={!busy} onCancel={close}
      footer={<WorkbenchDialogActions secondary={<Button variant="quiet" disabled={busy} onClick={close}>暂不应用</Button>}>
        <Button variant="primary" loading={applying} disabled={!review || !ready || !editable || busy || !!repairIntent || !!manualStacks.length || blocked}
          onClick={() => void applyReview()}>{automaticStacks.length ? '应用并解除受影响的堆叠' : '应用分镜'}</Button>
      </WorkbenchDialogActions>}>
      {error && <Alert type="warning" showIcon message={saveError || error} action={<Button disabled={applying} loading={opening}
        onClick={() => void open(true)}>核对最新画布</Button>} />}
      {!diff && !error && <Spin aria-label="正在核对差异" />}
      {continuity?.stale && <Alert type="warning" showIcon message="相关分镜内容已变化，请重新审查。"
        action={continuity.can_review_plan && <Button disabled={!editable || !ready || busy || !!repairIntent?.targeted_repair}
          onClick={recheckPlan}>{repairIntent?.review_plan ? '核实方案审查' : '审查当前方案'}</Button>} />}
      {repairTask && <p role="status">{repairTask.stage === 'repairing_storyboard'
        ? '正在定向修正分镜' : '正在复核分镜连续性'}</p>}
      {!!report?.issues.length && <Alert type={hasConflicts ? 'error' : 'warning'} showIcon
        message={hasConflicts ? '设计冲突待处理' : '部分连续性依据不足'}
        description={<StoryboardReviewFindings report={report} candidate={candidate} action={issue => {
          const conflict = conflicts.find(item => item.issue.requirements === issue.requirements &&
            item.issue.shot_ids.join() === issue.shot_ids.join())
          if (!conflict) return null
          return <>
            <Checkbox checked={conflict.previously_accepted || accepted.includes(conflict.id)}
              disabled={!editable || busy || !!repairIntent || !!continuity?.stale || conflict.previously_accepted}
              aria-label={`接受风险：${issue.requirements}`} onChange={event => setAccepted(values => event.target.checked
                ? [...values, conflict.id] : values.filter(id => id !== conflict.id))}>
              {conflict.previously_accepted ? '已接受此风险' : '保留当前设计并接受此风险'}
            </Checkbox>
            {conflict.can_repair && <Button variant="quiet" disabled={!editable || busy || !!continuity?.stale ||
              !!repairIntent && repairIntent.targeted_repair?.conflict_id !== conflict.id} onClick={() => void repair(conflict)}>
              {repairIntent?.targeted_repair?.conflict_id === conflict.id ? '核实定向修正' : '定向修正'}
            </Button>}
          </>
        }} />} />}
      {diff && <>
        {diff.source_changed && <p>应用时将采用本次已确认的原文。仍被引用的旧原文依据会保留。</p>}
        <p>人工新增的卡片会保留。勾选后才会覆盖相应的人工修改或移除这些卡片。</p>
        {!!manualStacks.length && <section>
          <Alert type="warning" showIcon message="请先返回画布手动解除这些堆叠，再重新核对差异。"
            description={<ul>{manualStacks.map(stack => <li key={stack.id}>{stack.name}</li>)}</ul>} />
        </section>}
        {!!automaticStacks.length && <section><h3>应用后解除的自动堆叠</h3>
          <ul>{automaticStacks.map(stack => <li key={stack.id}>{stack.name}</li>)}</ul>
        </section>}
        {!!diff.visual_continuity_impacts?.length && <section><h3>视觉承接影响</h3>
          <ul>{diff.visual_continuity_impacts.map(message => <li key={message}>{message}</li>)}</ul>
        </section>}
        {!!diff.orphaned.length && <section><h3>失去引用的保留卡片</h3>
          <ul>{diff.orphaned.map(card => <li key={card.id}>{card.name} 将失去 {card.lost_targets?.join('、')}</li>)}</ul>
        </section>}
        <Changes title="新增" cards={diff.added} selected={selected} choose={choose} />
        <Changes title="修改" cards={diff.modified} selected={selected} choose={choose} />
        <Changes title="移除" cards={diff.removed} selected={selected} choose={choose} />

      </>}
    </WorkbenchModal>
  </>
}
