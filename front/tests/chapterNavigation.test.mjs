import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSource } from './directing-fixtures.mjs'

const { legacyChapterManagementLocation, sceneCanvasLocation, chapterLocation,
  readChapterBrowse, saveChapterBrowse, chapterAction, chapterActionLocation } = await loadSource('chapterNavigation')
test('canonical destinations preserve identities and explicit stage', () => {
  assert.equal(chapterLocation('p1', 'ch1', 's1'), '/projects/p1?tab=chapters&chapter=ch1&sequence=s1')
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

test('old links preserve explicit scope and task targets when entering management', () => {
  const target = query => legacyChapterManagementLocation('p1', 'ch1', new URLSearchParams(query))
  assert.equal(target('panel=source&sequence=s1'), '/projects/p1/chapters/ch1/workbench-management?sequence=s1&step=division')
  assert.equal(target('sequence=s1&selected=c1&storyboardTask=t1'),
    '/projects/p1/chapters/ch1/workbench-management?sequence=s1&step=storyboard&canvas=c1&storyboardTask=t1')
  assert.equal(target('sequence=s1&objectTask=t2'), '/projects/p1/chapters/ch1/workbench-management?sequence=s1&step=objects&objectTask=t2')
  assert.equal(sceneCanvasLocation('p1', 'ch1', 's1', 'c1', 't1'),
    '/projects/p1/chapters/ch1/sequences/s1/canvas-workbench?canvas=c1&storyboardTask=t1')
})


test('project chapter actions preserve editing and enter the independent management workflow', () => {
  const destination = chapter => chapterActionLocation('p1', 'ch1', chapterAction(chapter).target)
  assert.equal(destination({ rawText: '', sequenceCount: 0 }), '/projects/p1?tab=chapters&edit=ch1')
  assert.equal(destination({ rawText: '正文', sequenceCount: 0 }), '/projects/p1/chapters/ch1/workbench-management?step=division')
  assert.equal(destination({ rawText: '正文', sequenceCount: 2 }), '/projects/p1/chapters/ch1/workbench-management')
  assert.equal(destination({}), '/projects/p1/chapters/ch1/workbench-management')
})
