import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSource, makeWorkspace, revision } from './directing-fixtures.mjs'
const { selectWorkspaceVersion, workspaceVersionErrors } = await loadSource('workspaceVersions')

test('plan selection follows its fixed design while cut stays independent', () => {
  const workspace = makeWorkspace()
  workspace.designs.push(revision('d3', workspace.designs[0].content))
  workspace.plans.push(revision('p3', { ...workspace.plans[0].content, design_revision_id: 'd3' }))
  const initial = { design: 'd1', plan: 'p-old', cut: 'c-active' }
  assert.deepEqual(selectWorkspaceVersion(workspace, initial, 'plan', 'p3'), { design: 'd3', plan: 'p3', cut: 'c-active' })
  assert.deepEqual(initial, { design: 'd1', plan: 'p-old', cut: 'c-active' })
  assert.deepEqual(selectWorkspaceVersion(workspace, initial, 'design', 'd2'), { design: 'd2', plan: null, cut: 'c-active' })
  assert.deepEqual(selectWorkspaceVersion(workspace, initial, 'cut', 'c-draft'), { design: 'd1', plan: 'p-old', cut: 'c-draft' })
})

test('draft browsing and explicit empty selection are legal; missing and foreign versions never become latest', () => {
  const workspace = makeWorkspace()
  assert.deepEqual(workspaceVersionErrors(workspace, { design: 'd2', plan: null, cut: null }), [])
  const unknown = selectWorkspaceVersion(workspace, { design: 'd1', plan: 'p-old', cut: null }, 'plan', 'missing')
  assert.equal(unknown.plan, 'missing')
  assert.ok(workspaceVersionErrors(workspace, unknown).length)
  workspace.plans[0].sequence_id = 'other'
  assert.ok(workspaceVersionErrors(workspace, { design: 'd1', plan: 'p-old', cut: null }).length)
})

test('conflicting plan/design is explicit, while cross-plan cut sources do not constrain selection', () => {
  const workspace = makeWorkspace()
  assert.ok(workspaceVersionErrors(workspace, { design: 'd2', plan: 'p-old', cut: 'c-active' }).length)
  assert.deepEqual(workspaceVersionErrors(workspace, { design: 'd1', plan: 'p-new', cut: 'c-active' }), [])
  assert.deepEqual(selectWorkspaceVersion(workspace, { design: 'd1', plan: 'p-new', cut: 'c-active' }, 'plan', null), { design: 'd1', plan: null, cut: 'c-active' })
})
