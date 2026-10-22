import { opaqueCanvasAddresses, remapCanvasGraph } from './canvas-graph-fixtures.mjs'
import { workbenchControl } from './workbenchControls.mjs'
import { selectWorkbenchOption, workbenchShot } from './workbenchControls.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await mkdtemp(join(tmpdir(), 'jellyfish-scene-version-'))
const api = 'http://127.0.0.1:8247'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.directing.scene_version_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8247', SCENE_BROWSER_TEST_LEGACY_TAKE: '1' },
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
  server = await createServer({ root: process.env.CANVAS_TEST_ROOT || root, server: { host: '127.0.0.1', port: 4247, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  page = await context.newPage()
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const create = await fetch(versionsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), title: '覆盖编辑验收' }) })
  assert.equal(create.status, 200)
  const version = (await create.json()).data
  const content = version.content
  const assets = []
  for (const [kind, name] of [['character', '共享读信者'], ['scene', '共享书房']]) {
    const response = await fetch(`${api}/api/v1/studio/projects/canvas-project/directing/sequences/${sequenceId}/assets`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), kind, name }) })
    assert.equal(response.status, 200)
    assets.push((await response.json()).data)
  }
  const form = new FormData()
  form.append('file', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }), 'navigation.png')
  form.append('project_id', 'canvas-project'); form.append('usage_kind', 'reference')
  const upload = await fetch(`${api}/api/v1/studio/files/upload`, { method: 'POST', body: form })
  assert.equal(upload.status, 201, await upload.clone().text())
  const file = (await upload.json()).data
  const note = text => ({ state: 'proposal', text, sources: [{ kind: 'human', reference: 'navigation', version: '1' }] })
  const historicalWorkspace = (await (await fetch(`${api}/api/v1/studio/projects/canvas-project/directing/sequences/${sequenceId}`)).json()).data
  const historicalDesign = historicalWorkspace.designs[0]
  content.design.direction.viewpoint = note('从读信者视角观察')
  content.design.direction.viewpoint.sources = [{ kind: 'revision', reference: historicalDesign.id, version: String(historicalDesign.version) }]
  content.design.direction.location_asset_id = assets[1].id
  content.design.participants = [{ id: 'reader', name: '读信者', character_id: assets[0].id }]
  content.design.direction.shots = [{ id: 'A', beat_ids: [], event_ids: [], blocking_state_ids: [], participant_ids: ['reader'], criterion_ids: [], narrative_function: {}, visible_result: note('读信') }]
  content.units = [{ id: 'A1', ratio: '16:9', instruction: '长正文：保持人物动作、视线与空间连续。'.repeat(200), coverage: [{ id: 'coverage', shot_id: 'A', action_scope: '拆信' }], references: [{ id: 'reference', file_id: file.id, media_kind: 'image', purpose: 'identity', participant_ids: ['reader'], ordinal: 0, source: { kind: 'file', reference: file.id, version: '1', file_id: file.id } }] }]
  const take = (await (await fetch(`${versionsUrl}/${version.id}/take-library`)).json()).data[0]
  content.timeline.items = [0, 1].map(index => ({ kind: 'media', id: `clip:${index}`, take_kind: take.take_kind, take_id: take.take_id, file_id: take.file_id, media_range: { source_in_ms: index * 800, source_out_ms: (index + 1) * 800 }, timeline_start_ms: index * 800, fit: 'contain' }))
  const saved = await fetch(`${versionsUrl}/${version.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: 1, content }) })
  assert.equal(saved.status, 200, await saved.clone().text())
  const baseline = (await saved.json()).data
  await page.route('**/versions*', async route => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch(); const payload = await response.json()
    for (const row of Array.isArray(payload.data) ? payload.data : [payload.data]) for (const key of ['director_graph', 'unit_graph', 'instruction_graph', 'edit_graph']) if (row?.[key]) remapCanvasGraph(row[key], opaqueCanvasAddresses(row[key]))
    await route.fulfill({ response, json: payload })
  })
  await page.goto(`http://127.0.0.1:4247/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  await (await workbenchControl(page, '保存设置', 'switch', '自动保存')).click()
  await (await workbenchShot(page, '镜头 1：读信')).click()
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  await selectWorkbenchOption(page, '指令所属单元', '单元 1')
  const body = page.getByRole('textbox', { name: '当前单元指令正文', exact: true })
  await body.fill('保持未保存正文')
  const relations = page.getByRole('navigation', { name: '场次关系树', exact: true })
  await relations.getByRole('button', { name: '展开关系树', exact: true }).click()
  await relations.getByRole('button', { name: '展开同场次素材', exact: true }).click()
  assert.equal(await relations.getByRole('button', { name: '刷新关系树素材', exact: true }).count(), 0, '关系树素材消费版本图，不独立读取素材列表')
  await relations.getByRole('button', { name: '展开镜头 1', exact: true }).click()
  await relations.getByRole('button', { name: '展开单元 1', exact: true }).click()
  const longSummary = relations.getByRole('button', { name: '展开已保存正文', exact: true })
  await longSummary.click()
  assert.equal(await relations.getByRole('button', { name: '收起已保存正文', exact: true }).getAttribute('aria-expanded'), 'true')
  await relations.getByRole('button', { name: '收起已保存正文', exact: true }).click()
  await relations.getByRole('button', { name: '定位单元 1 的指令', exact: true }).focus()
  await page.keyboard.press('Enter')
  assert.equal(await body.inputValue(), '保持未保存正文')
  await relations.getByRole('button', { name: '展开时间线片段', exact: true }).click()
  await relations.getByRole('button', { name: '定位片段 2', exact: true }).click()
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '时间线片段 2')
  assert.equal(await page.locator('video').count(), 0)
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  assert.equal(await body.inputValue(), '保持未保存正文')
  await relations.getByRole('button', { name: '展开全图', exact: true }).click()
  const overview = page.getByRole('complementary', { name: '全场关系总览', exact: true })
  await overview.getByRole('button', { name: '选择总览对象：片段 2 · 真实媒体', exact: true }).click()
  await overview.getByRole('button', { name: '定位当前对象', exact: true }).click()
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '时间线片段 2')
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  assert.equal(await body.inputValue(), '保持未保存正文')
  assert.equal(await page.locator('.canvas-workbench-toolbar:visible').count(), 1)
  await page.screenshot({ path: join(output, 'navigation-desktop.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))) })
  assert.equal(await page.locator('.canvas-workbench-toolbar:visible').count(), 1)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  console.log('Viewport dimensions', await page.evaluate(() => ({ height: innerHeight, document: document.documentElement.scrollHeight, toolbar: [...document.querySelectorAll('.canvas-workbench-toolbar')].map(element => ({ rect: element.getBoundingClientRect().toJSON(), hidden: !!element.closest('[hidden]') })) })))
  await page.screenshot({ path: join(output, 'navigation-narrow.png'), animations: 'disabled' })
  if (await relations.getByRole('button', { name: '收起关系树', exact: true }).count()) await relations.getByRole('button', { name: '收起关系树', exact: true }).click()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  if (await page.getByRole('button', { name: '浏览整场剪辑', exact: true }).count()) await page.getByRole('button', { name: '浏览整场剪辑', exact: true }).click()
  await page.getByRole('button', { name: '定位画布节点', exact: true }).click()
  await page.getByRole('menuitem', { name: '片段 2 · 真实媒体', exact: true }).focus()
  await page.keyboard.press('Escape')
  await page.getByRole('menu').waitFor({ state: 'hidden' })
  await page.screenshot({ path: join(output, 'locator-closed-narrow.png') })
  assert.deepEqual((await (await fetch(`${versionsUrl}/${version.id}`)).json()).data, baseline)
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  await relations.getByRole('button', { name: '展开关系树', exact: true }).click()
  await relations.getByRole('button', { name: '展开全图', exact: true }).click()
  await overview.getByRole('button', { name: '选择总览对象：片段 2 · 真实媒体', exact: true }).click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: /^已保存$/ }).waitFor()
  await overview.getByRole('region', { name: '当前总览对象', exact: true }).getByRole('heading', { name: '片段 2 · 真实媒体', exact: true }).waitFor()
  await overview.getByRole('button', { name: '关闭详情', exact: true }).click()
  assert.equal(await body.inputValue(), '保持未保存正文')
  assert.equal((await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.content.units[0].instruction, '保持未保存正文')
  console.log(`PASS shared objects and references inspected in place without changing current work; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true, animations: 'disabled' }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
