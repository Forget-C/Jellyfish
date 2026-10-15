import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { makeWorkspace } from './directing-fixtures.mjs'
import { directorSelect, workbenchShot } from './workbenchControls.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const output = await mkdtemp(join(tmpdir(), 'jellyfish-director-layout-'))
const api = 'http://127.0.0.1:8198'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.directing.scene_version_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8198' }, stdio: ['ignore', 'pipe', 'pipe'],
})
let logs = '', server, browser, page
backend.stdout.on('data', data => { logs += data })
backend.stderr.on('data', data => { logs += data })
const errors = []
async function screenshot(name) {
  await page.evaluate(async () => { await new Promise(requestAnimationFrame); await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))) })
  await page.screenshot({ path: join(output, name), animations: 'disabled' })
}
async function request(url, body, method = 'POST') {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const result = await response.json()
  assert.equal(response.status, 200, JSON.stringify(result))
  return result.data
}
try {
  let chapter
  for (let i = 0; i < 100; i++) {
    if (backend.exitCode !== null) throw new Error(logs)
    try { const response = await fetch(`${api}/api/v1/studio/projects/canvas-project/directing/chapters/canvas-chapter`); if (response.ok) { chapter = (await response.json()).data; break } } catch {}
    await delay(250)
  }
  assert.ok(chapter, logs)
  const sequence = chapter.sequences[0].id
  const versions = `${api}/api/v1/studio/projects/canvas-project/directing/sequences/${sequence}/versions`
  let version = await request(versions, { request_id: crypto.randomUUID(), title: '设计卡片验收' })
  const design = makeWorkspace().designs[0].content
  const note = text => ({ state: 'proposal', text, sources: [{ kind: 'human', reference: 'browser', version: '1' }] })
  design.direction.information_change = note('读到旧信')
  design.participants[0].name = '读信者'
  design.direction.shots[0].visible_result = note('打开旧信')
  design.direction.shots.push({ ...structuredClone(design.direction.shots[0]), id: 'shot2', visible_result: note('望向门口') })
  design.criteria = Array.from({ length: 5 }, (_, i) => ({ id: `criterion${i + 1}`, requirement: note(`验收要求 ${i + 1}：保持动作与画面关系清楚`) }))
  design.direction.shots.forEach(shot => { shot.criterion_ids = design.criteria.map(row => row.id) })
  design.performance.beats[0].physical_action = note('缓慢展开信纸')
  design.performance.beats[0].dialogue_ids = ['dialogue1']
  design.cinematography[0].composition = note('让信纸位于画面中央')
  design.staging.activities[0].ongoing_task = note('窗外行人经过')
  design.staging.activities.push({ ...structuredClone(design.staging.activities[0]), trigger_event_id: null, ongoing_task: note('整理桌上的物件') })
  version = await request(`${versions}/${version.id}`, { request_id: crypto.randomUUID(), expected_revision: version.revision, content: { ...version.content, design } }, 'PUT')
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4198, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin }; localStorage.setItem('jellyfish:scene-autosave:local-user', 'off') })
  await page.goto(`http://127.0.0.1:4198/projects/canvas-project/chapters/canvas-chapter/sequences/${sequence}?version=${version.id}`)
  const surface = page.getByLabel('导演画布视口', { exact: true })
  const node = id => page.locator(`[data-canvas-node="${id}"]`)
  const locate = async label => { await page.getByRole('button', { name: '定位画布节点', exact: true }).click(); await page.getByRole('menuitem', { name: label, exact: true }).click() }
  const layoutAction = async label => { await page.getByRole('button', { name: '布局', exact: true }).click(); await page.getByRole('menuitem', { name: label, exact: true }).click() }
  const snapshot = () => page.evaluate(() => ({ transform: document.querySelector('.director-canvas-content').style.transform,
    positions: Object.fromEntries([...document.querySelectorAll('.director-canvas-object')].map(card => [card.dataset.canvasNode, { x: card.offsetLeft, y: card.offsetTop }])) }))
  const assertGeometry = async () => {
    const result = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.director-canvas-object')].map(card => ({ id: card.dataset.canvasNode, x: card.offsetLeft, y: card.offsetTop, w: card.offsetWidth, h: card.offsetHeight }))
      const overlaps = cards.flatMap((a, i) => cards.slice(i + 1).filter(b => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y).map(b => [a.id, b.id]))
      const criteria = cards.filter(card => card.id.startsWith('criterion:'))
      const paths = [...document.querySelectorAll('.director-canvas-relations .canvas-edge-line')]
      return { overlaps, curves: paths.every(path => path.getAttribute('d').includes(' C')), columns: new Set(criteria.map(card => card.x)).size, rows: new Set(criteria.map(card => card.y)).size, lines: paths.length }
    })
    assert.deepEqual(result.overlaps, [])
    assert.equal(result.curves, true)
    assert.ok(result.lines >= 5)
    return result
  }
  await page.locator('[data-layout-view="outer:all"]').waitFor()
  await page.locator('[data-layout-group="criterion"]').waitFor()
  assert.equal(await page.locator('[data-canvas-node^="domain:"]').count(), 7)
  assert.equal((await assertGeometry()).columns, 3)
  await locate(await node('criterion:criterion1').locator('h2').innerText())
  const handle = node('criterion:criterion1').getByRole('button', { name: /^移动布局/ })
  await handle.focus(); await handle.press('ArrowRight')
  const moved = await snapshot()
  await directorSelect(page, '查看范围', '当前镜头')
  await page.locator('[data-layout-view="outer:shot:shot1"]').waitFor()
  await directorSelect(page, '查看范围', '整场')
  assert.deepEqual(await snapshot(), moved)
  await page.goBack()
  await page.locator('[data-layout-view="outer:shot:shot1"]').waitFor()
  await page.goForward()
  await page.locator('[data-layout-view="outer:all"]').waitFor()
  assert.deepEqual(await snapshot(), moved)
  await locate('表演指导')
  const beforeDomain = await snapshot()
  await node('domain:performance').getByRole('button', { name: '进入表演指导' }).click()
  await page.locator('[data-layout-view="performance:all"]').waitFor()
  await node('performance:beat1:person1').waitFor()
  assert.equal(await node('criterion:criterion1').getByRole('button', { name: '编辑此卡' }).count(), 0)
  await page.getByRole('button', { name: '返回上一处' }).click()
  await page.locator('[data-layout-view="outer:all"]').waitFor()
  assert.deepEqual(await snapshot(), beforeDomain)
  const projected = page.locator('[data-relation-from="domain:performance"][data-relation-to="participant:person1"]')
  assert.ok(await projected.count() > 0)
  const parallel = page.locator('[data-relation-from="domain:direction"][data-relation-to="participant:person1"]')
  assert.ok(await parallel.count() > 1)
  assert.equal(new Set(await parallel.locator('.canvas-edge-line').evaluateAll(rows => rows.map(row => row.getAttribute('d')))).size, await parallel.count())
  await projected.getByRole('button', { name: /表演人物/ }).focus()
  await projected.getByRole('button', { name: /表演人物/ }).press('Enter')
  assert.match(await page.getByRole('complementary', { name: '关系来源' }).innerText(), /表演.*participant_id/s)
  await page.getByRole('button', { name: '关闭详情' }).click()
  const beforeReload = await snapshot()
  await page.reload()
  await page.locator('[data-layout-view="outer:all"]').waitFor()
  await page.locator('[data-layout-group="criterion"]').waitFor()
  assert.deepEqual(await snapshot(), beforeReload)
  await page.setViewportSize({ width: 390, height: 844 })
  await layoutAction('重新整理布局')
  assert.equal((await assertGeometry()).columns, 1)
  await locate(await node('criterion:criterion5').locator('h2').innerText())
  await node('criterion:criterion5').getByRole('button', { name: '编辑此卡' }).click()
  const input = await page.locator('.canvas-quick-editor').getByRole('textbox', { name: '验收要求', exact: true }).boundingBox()
  assert.ok(input.x >= 0 && input.x + input.width <= 390)
  await screenshot('domains-390px.png')
  await page.getByRole('button', { name: '关闭编辑区' }).click()
  const narrow = await snapshot()
  await page.setViewportSize({ width: 1440, height: 960 })
  assert.deepEqual(await snapshot(), narrow, 'resizing does not rearrange existing cards')
  await layoutAction('重新整理布局')
  assert.equal((await assertGeometry()).columns, 3)
  await layoutAction('撤销本次整理')
  assert.deepEqual(await snapshot(), narrow)
  await layoutAction('重新整理布局')
  assert.deepEqual((await (await fetch(`${versions}/${version.id}`)).json()).data.content, version.content, 'layout and browsing do not change business content')
  await directorSelect(page, '设计域', '镜内执行')
  await page.locator('[data-layout-view="staging:all"]').waitFor()
  const activityIds = await page.locator('[data-canvas-node^="activity:"]').evaluateAll(rows => rows.map(row => row.dataset.canvasNode))
  assert.equal(activityIds.length, 2)
  const duplicate = structuredClone(version.content)
  duplicate.design.staging.activities[1] = structuredClone(duplicate.design.staging.activities[0])
  version = await request(`${versions}/${version.id}`, { request_id: crypto.randomUUID(), expected_revision: version.revision, content: duplicate }, 'PUT')
  await page.reload()
  await page.locator('[data-layout-view="staging:all"]').waitFor()
  await page.getByText('原对象不可用，请重新选择', { exact: true }).waitFor()
  assert.equal(await page.evaluate(ids => Object.entries(localStorage).filter(([key]) => key.includes('director-domains:') && key.includes(':view:')).some(([, value]) => Object.keys(JSON.parse(value).positions).some(id => ids.includes(id) || id.includes(':ambiguous:'))), activityIds), false)
  await locate(await node('activity:ambiguous:0').locator('h2').innerText())
  await node('activity:ambiguous:0').getByRole('button', { name: '编辑此卡' }).click()
  await page.getByRole('textbox', { name: '持续任务', exact: true }).fill('明确编辑第一项重复工作单')
  assert.match(await page.locator('[data-canvas-node^="activity:"]').filter({ hasText: '明确编辑第一项重复工作单' }).innerText(), /明确编辑第一项重复工作单/)
  await page.getByRole('button', { name: '关闭编辑区', exact: true }).click()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  const fresh = await request(versions, { request_id: crypto.randomUUID(), title: '新的布局版本' })
  const freshSaved = await request(`${versions}/${fresh.id}`, { request_id: crypto.randomUUID(), expected_revision: fresh.revision, content: version.content }, 'PUT')
  await page.goto(`http://127.0.0.1:4198/projects/canvas-project/chapters/canvas-chapter/sequences/${sequence}?version=${fresh.id}`)
  await page.locator('[data-layout-view="outer:all"]').waitFor()
  await page.locator('[data-layout-group="criterion"]').waitFor()
  assert.equal(await page.getByText('原对象不可用，请重新选择', { exact: true }).count(), 0)
  assert.equal((await assertGeometry()).columns, 3)
  const retained = (await snapshot()).positions['criterion:criterion1']
  const dense = structuredClone(freshSaved.content)
  for (let i = 6; i <= 30; i++) dense.design.criteria.push({ id: `criterion${i}`, requirement: note(`密集布局验收要求 ${i}`) })
  dense.design.direction.shots.forEach(shot => { shot.criterion_ids = dense.design.criteria.map(row => row.id) })
  const denseSaved = await request(`${versions}/${fresh.id}`, { request_id: crypto.randomUUID(), expected_revision: freshSaved.revision, content: dense }, 'PUT')
  await page.reload()
  await page.waitForFunction(() => document.querySelectorAll('[data-canvas-node^="criterion:"]').length === 30)
  assert.deepEqual((await snapshot()).positions['criterion:criterion1'], retained)
  await assertGeometry()
  await locate(await node('criterion:criterion30').locator('h2').innerText())
  await screenshot('domains-dense.png')
  const deleted = structuredClone(denseSaved.content)
  deleted.design.direction.shots = deleted.design.direction.shots.filter(shot => shot.id !== 'shot1')
  deleted.design.cinematography = deleted.design.cinematography.filter(row => row.shot_id !== 'shot1')
  await request(`${versions}/${fresh.id}`, { request_id: crypto.randomUUID(), expected_revision: denseSaved.revision, content: deleted }, 'PUT')
  await page.reload()
  await page.locator('[data-layout-view="outer:all"]').waitFor()
  await page.getByText('原镜头不可用，请重新选择镜头', { exact: true }).waitFor()
  await (await workbenchShot(page, '镜头 1：望向门口')).click()
  assert.equal(await page.getByText('原镜头不可用，请重新选择镜头', { exact: true }).count(), 0)
  assert.deepEqual(errors, [])
  console.log(`PASS seven-domain geometry, provenance, per-scope viewport/history, reload, narrow rearrange/undo, ambiguous identity, version isolation and dense graph; evidence: ${output}`)
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png'), animations: 'disabled' }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close(); await server?.close(); backend.kill('SIGTERM')
}
