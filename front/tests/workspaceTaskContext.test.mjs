import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSource } from './directing-fixtures.mjs'

const { readReviewRequests, saveReviewRequest, readCompileRequests, saveCompileRequest, readShootRequests, saveShootRequest, readSubmittedTasks, rememberSubmittedTask, taskWorkspaceContext, tasksForUnit, unitTaskSummary } = await loadSource('workspaceTaskContext')

test('unit task summary distinguishes review from video execution and preserves concurrent tasks', () => {
  const tasks = [
    { kind: 'directing_review', status: 'running' },
    { kind: 'video_generation', status: 'queued' },
    { kind: 'video_generation', status: 'failed' },
    { kind: 'video_generation', status: 'succeeded' },
    { kind: 'directing_design', status: 'running' },
  ]
  assert.equal(unitTaskSummary(tasks), '检查中 1 · 视频生成排队中 1 · 视频生成失败 1')
  assert.equal(unitTaskSummary([{ kind: 'directing_review', status: 'cancelled' }]), '检查已取消 1')
  assert.equal(unitTaskSummary([]), '')
})
test('multiple submitted unit identities survive refresh and stay scoped to project and scene', () => {
  const data = new Map()
  globalThis.sessionStorage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) }
  rememberSubmittedTask('p1', 's1', { taskId: 't1', planId: 'p-old', unitId: 'u1', promptId: 'prompt1' })
  rememberSubmittedTask('p1', 's1', { taskId: 't2', planId: 'p-old', unitId: 'u2', promptId: 'prompt2' })
  assert.deepEqual(readSubmittedTasks('p1', 's1').map(row => row.unitId), ['u1', 'u2'])
  assert.deepEqual(readSubmittedTasks('p2', 's1'), [])
  assert.deepEqual(readSubmittedTasks('p1', 's2'), [])
  rememberSubmittedTask('p1', 's1', { taskId: 't1', planId: 'p-old', unitId: 'u1', promptId: 'prompt1' })
  assert.equal(readSubmittedTasks('p1', 's1').length, 2)
  globalThis.sessionStorage = { getItem: () => '[null,{"taskId":2},{"taskId":"t","unitId":4}]' }
  assert.deepEqual(readSubmittedTasks('p1', 's1'), [])
  delete globalThis.sessionStorage
})
test('task recovery uses actual identities and refuses to invent a plan for an unknown task', () => {
  const workspace = { takes: [{ task_id: 'video', plan_revision_id: 'old', unit_id: 'u1', prompt_revision_id: 'prompt1' }] }
  assert.deepEqual(taskWorkspaceContext(workspace, 'video', []), { taskId: 'video', planId: 'old', unitId: 'u1', promptId: 'prompt1' })
  assert.equal(taskWorkspaceContext(workspace, 'unknown', []), undefined)
  const task = { task_id: 'review', review: { occurrences: [{ plan_revision_id: 'old', unit_id: 'u1', prompt_revision_id: 'prompt1' }] } }
  assert.equal(taskWorkspaceContext(workspace, 'review', [], task).planId, 'old')
  task.review.occurrences.push({ plan_revision_id: 'new', unit_id: 'u1', prompt_revision_id: 'prompt2' })
  assert.equal(taskWorkspaceContext(workspace, 'review', [], task), undefined)
})

test('unit task summary separates plan versions and includes explicit multi-unit review occurrences', () => {
  const workspace = { takes: [{ task_id: 'video', plan_revision_id: 'old', unit_id: 'u1', prompt_revision_id: 'prompt1' }] }
  const tasks = [{ task_id: 'video', status: 'succeeded' }, { task_id: 'running', status: 'running' }, { task_id: 'unknown', status: 'failed' }, { task_id: 'batch', status: 'failed', review: { occurrences: [{ plan_revision_id: 'old', unit_id: 'u1' }, { plan_revision_id: 'old', unit_id: 'u2' }] } }]
  const submitted = [{ taskId: 'running', planId: 'new', unitId: 'u1' }]
  assert.deepEqual(tasksForUnit(workspace, tasks, submitted, 'old', 'u1').map(row => row.task_id), ['video', 'batch'])
  assert.deepEqual(tasksForUnit(workspace, tasks, submitted, 'old', 'u2').map(row => row.task_id), ['batch'])
  assert.deepEqual(tasksForUnit(workspace, tasks, submitted, 'new', 'u1').map(row => row.task_id), ['running'])
  assert.deepEqual(tasksForUnit(workspace, tasks, submitted, undefined, 'u1'), [])
})


test('unverified shooting identities survive refresh, remain scoped and fail closed on broken storage', () => {
  const data = new Map()
  globalThis.sessionStorage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) }
  const first = { prompt: 'prompt1', review: 'review1', request: 'request1' }
  const second = { prompt: 'prompt2', review: 'review2', request: 'request2' }
  saveShootRequest('p1', 's1', first)
  saveShootRequest('p1', 's1', second)
  assert.deepEqual(readShootRequests('p1', 's1'), [first, second])
  assert.deepEqual(readShootRequests('p2', 's1'), [])
  assert.deepEqual(readShootRequests('p1', 's2'), [])
  saveShootRequest('p1', 's1', first, true)
  assert.deepEqual(readShootRequests('p1', 's1'), [second])
  globalThis.sessionStorage = { getItem: () => '[{"prompt":"p"}]' }
  assert.throws(() => readShootRequests('p1', 's1'))
  assert.throws(() => saveShootRequest('p1', 's1', first))
  globalThis.sessionStorage = { getItem: () => null, setItem: () => { throw new Error('storage unavailable') } }
  assert.throws(() => saveShootRequest('p1', 's1', first), /storage unavailable/)
  delete globalThis.sessionStorage
})


test('compile recovery retains each exact plan and unit request independently', () => {
  const data = new Map()
  globalThis.sessionStorage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) }
  const first = { plan: 'plan1', unit: 'unit1', request: 'compile1' }
  const second = { plan: 'plan2', unit: 'unit1', request: 'compile2' }
  saveCompileRequest('p1', 's1', first)
  saveCompileRequest('p1', 's1', second)
  assert.deepEqual(readCompileRequests('p1', 's1'), [first, second])
  assert.deepEqual(readCompileRequests('p1', 's2'), [])
  saveCompileRequest('p1', 's1', first, true)
  assert.deepEqual(readCompileRequests('p1', 's1'), [second])
  globalThis.sessionStorage = { getItem: () => '[null]' }
  assert.throws(() => readCompileRequests('p1', 's1'))
  delete globalThis.sessionStorage
})


test('review recovery preserves exact prompt requests independently and rejects corrupt storage', () => {
  const data = new Map()
  globalThis.sessionStorage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) }
  const first = { prompt: 'prompt1', request: 'check1' }
  const second = { prompt: 'prompt2', request: 'check2' }
  saveReviewRequest('p1', 's1', first)
  saveReviewRequest('p1', 's1', second)
  assert.deepEqual(readReviewRequests('p1', 's1'), [first, second])
  assert.deepEqual(readReviewRequests('p2', 's1'), [])
  saveReviewRequest('p1', 's1', first, true)
  assert.deepEqual(readReviewRequests('p1', 's1'), [second])
  globalThis.sessionStorage = { getItem: () => '[{"request":"check"}]' }
  assert.throws(() => readReviewRequests('p1', 's1'))
  delete globalThis.sessionStorage
})
