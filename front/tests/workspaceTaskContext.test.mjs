import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSource } from './directing-fixtures.mjs'

const { readSubmittedTasks, rememberSubmittedTask, taskWorkspaceContext } = await loadSource('workspaceTaskContext')
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
