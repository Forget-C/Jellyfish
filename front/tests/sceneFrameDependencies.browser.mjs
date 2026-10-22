import { makeWorkspace } from './directing-fixtures.mjs'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import { closeWorkbenchDetails, locateCanvasNode } from './workbenchControls.mjs'
import { workbenchControl } from './workbenchControls.mjs'
import { selectWorkbenchOption, unitCard } from './workbenchControls.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-predecessor-')
const api = 'http://127.0.0.1:8265'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.directing.scene_version_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8265', SCENE_BROWSER_TEST_LEGACY_TAKE: '1', SCENE_BROWSER_TEST_LEGACY_FRAMING: '1' },
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4265, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  page = await context.newPage()
  page.setDefaultTimeout(12000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
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
  const upload = new FormData()
  upload.set('file', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }), 'ordinary-first.png')
  upload.set('project_id', 'canvas-project'); upload.set('usage_kind', 'upload')
  const uploaded = await fetch(`${api}/api/v1/studio/files/upload`, { method: 'POST', body: upload })
  assert.equal(uploaded.status, 201, await uploaded.clone().text())
  const ordinaryFile = (await uploaded.json()).data.id
  const content = structuredClone(version.content)
  content.design.direction.shots = [{ id: 'framing-shot', beat_ids: [], event_ids: [], blocking_state_ids: [], participant_ids: [], criterion_ids: [], narrative_function: {}, visible_result: { state: 'proposal', text: '构图测试', sources: [{ kind: 'human', reference: 'author', version: '1' }] } }]
  content.design.cinematography = content.design.direction.shots.map((shot, index) => ({ ...makeWorkspace().designs[0].content.cinematography[0], id: `camera-${index}`, shot_id: shot.id, criterion_ids: [] }))
  content.timeline.items = ['first', 'second'].map((id, index) => ({ kind: 'media', id, take_kind: library[0].take_kind, take_id: library[0].take_id, file_id: library[0].file_id, fit: 'contain', media_range: { source_in_ms: 0, source_out_ms: 1000 }, timeline_start_ms: index * 5000 }))
  content.units = ['affected', 'independent'].map(id => ({ id, ratio: '16:9', model_id: 'browser-video-model', duration_ms: 5000, instruction: '后段保持人物位置。', coverage: [{ id: 'coverage', shot_id: 'framing-shot', action_scope: '后段保持人物位置' }] }))
  content.units[0].references = [{ id: 'ordinary-first', file_id: ordinaryFile, media_kind: 'image', purpose: 'composition', input_role: 'first_frame', participant_ids: [], ordinal: 0, source: { kind: 'human', reference: 'author', version: '1' } }]
  const saved = await fetch(`${versionsUrl}/${version.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: version.revision, content }) })
  assert.equal(saved.status, 200, await saved.text())
  await page.goto(`http://127.0.0.1:4265/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  await (await workbenchControl(page, '保存设置', 'switch', '自动保存')).click()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  await page.getByRole('button', { name: '打开剪辑工作区', exact: true }).click()
  await locateCanvasNode(page, '时间线')
  const detailUrl = `${versionsUrl}/${version.id}`
  const read = async () => (await (await fetch(detailUrl)).json()).data
  await page.getByRole('button', { name: '提取片段 1 实际落幅', exact: true }).click()
  await page.getByText('落幅 1：当前采用适用', { exact: true }).waitFor()
  const original = await read()
  const frames = (await (await fetch(detailUrl + '/end-frames')).json()).data
  assert.equal(frames.length, 1)
  assert.equal(frames[0].at_ms, 960, 'last decodable frame inside the adopted 0–1000ms interval')
  assert.deepEqual(frames[0].clip.media_range, { source_in_ms: 0, source_out_ms: 1000 })
  const proposed = structuredClone(original.content)
  proposed.units[0].references = [{ ...proposed.units[0].references[0], file_id: frames[0].file_id, purpose: 'continuity', source: frames[0].source }]
  proposed.units[0].scene_dependencies = [{ version_id: version.id, clip_id: 'first', frame_id: frames[0].id, reference_id: 'ordinary-first' }]
  for (const failure of ['subject', 'wrong-file', 'forged-source', 'stale-frame', 'stale-revision']) {
    const invalid = structuredClone(proposed)
    if (failure === 'subject') invalid.units[0].references[0].input_role = 'subject'
    if (failure === 'wrong-file') invalid.units[0].references[0].file_id = ordinaryFile
    if (failure === 'forged-source') invalid.units[0].references[0].source.media_range.source_in_ms = 0
    if (failure === 'stale-frame') invalid.timeline.items[0].media_range.source_out_ms = 1500
    const response = await fetch(detailUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: failure === 'stale-revision' ? 1 : original.revision, content: invalid }) })
    assert.equal(response.status, failure.startsWith('stale') ? 409 : 422, `${failure}: ${await response.clone().text()}`)
    assert.deepEqual(await read(), original, `${failure} must leave the entire saved version unchanged`)
  }

  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await selectWorkbenchOption(page, '单元镜头筛选', '镜头 1')
  await page.getByRole('combobox', { name: '当前单元', exact: true }).press('ArrowDown')
  await page.getByRole('combobox', { name: '当前单元', exact: true }).press('Enter')
  await unitCard(page, '前段依赖')
  const dialog = page.getByRole('complementary', { name: '前段依赖', exact: true })
  await dialog.getByRole('button', { name: '依赖当前版本片段 1', exact: true }).click({ timeout: 5000 })
  const confirm = page.getByRole('dialog', { name: '应用前段承接', exact: true })
  await confirm.getByRole('button', { name: '应用承接', exact: true }).click()
  await dialog.getByRole('button', { name: '依赖 1 绑定落幅 1', exact: true }).click()
  await confirm.getByRole('img', { name: '原首帧', exact: true }).waitFor()
  await confirm.getByRole('img', { name: '拟用落幅', exact: true }).waitFor()
  await confirm.getByRole('button', { name: '取消', exact: true }).click()
  assert.equal((await read()).content.units[0].references[0].file_id, ordinaryFile)
  await dialog.getByRole('button', { name: '依赖 1 绑定落幅 1', exact: true }).click()
  await confirm.getByRole('button', { name: '替换首帧并应用承接', exact: true }).click()
  await dialog.getByText('依赖 1：实际落幅适用', { exact: true }).waitFor()
  await closeWorkbenchDetails(page)
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  let current = await read()
  const bound = current.content.units[0]
  assert.equal(bound.scene_dependencies.length, 1)
  assert.equal(bound.references.length, 1)
  assert.equal(bound.references[0].input_role, 'first_frame')
  const dependencyEvidence = version => version.unit_graph.nodes.find(node => node.kind === 'unit_config' && node.unit_id === 'affected' && node.config_kind === 'dependencies').dependency_evidence[0]
  assert.equal(dependencyEvidence(current).status, 'current')
  assert.equal(dependencyEvidence(current).frame_id, bound.scene_dependencies[0].frame_id)
  assert.equal(dependencyEvidence(current).frame_file_id, bound.references[0].file_id)
  assert.deepEqual(dependencyEvidence(current).source, bound.references[0].source)
  assert.equal(bound.references[0].source.media_range.source_in_ms, 960)
  const check = async (unitId, outcome = 'pass') => {
    current = await read()
    const unitUrl = `${detailUrl}/units/${unitId}`
    const basis = await fetch(unitUrl + '/instruction-basis/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: current.revision, content: current.content }) })
    assert.equal(basis.status, 200, await basis.clone().text())
    current.content.units.find(unit => unit.id === unitId).instruction_basis_id = (await basis.json()).data.basis_id
    const request = { request_id: crypto.randomUUID(), expected_revision: current.revision, content: current.content, model_id: 'browser-text-model' }
    const submitted = await fetch(unitUrl + '/instruction-checks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) })
    assert.equal(submitted.status, 200, await submitted.clone().text())
    const taskId = (await submitted.json()).data.task_id
    const completed = await fetch(`${api}/browser-test/instruction-checks/${taskId}/complete?outcome=${outcome}`, { method: 'POST' })
    assert.equal(completed.status, 200, await completed.text())
    const confirmed = await fetch(unitUrl + '/instruction-checks/' + taskId + '/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: current.content }) })
    if (outcome !== 'pass') {
      assert.equal(confirmed.status, 422, await confirmed.text())
      return
    }
    assert.equal(confirmed.status, 200, await confirmed.text())
    current.content.units.find(unit => unit.id === unitId).instruction_check_task_id = taskId
    const saved = await fetch(detailUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: current.revision, content: current.content }) })
    assert.equal(saved.status, 200, await saved.text())
  }
  await check('affected'); await check('independent')
  current = await read()
  const prepare = unitId => fetch(`${detailUrl}/units/${unitId}/video/prepare`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expected_revision: current.revision }) })
  assert.equal((await prepare('affected')).status, 200)
  assert.equal((await prepare('independent')).status, 200)
  current.content.timeline.items[0].media_range.source_out_ms = 1500
  const changed = await fetch(detailUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: current.revision, content: current.content }) })
  assert.equal(changed.status, 200, await changed.text())
  current = await read()
  assert.equal(dependencyEvidence(current).status, 'needs_review')
  assert.equal(dependencyEvidence(current).frame_file_id, bound.references[0].file_id)
  const blocked = await prepare('affected')
  assert.equal(blocked.status, 409)
  assert.match(await blocked.text(), /实际落幅依据已变/)
  assert.equal((await prepare('independent')).status, 200)
  await page.reload()
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await selectWorkbenchOption(page, '单元镜头筛选', '镜头 1')
  await page.getByRole('combobox', { name: '当前单元', exact: true }).press('ArrowDown')
  await page.getByRole('combobox', { name: '当前单元', exact: true }).press('Enter')
  await unitCard(page, '前段依赖')
  await dialog.getByText('依赖 1：实际落幅依据已变，请重新提取并明确换绑', { exact: true }).waitFor()
  assert.equal((await read()).content.units[0].references[0].file_id, bound.references[0].file_id)
  await dialog.getByRole('button', { name: '定位依赖 1 原采用并提取落幅', exact: true }).click()
  await page.getByRole('button', { name: '提取片段 1 实际落幅', exact: true }).click()
  await page.getByText('落幅 2：当前采用适用', { exact: true }).waitFor()
  await page.getByRole('button', { name: '定位后段单元 1', exact: true }).click()
  await dialog.getByText('依赖 1：实际落幅依据已变，请重新提取并明确换绑', { exact: true }).waitFor()
  await dialog.getByRole('button', { name: '依赖 1 绑定落幅 1', exact: true }).click()
  await confirm.getByRole('button', { name: '替换首帧并应用承接', exact: true }).click()
  await dialog.getByRole('button', { name: '前往当前单元指令核对', exact: true }).click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  current = await read()
  assert.notEqual(current.content.units[0].references[0].file_id, bound.references[0].file_id)
  assert.equal(dependencyEvidence(current).status, 'current')
  const basis = await fetch(detailUrl + '/units/affected/instruction-basis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: current.content }) })
  assert.equal((await basis.json()).data.status, 'changed')
  const requiresCheck = await prepare('affected')
  assert.equal(requiresCheck.status, 409)
  assert.match(await requiresCheck.text(), /更新并重新检查/)
  assert.equal((await prepare('independent')).status, 200)
  for (const outcome of ['failed', 'cancelled', 'revise']) {
    await check('affected', outcome)
    current = await read()
    assert.equal((await prepare('affected')).status, 409)
    assert.equal((await prepare('independent')).status, 200)
  }
  await check('affected')
  current = await read()
  assert.equal((await prepare('affected')).status, 200)
  assert.equal((await prepare('independent')).status, 200)
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await unitCard(page, '前段依赖')
  await page.route('**/end-frames', route => route.request().method() === 'GET' ? route.abort('failed') : route.continue())
  await dialog.getByRole('button', { name: '刷新场次落幅', exact: true }).click()
  await dialog.getByText('场次落幅读取失败，依赖适用性尚未核实', { exact: true }).waitFor()
  assert.equal(await dialog.getByText('依赖 1：实际落幅适用', { exact: true }).count(), 0)
  assert.equal(await dialog.getByRole('button', { name: /^依赖 1 绑定落幅/ }).count(), 0)
  await page.unroute('**/end-frames')
  await dialog.getByRole('button', { name: '刷新场次落幅', exact: true }).click()
  await dialog.getByText('依赖 1：实际落幅适用', { exact: true }).waitFor()
  current = await read()
  const forged = structuredClone(current.content)
  forged.units[0].references[0].source.media_range.source_in_ms = 0
  const rejected = await fetch(detailUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: current.revision, content: forged }) })
  assert.equal(rejected.status, 422)
  assert.match(await rejected.text(), /固定来源不一致/)
  assert.deepEqual(await read(), current)
  for (const unitId of ['affected', 'independent']) {
    const executions = await fetch(`${detailUrl}/units/${unitId}/video`)
    assert.equal(executions.status, 200)
    assert.equal((await executions.json()).data.length, 0)
  }
  await page.reload()
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await unitCard(page, '前段依赖')
  await closeWorkbenchDetails(page)
  const save = async () => {
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
    return read()
  }
  const openFirst = async () => {
    await closeWorkbenchDetails(page)
    await locateCanvasNode(page, '首帧参考')
    await page.getByRole('button', { name: '查看节点：首帧参考', exact: true }).click()
    const picker = page.getByRole('dialog', { name: '编辑首帧参考', exact: true })
    await picker.waitFor()
    return picker
  }
  const assertPending = async value => {
    const link = value.content.units[0].scene_dependencies[0]
    assert.equal(link.clip_id, 'first')
    assert.equal(link.frame_id, null)
    assert.equal(link.reference_id, null)
    assert.equal(dependencyEvidence(value).status, 'unbound')
    assert.equal(value.unit_graph.nodes.find(node => node.id === 'unit:affected:first-frame').summary.some(field => field.field === 'predecessor'), false)
    current = value
    assert.equal((await prepare('affected')).status, 409)
    assert.equal((await prepare('independent')).status, 200)
  }
  await locateCanvasNode(page, '首帧参考')
  await page.getByRole('button', { name: '定位承接片段与取帧依据', exact: true }).click()
  await dialog.getByRole('button', { name: '定位依赖 1 原采用并提取落幅', exact: true }).waitFor()
  await closeWorkbenchDetails(page)
  await locateCanvasNode(page, '首帧参考')
  await page.screenshot({ path: join(output, 'predecessor-desktop.png'), animations: 'disabled' })
  const beforeRemoval = await read()
  let picker = await openFirst()
  await picker.getByRole('button', { name: /^移\s*除$/ }).click()
  await picker.getByText('应用后将清除原落幅与参考绑定，保留前段声明为待绑定；新图只是普通参考，需要重新绑定承接才能生成。', { exact: true }).waitFor()
  await picker.getByRole('button', { name: /^取\s*消$/ }).click()
  assert.deepEqual(await read(), beforeRemoval)
  picker = await openFirst()
  await picker.getByRole('button', { name: /^移\s*除$/ }).click()
  await picker.getByRole('button', { name: '应用到本单元', exact: true }).click()
  current = await save()
  assert.equal(current.content.units[0].references.length, 0)
  await assertPending(current)
  await (await workbenchControl(page, '编辑历史', 'button', '撤销')).click()
  current = await save()
  assert.deepEqual(current.content.units, beforeRemoval.content.units, 'one undo restores image and binding together')
  picker = await openFirst()
  await picker.getByRole('button', { name: '更换素材', exact: true }).click()
  await selectWorkbenchOption(page, '参考素材来源', '已有素材')
  const ordinaryRow = picker.getByRole('button', { name: /^查看图片：ordinary-first/ }).locator('xpath=ancestor::div[contains(@class,"ant-space-horizontal")][1]')
  await ordinaryRow.getByRole('button', { name: /^选\s*入$/ }).click()
  await picker.getByRole('button', { name: '应用到本单元', exact: true }).click()
  current = await save()
  assert.equal(current.content.units[0].references[0].file_id, ordinaryFile)
  assert.equal(current.content.units[0].references[0].input_role, 'first_frame')
  await assertPending(current)
  await unitCard(page, '前段依赖')
  await dialog.getByRole('button', { name: '依赖 1 绑定落幅 1', exact: true }).click()
  await confirm.getByRole('button', { name: '替换首帧并应用承接', exact: true }).click()
  await closeWorkbenchDetails(page)
  current = await save()
  assert.equal(dependencyEvidence(current).status, 'current')
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  await page.getByRole('button', { name: '打开剪辑工作区', exact: true }).click()
  await locateCanvasNode(page, '时间线')
  await page.getByRole('button', { name: '提取片段 2 实际落幅', exact: true }).click()
  await page.getByText('落幅 3：当前采用适用', { exact: true }).waitFor()
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await unitCard(page, '前段依赖')
  const beforeReplace = await read()
  await dialog.getByRole('button', { name: '承接当前版本片段 2 落幅 1', exact: true }).click()
  await confirm.getByRole('button', { name: '取消', exact: true }).click()
  assert.deepEqual(await read(), beforeReplace)
  await dialog.getByRole('button', { name: '承接当前版本片段 2 落幅 1', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await confirm.getByRole('button', { name: '替换首帧并应用承接', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(output, 'predecessor-mobile.png'), animations: 'disabled' })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
  await confirm.getByRole('button', { name: '替换首帧并应用承接', exact: true }).click()
  await closeWorkbenchDetails(page)
  current = await save()
  assert.equal(current.content.units[0].scene_dependencies.length, 1)
  assert.equal(current.content.units[0].scene_dependencies[0].clip_id, 'second')
  assert.equal(current.content.units[0].references.length, 1)
  assert.notEqual(current.content.units[0].references[0].file_id, beforeReplace.content.units[0].references[0].file_id)
  await page.setViewportSize({ width: 1440, height: 960 })
  await (await workbenchControl(page, '编辑历史', 'button', '撤销')).click()
  current = await save()
  assert.deepEqual(current.content.units, beforeReplace.content.units)
  await unitCard(page, '前段依赖')
  await dialog.getByRole('button', { name: '移除场次依赖 1（保留参考）', exact: true }).click()
  await closeWorkbenchDetails(page)
  current = await save()
  assert.equal(current.content.units[0].scene_dependencies.length, 0)
  assert.deepEqual(current.content.units[0].references, beforeReplace.content.units[0].references)
  assert.equal((await (await fetch(detailUrl + '/end-frames')).json()).data.length, 3)
  assert.deepEqual(current.content.timeline, beforeReplace.content.timeline)
  const workspace = (await (await fetch(sceneUrl)).json()).data
  const historical = structuredClone(current.content)
  historical.units[0].dependencies = [{ plan_revision_id: workspace.plans[0].id, unit_id: workspace.plans[0].content.units[0].id }]
  const withHistory = await fetch(detailUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: current.revision, content: historical }) })
  assert.equal(withHistory.status, 200, await withHistory.clone().text())
  await page.reload()
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await unitCard(page, '前段依赖')
  await dialog.getByText('固定来源身份', { exact: true }).click()
  assert.ok((await dialog.locator('details').filter({ hasText: '固定来源身份' }).textContent()).includes(`${workspace.plans[0].id} / ${workspace.plans[0].content.units[0].id}`))
  const historicalSaved = await read()
  await dialog.getByRole('button', { name: '承接当前版本片段 2 落幅 1', exact: true }).click()
  await confirm.getByText('本单元只保留这一个承接来源，替换现有 1 项前段声明（含历史来源）。', { exact: true }).waitFor()
  await confirm.getByRole('button', { name: '取消', exact: true }).click()
  assert.deepEqual(await read(), historicalSaved)
  await dialog.getByRole('button', { name: '承接当前版本片段 2 落幅 1', exact: true }).click()
  await confirm.getByRole('button', { name: '替换首帧并应用承接', exact: true }).click()
  await closeWorkbenchDetails(page)
  current = await save()
  assert.equal(current.content.units[0].dependencies.length, 0)
  assert.equal(current.content.units[0].scene_dependencies.length, 1)
  assert.equal(current.content.units[0].scene_dependencies[0].clip_id, 'second')
  assert.equal(current.content.units[0].references[0].input_role, 'first_frame')
  await check('affected')
  current = await read()
  const prepared = await prepare('affected')
  assert.equal(prepared.status, 200, await prepared.clone().text())
  const preparation = (await prepared.json()).data
  assert.equal(preparation.request.media.frames.first.file_id, current.content.units[0].references[0].file_id)
  const submitted = await fetch(`${detailUrl}/units/affected/video`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: current.revision, expected_preparation: preparation }) })
  assert.equal(submitted.status, 200, await submitted.clone().text())
  const executions = (await (await fetch(`${detailUrl}/units/affected/video`)).json()).data
  assert.equal(executions.length, 1)
  assert.equal(executions[0].preparation.request.media.frames.first.file_id, current.content.units[0].references[0].file_id)
  console.log(`PASS explicit frame binding, atomic replacement/undo, pending removal, historical occupancy and fixed first-frame task; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await cleanup()
}
