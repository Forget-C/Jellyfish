import { unitSettings, workbenchShot } from './workbenchControls.mjs'
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
async function openUnitShot() {
  await (await workbenchShot(page, '镜头 1：读信反应')).click()
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
}
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
    { id: 'coverage-two', shot_id: 'shot-one', beat_ids: [], event_ids: [], action_scope: '' },
  ] }]
  content.units.push({ ...structuredClone(content.units[0]), id: 'unit-two' })
  const saved = await fetch(`${versionsUrl}/${version.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: version.revision, content }) })
  assert.equal(saved.status, 200, await saved.text())
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await openUnitShot()
  await page.getByRole('combobox', { name: '当前单元', exact: true }).press('ArrowDown')
  await page.getByRole('combobox', { name: '当前单元', exact: true }).press('Enter')
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  const body = page.getByRole('textbox', { name: '当前单元指令正文', exact: true })
  await body.fill('递出信封。')
  await page.getByText('指令依据尚未确认', { exact: true }).waitFor({ timeout: 5000 })
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  await page.getByRole('button', { name: '确认已按当前依据核对正文', exact: true }).click()
  await page.getByText('指令依据一致，尚不代表检查通过', { exact: true }).waitFor()
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  const confirmed = (await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.content.units[0]
  assert.ok(confirmed.instruction_basis_id)
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await unitSettings(page)
  await page.getByRole('textbox', { name: '单元动作范围', exact: true }).fill('收下信封')
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  await page.getByText('指令依据已变', { exact: true }).waitFor()
  assert.equal(await body.inputValue(), '递出信封。')
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  await page.reload()
  await openUnitShot()
  await page.getByRole('combobox', { name: '当前单元', exact: true }).press('ArrowDown')
  await page.getByRole('combobox', { name: '当前单元', exact: true }).press('Enter')
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  await page.getByText('指令依据已变', { exact: true }).waitFor()
  await page.getByText('查看新旧依据', { exact: true }).click()
  await page.getByRole('region', { name: '原确认依据', exact: true }).getByText('动作：拆开信封；', { exact: true }).waitFor()
  await page.getByRole('region', { name: '当前依据', exact: true }).getByText('动作：收下信封；', { exact: true }).waitFor()
  const currentScope = page.getByRole('region', { name: '当前依据', exact: true })
  assert.match(await currentScope.getByRole('region', { name: '本次执行项' }).innerText(), /收下信封/)
  const background = await currentScope.getByRole('region', { name: '解释背景' }).innerText()
  assert.match(background, /目标 1/)
  assert.doesNotMatch(background, /目标 2/)
  await body.fill('收下信封，低头看一眼。')
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  await page.getByRole('button', { name: '确认已按当前依据核对正文', exact: true }).click()
  await page.getByText('指令依据一致，尚不代表检查通过', { exact: true }).waitFor()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await page.getByText('指令依据已变', { exact: true }).waitFor()
  assert.equal(await body.inputValue(), '收下信封，低头看一眼。')
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await page.getByText('指令依据一致，尚不代表检查通过', { exact: true }).waitFor()
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  assert.notEqual((await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.content.units[0].instruction_basis_id, confirmed.instruction_basis_id)
  // A committed confirmation with a lost response must recover the exact request after reload.
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await unitSettings(page)
  await page.getByRole('textbox', { name: '单元动作范围', exact: true }).fill('收下信封并拆开')
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  await page.getByText('指令依据已变', { exact: true }).waitFor()
  let originalRequest, originalReceipt, confirmationLost
  const lostResponse = new Promise(resolve => { confirmationLost = resolve })
  await page.route('**/instruction-basis/confirm', async route => {
    originalRequest = route.request().postDataJSON()
    originalReceipt = (await (await route.fetch()).json()).data.basis_id
    await route.abort('failed')
    confirmationLost()
  })
  await page.getByRole('button', { name: '确认已按当前依据核对正文', exact: true }).click()
  await lostResponse
  await page.getByRole('button', { name: '核实原依据确认', exact: true }).waitFor()
  await page.waitForFunction(key => !!localStorage.getItem(key), `jellyfish:instruction-basis:canvas-project:${sequenceId}:${version.id}:unit-one`)
  await page.unroute('**/instruction-basis/confirm')
  await page.reload()
  await openUnitShot()
  await page.getByRole('combobox', { name: '当前单元', exact: true }).press('ArrowDown')
  await page.getByRole('combobox', { name: '当前单元', exact: true }).press('Enter')
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  await page.getByText('指令依据已变', { exact: true }).waitFor()
  let retryRequest
  await page.route('**/instruction-basis/confirm', async route => {
    retryRequest = route.request().postDataJSON()
    await route.continue()
  })
  await page.getByRole('button', { name: '核实原依据确认', exact: true }).click()
  await page.getByText('指令依据一致，尚不代表检查通过', { exact: true }).waitFor()
  assert.deepEqual(retryRequest, originalRequest)
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  assert.equal((await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.content.units[0].instruction_basis_id, originalReceipt)
  await page.unroute('**/instruction-basis/confirm')
  // A late confirmation cannot acknowledge text edited while its response was pending.
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await unitSettings(page)
  await page.getByRole('textbox', { name: '单元动作范围', exact: true }).fill('收下信封并阅读')
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  await page.getByText('指令依据已变', { exact: true }).waitFor()
  let releaseConfirmation, receivedConfirmation
  const confirmationGate = new Promise(resolve => { releaseConfirmation = resolve })
  const confirmationReceived = new Promise(resolve => { receivedConfirmation = resolve })
  await page.route('**/instruction-basis/confirm', async route => {
    const response = await route.fetch()
    receivedConfirmation()
    await confirmationGate
    await route.fulfill({ response })
  })
  await page.getByRole('button', { name: '确认已按当前依据核对正文', exact: true }).click()
  await confirmationReceived
  await body.fill('收下信封，取出信纸并阅读。')
  releaseConfirmation()
  await page.getByText('原确认已完成，但正文已变化，请重新核对后确认', { exact: true }).waitFor()
  await page.getByText('指令依据已变', { exact: true }).waitFor()
  assert.equal(await body.inputValue(), '收下信封，取出信纸并阅读。')
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  assert.equal((await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.content.units[0].instruction_basis_id, originalReceipt)
  await page.unroute('**/instruction-basis/confirm')
  await page.screenshot({ path: join(output, 'instruction-basis.png'), animations: 'disabled' })
  console.log(`PASS instruction basis workflow; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true, animations: 'disabled' }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
