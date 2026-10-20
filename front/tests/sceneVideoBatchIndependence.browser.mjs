import { makeWorkspace } from './directing-fixtures.mjs'
import { workbenchControl, directorObject, closeWorkbenchDetails } from './workbenchControls.mjs'
import { workbenchShot } from './workbenchControls.mjs'
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
  env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8193' },
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
  const note = text => ({ state: 'proposal', text, sources: [{ kind: 'human', reference: 'coverage-browser', version: '1' }] })
  const content = version.content
  content.design.direction.beats = ['beat-one', 'beat-two'].map((id, index) => ({ id, event_ids: [], objective: note(`目标 ${index + 1}`), obstacle: {}, expected_change: {}, must_show: note(`可拍变化 ${index + 1}`) }))
  content.design.events = [{ id: 'event-one', description: note('拆开信封') }]
  content.design.participants = [{ id: 'reader', name: '读信者' }]
  content.design.direction.shots = [{ id: 'shot-one', beat_ids: ['beat-one', 'beat-two'], event_ids: ['event-one'], blocking_state_ids: [], participant_ids: ['reader'], criterion_ids: [], narrative_function: {}, visible_result: note('读信反应') }]
  content.design.cinematography = content.design.direction.shots.map((shot, index) => ({ ...makeWorkspace().designs[0].content.cinematography[0], id: `camera-${index}`, shot_id: shot.id, criterion_ids: [] }))
  content.units = [{ id: 'unit-one', model_id: 'browser-video-model', duration_ms: 5000, ratio: '16:9', coverage: [
    { id: 'coverage-one', shot_id: 'shot-one', beat_ids: ['beat-one'], event_ids: [], action_scope: '拆开信封' },

  ] }]
  content.units.push({ ...structuredClone(content.units[0]), id: 'unit-two' })
  content.design.direction.shots.push({ ...structuredClone(content.design.direction.shots[0]), id: 'unrelated-shot', visible_result: note('无关镜头') })
  content.units.push({ ...structuredClone(content.units[0]), id: 'unit-three' })
  content.units.forEach((unit, index) => { unit.instruction = `单元 ${index + 1} 的原指令。` })
  const saved = await fetch(`${versionsUrl}/${version.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: version.revision, content }) })
  assert.equal(saved.status, 200, await saved.text())
  for (const unit of content.units) {
    const unitUrl = `${versionsUrl}/${version.id}/units/${unit.id}`
    const basis = await fetch(unitUrl + '/instruction-basis/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: 2, content }) })
    assert.equal(basis.status, 200, await basis.clone().text())
    unit.instruction_basis_id = (await basis.json()).data.basis_id
    const checking = await fetch(unitUrl + '/instruction-checks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: 2, content, model_id: 'browser-text-model' }) })
    assert.equal(checking.status, 200, await checking.clone().text())
    const taskId = (await checking.json()).data.task_id
    assert.equal((await fetch(`${api}/browser-test/instruction-checks/${taskId}/complete`, { method: 'POST' })).status, 200)
    const confirmed = await fetch(unitUrl + `/instruction-checks/${taskId}/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) })
    assert.equal(confirmed.status, 200, await confirmed.clone().text())
    unit.instruction_check_task_id = taskId
  }
  const prepared = await fetch(`${versionsUrl}/${version.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: 2, content }) })
  assert.equal(prepared.status, 200, await prepared.text())
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await (await workbenchControl(page, '保存设置', 'switch', '自动保存')).click()
  await (await workbenchControl(page, '更多操作', 'button', '批量拍摄')).click()
  const dialog = page.getByRole('dialog', { name: '批量预检与拍摄', exact: true })
  for (const number of [1, 2, 3]) await dialog.getByRole('checkbox', { name: `选择单元 ${number}`, exact: true }).check()
  await dialog.getByRole('button', { name: '预检所选 3 项', exact: true }).click()
  await dialog.getByText('可提交 3 项 · 受阻 0 项', { exact: true }).waitFor()
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await (await workbenchShot(page, '镜头 2：无关镜头')).click()
  await directorObject(page, /^镜头 02/, '镜头 02')
  await page.route('**/instruction-checks/*/compare', route => route.abort('failed'))
  await page.getByRole('textbox', { name: '可见结果', exact: true }).fill('无关镜头的新结果')
  await (await workbenchControl(page, '更多操作', 'button', '批量拍摄')).click()
  await dialog.getByText('预检适用性读取失败', { exact: true }).first().waitFor()
  assert.equal(await dialog.getByRole('button', { name: '提交可执行 0 项', exact: true }).isDisabled(), true)
  for (const id of ['unit-one', 'unit-two', 'unit-three']) {
    assert.equal((await (await fetch(`${versionsUrl}/${version.id}/units/${id}/video`)).json()).data.length, 0)
  }
  await page.unroute('**/instruction-checks/*/compare')
  await dialog.getByRole('button', { name: '重试适用性核对', exact: true }).first().click()
  await dialog.getByText('可提交 3 项 · 受阻 0 项', { exact: true }).waitFor({ timeout: 5000 })
  await dialog.getByRole('button', { name: '定位单元 2', exact: true }).click()
  const body = page.getByRole('textbox', { name: '当前单元指令正文', exact: true })
  let oldReceived, releaseOld
  const received = new Promise(resolve => { oldReceived = resolve })
  const gate = new Promise(resolve => { releaseOld = resolve })
  const lateResponses = []
  const comparisonRoute = '**/units/unit-two/instruction-checks/*/compare'
  await page.route(comparisonRoute, async route => {
    if (route.request().postDataJSON().content.units.find(unit => unit.id === 'unit-two').instruction !== 'B 的临时修改') return route.continue()
    const response = await route.fetch()
    oldReceived()
    await gate
    lateResponses.push(route.fulfill({ response }))
    await lateResponses.at(-1)
  })
  await body.fill('B 的临时修改')
  await received
  await body.fill('单元 2 的原指令。')
  await (await workbenchControl(page, '更多操作', 'button', '批量拍摄')).click()
  await dialog.getByText('可提交 3 项 · 受阻 0 项', { exact: true }).waitFor()
  releaseOld()
  await delay(200)
  await Promise.all(lateResponses)
  await page.unroute(comparisonRoute)
  await dialog.getByText('可提交 3 项 · 受阻 0 项', { exact: true }).waitFor()
  await dialog.getByRole('button', { name: '定位单元 2', exact: true }).click()
  await body.fill('B 后来修改的指令，不得提交旧输入。')
  await (await workbenchControl(page, '更多操作', 'button', '批量拍摄')).click()
  await dialog.getByText('可提交 2 项 · 受阻 1 项', { exact: true }).waitFor()
  await dialog.getByRole('region', { name: '批量单元 2', exact: true }).getByText('输入已变化，请保存并重新预检', { exact: true }).waitFor()
  const firstSubmissions = Promise.all(['unit-one', 'unit-three'].map(id => page.waitForResponse(response => response.url().endsWith(`/units/${id}/video`) && response.request().method() === 'POST' && response.status() === 200)))
  await dialog.getByRole('button', { name: '提交可执行 2 项', exact: true }).click()
  await firstSubmissions
  const records = async id => (await (await fetch(`${versionsUrl}/${version.id}/units/${id}/video`)).json()).data
  await dialog.getByRole('button', { name: '查看已提交拍摄记录', exact: true }).click()
  const recordsPanel = page.getByRole('complementary', { name: '批量拍摄记录', exact: true })
  await recordsPanel.getByText('任务状态：等待执行', { exact: true }).first().waitFor()
  for (const id of ['unit-one', 'unit-three']) await recordsPanel.getByRole('region', { name: `批量视频任务 ${(await records(id))[0].task_id}`, exact: true }).getByText('任务状态：等待执行', { exact: true }).waitFor()
  assert.equal((await records('unit-one')).length, 1)
  assert.equal((await records('unit-three')).length, 1)
  assert.equal((await records('unit-two')).length, 0)
  assert.equal((await records('unit-one'))[0].preparation.request.execution_prompt, '单元 1 的原指令。')
  assert.equal((await records('unit-three'))[0].preparation.request.execution_prompt, '单元 3 的原指令。')
  await closeWorkbenchDetails(page)
  await (await workbenchControl(page, '更多操作', 'button', '批量拍摄')).click()
  await dialog.getByRole('button', { name: '定位单元 2', exact: true }).click()
  assert.equal(await body.inputValue(), 'B 后来修改的指令，不得提交旧输入。')
  await page.getByRole('button', { name: '检查当前指令', exact: true }).click()
  await page.getByText('检查任务：等待执行', { exact: true }).waitFor()
  const checks = (await (await fetch(`${versionsUrl}/${version.id}/units/unit-two/instruction-checks`)).json()).data
  const newCheck = checks.find(row => row.status === 'queued')
  assert.ok(newCheck)
  assert.equal((await fetch(`${api}/browser-test/instruction-checks/${newCheck.task_id}/complete`, { method: 'POST' })).status, 200)
  await page.getByRole('button', { name: '查看检查结果', exact: true }).first().click()
  await page.getByText('六岗检查均通过，尚待明确核对结果', { exact: true }).waitFor()
  await page.getByRole('button', { name: '确认已核对检查结果', exact: true }).click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  await page.reload()
  await (await workbenchControl(page, '更多操作', 'button', '批量拍摄')).click()
  for (const number of [1, 2, 3]) await dialog.getByRole('checkbox', { name: `选择单元 ${number}`, exact: true }).check()
  await dialog.getByRole('button', { name: '预检所选 3 项', exact: true }).click()
  await dialog.getByText('可提交 1 项 · 受阻 2 项', { exact: true }).waitFor()
  const secondSubmission = page.waitForResponse(response => response.url().endsWith('/units/unit-two/video') && response.request().method() === 'POST' && response.status() === 200)
  await dialog.getByRole('button', { name: '提交可执行 1 项', exact: true }).click()
  await secondSubmission
  await dialog.getByRole('button', { name: '查看已提交拍摄记录', exact: true }).click()
  await recordsPanel.getByRole('region', { name: `批量视频任务 ${(await records('unit-two'))[0].task_id}`, exact: true }).getByText('任务状态：等待执行', { exact: true }).waitFor()
  assert.equal((await records('unit-two'))[0].preparation.request.execution_prompt, 'B 后来修改的指令，不得提交旧输入。')
  for (const id of ['unit-one', 'unit-two', 'unit-three']) assert.equal((await records(id)).length, 1)
  const beforeCompletion = (await (await fetch(`${versionsUrl}/${version.id}`)).json()).data
  const taskA = (await records('unit-one'))[0].task_id
  const taskC = (await records('unit-three'))[0].task_id
  assert.equal((await fetch(`${api}/browser-test/video-tasks/${taskA}/complete`, { method: 'POST' })).status, 200)
  assert.equal((await fetch(`${api}/browser-test/video-tasks/${taskC}/complete?outcome=failed`, { method: 'POST' })).status, 200)
  const itemA = recordsPanel.getByRole('region', { name: `批量视频任务 ${taskA}`, exact: true })
  const itemC = recordsPanel.getByRole('region', { name: `批量视频任务 ${taskC}`, exact: true })
  await itemA.getByText('已登记 1 份候选，尚未自动采用', { exact: true }).waitFor()
  await itemC.getByText('任务状态：失败', { exact: true }).waitFor()
  await itemC.getByText('视频供应商返回失败', { exact: true }).waitFor()
  await recordsPanel.getByRole('region', { name: `批量视频任务 ${(await records('unit-two'))[0].task_id}`, exact: true }).getByText('任务状态：等待执行', { exact: true }).waitFor()
  for (const id of ['unit-one', 'unit-two', 'unit-three']) assert.equal((await records(id)).length, 1)
  assert.deepEqual((await (await fetch(`${versionsUrl}/${version.id}`)).json()).data, beforeCompletion)
  console.log(`PASS independent A/B/C preflight and submission; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
