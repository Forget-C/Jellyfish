import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSource } from './directing-fixtures.mjs'

const { sequenceAction, chapterLocation, sequenceLocation, readChapterBrowse, saveChapterBrowse } = await loadSource('chapterNavigation')
const scene = { id: 's1', source_changed: false, confirmed_design_count: 0, plan_count: 0, take_count: 0, unreviewed_take_count: 0, active_cut_revision_id: null }

test('source verification precedes remembered work; unknown remembered stages are ignored', () => {
  assert.equal(sequenceAction({ ...scene, source_changed: true }, 'shoot').view, null)
  assert.equal(sequenceAction(scene, 'shoot').view, 'shoot')
  assert.equal(sequenceAction(scene, 'unknown').view, 'design')
})

test('primary action follows review, adopted cut, design and production preparation', () => {
  assert.equal(sequenceAction({ ...scene, unreviewed_take_count: 2 }).view, 'cut')
  assert.equal(sequenceAction({ ...scene, active_cut_revision_id: 'c1' }).view, 'cut')
  assert.equal(sequenceAction(scene).view, 'design')
  assert.equal(sequenceAction({ ...scene, confirmed_design_count: 1 }).view, 'shoot')
  assert.equal(sequenceAction({ ...scene, confirmed_design_count: 1, plan_count: 1, take_count: 1 }).view, 'cut')
})

test('canonical destinations preserve identities and explicit stage', () => {
  assert.equal(chapterLocation('p1', 'ch1', 's1'), '/projects/p1?tab=chapters&chapter=ch1&sequence=s1')
  assert.equal(sequenceLocation('p1', 'ch1', 's1', 'shoot'), '/projects/p1/chapters/ch1/sequences/s1?view=shoot')
})

test('chapter browsing stays isolated and tolerates damaged or unavailable storage', () => {
  const values = new Map()
  globalThis.sessionStorage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }
  try {
    saveChapterBrowse('p1', 'ch1', { query: '门', top: 1200, sourceTop: 450, sequence: 's1' })
    saveChapterBrowse('p1', '', { chapter: 'ch1', query: '第十章', page: 11 })
    assert.equal(readChapterBrowse('p1').chapter, 'ch1')
    assert.equal(readChapterBrowse('p1', 'ch1').query, '门')
    assert.equal(readChapterBrowse('p1', 'ch1').sourceTop, 450)
    assert.equal(readChapterBrowse('p1', 'ch1').sequence, 's1')
    assert.equal(readChapterBrowse('p1').page, 11)
    assert.equal(readChapterBrowse('p1').query, '第十章')
    assert.equal(readChapterBrowse('p2', 'ch1').query, undefined)
    assert.equal(readChapterBrowse('p1', 'ch2').top, undefined)
    values.set('chapter-browse:["p1","ch1"]', '{broken')
    assert.deepEqual(readChapterBrowse('p1', 'ch1'), {})
    values.set('chapter-browse:["p1","ch1"]', '{"top":-1,"query":12,"page":0,"sequence":12}')
    assert.equal(readChapterBrowse('p1', 'ch1').top, undefined)
    assert.equal(readChapterBrowse('p1', 'ch1').query, undefined)
    assert.equal(readChapterBrowse('p1', 'ch1').page, undefined)
    assert.equal(readChapterBrowse('p1', 'ch1').sequence, undefined)
    globalThis.sessionStorage = { getItem: () => { throw Error('blocked') }, setItem: () => { throw Error('blocked') } }
    assert.doesNotThrow(() => saveChapterBrowse('p1', 'ch1', { query: '仍可操作' }))
    assert.deepEqual(readChapterBrowse('p1', 'ch1'), {})
  } finally { delete globalThis.sessionStorage }
})
