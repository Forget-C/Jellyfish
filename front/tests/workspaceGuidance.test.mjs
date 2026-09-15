import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSource, makeWorkspace, revision } from './directing-fixtures.mjs'

const { workspaceGuidance } = await loadSource('workspaceGuidance')
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
