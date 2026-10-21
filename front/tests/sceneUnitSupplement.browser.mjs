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
const api = 'http://127.0.0.1:8245'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.directing.scene_version_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8245' },
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4245, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  page = await context.newPage()
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const create = await fetch(versionsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), title: '覆盖编辑验收' }) })
  assert.equal(create.status, 200)
  const version = (await create.json()).data
  const content = version.content
  const note = text => ({ state: 'proposal', text, sources: [{ kind: 'human', reference: 'supplement-browser', version: '1' }] })
  content.design.direction.shots = [{ id: 'shot-one', beat_ids: [], event_ids: [], blocking_state_ids: [], participant_ids: [], criterion_ids: [], narrative_function: {}, visible_result: note('拆信；读信；抬头') }]
  content.units = ['source-a', 'source-b'].map((id, index) => ({ id, ratio: '16:9', model_id: index ? 'browser-video-model' : null, parameters: { seed: index ? 29 : 17 }, instruction: index ? '来源B指令' : '来源A指令', coverage: [{ id: id + '-coverage', shot_id: 'shot-one', action_scope: index ? '读信；抬头' : '拆信' }] }))
  const detail = `${versionsUrl}/${version.id}`
  const saved = await fetch(detail, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: 1, content }) })
  assert.equal(saved.status, 200, await saved.text())
  const before = (await (await fetch(detail)).json()).data.content
  await page.goto(`http://127.0.0.1:4245/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await (await workbenchShot(page, '镜头 1：拆信；读信；抬头')).click()
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await page.getByRole('combobox', { name: '当前单元', exact: true }).click()
  await page.locator('.ant-select-dropdown:visible').getByText(/单元 2 · 读信；抬头/).click()
  await page.getByRole('button', { name: 'AI设计', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'AI设计', exact: true })
  await dialog.getByText('视频模型能力已核实', { exact: true }).waitFor()
  const start = dialog.getByRole('button', { name: '开始设计', exact: true })
  assert.equal(await start.isDisabled(), false, 'selected source video model must be visibly preselected')
  await start.click()
  await dialog.getByText('等待执行', { exact: true }).waitFor()
  const rows = (await (await fetch(detail + '/unit-design-suggestions')).json()).data
  assert.equal(rows[0].request.source_unit_id, 'source-b')
  assert.equal(rows[0].request.target_model_id, 'browser-video-model')
  const completed = await fetch(`${api}/browser-test/unit-design-tasks/${rows[0].task_id}/complete-supplement`, { method: 'POST' })
  assert.equal(completed.status, 200, await completed.text())
  await dialog.getByRole('heading', { name: '单元方案预览', exact: true }).waitFor({ timeout: 15000 })
  await dialog.getByText('保留原单元，仅补拍抬头', { exact: true }).waitFor()
  await dialog.getByText('继承来源：source-b', { exact: true }).waitFor()
  await dialog.getByText('继承的准备输入', { exact: true }).click()
  await dialog.getByText('参数：{"seed":29}', { exact: true }).waitFor()
  await dialog.getByText('真实参考：尚未绑定', { exact: true }).waitFor()
  assert.deepEqual((await (await fetch(detail)).json()).data.content, before)
  await page.screenshot({ path: join(output, 'unit-supplement-desktop.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  await delay(300)
  assert.equal(await dialog.evaluate(node => node.getBoundingClientRect().bottom <= window.innerHeight + 1), true)
  await page.screenshot({ path: join(output, 'unit-supplement-mobile.png'), animations: 'disabled' })
  assert.equal(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true)
  await page.setViewportSize({ width: 1440, height: 960 })
  await dialog.getByRole('button', { name: '确认应用方案', exact: true }).click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.locator('.canvas-toolbar-identity [role="status"]').filter({ hasText: '已保存' }).waitFor()
  const after = (await (await fetch(detail)).json()).data.content
  assert.deepEqual(after.units.slice(0, 2), before.units)
  assert.equal(after.units[2].id, 'browser-supplement')
  assert.equal(after.units[2].parameters.seed, 29)
  assert.equal(after.units[2].instruction, '来源B指令')
  assert.equal(after.units[2].instruction_basis_id, null)
  assert.equal(after.units[2].instruction_check_task_id, null)
  assert.equal((await (await fetch(`${api}/api/v1/llm/model-settings`)).json()).data.default_video_model_id, null)
  await page.goto(`http://127.0.0.1:4245/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}&view=units&directorShot=shot-one`)
  assert.deepEqual((await (await fetch(detail)).json()).data.content, after)
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await page.getByRole('combobox', { name: '当前单元', exact: true }).click()
  await page.locator('.ant-select-dropdown:visible').getByText(/单元 1 · 拆信/).click()
  await page.getByRole('button', { name: 'AI设计', exact: true }).click()
  await dialog.getByRole('combobox', { name: '单元设计记录', exact: true }).click()
  await page.locator('.ant-select-dropdown:visible').getByText('shot-one · 已生成', { exact: true }).click()
  await dialog.getByText('所选单元：source-b', { exact: true }).waitFor()
  await dialog.getByText('继承来源：source-b', { exact: true }).waitFor()
  console.log(`PASS selected source supplement preserves original units and inherits source B; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true, animations: 'disabled' }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
