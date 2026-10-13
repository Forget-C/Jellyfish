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
  content.design.direction.beats = ['beat-one', 'beat-two'].map((id, index) => ({ id, event_ids: [], objective: note(`目标 ${index + 1}`), obstacle: {}, expected_change: {}, must_show: {} }))
  content.design.events = [{ id: 'event-one', description: note('拆开信封') }]
  content.design.participants = [{ id: 'reader', name: '读信者' }]
  content.design.direction.shots = [{ id: 'shot-one', beat_ids: ['beat-one', 'beat-two'], event_ids: ['event-one'], blocking_state_ids: [], participant_ids: ['reader'], criterion_ids: [], narrative_function: {}, visible_result: note('读信反应') }]
  content.units = [{ id: 'unit-one', model_id: 'browser-video-model', duration_ms: 5000, ratio: '16:9', coverage: [
    { id: 'coverage-one', shot_id: 'shot-one', beat_ids: ['beat-one'], event_ids: [], action_scope: '拆开信封' },

  ] }]
  content.units.push({ ...structuredClone(content.units[0]), id: 'unit-two' })
  const saved = await fetch(`${versionsUrl}/${version.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: version.revision, content }) })
  assert.equal(saved.status, 200, await saved.text())
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await page.getByRole('button', { name: '镜头 1：读信反应', exact: true }).click()
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await page.getByRole('combobox', { name: '当前单元', exact: true }).press('ArrowDown')
  await page.getByRole('combobox', { name: '当前单元', exact: true }).press('Enter')
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  const body = page.getByRole('textbox', { name: '当前单元指令正文', exact: true })
  await body.fill('历史场次的原指令。')
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await page.getByRole('button', { name: '确认已按当前依据核对正文', exact: true }).click()
  await page.getByText('指令依据一致，尚不代表检查通过', { exact: true }).waitFor()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await page.getByRole('button', { name: '检查当前指令', exact: true }).click({ timeout: 5000 })
  await page.getByText('检查任务：等待执行', { exact: true }).waitFor()
  const checksUrl = `${versionsUrl}/${version.id}/units/unit-one/instruction-checks`
  const tasks = (await (await fetch(checksUrl)).json()).data
  assert.equal(tasks.length, 1)
  assert.equal((await fetch(`${api}/browser-test/instruction-checks/${tasks[0].task_id}/complete`, { method: 'POST' })).status, 200)
  await page.getByRole('button', { name: '查看检查结果', exact: true }).click()
  await page.getByText('六岗检查均通过，尚待明确核对结果', { exact: true }).waitFor()
  assert.equal(await page.getByText('检查夹具：动作表达一致', { exact: true }).count(), 6)
  await page.getByRole('switch', { name: '自动保存', exact: true }).click()
  await page.getByRole('button', { name: '确认已核对检查结果', exact: true }).click()
  await page.getByText('当前指令检查结果已确认', { exact: true }).waitFor()
  await page.getByRole('status').filter({ hasText: '未保存' }).waitFor()
  await page.getByRole('button', { name: '保存并生成视频', exact: true }).click()
  await page.getByText('视频任务：等待执行', { exact: true }).waitFor()
  const videoUrl = `${versionsUrl}/${version.id}/units/unit-one/video`
  const original = (await (await fetch(videoUrl)).json()).data[0]
  const completed = await fetch(`${api}/browser-test/video-tasks/${original.task_id}/complete`, { method: 'POST' })
  assert.equal(completed.status, 200, await completed.text())
  const take = (await (await fetch(videoUrl)).json()).data[0].takes[0]
  const second = await fetch(versionsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), title: 'B 历史导航' }) })
  assert.equal(second.status, 200)
  const b = (await second.json()).data
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${b.id}`)
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  const autoSave = page.getByRole('switch', { name: '自动保存', exact: true })
  if (await autoSave.getAttribute('aria-checked') === 'true') await autoSave.click()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  await page.getByRole('button', { name: '选择素材 1', exact: true }).click()
  const judgmentBody = page.getByRole('textbox', { name: '素材审查说明', exact: true })
  await judgmentBody.fill('B 未保存的素材判断')
  await page.route(`**/versions/${version.id}`, route => route.abort('failed'))
  await page.getByRole('button', { name: '打开所属版本继续编辑', exact: true }).click({ timeout: 5000 })
  await page.getByText('所属版本打开失败', { exact: true }).waitFor()
  assert.equal(new URL(page.url()).searchParams.get('version'), b.id)
  assert.equal(await judgmentBody.inputValue(), 'B 未保存的素材判断')
  await page.unroute(`**/versions/${version.id}`)
  const originalA = (await (await fetch(`${versionsUrl}/${version.id}`)).json()).data
  const removedContent = structuredClone(originalA.content)
  removedContent.units = removedContent.units.filter(unit => unit.id !== 'unit-one')
  const removed = await fetch(`${versionsUrl}/${version.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: originalA.revision, content: removedContent }) })
  assert.equal(removed.status, 200, await removed.clone().text())
  const removedVersion = (await removed.json()).data
  await page.getByRole('button', { name: '打开所属版本继续编辑', exact: true }).click()
  await page.getByText('原视频单元或关联镜头已不可用，未切换或选择替代对象', { exact: true }).waitFor()
  assert.equal(new URL(page.url()).searchParams.get('version'), b.id)
  assert.equal(await judgmentBody.inputValue(), 'B 未保存的素材判断')
  assert.equal(await page.getByRole('dialog', { name: '有未保存的修改', exact: true }).count(), 0)
  const restored = await fetch(`${versionsUrl}/${version.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: removedVersion.revision, content: originalA.content }) })
  assert.equal(restored.status, 200, await restored.clone().text())

  await page.getByRole('button', { name: '打开所属版本继续编辑', exact: true }).click()
  const protection = page.getByRole('dialog', { name: '有未保存的修改', exact: true })
  await protection.getByRole('button', { name: '取消，继续编辑', exact: true }).click()
  assert.equal(await judgmentBody.inputValue(), 'B 未保存的素材判断')
  await page.getByRole('button', { name: '打开所属版本继续编辑', exact: true }).click()
  await page.route(`**/versions/${b.id}`, route => route.request().method() === 'PUT' ? route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ detail: '保存失败夹具' }) }) : route.continue())
  await protection.getByRole('button', { name: '保存并切换', exact: true }).click()
  await protection.getByText('保存未完成，请重试或取消切换', { exact: true }).waitFor()
  assert.equal(new URL(page.url()).searchParams.get('version'), b.id)
  await protection.getByRole('button', { name: '取消，继续编辑', exact: true }).click()
  await page.unroute(`**/versions/${b.id}`)
  assert.equal(await judgmentBody.inputValue(), 'B 未保存的素材判断')
  await page.getByRole('button', { name: '打开所属版本继续编辑', exact: true }).click()
  await protection.getByRole('button', { name: '放弃修改并切换', exact: true }).click()
  await page.waitForURL(url => url.searchParams.get('version') === version.id)
  await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).waitFor()
  assert.deepEqual((await (await fetch(`${versionsUrl}/${b.id}`)).json()).data, b)
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${b.id}`)
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  await page.getByRole('button', { name: '选择素材 1', exact: true }).click()
  await judgmentBody.fill('B 明确保存后返回 A')
  await page.getByRole('button', { name: '打开所属版本继续编辑', exact: true }).click()
  await protection.getByRole('button', { name: '保存并切换', exact: true }).click()
  await page.waitForURL(url => url.searchParams.get('version') === version.id)
  await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).waitFor()
  const savedB = (await (await fetch(`${versionsUrl}/${b.id}`)).json()).data
  assert.equal(savedB.content.take_judgments[0].annotation.rationale.text, 'B 明确保存后返回 A')

  console.log(`PASS explicit origin version navigation with cancel, save failure and discard protection; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
