import assert from 'node:assert/strict'
import test from 'node:test'
import { loadSource } from './directing-fixtures.mjs'

const { referenceGroups, referenceIssues, referenceSummary } = await loadSource('referenceInput')
const reference = (id, ordinal, extra = {}) => ({ id, ordinal, file_id: id, media_kind: 'image', purpose: 'identity', participant_ids: [], ...extra })
const capability = { frame_roles: ['first_frame', 'last_frame'], max_frames: 2, subject_images: true, subject_videos: false, combine_subjects_and_frames: false, max_subjects: 2, max_images_per_subject: 2 }

test('explicit groups use the default subject role, legacy references remain separate', () => {
  const refs = [reference('b', 2, { subject_group_id: 'person' }), reference('old', 1), reference('a', 0, { subject_group_id: 'person' })]
  assert.deepEqual(referenceGroups(refs).map(group => group.map(ref => ref.id)), [['a', 'b'], ['old']])
  assert.equal(referenceSummary(refs), '提示词 + 3 张图片 · 2 组主体参考')
})

test('changing a model reports incompatible inputs without changing them', () => {
  const refs = [reference('a', 0, { input_role: 'subject' }), reference('b', 1, { input_role: 'first_frame' })]
  const original = structuredClone(refs)
  assert.ok(referenceIssues(refs, capability).some(issue => issue.includes('不能组合')))
  assert.ok(referenceIssues(refs, { ...capability, subject_images: false }).some(issue => issue.includes('不支持主体图片')))
  assert.deepEqual(refs, original)
})

test('frame positions, group limits and unsupported sound are checked separately', () => {
  const refs = [reference('a', 0, { input_role: 'first_frame' }), reference('b', 1, { input_role: 'first_frame' }), reference('c', 2, { input_role: 'key_frame' }), reference('d', 3, { media_kind: 'audio' })]
  const issues = referenceIssues(refs, capability)
  for (const text of ['不支持所选帧位置', '帧参考最多', '起始画面最多', '不支持声音']) assert.ok(issues.some(issue => issue.includes(text)))
  assert.ok(referenceIssues([0, 1, 2].map(i => reference(String(i), i, { input_role: 'subject', subject_group_id: 'one' })), capability).some(issue => issue.includes('每个主体的图片最多')))
  assert.deepEqual(referenceIssues(refs), [])
  assert.equal(referenceSummary([]), '提示词 + 0 张图片')
})
