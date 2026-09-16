import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSource, makeWorkspace, revision } from './directing-fixtures.mjs'

const { workspaceGuidance, reviewPacketPassed, reviewPacketComplete, pendingReviewResults } = await loadSource('workspaceGuidance')

test('saved checks match their task identity even when another task produced identical text', () => {
  const workspace = makeWorkspace()
  const review = { mode: 'formal', occurrences: [{ prompt_revision_id: 'prompt1', plan_revision_id: 'p-old', unit_id: 'u1' }], rows: [] }
  const tasks = ['check1', 'check2'].map(task_id => ({ task_id, kind: 'directing_review', status: 'succeeded', review }))
  workspace.reviews = [{ ...revision('r1', review), source_task_id: 'check1' }]
  assert.deepEqual(pendingReviewResults(workspace, tasks, 'p-old', 'u1', 'prompt1').map(row => row.task_id), ['check2'])
})

test('incomplete or duplicate passing rows cannot promise entry into shooting', () => {
  const roles = ['direction', 'performance', 'staging', 'cinematography', 'continuity', 'prompt']
  const packet = { mode: 'formal', occurrences: [{ id: 'o1', prompt_revision_id: 'p1' }], rows: [] }
  assert.equal(reviewPacketPassed(packet, 'p1'), false)
  packet.rows = roles.map(role => ({ role, occurrence_id: 'o1', verdict: 'pass' }))
  assert.equal(reviewPacketPassed(packet, 'p1'), true)
  assert.equal(reviewPacketPassed(packet, 'other'), false)
  packet.rows[5] = { ...packet.rows[0] }
  assert.equal(reviewPacketPassed(packet, 'p1'), false)
})
function input(stage = 'design') {
  const workspace = makeWorkspace()
  workspace.takes = []
  return { workspace, stage, design: workspace.designs[0], plan: workspace.plans[0], editingPlan: workspace.plans[0].content, unitId: 'u1', designStale: false, planStale: false, tasks: [] }
}
test('first entry describes an output and proposes generation without performing it', () => {
  const data = input()
  data.design = undefined
  data.workspace.designs = []
  assert.equal(workspaceGuidance(data).target, 'generate-design')
  assert.equal(workspaceGuidance(data).label, '生成拍摄方案草稿')
  assert.equal(data.workspace.designs.length, 0)
})
test('source and concurrent versions precede generation; existing media remains accessible', () => {
  const data = input()
  data.workspace.sequence.source_changed = true
  assert.equal(workspaceGuidance(data).view, 'source')
  data.designStale = true
  assert.equal(workspaceGuidance(data).target, 'design-version')
  data.stage = 'cut'
  assert.equal(workspaceGuidance(data).target, 'cut-editor')
})
test('design drafts lead to confirmation and confirmed designs lead to preparation', () => {
  const data = input()
  data.design = data.workspace.designs[1]
  assert.equal(workspaceGuidance(data).target, 'design-confirm')
  data.design = data.workspace.designs[0]
  assert.equal(workspaceGuidance(data).target, 'plan-version')
})
test('provider rejection is scoped to its plan and unit; empty references alone are not a blocker', () => {
  const data = input('shoot')
  assert.equal(workspaceGuidance(data).target, 'compile')
  data.issue = { stage: 'shoot', planId: 'p-old', unitId: 'u1', target: 'unit:u1', message: '当前模型要求首帧参考' }
  assert.equal(workspaceGuidance(data).description, '当前模型要求首帧参考')
  assert.equal(workspaceGuidance(data).target, 'unit:u1')
  data.plan.content.units.push({ ...structuredClone(data.plan.content.units[0]), id: 'u2' })
  data.unitId = 'u2'
  assert.equal(workspaceGuidance(data).target, 'compile')
})
test('task progress is only primary for the submitted unit; matching candidates lead to review', () => {
  const data = input('shoot')
  data.tasks = [{ task_id: 'task1', kind: 'video_generation', status: 'running', error: null, source_version: null }]
  data.pending = [{ taskId: 'task1', planId: 'p-old', unitId: 'u1' }]
  assert.equal(workspaceGuidance(data).target, 'tasks')
  data.pending[0].unitId = 'u2'
  assert.equal(workspaceGuidance(data).target, 'compile')
  data.workspace.takes = makeWorkspace().takes
  assert.equal(workspaceGuidance(data).takeId, 't3')
  assert.equal(workspaceGuidance(data).view, 'cut')
})
test('unread task state cannot recommend a duplicate submission and remains scoped to its unit', () => {
  const data = input('shoot')
  data.workspace.task_ids = ['pending-task']
  data.pending = [{ taskId: 'pending-task', planId: 'p-old', unitId: 'u1' }]
  data.tasksState = 'loading'
  assert.equal(workspaceGuidance(data).target, 'tasks')
  data.pending[0].unitId = 'u2'
  assert.equal(workspaceGuidance(data).target, 'compile')
  data.stage = 'design'; data.design = undefined
  assert.equal(workspaceGuidance(data).target, 'tasks')
  data.tasksState = 'error'
  assert.equal(workspaceGuidance(data).target, 'tasks')
})
test('fixed prompt and review identities govern the proposed action', () => {
  const data = input('shoot')
  const prompt = revision('prompt1', { plan_revision_id: 'p-old', unit_id: 'u1' })
  data.workspace.prompts = [prompt]
  data.promptId = prompt.id
  assert.equal(workspaceGuidance(data).target, 'prompt-review')
  prompt.content.unit_id = 'other'
  assert.equal(workspaceGuidance(data).target, 'compile')
  prompt.content.unit_id = 'u1'
  const review = revision('review1', { mode: 'formal', occurrences: [{ id: 'o1', prompt_revision_id: prompt.id }], rows: ['direction', 'performance', 'staging', 'cinematography', 'continuity', 'prompt'].map(role => ({ occurrence_id: 'o1', role, verdict: 'revise' })) })
  data.workspace.reviews = [review]
  data.reviewId = review.id
  assert.equal(workspaceGuidance(data).target, 'review')
  review.content.rows.forEach(row => { row.verdict = 'pass' })
  assert.equal(workspaceGuidance(data).target, 'shoot-confirm')
  review.content.occurrences = []
  assert.equal(workspaceGuidance(data).target, 'prompt-review')
})

test('accepted tasks block duplicates before the workspace list catches up, but not another selected prompt', () => {
  const data = input('shoot')
  data.workspace.task_ids = []
  data.pending = [{ taskId: 'accepted', planId: 'p-old', unitId: 'u1', promptId: 'prompt1' }]
  data.promptId = 'prompt1'
  data.workspace.prompts = [revision('prompt1', { plan_revision_id: 'p-old', unit_id: 'u1' }), revision('prompt2', { plan_revision_id: 'p-old', unit_id: 'u1' })]
  data.tasksState = 'ready'
  assert.equal(workspaceGuidance(data).title, '先核对本次任务状态')
  data.tasks = [{ task_id: 'accepted', kind: 'video_generation', status: 'running' }]
  assert.equal(workspaceGuidance(data).title, '本次视频生成中')
  data.promptId = 'prompt2'
  assert.equal(workspaceGuidance(data).target, 'prompt-review')
  data.tasksState = 'error'
  assert.equal(workspaceGuidance(data).target, 'prompt-review')
  data.promptId = 'prompt1'
  assert.equal(workspaceGuidance(data).target, 'tasks')
  data.tasksState = 'ready'; data.tasks[0].status = 'failed'
  assert.equal(workspaceGuidance(data).target, 'prompt-review')
})

test('current review results precede old candidates and require exact unit identity', () => {
  const data = input('shoot')
  data.workspace.takes = makeWorkspace().takes
  data.promptId = 'new-prompt'
  data.workspace.prompts = [revision('new-prompt', { plan_revision_id: 'p-old', unit_id: 'u1' })]
  const task = { task_id: 'review-new', kind: 'directing_review', status: 'succeeded', review: { occurrences: [{ prompt_revision_id: 'new-prompt', plan_revision_id: 'p-old', unit_id: 'u1' }], rows: [] } }
  data.tasks = [task]
  assert.equal(workspaceGuidance(data).taskId, 'review-new')
  task.review.occurrences[0].unit_id = 'u2'
  assert.equal(workspaceGuidance(data).target, 'prompt-review', 'another unit report and old prompt candidates do not replace the selected instruction')
  task.status = 'running'
  data.pending = [{ taskId: task.task_id, planId: 'p-old', unitId: 'u1', promptId: 'new-prompt' }]
  assert.equal(workspaceGuidance(data).title, '本次指令检查中')
  task.kind = 'video_generation'
  assert.equal(workspaceGuidance(data).title, '本次视频生成中')
})

test('multiple unsaved checks require a choice and do not override a saved review being inspected', () => {
  const data = input('shoot')
  data.promptId = 'prompt1'
  data.workspace.prompts = [revision('prompt1', { plan_revision_id: 'p-old', unit_id: 'u1' })]
  data.tasks = ['check1', 'check2'].map(task_id => ({ task_id, kind: 'directing_review', status: 'succeeded', review: { occurrences: [{ prompt_revision_id: 'prompt1', plan_revision_id: 'p-old', unit_id: 'u1' }], rows: [] } }))
  assert.equal(workspaceGuidance(data).title, '选择本轮检查结果')
  assert.equal(workspaceGuidance(data).taskId, undefined)
  data.reviewTaskId = 'check1'
  assert.equal(workspaceGuidance(data).taskId, 'check1')
  data.reviewTaskId = undefined
  data.reviewId = 'saved'
  data.workspace.reviews = [revision('saved', { mode: 'formal', occurrences: [{ prompt_revision_id: 'prompt1' }], rows: [] })]
  assert.equal(workspaceGuidance(data).target, 'review')
  assert.equal(workspaceGuidance(data).taskId, undefined)
})

test('shoot preparation directs missing models and edited confirmed plans to the exact next input', () => {
  const data = input('shoot')
  data.editingPlan = structuredClone(data.plan.content)
  data.editingPlan.units[0].model_id = ''
  assert.equal(workspaceGuidance(data).target, 'unit-model:u1')
  data.editingPlan.units[0].model_id = 'another-model'
  assert.equal(workspaceGuidance(data).target, 'plan-confirm')
  assert.equal(data.plan.content.units[0].model_id === 'another-model', false)
})


test('multi-occurrence completeness distinguishes pending, missing rows and duplicate identities', () => {
  const roles = ['direction', 'performance', 'staging', 'cinematography', 'continuity', 'prompt']
  const packet = { mode: 'formal', occurrences: ['o1', 'o2'].map(id => ({ id, prompt_revision_id: 'p1' })), rows: ['o1', 'o2'].flatMap(id => roles.map(role => ({ role, occurrence_id: id, verdict: 'pass' }))) }
  assert.equal(reviewPacketComplete(packet), true)
  packet.rows[7].verdict = 'pending'
  assert.equal(reviewPacketComplete(packet), true)
  assert.equal(reviewPacketPassed(packet, 'p1'), false)
  packet.rows[7].verdict = 'pass'
  assert.equal(reviewPacketPassed(packet, 'p1'), true)
  packet.rows.pop()
  assert.equal(reviewPacketComplete(packet), false)
  packet.rows.push({ ...packet.rows[0] })
  assert.equal(reviewPacketComplete(packet), false)
  packet.occurrences[1].id = 'o1'
  assert.equal(reviewPacketComplete(packet), false)
})
