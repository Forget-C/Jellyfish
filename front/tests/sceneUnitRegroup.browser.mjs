import { closeWorkbenchDetails } from './workbenchControls.mjs'
import { makeWorkspace } from './directing-fixtures.mjs'
import { workbenchControl } from './workbenchControls.mjs'
import { workbenchShot } from './workbenchControls.mjs'
import { unitSettings } from './workbenchControls.mjs'
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
const output = await mkdtemp(join(tmpdir(), 'jellyfish-unit-regroup-'))
const api = 'http://127.0.0.1:8246'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.directing.scene_version_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8246' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let backendOutput = ''
backend.stdout.on('data', data => { backendOutput += data })
backend.stderr.on('data', data => { backendOutput += data })
let server, browser, page
try {
  let chapter
  for (let attempt = 0; attempt < 120; attempt++) {
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
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const create = await fetch(versionsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), title: '单元整份重组验收' }) })
  assert.equal(create.status, 200)
  const version = (await create.json()).data
  const note = text => ({ state: 'proposal', text, sources: [{ kind: 'human', reference: 'revision-browser', version: '1' }] })
  const content = version.content
  content.design.direction.shots = [{ id: 'shot-one', beat_ids: [], event_ids: [], blocking_state_ids: [], participant_ids: [], criterion_ids: [], narrative_function: {}, visible_result: note('拆信；读信；抬头') }]
  content.units = ['target', 'retained', 'removed'].map(id => ({ id, model_id: 'browser-video-model', ratio: '16:9', instruction: '人工保留指令', instruction_source: { kind: 'human', reference: 'revision-browser', version: '1' }, coverage: [{ id: id + '-coverage', shot_id: 'shot-one', action_scope: '拆信；读信；抬头' }] }))
  const detail = `${versionsUrl}/${version.id}`
  const saved = await fetch(detail, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: version.revision, content }) })
  assert.equal(saved.status, 200, await saved.text())
  const before = (await (await fetch(detail)).json()).data
  await page.goto(`http://127.0.0.1:4246/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await (await workbenchShot(page, '镜头 1：拆信；读信；抬头')).click()
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  const combo = page.getByRole('combobox', { name: '当前单元', exact: true })
  await combo.click()
  await page.locator('.ant-select-dropdown:visible').getByText('单元 1 · 拆信；读信；抬头', { exact: true }).click()
  await page.getByRole('button', { name: 'AI设计', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'AI设计', exact: true })
  await dialog.getByText('所选单元：target', { exact: true }).waitFor({ timeout: 5000 })
  await dialog.getByText('视频模型能力已核实', { exact: true }).waitFor()
  const start = dialog.getByRole('button', { name: '开始设计', exact: true })
  assert.equal(await start.isDisabled(), false, 'selected valid unit model is the visible default even without a global default')
  let previous = before
  for (const [mode, expectedCount] of [['reduce', 2], ['split', 3], ['merge', 1]]) {
    if (mode !== 'reduce') {
      const selector = page.getByRole('combobox', { name: '当前单元', exact: true })
      await selector.click()
      await page.locator('.ant-select-dropdown:visible').getByText(/^单元 1 ·/).click()
      await page.getByRole('button', { name: 'AI设计', exact: true }).click()
      await dialog.getByRole('button', { name: '重新设计', exact: true }).click()
      await dialog.getByText('视频模型能力已核实', { exact: true }).waitFor()
    }
    await dialog.getByRole('textbox', { name: '本次要求（可选）', exact: true }).fill(mode)
    await dialog.getByRole('button', { name: '开始设计', exact: true }).click()
    await dialog.getByText('等待执行', { exact: true }).waitFor()
    const rows = (await (await fetch(detail + '/unit-design-suggestions')).json()).data
    const complete = await fetch(`${api}/browser-test/unit-design-tasks/${rows[0].task_id}/complete-regroup?mode=${mode}`, { method: 'POST' })
    assert.equal(complete.status, 200, await complete.text())
    await dialog.getByRole('heading', { name: '单元方案预览', exact: true }).waitFor({ timeout: 15000 })
    assert.equal(await dialog.getByRole('heading', { name: /^移除 ·/ }).count(), mode === 'merge' ? 3 : 1)
    if (mode !== 'reduce') assert.equal(await dialog.getByRole('heading', { name: /^新增 ·/ }).count(), mode === 'split' ? 2 : 1)
    assert.deepEqual((await (await fetch(detail)).json()).data, previous)
    await page.screenshot({ path: join(output, `unit-regroup-${mode}-desktop.png`), animations: 'disabled' })
    await page.setViewportSize({ width: 390, height: 844 })
    await delay(300)
    const confirmation = dialog.getByRole('button', { name: '确认应用方案', exact: true })
    const box = await confirmation.boundingBox()
    assert.ok(box && box.y >= 0 && box.y + box.height <= 844)
    assert.equal(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true)
    await page.screenshot({ path: join(output, `unit-regroup-${mode}-mobile.png`), animations: 'disabled' })
    await confirmation.click()
    await dialog.waitFor({ state: 'hidden' })
    for (let attempt = 0; attempt < 60; attempt++) {
      const after = (await (await fetch(detail)).json()).data
      if (after.revision > previous.revision) { previous = after; break }
      await delay(250)
    }
    assert.equal(previous.content.units.length, expectedCount)
    if (mode === 'merge') assert.ok(previous.content.units.every(unit => !['target', 'retained', 'removed'].includes(unit.id)))
    await page.setViewportSize({ width: 1440, height: 960 })
  }
  await page.reload()
  assert.equal((await (await fetch(detail)).json()).data.content.units.length, 1)
  console.log(`PASS three-to-two, split and merge through real AI task, preview, single confirmation, save and reload; desktop/mobile evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true, animations: 'disabled' }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
