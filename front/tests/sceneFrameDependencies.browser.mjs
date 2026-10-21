import { makeWorkspace } from './directing-fixtures.mjs'
import { locateCanvasNode } from './workbenchControls.mjs'
import { workbenchControl } from './workbenchControls.mjs'
import { selectWorkbenchOption, unitSettings } from './workbenchControls.mjs'
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
const api = 'http://127.0.0.1:8193'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.directing.scene_version_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8193', SCENE_BROWSER_TEST_LEGACY_TAKE: '1', SCENE_BROWSER_TEST_LEGACY_FRAMING: '1' },
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4193, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  page = await context.newPage()
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
  const content = structuredClone(version.content)
  content.design.direction.shots = [{ id: 'framing-shot', beat_ids: [], event_ids: [], blocking_state_ids: [], participant_ids: [], criterion_ids: [], narrative_function: {}, visible_result: { state: 'proposal', text: '构图测试', sources: [{ kind: 'human', reference: 'author', version: '1' }] } }]
  content.design.cinematography = content.design.direction.shots.map((shot, index) => ({ ...makeWorkspace().designs[0].content.cinematography[0], id: `camera-${index}`, shot_id: shot.id, criterion_ids: [] }))
  content.timeline.items = ['first', 'second'].map((id, index) => ({ kind: 'media', id, take_kind: library[0].take_kind, take_id: library[0].take_id, file_id: library[0].file_id, fit: 'contain', media_range: { source_in_ms: 0, source_out_ms: 1000 }, timeline_start_ms: index * 5000 }))
  content.units = ['affected', 'independent'].map(id => ({ id, ratio: '16:9', model_id: 'browser-video-model', duration_ms: 5000, instruction: '后段保持人物位置。', coverage: [{ id: 'coverage', shot_id: 'framing-shot', action_scope: '后段保持人物位置' }] }))
  const saved = await fetch(`${versionsUrl}/${version.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: version.revision, content }) })
  assert.equal(saved.status, 200, await saved.text())
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  await (await workbenchControl(page, '保存设置', 'switch', '自动保存')).click()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  await locateCanvasNode(page, '时间线')
  const detailUrl = `${versionsUrl}/${version.id}`
  const read = async () => (await (await fetch(detailUrl)).json()).data
  await page.getByRole('button', { name: '提取片段 1 实际落幅', exact: true }).click()
  await page.getByText('落幅 1：当前采用适用', { exact: true }).waitFor()
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await selectWorkbenchOption(page, '单元镜头筛选', '镜头 1')
  await page.getByRole('combobox', { name: '当前单元', exact: true }).press('ArrowDown')
  await page.getByRole('combobox', { name: '当前单元', exact: true }).press('Enter')
  await unitSettings(page)
  await page.getByRole('button', { name: '编辑前段依赖', exact: true }).click()
  const dialog = page.getByRole('complementary', { name: '前段依赖', exact: true })
  await dialog.getByRole('button', { name: '依赖当前版本片段 1', exact: true }).click({ timeout: 5000 })
  await dialog.getByRole('button', { name: '依赖 1 绑定落幅 1', exact: true }).click()
  await dialog.getByText('依赖 1：实际落幅适用', { exact: true }).waitFor()
  await dialog.getByRole('button', { name: '返回单元设置', exact: true }).click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  let current = await read()
  const bound = current.content.units[0]
  assert.equal(bound.scene_dependencies.length, 1)
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
  await unitSettings(page)
  await page.getByRole('button', { name: '编辑前段依赖', exact: true }).click()
  await dialog.getByText('依赖 1：实际落幅依据已变，请重新提取并明确换绑', { exact: true }).waitFor()
  assert.equal((await read()).content.units[0].references[0].file_id, bound.references[0].file_id)
  await dialog.getByRole('button', { name: '定位依赖 1 原采用并提取落幅', exact: true }).click()
  await page.getByRole('button', { name: '提取片段 1 实际落幅', exact: true }).click()
  await page.getByText('落幅 2：当前采用适用', { exact: true }).waitFor()
  await page.getByRole('button', { name: '定位后段单元 1', exact: true }).click()
  await dialog.getByText('依赖 1：实际落幅依据已变，请重新提取并明确换绑', { exact: true }).waitFor()
  await dialog.getByRole('button', { name: '依赖 1 绑定落幅 1', exact: true }).click()
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
  await unitSettings(page)
  await page.getByRole('button', { name: '编辑前段依赖', exact: true }).click()
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
  console.log(`PASS explicit frame binding and affected-unit-only execution gate; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
