import { locateCanvasNode } from './workbenchControls.mjs'
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
const api = 'http://127.0.0.1:8244'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.directing.scene_version_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8244', SCENE_BROWSER_TEST_LEGACY_TAKE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let backendOutput = ''
backend.stdout.on('data', data => { backendOutput += data })
backend.stderr.on('data', data => { backendOutput += data })
let server, browser, page
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4244, strictPort: true, open: false, proxy: { '/api': api } } })
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
  const note = text => ({ state: 'proposal', text, sources: [{ kind: 'human', reference: 'library-browser', version: '1' }] })
  content.design.direction.shots = [{ id: 'shot', event_ids: [], blocking_state_ids: [], criterion_ids: [], narrative_function: {}, visible_result: note('开门') }]
  content.units = [{ id: 'unit', ratio: '16:9', coverage: [{ id: 'action', shot_id: 'shot', action_scope: '完整开门' }] }]
  const source = library[0]
  content.take_judgments = [{ take_kind: source.take_kind, take_id: source.take_id, file_id: source.file_id, annotation: {
    review_status: 'reviewed', verdict: 'retain', rationale: note('只保留起手'), retained_ranges: [{ source_in_ms: 0, source_out_ms: 1000 }],
    coverage: [{ id: 'observed', unit_id: 'unit', coverage_item_id: 'action', observation: '手碰到门，尚未完整开门',
      media_range: { source_in_ms: 100, source_out_ms: 700 }, source: { kind: 'file', reference: source.take_id, version: source.file_id, file_id: source.file_id, media_range: { source_in_ms: 100, source_out_ms: 700 } } }],
  } }]
  content.timeline.items = [{ kind: 'media', id: 'first', take_kind: source.take_kind, take_id: source.take_id, file_id: source.file_id, media_range: { source_in_ms: 0, source_out_ms: 1800 }, timeline_start_ms: 0, fit: 'contain' }]
  const detail = `${versionsUrl}/${version.id}`
  const put = await fetch(detail, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: 1, content }) })
  assert.equal(put.status, 200, await put.clone().text())
  let saved = (await put.json()).data
  // 中间旧记录不属于 graph 最新摘要，仍须能经 Tab 阅读。
  for (const rationale of ['旧历史审查', '只保留起手']) {
    const next = structuredClone(saved.content)
    next.take_judgments[0].annotation.rationale = note(rationale)
    const response = await fetch(detail, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: saved.revision, content: next }) })
    assert.equal(response.status, 200, await response.clone().text())
    saved = (await response.json()).data
  }
  let signature = 0
  await page.route('**/take-library', async route => {
    const response = await route.fetch()
    const payload = await response.json()
    for (const row of payload.data) if (row.media_url) row.media_url += `?signature=${++signature}`
    await route.fulfill({ response, json: payload })
  })
  await page.route('**/versions*', async route => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    const payload = await response.json()
    const rows = Array.isArray(payload.data) ? payload.data : [payload.data]
    for (const row of rows) if (row?.edit_graph) remapCanvasGraph(row.edit_graph, opaqueCanvasAddresses(row.edit_graph))
    await route.fulfill({ response, json: payload })
  })
  await page.goto(`http://127.0.0.1:4244/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  await page.getByRole('button', { name: '浏览同场素材图', exact: true }).click()
  const graph = page.getByLabel('同场素材画布视口', { exact: true })
  await graph.getByRole('button', { name: '定位实际覆盖', exact: true }).waitFor()
  assert.equal(await graph.locator('[data-canvas-node]').count(), 2)
  assert.equal(await page.locator('video').count(), 0)
  await page.screenshot({ path: join(output, 'take-library-desktop.png'), fullPage: true })
  await graph.getByRole('button', { name: '定位源素材', exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.activeElement?.id === 'scene-current-take')
  await page.getByRole('button', { name: '预览当前素材', exact: true }).click()
  const video = page.getByLabel('当前素材视频', { exact: true })
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2)
  await video.evaluate(node => { node.currentTime = .6; node.playbackRate = .0625 })
  await video.evaluate(node => node.play())
  const originalVideo = await video.elementHandle()
  const originalUrl = await video.getAttribute('src')
  const beforeTime = await video.evaluate(node => node.currentTime)
  const added = await fetch(`${api}/browser-test/legacy-takes/${source.take_id}/candidate`, { method: 'POST' })
  assert.equal(added.status, 200, await added.clone().text())
  const newTake = (await added.json()).take_id
  await locateCanvasNode(page, '方案判断')
  const rationale = page.getByRole('textbox', { name: '素材审查说明', exact: true })
  await rationale.fill('保留尚未保存的判断')
  const observation = page.getByRole('textbox', { name: '实际覆盖观察', exact: true })
  await observation.fill('尚未记录的覆盖输入')
  await page.getByRole('button', { name: '刷新图证据', exact: true }).click()
  await page.getByRole('button', { name: '选择素材 2', exact: true }).waitFor()
  assert.equal(await video.evaluate((node, original) => node === original, originalVideo), true)
  assert.equal(await video.getAttribute('src'), originalUrl)
  assert.equal(await video.evaluate(node => node.paused), false)
  assert.ok(await video.evaluate(node => node.currentTime) >= beforeTime)
  assert.equal(await rationale.inputValue(), '保留尚未保存的判断')
  assert.equal(await observation.inputValue(), '尚未记录的覆盖输入')
  const refreshed = (await (await fetch(detail)).json()).data
  assert.equal(refreshed.revision, saved.revision)
  assert.deepEqual(refreshed.content, saved.content)
  assert.ok(refreshed.edit_graph.nodes.some(node => node.kind === 'edit_take' && node.take_id === newTake))
  await video.evaluate(node => node.pause())
  await page.getByRole('button', { name: '浏览同场素材图', exact: true }).click()
  assert.equal(await graph.locator('[data-canvas-node]').count(), 3)
  await graph.getByRole('button', { name: '定位实际覆盖', exact: true }).click()
  await page.waitForFunction(() => document.activeElement?.id === 'scene-actual-coverage-observed')
  assert.equal(await observation.inputValue(), '尚未记录的覆盖输入')
  await locateCanvasNode(page, '时间线')
  await page.getByRole('button', { name: '编辑片段 1', exact: true }).click()
  const out = page.getByRole('spinbutton', { name: '片段源出点毫秒', exact: true })
  await out.fill('1600')
  await page.getByRole('button', { name: '播放整场时间线', exact: true }).click()
  const timeline = page.getByLabel('时间线媒体', { exact: true })
  await timeline.waitFor()
  await timeline.evaluate(node => { node.playbackRate = .0625 })
  await page.getByRole('button', { name: '暂停时间线', exact: true }).click()
  await timeline.evaluate(node => { node.currentTime = .7 })
  const timelineHandle = await timeline.elementHandle()
  const timelineUrl = await timeline.getAttribute('src')
  await page.getByRole('button', { name: '刷新图证据', exact: true }).click()
  await delay(600)
  assert.equal(await timeline.evaluate((node, original) => node === original, timelineHandle), true)
  assert.equal(await timeline.getAttribute('src'), timelineUrl)
  assert.equal(await timeline.evaluate(node => node.paused), true)
  assert.ok(Math.abs(await timeline.evaluate(node => node.currentTime) - .7) < .1)
  assert.equal(await out.inputValue(), '1600')
  await page.route('**/versions/' + version.id, route => route.request().method() === 'GET' ? route.abort() : route.continue())
  await page.getByRole('button', { name: '刷新图证据', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '图证据读取失败' }).waitFor()
  assert.equal(await out.inputValue(), '1600')
  await page.unroute('**/versions/' + version.id)
  await page.getByRole('button', { name: '刷新图证据', exact: true }).click()
  await delay(400)
  await page.getByRole('button', { name: '浏览同场素材图', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: join(output, 'take-library-narrow.png'), fullPage: true })
  await graph.getByRole('button', { name: '定位当前覆盖目标', exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.activeElement?.id === 'scene-unit-action-action')
  assert.equal(await page.getByRole('textbox', { name: '单元动作范围', exact: true }).inputValue(), '完整开门')
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  if (!await graph.isVisible()) await page.getByRole('button', { name: '浏览同场素材图', exact: true }).click()
  await graph.getByRole('button', { name: '查看原复核记录', exact: true }).click()
  await page.locator('details[id^="scene-take-review-"][open]').waitFor()
  await locateCanvasNode(page, '方案判断')
  const oldRecord = page.getByText('查看审片记录 2', { exact: true })
  await oldRecord.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  assert.equal(await oldRecord.evaluate(node => node === document.activeElement), true, '旧历史入口保留在Tab顺序')
  await page.keyboard.press('Enter')
  assert.equal(await oldRecord.evaluate(node => node.closest('details').open), true)
  await page.getByRole('button', { name: '删除覆盖 1', exact: true }).click()
  await page.getByRole('button', { name: '浏览同场素材图', exact: true }).click()
  await graph.getByRole('button', { name: '定位实际覆盖', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '原覆盖目标在当前编辑中已不可用' }).waitFor()
  assert.equal(await graph.isVisible(), true)
  console.log(`PASS all-candidate library, immutable provenance, actual coverage, same-revision refresh, active/paused playback and drafts; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
