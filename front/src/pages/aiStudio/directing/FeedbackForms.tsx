import { Button, Card, Checkbox, Input, Select, Space } from 'antd'
import type { CutReview_Input, KnowledgeCandidate_Input, RepairItem_Input, WorkspaceRead, FeedbackRead } from '../../../services/generated'
import { FeedbackNote, ObservedRanges, RangeFields } from './FeedbackFields'

/** 整场判断覆盖成立部分、缺口、真实证据与声音状态。 */
export function CutReviewForm({ value, workspace, onChange }: { value: CutReview_Input; workspace: WorkspaceRead; onChange: (next: CutReview_Input) => void }) {
  return <Space direction="vertical" className="w-full" size="middle">
    <Select aria-label="场次验收结论" value={value.verdict} options={[{ value: 'revise', label: '需要调整' }, { value: 'pass', label: '场次画面通过' }]} onChange={verdict => onChange({ ...value, verdict })} />
    {([['overall', '整体判断'], ['established', '已经成立的部分'], ['missing_coverage', '缺失覆盖'], ['awaiting_evidence', '待观察证据'], ['sound_observation', '声音依据']] as const).map(([key, label]) => <FeedbackNote key={key} label={label} value={value[key]} onChange={note => onChange({ ...value, [key]: note })} />)}
    <Select aria-label="声音完成状态" value={value.sound_status} options={[{ value: 'pending_postproduction', label: '声音待后期' }, { value: 'reviewed', label: '已实际审听' }, { value: 'not_applicable', label: '声音不适用' }]} onChange={sound_status => onChange({ ...value, sound_status })} />
    <ObservedRanges label="可用区间" workspace={workspace} value={value.usable_ranges} onChange={usable_ranges => onChange({ ...value, usable_ranges })} />
    {value.issues.map((issue, index) => <Card key={issue.id} size="small" title={`问题 ${index + 1}`} extra={<Button danger onClick={() => onChange({ ...value, issues: value.issues.filter((_, i) => i !== index) })}>删除问题</Button>}>
      <Select aria-label={`问题 ${index + 1}级别`} value={issue.severity} options={[{ value: 'required', label: '必须修复' }, { value: 'optional', label: '可以优化' }, { value: 'postproduction', label: '留待后期' }]} onChange={severity => onChange({ ...value, issues: value.issues.map((row, i) => i === index ? { ...row, severity } : row) })} />
      <FeedbackNote label={`问题 ${index + 1}观察`} value={issue.observation} onChange={observation => onChange({ ...value, issues: value.issues.map((row, i) => i === index ? { ...row, observation } : row) })} />
      <FeedbackNote label={`问题 ${index + 1}验收`} value={issue.acceptance} onChange={acceptance => onChange({ ...value, issues: value.issues.map((row, i) => i === index ? { ...row, acceptance } : row) })} />
      <ObservedRanges label={`问题 ${index + 1}证据`} workspace={workspace} value={issue.evidence || []} onChange={evidence => onChange({ ...value, issues: value.issues.map((row, i) => i === index ? { ...row, evidence } : row) })} />
    </Card>)}
    <Button onClick={() => onChange({ ...value, issues: [...value.issues, { id: crypto.randomUUID(), severity: 'required', observation: {}, acceptance: {}, evidence: [] }] })}>添加审片问题</Button>
  </Space>
}

/** 返工只指向明确问题范围，旧好区间和新结果分开保存。 */
export function RepairForm({ value, workspace, onChange }: { value: RepairItem_Input; workspace: WorkspaceRead; onChange: (next: RepairItem_Input) => void }) {
  const cut = workspace.cuts.find(row => row.id === value.cut_revision_id)
  const plan = workspace.plans.find(row => row.id === value.result_plan_revision_id)
  return <Space direction="vertical" className="w-full" size="middle">
    <Select aria-label="返工目标片段" className="w-full" value={value.item_id} options={cut?.content.items.filter(item => item.kind === 'media').map(item => ({ value: item.id, label: `采用片段 ${item.id}` }))} onChange={item_id => {
      const item = cut?.content.items.find(row => row.id === item_id)
      onChange({ ...value, item_id, ...(item && 'media_range' in item ? { problem_range: item.media_range } : {}) })
    }} />
    <RangeFields label="问题区间" value={value.problem_range} onChange={problem_range => onChange({ ...value, problem_range })} />
    {([['symptom', '症状'], ['root_cause_hypothesis', '根因假设'], ['alternative_fix', '备选修法'], ['primary_change', '本轮主要调整'], ['acceptance', '返工验收'], ['comparison', '新旧结果比较']] as const).map(([key, label]) => <FeedbackNote key={key} label={label} value={value[key] || {}} onChange={note => onChange({ ...value, [key]: note })} />)}
    <Select aria-label="首选修法" value={value.preferred_fix} options={[{ value: 'trim', label: '调整剪辑区间' }, { value: 'replace', label: '替换现有素材' }, { value: 'reshoot', label: '局部补拍' }, { value: 'design', label: '修改设计' }, { value: 'postproduction', label: '后期处理' }]} onChange={preferred_fix => onChange({ ...value, preferred_fix })} />
    <Checkbox checked={value.needs_new_media} onChange={event => onChange({ ...value, needs_new_media: event.target.checked })}>需要新素材</Checkbox>
    <ObservedRanges label="必须保留的好区间" value={value.retained_ranges} workspace={workspace} onChange={retained_ranges => onChange({ ...value, retained_ranges })} />
    <Select allowClear aria-label="返工结果计划" placeholder="关联已确认返工计划" className="w-full" value={value.result_plan_revision_id} options={workspace.plans.filter(row => row.confirmed_at).map((row, index) => ({ value: row.id, label: `计划 ${index + 1} · ${row.id}` }))} onChange={id => onChange({ ...value, result_plan_revision_id: id || null, result_unit_id: id ? workspace.plans.find(row => row.id === id)?.content.units[0]?.id : null, result_take_id: null, result_range: null })} />
    {plan && <Select aria-label="返工结果单元" value={value.result_unit_id} options={plan.content.units.map(unit => ({ value: unit.id, label: unit.coverage.map(item => item.action_scope).join('；') }))} onChange={result_unit_id => onChange({ ...value, result_unit_id, result_take_id: null, result_range: null })} />}
    <Select allowClear aria-label="返工结果素材" placeholder="选择新结果或用于替换的已有素材" className="w-full" value={value.result_take_id} options={workspace.takes.filter(take => !plan || (take.plan_revision_id === plan.id && take.unit_id === value.result_unit_id)).map((take, index) => ({ value: take.id, label: `Take ${index + 1} · ${take.unit_id} · ${take.id}` }))} onChange={id => onChange({ ...value, result_take_id: id || null, result_range: id ? { source_in_ms: 0, source_out_ms: 1000 } : null, attribution: 'unproven' })} />
    {value.result_range && <RangeFields label="结果区间" value={value.result_range} onChange={result_range => onChange({ ...value, result_range })} />}
    <Select allowClear aria-label="返工结果剪辑" placeholder="关联修复后的确认剪辑" className="w-full" value={value.result_cut_revision_id} options={workspace.cuts.filter(row => row.confirmed_at).map((row, index) => ({ value: row.id, label: `剪辑 ${index + 1} · ${row.id}` }))} onChange={id => onChange({ ...value, result_cut_revision_id: id || null })} />
    <Select aria-label="比较归因" value={value.attribution || 'unproven'} options={[{ value: 'unproven', label: '观察记录，因果尚未证明' }, { value: 'single_variable', label: '单变量比较，仍非因果证明' }, { value: 'multiple_variables', label: '多变量变化，不能单独归因' }]} onChange={attribution => onChange({ ...value, attribution })} />
  </Space>
}

/** 经验保存适用条件、反例和复核日期，人工确认也不改变全局规则。 */
export function KnowledgeForm({ value, workspace, feedback, onChange }: { value: KnowledgeCandidate_Input; workspace: WorkspaceRead; feedback: FeedbackRead; onChange: (next: KnowledgeCandidate_Input) => void }) {
  const evidence = [...feedback.reviews, ...feedback.repairs.map(row => row.revision), ...workspace.reviews].filter(row => row.confirmed_at)
  return <Space direction="vertical" className="w-full" size="middle">
    <Select aria-label="经验类别" value={value.category} options={[{ value: 'P', label: 'P · 原则候选' }, { value: 'O', label: 'O · 当前操作条件' }, { value: 'C', label: 'C · 项目设定' }]} onChange={category => onChange({ ...value, category })} />
    <Select aria-label="经验负责岗位" value={value.role} options={['direction', 'performance', 'staging', 'cinematography', 'continuity', 'prompt'].map((role, index) => ({ value: role, label: ['总导演', '表演', '镜内执行', '摄影', '场记', '提示词'][index] }))} onChange={role => onChange({ ...value, role })} />
    {([['claim', '经验主张'], ['counterexamples', '反例 / 失败信号'], ['exceptions', '例外']] as const).map(([key, label]) => <FeedbackNote key={key} label={label} value={value[key]} onChange={note => onChange({ ...value, [key]: note })} />)}
    <Input.TextArea aria-label="适用条件" placeholder="适用条件、模型和范围" value={value.conditions} onChange={event => onChange({ ...value, conditions: event.target.value })} />
    <Input.TextArea aria-label="操作建议" placeholder="操作建议" value={value.recommendation} onChange={event => onChange({ ...value, recommendation: event.target.value })} />
    <Select aria-label="可信程度" value={value.confidence} options={[{ value: 'tentative', label: '待验证' }, { value: 'supported', label: '证据支持' }, { value: 'contradicted', label: '已有反证' }]} onChange={confidence => onChange({ ...value, confidence })} />
    <Input aria-label="复核日期" type="date" value={value.review_on} onChange={event => onChange({ ...value, review_on: event.target.value })} />
    <Select mode="multiple" aria-label="经验版本证据" placeholder="关联审片、返工或审稿版本" className="w-full" value={value.evidence_revision_ids || []} options={evidence.map(row => ({ value: row.id, label: `${row.id} · 修订 ${row.version}` }))} onChange={evidence_revision_ids => onChange({ ...value, evidence_revision_ids })} />
    <Select mode="multiple" aria-label="经验素材证据" placeholder="关联实际 Take" className="w-full" value={value.evidence_take_ids || []} options={workspace.takes.map((take, index) => ({ value: take.id, label: `Take ${index + 1} · ${take.unit_id}` }))} onChange={evidence_take_ids => onChange({ ...value, evidence_take_ids })} />
  </Space>
}

/** 局部补拍范围由用户明确选择，创建草稿不会执行付费任务。 */
export function RepairPlanFields({ value, workspace, coverageIds, action, duration, onCoverage, onAction, onDuration }: {
  value: RepairItem_Input; workspace: WorkspaceRead; coverageIds: string[]; action: string; duration: number;
  onCoverage: (ids: string[]) => void; onAction: (text: string) => void; onDuration: (duration: number) => void;
}) {
  const item = workspace.cuts.find(row => row.id === value.cut_revision_id)?.content.items.find(row => row.id === value.item_id)
  const take = item && 'take_id' in item ? workspace.takes.find(row => row.id === item.take_id) : undefined
  const unit = workspace.plans.find(row => row.id === take?.plan_revision_id)?.content.units.find(row => row.id === take?.unit_id)
  return <Card size="small" title="只准备需要补拍的范围"><Space direction="vertical" className="w-full">
    <Select mode="multiple" aria-label="局部补拍覆盖" className="w-full" placeholder="明确选择需要补拍的覆盖项" value={coverageIds} options={unit?.coverage.map(row => ({ value: row.id, label: row.action_scope }))} onChange={onCoverage} />
    <Input.TextArea aria-label="局部补拍动作" placeholder="本次只补什么动作" value={action} onChange={event => onAction(event.target.value)} />
    <Input aria-label="局部补拍秒数" type="number" min={0.1} step={0.1} value={duration / 1000} onChange={event => onDuration(Math.round(Number(event.target.value) * 1000))} />
  </Space></Card>
}
