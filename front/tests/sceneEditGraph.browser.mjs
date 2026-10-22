import { workbenchControl } from './workbenchControls.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'

import { opaqueCanvasAddresses, remapCanvasGraph } from './canvas-graph-fixtures.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await mkdtemp(join(tmpdir(), 'jellyfish-scene-version-'))
const api = 'http://127.0.0.1:8243'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.directing.scene_version_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8243', SCENE_BROWSER_TEST_LEGACY_TAKE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let backendOutput = ''
backend.stdout.on('data', data => { backendOutput += data })
backend.stderr.on('data', data => { backendOutput += data })
let server, browser, page
let missingEditGraph = false
try {
  let chapter
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null) throw new Error(backendOutput)
    try {
      const response = await fetch(`${api}/api/v1/studio/projects/canvas-project/directing/chapters/canvas-chapter`)
      if (response.ok) { chapter = (await response.json()).data; break }
    } catch { /* The dedicated test server is still starting. */ }
    await delay(250)
  }
  assert.ok(chapter, `test backend did not become ready: ${backendOutput}`)
  const sequenceId = chapter.sequences[0].id
  const versionsUrl = `${api}/api/v1/studio/projects/canvas-project/directing/sequences/${sequenceId}/versions`
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4243, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  page = await context.newPage()
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin }; localStorage.setItem('jellyfish:scene-autosave:local-user', 'off') })
  const create = await fetch(versionsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), title: '覆盖编辑验收' }) })
  assert.equal(create.status, 200)
  const version = (await create.json()).data
  const sceneUrl = `${api}/api/v1/studio/projects/canvas-project/directing/sequences/${sequenceId}`
  const originalTakes = (await (await fetch(sceneUrl)).json()).data.takes
  assert.equal(originalTakes.length, 1)
  const library = (await (await fetch(`${versionsUrl}/${version.id}/take-library`)).json()).data
  assert.equal(library.length, 1)
  assert.equal(library[0].take_kind, 'production_plan')
  assert.equal(library[0].file_id, 'legacy-take-file')
  assert.equal(library[0].task_id, 'legacy-video-task')
  assert.equal(library[0].prompt.text, '旧生产计划的固定拍摄指令')
  const content = structuredClone(version.content)
  content.design.direction.shots = [{ id: 'shot', event_ids: [], blocking_state_ids: [], criterion_ids: [], narrative_function: {}, visible_result: { state: 'proposal', text: '开门', sources: [{ kind: 'human', reference: 'fixture', version: '1' }] } }]
  content.timeline.items = [
    { kind: 'media', id: 'first', take_kind: 'production_plan', take_id: library[0].take_id, file_id: library[0].file_id, media_range: { source_in_ms: 0, source_out_ms: 700 }, timeline_start_ms: 0, fit: 'contain' },
    { kind: 'media', id: 'second', take_kind: 'production_plan', take_id: library[0].take_id, file_id: library[0].file_id, media_range: { source_in_ms: 900, source_out_ms: 1700 }, timeline_start_ms: 2000, fit: 'cover' },
    { kind: 'planned', id: 'planned', shot_id: 'shot', estimated_duration_ms: 900, timeline_start_ms: 4000 },
  ]
  content.timeline.items.push(...Array.from({ length: 12 }, (_, index) => ({ kind: 'planned', id: `long-${index}`, shot_id: 'shot', estimated_duration_ms: 500, timeline_start_ms: 5000 + index * 1000 })))
  const detail = `${versionsUrl}/${version.id}`
  const put = await fetch(detail, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: 1, content }) })
  assert.equal(put.status, 200, await put.clone().text())
  const saved = (await put.json()).data
  await page.route(/\/versions(?:\/[^/?]+)?(?:\?.*)?$/, async route => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    const payload = await response.json()
    const rows = Array.isArray(payload.data) ? payload.data : [payload.data]
    for (const row of rows) {
      if (row?.edit_graph) remapCanvasGraph(row.edit_graph, opaqueCanvasAddresses(row.edit_graph))
      if (missingEditGraph && row) delete row.edit_graph
    }
    await route.fulfill({ response, json: payload })
  })
  await page.goto(`http://127.0.0.1:4243/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  const graph = page.getByLabel('整场剪辑画布视口', { exact: true })
  await graph.locator('[data-canvas-node="edit-node-2"]').waitFor()
  assert.equal(await graph.locator('[data-canvas-node]').count(), 16)
  assert.equal(await graph.locator('[data-relation-from]').count(), 2)
  await page.goBack()
  await page.waitForFunction(() => document.querySelector('.canvas-toolbar-views button[aria-pressed="true"]')?.textContent === '导演画布', undefined, { timeout: 4000 })
  assert.equal(new URL(page.url()).searchParams.has('canvas'), false)
  await page.goForward()
  await graph.waitFor({ state: 'visible' })
  await page.screenshot({ path: join(output, 'edit-graph-desktop.png'), fullPage: true })
  await page.getByRole('button', { name: '缩小画布', exact: true }).click()
  const sceneTransform = await graph.locator('.director-canvas-content').getAttribute('style')
  // 新视图是可返回/前进的浏览位置，不离开当前方案或产生业务写入。
  await page.getByRole('button', { name: '浏览同场素材图', exact: true }).click()
  const libraryGraph = page.getByLabel('同场素材画布视口', { exact: true })
  await libraryGraph.waitFor({ state: 'visible' })
  await page.goBack()
  await graph.waitFor({ state: 'visible', timeout: 4000 })
  assert.equal(await graph.locator('.director-canvas-content').getAttribute('style'), sceneTransform)
  await page.goForward()
  await libraryGraph.waitFor({ state: 'visible', timeout: 4000 })
  await page.getByRole('button', { name: '后退', exact: true }).click()
  await graph.waitFor({ state: 'visible' })
  await page.getByRole('button', { name: '前进', exact: true }).click()
  await libraryGraph.waitFor({ state: 'visible' })
  await libraryGraph.getByRole('button', { name: '定位源素材', exact: true }).first().click()
  const workspace = page.getByLabel('编辑画布视口', { exact: true })
  await workspace.waitFor({ state: 'visible' })
  await page.goBack()
  await libraryGraph.waitFor({ state: 'visible', timeout: 4000 })
  await page.goForward()
  await workspace.waitFor({ state: 'visible', timeout: 4000 })
  assert.equal(await page.locator('video').count(), 0)
  assert.equal((await (await fetch(detail)).json()).data.revision, saved.revision)
  await page.getByRole('button', { name: '浏览整场剪辑', exact: true }).click()
  await graph.waitFor({ state: 'visible' })
  await page.getByRole('button', { name: '定位画布节点', exact: true }).click()
  await page.getByRole('menuitem', { name: '片段 15 · 待拍占位', exact: true }).click()
  await page.getByRole('button', { name: '定位画布节点', exact: true }).click()
  await page.getByRole('menuitem', { name: '片段 2 · 真实媒体', exact: true }).click()
  const second = graph.locator('[data-canvas-node]').filter({ hasText: '片段 2 · 真实媒体' })
  await second.getByRole('button', { name: '定位时间线片段', exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '时间线片段 2')
  assert.equal(await page.getByRole('region', { name: '时间线片段 1', exact: true }).count(), 1)
  assert.equal(await page.getByRole('region', { name: '时间线片段 3', exact: true }).count(), 1)
  assert.equal(await page.locator('video').count(), 0)
  await page.getByRole('button', { name: '编辑片段 2', exact: true }).click()
  const out = page.getByRole('spinbutton', { name: '片段源出点毫秒', exact: true })
  assert.equal(await out.inputValue(), '1700')
  await out.fill('1600')
  const beforeBrowse = await out.elementHandle()
  await page.goBack()
  await graph.waitFor({ state: 'visible' })
  await page.goForward()
  await workspace.waitFor({ state: 'visible' })
  assert.equal(await out.inputValue(), '1600')
  assert.equal(await out.evaluate((node, original) => node === original, beforeBrowse), true)
  await page.getByRole('button', { name: '导演画布', exact: true }).click()
  await page.goBack()
  await workspace.waitFor({ state: 'visible', timeout: 4000 })
  assert.equal(await out.inputValue(), '1600')
  await page.goForward()
  await page.waitForFunction(() => document.querySelector('.canvas-toolbar-views button[aria-pressed="true"]')?.textContent === '导演画布')
  await page.goBack()
  await workspace.waitFor({ state: 'visible' })
  assert.equal(await out.inputValue(), '1600')
  assert.equal((await (await fetch(detail)).json()).data.revision, saved.revision)
  const originalInput = await out.elementHandle()
  await page.getByRole('button', { name: '刷新图证据', exact: true }).click()
  await delay(600)
  assert.equal(await out.inputValue(), '1600')
  assert.equal(await out.evaluate((node, original) => node === original, originalInput), true)
  await page.route('**/versions/' + version.id, route => route.request().method() === 'GET' ? route.abort() : route.continue())
  await page.getByRole('button', { name: '刷新图证据', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '图证据读取失败' }).waitFor()
  assert.equal(await out.inputValue(), '1600')
  await page.unroute('**/versions/' + version.id)
  await page.getByRole('button', { name: '刷新图证据', exact: true }).click()
  await page.getByRole('button', { name: '保存片段修改', exact: true }).click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  const changed = (await (await fetch(detail)).json()).data
  assert.equal(changed.content.timeline.items[1].media_range.source_out_ms, 1600)
  await page.getByRole('button', { name: '删除片段 2', exact: true }).click()
  await page.getByRole('button', { name: '浏览整场剪辑', exact: true }).click()
  await second.getByRole('button', { name: '定位时间线片段', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '在当前编辑中已不可用' }).waitFor()
  assert.equal(await graph.isVisible(), true)
  await (await workbenchControl(page, '编辑历史', 'button', '撤销')).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.screenshot({ path: join(output, 'edit-graph-narrow.png') })
  await second.getByRole('button', { name: '定位时间线片段', exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '时间线片段 2')
  await page.getByRole('button', { name: '编辑片段 2', exact: true }).click()
  await out.fill('1500')
  await page.getByRole('button', { name: '保存片段修改', exact: true }).click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  assert.equal((await (await fetch(detail)).json()).data.content.timeline.items[1].media_range.source_out_ms, 1500)
  await page.setViewportSize({ width: 1440, height: 960 })
  const emptyResponse = await fetch(versionsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), title: '空时间线' }) })
  assert.equal(emptyResponse.status, 200)
  const empty = (await emptyResponse.json()).data
  await page.goto(`http://127.0.0.1:4243/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${empty.id}`)
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  await page.getByText('时间线尚无片段。浏览同场次素材或打开剪辑工作区，明确采用素材或添加待拍占位。', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('整场剪辑画布视口', { exact: true }).locator('[data-canvas-node]').count(), 0)
  await page.getByRole('button', { name: '浏览同场次素材', exact: true }).click()
  await page.getByRole('button', { name: '选择素材 1', exact: true }).waitFor()
  assert.equal(await page.locator('video').count(), 0)
  assert.deepEqual((await (await fetch(`${versionsUrl}/${empty.id}`)).json()).data.content.timeline.items, [])
  missingEditGraph = true
  await page.goto(`http://127.0.0.1:4243/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${empty.id}&canvas=edit`)
  await page.getByRole('alert').filter({ hasText: '剪辑图与当前版本不一致' }).waitFor()
  await page.getByRole('button', { name: '打开剪辑工作区', exact: true }).click()
  await workspace.waitFor({ state: 'visible', timeout: 4000 })
  await page.getByRole('button', { name: '选择素材 1', exact: true }).waitFor()
  assert.deepEqual((await (await fetch(`${versionsUrl}/${empty.id}`)).json()).data.content.timeline.items, [])
  assert.equal(saved.edit_graph.nodes.filter(node => node.kind === 'edit_take').length, 1)
  console.log(`PASS edit graph opaque identities, repeated adoption, exact selection, saved editing and refresh stability; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
