import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import { opaqueCanvasAddresses, remapCanvasGraph } from './canvas-graph-fixtures.mjs'
import { closeWorkbenchDetails } from './workbenchControls.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-instruction-inputs-')
const api = 'http://127.0.0.1:8266'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.directing.scene_version_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8266', SCENE_BROWSER_TEST_SUBJECTS: '1', SCENE_BROWSER_TEST_LEGACY_TAKE: '1', SCENE_BROWSER_TEST_LEGACY_FRAMING: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let backendOutput = ''
backend.stdout.on('data', data => { backendOutput += data })
backend.stderr.on('data', data => { backendOutput += data })
let server, browser, page
const cleanup = browserCleanup(() => ({ browser, server, backend }))
captureBackend(backend, output)
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4266, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  page = await context.newPage()
  const errors = []
  const writes = []
  context.on('request', request => { if (request.method() === 'PUT' || request.method() === 'POST' && /\/(?:instructions|instruction-checks|video|save-and-submit)$/.test(new URL(request.url()).pathname)) writes.push(request.url()) })
  page.on('pageerror', error => errors.push(error.message))
  page.setDefaultTimeout(12000)
  await context.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin }; localStorage.setItem('jellyfish:scene-autosave:local-user', 'off') })
  const create = await fetch(versionsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), title: '覆盖编辑验收' }) })
  assert.equal(create.status, 200)
  const version = (await create.json()).data
  const content = version.content
  content.design.direction.shots = [{ id: 'shot', beat_ids: [], event_ids: [], blocking_state_ids: [], participant_ids: [], criterion_ids: [], narrative_function: {}, visible_result: {} }]
  content.units = [{ id: 'unit', instruction: '读信者看着来信。', model_id: 'browser-subject-model', duration_ms: 5000, ratio: '16:9', coverage: [{ id: 'coverage', shot_id: 'shot', action_scope: '读信' }] }]
  const detail = `${versionsUrl}/${version.id}`
  const response = await fetch(detail, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: 1, content }) })
  assert.equal(response.status, 200, await response.clone().text())
  const read = async () => (await (await fetch(detail)).json()).data
  await page.goto(`http://127.0.0.1:4266/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}&canvas=instructions&browseUnit=unit`)
  const card = page.locator('[data-canvas-node="unit:unit:references"]')
  await card.getByRole('button', { name: '查看节点：本次输入', exact: true }).waitFor()
  await card.getByRole('region', { name: '首帧', exact: true }).getByText('未选择', { exact: true }).waitFor()
  await card.getByRole('region', { name: '尾帧', exact: true }).getByText('未选择', { exact: true }).waitFor()
  await card.getByRole('region', { name: '参考组', exact: true }).getByText('未选择', { exact: true }).waitFor()
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64')
  const files = []
  for (const name of ['首尾共用.png', '人物正面.png', '人物侧面.png', '空间.png']) {
    const form = new FormData(); form.set('file', new Blob([png], { type: 'image/png' }), name)
    form.set('project_id', 'canvas-project'); form.set('usage_kind', 'upload')
    const response = await fetch(`${api}/api/v1/studio/files/upload`, { method: 'POST', body: form })
    assert.equal(response.status, 201); files.push((await response.json()).data.id)
  }
  let saved = await read()
  const prepared = structuredClone(saved.content)
  prepared.design.participants = [{ id: 'person', name: '读信者' }]
  const ref = (id, file, role, group, purpose, ordinal) => ({ id, file_id: files[file], media_kind: 'image', input_role: role, subject_group_id: group, purpose, ordinal, participant_ids: group === 'person-group' ? ['person'] : [], source: { kind: 'human', reference: 'local-user', version: '1' } })
  prepared.units[0].references = [ref('first', 0, 'first_frame', null, 'composition', 0), ref('last', 0, 'last_frame', null, 'composition', 1), ref('face', 1, 'subject', 'person-group', 'identity', 2), ref('profile', 2, 'subject', 'person-group', 'identity', 3), ref('space', 3, 'subject', 'space-group', 'space', 4)]
  prepared.units.push({ ...structuredClone(prepared.units[0]), id: 'other', references: [] })
  const library = (await (await fetch(detail + '/take-library')).json()).data
  const take = library[0]
  prepared.timeline.items = [{ kind: 'media', id: 'adopted', take_kind: take.take_kind, take_id: take.take_id, file_id: take.file_id, fit: 'contain', media_range: { source_in_ms: 0, source_out_ms: 1000 }, timeline_start_ms: 0 }]
  prepared.units[0].scene_dependencies = [{ version_id: version.id, clip_id: 'adopted' }]
  const save = async content => {
    const previous = await read()
    const response = await fetch(detail, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: previous.revision, content }) })
    assert.equal(response.status, 200, await response.clone().text()); return (await response.json()).data
  }
  await save(prepared)
  let activeNodes = []
  let rejectPreview = false
  let unavailableFile = false
  let failFullImage = false
  let releasePreview
  let holdPreview
  const remapUnits = graph => {
    const map = opaqueCanvasAddresses(graph)
    remapCanvasGraph(graph, map)
    for (const node of graph.nodes) if (node.kind === 'unit_references') node.title = '同名输入'
    if (unavailableFile) for (const node of graph.nodes) for (const preview of node.previews || []) if (preview.file_id === files[3]) preview.status = 'unavailable'
    if (failFullImage) for (const node of graph.nodes) for (const preview of node.previews || []) if (preview.file_id === files[2]) preview.media_url += '?fixture-read-failure=1'
    graph.nodes.reverse()
    activeNodes = graph.nodes
    return map
  }
  await context.route('**/versions**', async route => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() === 'POST' && path.endsWith('/unit-canvas/preview')) {
      if (holdPreview) await holdPreview
      if (rejectPreview) { await route.fulfill({ status: 503, json: { detail: '测试读取中断' } }); return }
      const response = await route.fetch(); const json = await response.json()
      remapUnits(json.data); await route.fulfill({ response, json }); return
    }
    if (route.request().method() === 'GET' && (path.endsWith('/versions') || path.endsWith(`/versions/${version.id}`))) {
      const response = await route.fetch(); const json = await response.json()
      for (const value of Array.isArray(json.data) ? json.data : [json.data]) {
        if (!value.unit_graph) continue
        const addresses = remapUnits(value.unit_graph)
        const graph = value.instruction_graph
        remapCanvasGraph(graph, { ...opaqueCanvasAddresses(graph), externalNodes: addresses.nodes })
      }
      await route.fulfill({ response, json }); return
    }
    await route.continue()
  })
  await page.reload()
  const openInputs = async targetPage => {
    await targetPage.getByRole('button', { name: '定位画布节点', exact: true }).click()
    await targetPage.getByRole('menuitem', { name: '本次输入', exact: true }).click()
    const entry = targetPage.getByRole('button', { name: '查看节点：本次输入', exact: true })
    await entry.focus(); await targetPage.keyboard.press('Enter')
    const panel = targetPage.getByRole('complementary', { name: '本次输入 · 只读', exact: true }).or(targetPage.getByRole('dialog', { name: '本次输入 · 只读', exact: true }))
    await panel.waitFor(); return panel
  }
  await page.getByRole('button', { name: '定位画布节点', exact: true }).click()
  await page.getByRole('menuitem', { name: '本次输入', exact: true }).click()
  const compact = page.locator('.instruction-inputs-compact')
  await compact.getByRole('button', { name: '查看大图：人物侧面', exact: true }).waitFor()
  assert.equal(await compact.evaluate(element => { const bounds = element.getBoundingClientRect(); return [...element.querySelectorAll('img')].every(image => { const rect = image.getBoundingClientRect(); return rect.top >= bounds.top && rect.bottom <= bounds.bottom }) }), true, 'input thumbnails remain visible inside the finite aggregate card')
  await page.keyboard.press('Escape')
  await page.screenshot({ path: join(output, 'input-card-desktop.png'), animations: 'disabled' })
  let panel = await openInputs(page)
  assert.equal(await panel.getByRole('button', { name: '查看大图：首尾共用', exact: true }).count(), 2)
  await panel.getByText('承接待绑定：片段 adopted', { exact: false }).waitFor()
  assert.match(await panel.textContent(), /对应对象：读信者/)
  assert.match(await panel.textContent(), /用途：人物／物件身份/)
  const imageButton = panel.getByRole('button', { name: '查看大图：人物侧面', exact: true })
  await imageButton.focus(); await page.keyboard.press('Enter')
  const imageDialog = page.getByRole('dialog', { name: '参考图片 · 只读', exact: true })
  await imageDialog.waitFor()
  assert.equal(await imageDialog.getByRole('img', { name: '人物侧面', exact: true }).evaluate(image => image.decode().then(() => image.naturalWidth > 0)), true)
  await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"]')].some(dialog => dialog.textContent.includes('参考图片 · 只读') && dialog.contains(document.activeElement)))
  await page.keyboard.press('Escape'); await imageDialog.waitFor({ state: 'hidden' })
  await imageButton.evaluate(button => new Promise((resolve, reject) => { const started = Date.now(); const check = () => { if (button === document.activeElement) resolve(); else if (Date.now() - started > 3000) reject(new Error('image close did not restore focus')); else requestAnimationFrame(check) }; check() }))
  await panel.getByRole('button', { name: /查看来源/ }).first().click()
  await panel.getByRole('heading', { name: '这条内容从哪里来', exact: true }).waitFor()
  await panel.getByRole('button', { name: '返回字段', exact: true }).click()
  await panel.screenshot({ path: join(output, 'inputs-desktop.png'), animations: 'disabled' })
  await closeWorkbenchDetails(page)
  const body = page.getByRole('textbox', { name: '当前单元指令正文', exact: true })
  await body.fill('保留尚未保存的指令。')
  panel = await openInputs(page)
  await panel.getByRole('button', { name: '查看大图：人物侧面', exact: true }).waitFor()
  for (const selector of [node => node.input_role === 'first_frame', node => node.input_role === 'last_frame', node => node.subject_group_id === 'person-group', node => node.subject_group_id === 'space-group']) {
    const node = activeNodes.find(node => node.unit_id === 'unit' && node.kind === 'unit_references' && selector(node))
    assert.ok(node)
    await panel.locator(`[data-input-node="${node.id}"]`).getByRole('button', { name: '修改同名输入', exact: true }).click()
    const picker = page.getByRole('dialog', { name: node.input_role === 'subject' ? '编辑参考组' : '编辑同名输入', exact: true })
    await picker.waitFor()
    assert.equal(new URL(page.url()).searchParams.get('browseUnit'), 'unit')
    assert.equal(await picker.getByRole('button', { name: '更换素材', exact: true }).count(), node.bindings.length)
    await picker.getByRole('button', { name: /^取\s*消$/ }).click()
    await page.getByRole('button', { name: '指令画布', exact: true }).click()
    assert.equal(await body.inputValue(), '保留尚未保存的指令。')
    panel = await openInputs(page)
  }
  console.log('PASS opaque same-title input targets and unsaved instruction preservation')
  assert.equal((await read()).content.units[0].instruction, '读信者看着来信。', 'navigation preserves the unsaved editor without writing')
  const personGroup = activeNodes.find(node => node.subject_group_id === 'person-group' && node.unit_id === 'unit')
  await panel.locator(`[data-input-node="${personGroup.id}"]`).getByRole('button', { name: '修改同名输入', exact: true }).click()
  let picker = page.getByRole('dialog', { name: '编辑参考组', exact: true })
  await picker.getByRole('button', { name: /^移\s*除$/ }).last().click()
  await picker.getByRole('button', { name: '应用到本单元', exact: true }).click()
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  panel = await openInputs(page)
  await panel.getByRole('button', { name: '查看大图：人物正面', exact: true }).waitFor()
  assert.equal(await panel.getByRole('button', { name: '查看大图：人物侧面', exact: true }).count(), 0)
  assert.equal((await read()).content.units[0].references.filter(ref => ref.subject_group_id === 'person-group').length, 2)
  await closeWorkbenchDetails(page)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  panel = await openInputs(page)
  await panel.getByRole('button', { name: '查看大图：人物侧面', exact: true }).waitFor()
  const reader = await context.newPage(); await reader.goto(page.url())
  await reader.getByRole('button', { name: '转到此页编辑', exact: true }).waitFor()
  const readonly = await openInputs(reader)
  assert.equal(await readonly.getByRole('button', { name: /^修改/ }).count(), 0)
  assert.ok(await readonly.getByRole('button', { name: '查看同名输入', exact: true }).count())
  await readonly.getByRole('button', { name: '查看大图：人物侧面', exact: true }).click()
  await reader.getByRole('dialog', { name: '参考图片 · 只读', exact: true }).waitFor()
  await reader.keyboard.press('Escape'); await reader.close()
  await page.setViewportSize({ width: 390, height: 844 })
  await panel.getByRole('button', { name: '查看大图：人物正面', exact: true }).click()
  await imageDialog.waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await imageDialog.screenshot({ path: join(output, 'input-image-mobile.png'), animations: 'disabled' })
  await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"]')].some(dialog => dialog.textContent.includes('参考图片 · 只读') && dialog.contains(document.activeElement)))
  await page.keyboard.press('Escape'); await imageDialog.waitFor({ state: 'hidden' })
  await panel.screenshot({ path: join(output, 'inputs-mobile.png'), animations: 'disabled' })
  await closeWorkbenchDetails(page)
  holdPreview = new Promise(resolve => { releasePreview = resolve })
  await body.fill('正在读取的新指令。')
  panel = await openInputs(page)
  await panel.getByRole('status').filter({ hasText: '正在核对本次输入' }).waitFor()
  assert.equal(await panel.getByRole('button', { name: '查看大图：人物正面', exact: true }).count(), 0)
  releasePreview(); holdPreview = undefined
  await panel.getByRole('button', { name: '查看大图：人物正面', exact: true }).waitFor()
  await closeWorkbenchDetails(page)
  rejectPreview = true
  await body.fill('触发新的输入读取。')
  panel = await openInputs(page)
  await panel.getByRole('alert').filter({ hasText: '本次输入加载失败' }).waitFor()
  assert.equal(await panel.getByText('未选择', { exact: true }).count(), 0)
  rejectPreview = false
  await panel.getByRole('button', { name: '重试本次输入', exact: true }).click()
  await panel.getByRole('button', { name: '查看大图：人物正面', exact: true }).waitFor()
  unavailableFile = true
  await closeWorkbenchDetails(page)
  await body.fill('保留不可用素材绑定。')
  panel = await openInputs(page)
  await panel.getByRole('status').filter({ hasText: '文件不可用或不属于当前项目' }).waitFor()
  assert.equal(await panel.getByRole('button', { name: '查看大图：空间', exact: true }).count(), 0)
  unavailableFile = false
  failFullImage = true
  await closeWorkbenchDetails(page)
  await body.fill('核对原图读取失败。')
  panel = await openInputs(page)
  await context.route(`**/files/${files[2]}/download?fixture-read-failure=1`, route => route.fulfill({ status: 503, body: 'fixture media temporarily unavailable' }))
  await panel.getByRole('button', { name: '查看大图：人物侧面', exact: true }).click()
  await imageDialog.getByRole('alert').filter({ hasText: '参考图片读取失败' }).waitFor()
  await imageDialog.getByRole('button', { name: 'Close', exact: true }).click()
  await context.unroute(`**/files/${files[2]}/download?fixture-read-failure=1`)
  failFullImage = false
  saved = await read()
  const extracted = await fetch(detail + '/end-frames', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: saved.revision, clip_id: 'adopted' }) })
  assert.equal(extracted.status, 200, await extracted.clone().text())
  const frame = (await extracted.json()).data
  const bound = structuredClone(saved.content)
  const firstFrame = bound.units[0].references.find(ref => ref.id === 'first')
  firstFrame.file_id = frame.file_id; firstFrame.purpose = 'continuity'; firstFrame.source = frame.source
  bound.units[0].scene_dependencies = [{ version_id: version.id, clip_id: 'adopted', frame_id: frame.id, reference_id: 'first' }]
  await save(bound)
  const fresh = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  await fresh.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const boundPage = await fresh.newPage(); await boundPage.goto(page.url())
  const boundPanel = await openInputs(boundPage)
  await boundPanel.getByText('承接片段 adopted', { exact: false }).waitFor()
  await boundPanel.getByText(`来源版本：${version.id} · 取帧 ${frame.at_ms} 毫秒`, { exact: true }).waitFor()
  await boundPanel.getByRole('button', { name: '查看前段承接依据', exact: true }).click()
  await boundPage.getByRole('complementary', { name: '前段依赖', exact: true }).waitFor()
  assert.equal(new URL(boundPage.url()).searchParams.get('browseUnit'), 'unit')
  await fresh.close()
  assert.deepEqual(writes, [], 'reading, image previews, and navigation never save or submit generation')
  assert.deepEqual(errors, [])
  console.log(`PASS instruction input groups, same-file frame slots, sources, precise target and unsaved/readonly/mobile reading: ${output}`)
} catch (error) {
  console.error(backendOutput)
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true, animations: 'disabled' }).catch(() => {})
  throw error
} finally { await cleanup() }
