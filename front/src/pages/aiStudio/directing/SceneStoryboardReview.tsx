import { useEffect, useState } from 'react'
import { Alert, Checkbox, Spin } from 'antd'
import { StudioDirectingService as Directing } from '../../../services/generated'
import type { StoryboardApplication, StoryboardCandidate, StoryboardDiff, StoryboardDiffCard, StoryboardReviewReport } from '../../../services/generated'
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

export function StoryboardReviewFindings({ report, candidate }: {
  report: StoryboardReviewReport; candidate?: StoryboardCandidate | null
}) {
  const storyboard = candidate?.document.storyboard
  const names = new Map(storyboard?.shots.map((shot, index) => [
    storyboard.origins[shot.card_id]?.semantic_key?.replace(/^shot:/, ''), '镜头 ' + String(index + 1).padStart(2, '0'),
  ]))
  return <ul>{report.issues.map((issue, index) => <li key={index}>
    <strong>{issue.kind === 'conflict' ? '设计冲突' : '依据不足'} · {issue.shot_ids.map(id => names.get(id) ?? id).join('、')}</strong>
    <p>{issue.requirements}</p><p>{issue.suggestion}</p>
  </li>)}</ul>
}

/** Compare the saved revision and exact overwrite selection before applying. */
export function SceneStoryboardReview({ scope, editable, prepare, reload, apply, applying, saveError, report, candidate }: {
  scope: StoryboardScope & { projectId: string }; editable: boolean; prepare: () => Promise<StoryboardReviewPreparation | undefined>;
  reload: () => Promise<boolean>; apply: (choice: StoryboardApplication) => Promise<boolean>; applying: boolean; saveError?: string;
  report?: StoryboardReviewReport | null; candidate?: StoryboardCandidate | null;
}) {
  const [baseline, setBaseline] = useState<number>()
  const [opening, setOpening] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [review, setReview] = useState<{ choice: StoryboardApplication; diff: StoryboardDiff }>()
  const [error, setError] = useState('')
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
      setBaseline(refresh ? (await prepare())?.revision : prepared.revision); setSelected([])
    } else setError('请先解决画布保存问题，再核对提取差异。')
    setOpening(false)
  }
  const close = () => { if (!applying) { setBaseline(undefined); setReview(undefined); setError('') } }
  const diff = review?.diff
  const ready = review?.choice.expected_revision === baseline && review?.choice.overwrite_card_ids === selected
  const automaticStacks = diff?.automatic_stacks || []
  const manualStacks = diff?.manual_stacks || []
  const blocked = report?.issues.some(issue => issue.kind === 'conflict')
  const applyReview = async () => {
    if (!review || applying || !ready || manualStacks.length || blocked) return
    const confirmedStacks = automaticStacks.map(stack => stack.id)
    const choice = confirmedStacks.length ? { ...review.choice, confirmed_auto_stack_ids: confirmedStacks } : review.choice
    if (await apply(choice)) close()
    else setError('应用尚未完成。请核对画布提示；结果未知时使用原选择再次核实。')
  }
  const choose = (id: string, overwrite: boolean) => {
    setSelected(values => overwrite ? [...values, id] : values.filter(value => value !== id))
  }
  return <>
    <Alert type="warning" showIcon message={baseline === undefined && error ? error :
      blocked ? '分镜存在设计冲突，现有画布内容已保留。' : '分镜结果待应用，现有画布内容已保留。'}
      action={<Button disabled={!editable} loading={opening} onClick={() => void open()}>核对差异</Button>} />
    <WorkbenchModal title="核对分镜差异" open={baseline !== undefined} width={640}
      closable={!applying} keyboard={!applying} maskClosable={!applying} onCancel={close}
      footer={<WorkbenchDialogActions secondary={<Button variant="quiet" disabled={applying} onClick={close}>暂不应用</Button>}>
        <Button variant="primary" loading={applying} disabled={!review || !ready || !editable || !!manualStacks.length || blocked}
          onClick={() => void applyReview()}>{automaticStacks.length ? '应用并解除受影响的堆叠' : '应用分镜'}</Button>
      </WorkbenchDialogActions>}>
      {error && <Alert type="warning" showIcon message={saveError || error} action={<Button disabled={applying} loading={opening}
        onClick={() => void open(true)}>核对最新画布</Button>} />}
      {!diff && !error && <Spin aria-label="正在核对差异" />}
      {!!report?.issues.length && <Alert type={blocked ? 'error' : 'warning'} showIcon
        message={blocked ? '设计冲突待处理' : '部分连续性依据不足'}
        description={<StoryboardReviewFindings report={report} candidate={candidate} />} />}
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
