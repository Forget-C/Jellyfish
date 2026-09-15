import assert from 'node:assert/strict'
import test from 'node:test'
import { clip, loadSource, makeWorkspace } from './directing-fixtures.mjs'

const { resolveActiveCut, takeRanges, takeUsage, cutStatus, revisionReferences, revisionName } = await loadSource('workspaceUsage')

test('uses the active pointer, not the newest draft or another confirmed revision', () => {
  const workspace = makeWorkspace()
  assert.equal(resolveActiveCut(workspace, 'c-active').cut.id, 'c-active')
  assert.equal(resolveActiveCut(workspace, 'c-old').cut.id, 'c-old')
  assert.deepEqual(resolveActiveCut(workspace, null), { status: 'ready' })
})

test('missing pointer, unknown cut, unconfirmed cut and another sequence remain unknown', () => {
  const workspace = makeWorkspace()
  for (const id of [undefined, 'missing', 'c-draft']) assert.deepEqual(resolveActiveCut(workspace, id), { status: 'error' })
  workspace.cuts[1].sequence_id = 'another-sequence'
  assert.deepEqual(resolveActiveCut(workspace, 'c-active'), { status: 'error' })
})

test('loading and errors never claim a take is not adopted', () => {
  assert.equal(takeUsage({ status: 'loading' }, 't1'), '采用状态加载中')
  assert.equal(takeUsage({ status: 'error' }, 't1'), '采用状态暂不可用')
  assert.equal(takeUsage(resolveActiveCut(makeWorkspace(), null), 't1'), '当前未采用')
})

test('all adopted source ranges are shown, with no fabricated range from the planned item', () => {
  const active = resolveActiveCut(makeWorkspace(), 'c-active')
  assert.deepEqual(takeRanges(active.cut.content, 't1'), ['片段 1 · 1.000–2.000 秒', '片段 2 · 4.000–5.000 秒'])
  assert.deepEqual(takeRanges(active.cut.content, 't2'), [])
})

test('review pass, previous adoption, and new generation do not imply current adoption', () => {
  const workspace = makeWorkspace()
  const active = resolveActiveCut(workspace, 'c-active')
  assert.equal(takeUsage(active, 't1'), '当前采用（指定区间）')
  assert.equal(workspace.takes[1].annotation.verdict, 'pass')
  assert.equal(takeUsage(active, 't2'), '当前未采用')
  assert.equal(takeUsage(active, 't3'), '当前未采用')
})

test('editing and saving a new cut does not replace the adopted cut', () => {
  const workspace = makeWorkspace()
  workspace.cuts[2].content.items.push(clip('new', 't3', 800, 4600))
  assert.equal(takeUsage(resolveActiveCut(workspace, 'c-active'), 't3'), '当前未采用')
  workspace.cuts[2].confirmed_at = '2026-09-15T02:00:00'
  assert.equal(takeUsage(resolveActiveCut(workspace, 'c-draft'), 't3'), '当前采用（指定区间）')
})

test('confirmation and current/historical adoption are separate labels', () => {
  const workspace = makeWorkspace()
  const active = resolveActiveCut(workspace, 'c-active')
  assert.equal(cutStatus(workspace.cuts[0], active), '已确认 · 历史版本')
  assert.equal(cutStatus(workspace.cuts[1], active), '已确认 · 当前采用')
  assert.equal(cutStatus(workspace.cuts[2], active), '草稿')
  assert.equal(cutStatus(workspace.cuts[1], { status: 'error' }), '已确认 · 采用状态待核对')
})

test('old designs and plans retain their actual current-media and preview references', () => {
  const workspace = makeWorkspace()
  const active = resolveActiveCut(workspace, 'c-active')
  assert.deepEqual(revisionReferences(workspace, active, 'design', 'd1'), ['计划 1 · 已确认（当前采用仍在引用）', '计划 2 · 草稿', '剪辑 2 · 预演依据（当前采用仍在引用）'])
  assert.deepEqual(revisionReferences(workspace, active, 'design', 'd2'), [])
  assert.deepEqual(revisionReferences(workspace, active, 'plan', 'p-old'), ['Take 1（当前采用仍在引用）', 'Take 2', 'Take 3'])
})

test('history and unknown adoption reads preserve source data and never infer current references', () => {
  const workspace = makeWorkspace()
  const before = structuredClone(workspace)
  const refs = revisionReferences(workspace, { status: 'error' }, 'design', 'd1')
  assert.ok(refs.every(ref => !ref.includes('当前采用')))
  workspace.cuts.forEach(row => cutStatus(row, { status: 'loading' }))
  assert.deepEqual(workspace, before)
})

test('version labels use the full collection, without renumbering filtered versions', () => {
  const workspace = makeWorkspace()
  assert.equal(revisionName(workspace.cuts, 'c-active', '剪辑'), '剪辑 2')
  assert.equal(revisionName(workspace.cuts, 'missing', '剪辑'), '剪辑 missing')
})
