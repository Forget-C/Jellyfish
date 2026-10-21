import { workbenchControl, selectWorkbenchOption } from './workbenchControls.mjs'
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
const api = 'http://127.0.0.1:8246'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.directing.scene_version_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8246', SCENE_BROWSER_TEST_LEGACY_TAKE: '1' },
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4246, strictPort: true, open: false, proxy: { '/api': api } } })
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
    { kind: 'media', id: 'second', take_kind: 'production_plan', take_id: library[0].take_id, file_id: library[0].file_id, media_range: { source_in_ms: 900, source_out_ms: 1700 }, timeline_start_ms: 700, fit: 'cover' },
    { kind: 'planned', id: 'planned', shot_id: 'shot', estimated_duration_ms: 900, timeline_start_ms: 4000 },
  ]
  content.timeline.items.push(...Array.from({ length: 12 }, (_, index) => ({ kind: 'planned', id: `long-${index}`, shot_id: 'shot', estimated_duration_ms: 500, timeline_start_ms: 5000 + index * 1000 })))
  content.units = [{ id: 'precise-downstream', ratio: '16:9', coverage: [{ id: 'coverage', shot_id: 'shot' }] }]
  const detail = `${versionsUrl}/${version.id}`
  const put = await fetch(detail, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: 1, content }) })
  assert.equal(put.status, 200, await put.clone().text())
  const saved = (await put.json()).data
  const frameResponse = await fetch(detail + '/end-frames', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: saved.revision, clip_id: 'first' }) })
  assert.equal(frameResponse.status, 200, await frameResponse.clone().text())
  const frame = (await frameResponse.json()).data
  const bound = structuredClone(saved.content)
  bound.units[0].references = [{ id: 'fixed-reference', file_id: frame.file_id, media_kind: 'image', purpose: 'continuity', participant_ids: [], ordinal: 0, source: frame.source }]
  bound.units[0].scene_dependencies = [{ version_id: version.id, clip_id: 'first', frame_id: frame.id, reference_id: 'fixed-reference' }]
  const bindResponse = await fetch(detail, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: saved.revision, content: bound }) })
  assert.equal(bindResponse.status, 200, await bindResponse.clone().text())
  const baseline = (await bindResponse.json()).data
  const decision = { verdict: 'revise', overall: '固定整场观察', established: '落幅保持', coverage_status: 'gaps', coverage_notes: '占位尚未拍摄', sound_status: 'pending_postproduction', sound_notes: '', issues: [{ id: 'multi-target', severity: 'required', observation: '两个采用共同影响后段', acceptance: '明确换绑并重新核对', clip_ids: ['first', 'second'] }] }
  const posted = await fetch(detail + '/cut-reviews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: baseline.revision, decision }) })
  assert.equal(posted.status, 200, await posted.clone().text())
  const record = (await posted.json()).data
  let posts = 0
  const historyReads = { cut: 0, seam: 0, frame: 0 }
  page.on('request', request => {
    if (request.method() !== 'GET') return
    if (request.url().endsWith('/cut-reviews')) historyReads.cut++
    if (request.url().endsWith('/seam-reviews')) historyReads.seam++
    if (request.url().endsWith('/end-frames')) historyReads.frame++
  })
  await page.route('**/*', route => { if (route.request().method() === 'POST' && /\/(cut-reviews|end-frames|seam-reviews|take-reviews|exports)(\?|$)/.test(route.request().url())) posts++; return route.continue() })
  await page.route('**/versions*', async route => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    const payload = await response.json()
    for (const row of Array.isArray(payload.data) ? payload.data : [payload.data]) if (row?.edit_graph) remapCanvasGraph(row.edit_graph, opaqueCanvasAddresses(row.edit_graph))
    await route.fulfill({ response, json: payload })
  })
  await page.goto(`http://127.0.0.1:4246/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  const graph = page.getByLabel('整场剪辑画布视口', { exact: true })
  await graph.waitFor()
  await delay(300)
  assert.deepEqual(historyReads, { cut: 0, seam: 0, frame: 0 }, '默认总览不读取完整历史')
  const cut = graph.locator('[data-canvas-node]').filter({ hasText: '整场验收' }).filter({ has: page.getByRole('button', { name: '查看原整场验收', exact: true }) })
  await cut.getByRole('combobox', { name: '问题片段定位', exact: true }).waitFor()
  assert.ok(await cut.evaluate(node => node.getBoundingClientRect().height < 600), '大量问题不使卡片无限增长')
  for (const id of ['first', 'second']) {
    await selectWorkbenchOption(page, '问题片段定位', `定位问题片段 ${id}`)
    await page.waitForFunction(id => document.activeElement?.id === `scene-clip-${id}`, id)
    await page.getByRole('button', { name: '浏览整场剪辑', exact: true }).click()
  }

  await cut.getByRole('button', { name: '查看原整场验收', exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.locator(`[id="scene-cut-review-${record.id}"]`).waitFor({ state: 'visible' })
  assert.ok(historyReads.cut > 0, '明确原记录动作才读取完整历史')
  assert.equal(historyReads.seam, 0)
  assert.equal(historyReads.frame, 0)
  await page.getByLabel('整场画面判断', { exact: true }).fill('保留中的未提交验收输入')
  const input = await page.getByLabel('整场画面判断', { exact: true }).elementHandle()
  const newerDecision = structuredClone(decision)
  newerDecision.overall = '同 revision 的新整场问题摘要'
  newerDecision.issues = Array.from({ length: 40 }, (_, index) => ({ ...decision.issues[0], id: `issue-${index}`, observation: '长观察'.repeat(200), acceptance: '完整验收'.repeat(100) }))
  const newer = await fetch(detail + '/cut-reviews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: baseline.revision, decision: newerDecision }) })
  assert.equal(newer.status, 200, await newer.clone().text())
  const beforeRefresh = { ...historyReads }
  await page.getByRole('button', { name: '刷新图证据', exact: true }).click()
  await graph.getByText(/同 revision 的新整场问题摘要/).waitFor({ state: 'attached' })
  await delay(300)
  assert.deepEqual(historyReads, beforeRefresh, 'graph证据刷新不得重新获取完整历史')
  assert.equal(await page.getByLabel('整场画面判断', { exact: true }).inputValue(), '保留中的未提交验收输入')
  assert.equal(await page.getByLabel('整场画面判断', { exact: true }).evaluate((node, old) => node === old, input), true)
  await page.getByRole('button', { name: '浏览整场剪辑', exact: true }).click()
  assert.ok(await cut.evaluate(node => node.getBoundingClientRect().height < 600), '大量问题仍保持有限卡片尺寸')
  assert.equal(await cut.evaluate(node => {
    const card = node.getBoundingClientRect()
    return [...node.querySelectorAll('button, [role="combobox"]')].every(control => {
      const rect = control.getBoundingClientRect()
      return rect.top >= card.top && rect.bottom <= card.bottom && rect.right <= card.right
    })
  }), true, '有限卡片保留全部明确操作，内容不靠卡内滚动才能操作')

  // 新页面直接恢复图布局，避免 Chrome 在已隐藏菜单上保留旧合成层；不改 DOM 或截图样式。
  await page.reload()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  const frameCard = async () => {
    await graph.evaluate(node => node.focus({ preventScroll: true }))
    const rect = await cut.boundingBox()
    const viewport = await graph.boundingBox()
    const dx = Math.round(((viewport.width - rect.width) / 2 - rect.x) / 30)
    const dy = Math.round((viewport.y + 16 - rect.y) / 30)
    for (let i = 0; i < Math.abs(dx); i++) await page.keyboard.press(dx > 0 ? 'ArrowLeft' : 'ArrowRight')
    for (let i = 0; i < Math.abs(dy); i++) await page.keyboard.press(dy > 0 ? 'ArrowUp' : 'ArrowDown')
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  }
  await frameCard()
  await page.screenshot({ path: join(output, 'cut-evidence-desktop.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '缩小画布', exact: true }).click()
  await page.getByRole('button', { name: '缩小画布', exact: true }).click()
  await frameCard()
  await page.screenshot({ path: join(output, 'cut-evidence-narrow.png'), animations: 'disabled' })
  await cut.getByRole('button', { name: '查看原整场验收', exact: true }).focus()
  await page.keyboard.press('Enter')
  assert.equal(await page.getByLabel('整场画面判断', { exact: true }).inputValue(), '保留中的未提交验收输入')
  await page.getByRole('button', { name: '浏览整场剪辑', exact: true }).click()
  await graph.getByRole('button', { name: '查看原实际落幅', exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.locator(`[id="scene-end-frame-${frame.id}"]`).waitFor({ state: 'visible' })
  await page.getByRole('button', { name: '浏览整场剪辑', exact: true }).click()
  const downstream = graph.locator('[data-canvas-node]').filter({ hasText: 'precise-downstream' }).filter({ has: page.getByRole('button', { name: '定位后段单元', exact: true }) })
  await downstream.getByRole('button', { name: '定位后段单元', exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('combobox', { name: '当前单元', exact: true }).waitFor()
  assert.equal((await (await fetch(detail)).json()).data.revision, baseline.revision)
  assert.equal(posts, 0)
  console.log(`PASS cut/frame/downstream opaque targets, multi-clip issues, same-revision refresh and retained draft, keyboard/narrow; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: false }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
