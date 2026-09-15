import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const source = await readFile(new URL('../src/layouts/navigation.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
const { pageBreadcrumbs, mainNavigation } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

test('scene breadcrumbs preserve valid parent routes and readable names', () => {
  assert.deepEqual(pageBreadcrumbs('/projects/p1/chapters/ch1/sequences/s1', { project: '旧信', chapter: '第二章', page: '旧信重逢' }), [
    { label: '项目', to: '/projects' }, { label: '旧信', to: '/projects/p1' },
    { label: '第二章', to: '/projects/p1/chapters/ch1/sequences' }, { label: '旧信重逢' },
  ])
  assert.equal(pageBreadcrumbs('/projects/private-id')[1].label, '项目工作台')
  assert.equal(pageBreadcrumbs('/projects/p1/chapters/private-id/sequences').at(-1).label, '章节场次')
})

test('asset and role parents return to their exact category', () => {
  for (const [type, tab] of [['actors', 'actor'], ['scenes', 'scene'], ['props', 'prop'], ['costumes', 'costume']]) {
    assert.equal(pageBreadcrumbs(`/assets/${type}/a1/edit`)[1].to, `/assets?tab=${tab}`)
  }
  assert.equal(pageBreadcrumbs('/projects/p1/roles/a1/edit').at(-2).to, '/projects/p1?tab=roles')
  assert.equal(pageBreadcrumbs('/agents/a1/edit')[0].to, '/agents')
})

test('unknown nested routes never pretend to identify a valid object', () => {
  for (const path of ['/unknown', '/projects/p1/roles/a1/edit/extra', '/projects/p1/chapters/ch1/sequences/s1/extra', '/assets/actors/a1/edit/extra', '/agents/a1/edit/extra']) {
    assert.deepEqual(pageBreadcrumbs(path), [{ label: '页面未找到' }])
  }
  assert.equal(new Set(mainNavigation.map(item => item.to)).size, 8)
})
