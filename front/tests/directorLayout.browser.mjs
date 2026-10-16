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
  await page.addInitScript(({ sequence, version }) => {
    window.__ENV = { BACKEND_URL: window.location.origin }
    localStorage.setItem('jellyfish:scene-autosave:local-user', 'off')
    localStorage.setItem(`jellyfish:director-shots:local-user:canvas-project:${sequence}:${version}:view:overview`, JSON.stringify({ schema: 1, layoutVersion: 2,
      transform: { x: 566, y: -72, scale: .4 }, positions: { '原文依据': { x: 0, y: 336 }, 'shot:shot1': { x: 0, y: 1604 }, 'shot:shot2': { x: 424, y: 1604 } },
      sizes: { '原文依据': { width: 360, height: 240 }, 'shot:shot1': { width: 360, height: 276 }, 'shot:shot2': { width: 360, height: 276 } } }))
  }, { sequence, version: version.id })
  await page.goto(`http://127.0.0.1:4198/projects/canvas-project/chapters/canvas-chapter/sequences/${sequence}?version=${version.id}`)
  const surface = page.getByLabel('导演画布视口', { exact: true })
  const node = id => page.locator(`[data-canvas-node="${id}"]`)
  const locate = async label => { await page.getByRole('button', { name: '定位画布节点', exact: true }).click(); await page.getByRole('menuitem', { name: label, exact: true }).click() }
  const layoutAction = async label => { await page.getByRole('button', { name: '布局', exact: true }).click(); await page.getByRole('menuitem', { name: label, exact: true }).click() }
  const settled = () => page.waitForFunction(() => document.querySelector('[data-layout-view]')?.getAttribute('aria-busy') !== 'true')
  const snapshot = async () => {
    await settled()
    return page.evaluate(() => ({ transform: document.querySelector('.director-canvas-content').style.transform,
      positions: Object.fromEntries([...document.querySelectorAll('.director-canvas-object')].map(card => [card.dataset.canvasNode, { x: card.offsetLeft, y: card.offsetTop }])) }))
  }
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
  await page.locator('[data-layout-view="overview"]').waitFor()
  const noOverlaps = async () => {
    await settled()
    const pairs = await page.locator('.director-canvas-object').evaluateAll(cards => {
      const boxes = cards.map(card => ({ id: card.dataset.canvasNode, x: card.offsetLeft, y: card.offsetTop, width: card.offsetWidth, height: card.offsetHeight }))
      return boxes.flatMap((a, index) => boxes.slice(index + 1).filter(b => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y).map(b => [a.id, b.id]))
    })
    assert.deepEqual(pairs, [])
  }
  await noOverlaps()
  await screenshot('overview-1440.png')
  await node('shot:shot1').waitFor()
  assert.equal(await page.locator('[data-layout-group="scene-shots"]').count(), 0)
  const overviewPositions = (await snapshot()).positions
  assert.ok(overviewPositions['shot:shot1'].x > overviewPositions['原文依据'].x)
  assert.ok(overviewPositions['shot:shot2'].y > overviewPositions['原文依据'].y)
  assert.equal(overviewPositions['原文依据'].y, 0)
  await page.waitForFunction(({ sequence, version }) => {
    const saved = JSON.parse(localStorage.getItem(`jellyfish:director-shots:local-user:canvas-project:${sequence}:${version}:view:overview`) || 'null')
    return saved?.layoutVersion === 4 && saved.positions['shot:shot2'].y > saved.positions['原文依据'].y && saved.transform.y >= 64
  }, { sequence, version: version.id })
  assert.equal(await page.locator('[data-canvas-node^="domain:"]').count(), 0)
  assert.equal(await node('beat:beat1').count(), 1, 'shared beat has one original in overview')
  assert.equal(await page.locator('[data-canvas-node^="camera:"]').count(), 0, 'single-shot work belongs in its shot subgraph')
  assert.ok(await node('shot:shot1').locator('.director-subgraph-preview rect').count() > 1)
  await node('shot:shot1').getByRole('button', { name: /进入子图/ }).click()
  await page.locator('[data-layout-view="shot:shot1"]').waitFor()
  assert.ok(await page.locator('[data-canvas-node^="camera:"]').count() > 0)
  await noOverlaps()
  await screenshot('shot-1440.png')
  assert.equal(await node('beat:beat1').count(), 1)
  assert.match(await node('beat:beat1').innerText(), /共享引用/)
  await node('beat:beat1').getByRole('button', { name: '定位共享原卡' }).click()
  await page.locator('[data-layout-view="overview"]').waitFor()
  assert.equal(await node('beat:beat1').count(), 1)
  await page.getByRole('button', { name: '返回上一处' }).click()
  await page.locator('[data-layout-view="shot:shot1"]').waitFor()
  await page.getByRole('button', { name: '场次总览' }).click()
  await page.locator('[data-layout-view="overview"]').waitFor()
  const beforeUnlinked = await page.locator('[data-canvas-node^="activity:"]').count()
  await page.getByRole('button', { name: /展开未关联设计/ }).click()
  assert.ok(await page.locator('[data-canvas-node^="activity:"]').count() > beforeUnlinked)
  await page.getByRole('button', { name: /收起未关联设计/ }).click()
  assert.equal(await page.locator('[data-canvas-node^="activity:"]').count(), beforeUnlinked)
  await page.goto(`http://127.0.0.1:4198/projects/canvas-project/chapters/canvas-chapter/sequences/${sequence}?version=${version.id}&directorView=shot&directorScope=shot&directorShot=shot1&directorTarget=beat:beat1`)
  await page.locator('[data-layout-view="overview"]').waitFor()
  assert.equal(new URL(page.url()).searchParams.get('directorTarget'), 'beat:beat1')
  await page.setViewportSize({ width: 390, height: 844 })
  await layoutAction('重新整理布局')
  await noOverlaps()
  await screenshot('overview-390.png')
  assert.deepEqual(errors, [])
  console.log(`PASS shot grouping navigation, shared reference, preview and unlinked section; evidence: ${output}`)
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png'), animations: 'disabled' }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close(); await server?.close(); backend.kill('SIGTERM')
}
