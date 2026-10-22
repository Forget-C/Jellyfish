import { closeWorkbenchDetails, selectWorkbenchOption } from './workbenchControls.mjs'
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
    { id: 'coverage-two', shot_id: 'shot-one', beat_ids: [], event_ids: [], action_scope: '' },
  ] }]
  content.units.push({ ...structuredClone(content.units[0]), id: 'unit-two' })
  const saved = await fetch(`${versionsUrl}/${version.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: version.revision, content }) })
  assert.equal(saved.status, 200, await saved.text())
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await page.locator('[data-canvas-node="shot:shot-one"]').getByRole('button', { name: /^进入子图：/ }).click()
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await page.locator('[data-canvas-node="unit:unit-one"]').getByRole('button', { name: /^进入子图：/ }).click()
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  assert.equal(await page.locator('[data-canvas-node="instruction:unit-one"]').count(), 1)
  await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).fill('第一单元：拆信特写。\n停留在手部。')
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await page.getByRole('combobox', { name: '指令所属单元', exact: true }).press('ArrowDown')
  await page.getByText('单元 2 · 拆开信封；', { exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).inputValue(), '')
  await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).fill('第二单元：人物抬头。')
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  const read = (await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.content.units
  assert.deepEqual(read.map(unit => unit.id), ['unit-one', 'unit-two'])
  assert.deepEqual(read.map(unit => unit.instruction), ['第一单元：拆信特写。\n停留在手部。', '第二单元：人物抬头。'])
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).inputValue(), '')
  await page.getByRole('button', { name: '重做', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).inputValue(), '第二单元：人物抬头。')
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  const textbox = page.getByRole('textbox', { name: '当前单元指令正文', exact: true })
  let releaseSave, savedRequest
  const held = new Promise(resolve => { savedRequest = resolve })
  const release = new Promise(resolve => { releaseSave = resolve })
  const detailUrl = `**/sequences/${sequenceId}/versions/${version.id}`
  await page.route(detailUrl, async route => {
    if (route.request().method() !== 'PUT') return route.continue()
    const response = await route.fetch()
    savedRequest()
    await release
    await route.fulfill({ response })
  }, { times: 1 })
  await textbox.fill('保存中的正文')
  await textbox.evaluate(node => { node.dataset.stableEditor = 'retained' })
  await held
  const longText = '继续输入并保留完整自由文本。'.repeat(120)
  await textbox.fill(longText)
  await textbox.evaluate(node => { node.setSelectionRange(7, 12); node.focus() })
  releaseSave()
  await page.waitForTimeout(300)
  assert.equal(await textbox.inputValue(), longText, 'late save responses preserve newer text')
  assert.equal(await textbox.getAttribute('data-stable-editor'), 'retained', 'saved graph updates preserve the same editor')
  assert.deepEqual(await textbox.evaluate(node => [node.selectionStart, node.selectionEnd]), [7, 12])
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  assert.equal((await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.content.units[1].instruction, longText)
  const instructionCard = page.getByLabel('指令画布视口', { exact: true }).locator('[data-canvas-node]').filter({ has: page.getByRole('button', { name: '修改指令', exact: true }) })
  assert.ok(await instructionCard.evaluate(node => node.getBoundingClientRect().height <= 600), '长正文只占有限摘要卡')
  assert.equal(await instructionCard.evaluate(node => {
    const rect = node.getBoundingClientRect()
    return [...node.querySelectorAll('button')].every(button => button.getBoundingClientRect().bottom <= rect.bottom)
  }), true, '长正文不挤掉明确操作')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('combobox', { name: '指令所属单元', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await textbox.focus()
  await textbox.press('ArrowLeft')
  assert.equal(await textbox.evaluate(node => document.activeElement === node), true)
  await page.screenshot({ path: join(output, 'instruction-narrow.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.route(detailUrl, async route => {
    if (route.request().method() !== 'PUT') return route.continue()
    const response = await route.fetch()
    const body = await response.json()
    delete body.data.instruction_graph
    await route.fulfill({ response, json: body })
  }, { times: 1 })
  await textbox.fill('响应缺少指令图时保留的输入')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '保存失败' }).waitFor()
  assert.equal(await textbox.inputValue(), '响应缺少指令图时保留的输入')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  assert.equal((await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.content.units[1].instruction, '响应缺少指令图时保留的输入')
  await page.evaluate(() => {
    localStorage.setItem('jellyfish:scene-autosave:local-user', 'off')
    window.dispatchEvent(new StorageEvent('storage', { key: 'jellyfish:scene-autosave:local-user', newValue: 'off' }))
  })
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await page.getByRole('button', { name: '建立单元', exact: true }).click()
  await selectWorkbenchOption(page, '新增单元目标镜头', '镜头 1')
  await page.getByRole('dialog', { name: '建立单元', exact: true }).getByRole('button', { name: '创建单元', exact: true }).click()
  await page.getByRole('dialog', { name: '建立单元', exact: true }).waitFor({ state: 'hidden' })
  await page.getByRole('textbox', { name: '单元动作范围', exact: true }).fill('新单元动作')
  await closeWorkbenchDetails(page)
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  await textbox.fill('新单元首次保存保留编辑器')
  await textbox.evaluate(node => { node.dataset.newEditor = 'retained'; node.setSelectionRange(2, 5) })
  await page.getByText('此单元尚未保存，图待同步。继续编辑当前正文。', { exact: true }).waitFor()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  assert.equal(await textbox.getAttribute('data-new-editor'), 'retained', 'first saved graph keeps the existing editor DOM')
  assert.equal(await textbox.inputValue(), '新单元首次保存保留编辑器')
  assert.deepEqual(await textbox.evaluate(node => [node.selectionStart, node.selectionEnd]), [2, 5])
  await page.getByRole('button', { name: '定位画布节点', exact: true }).click()
  await page.getByRole('menuitem', { name: '本单元执行依据', exact: true }).click()
  await page.getByRole('button', { name: '查看节点：本单元执行依据', exact: true }).press('Enter')
  await page.getByRole('region', { name: '本次执行项', exact: true }).waitFor()
  const sourceRow = page.getByRole('region', { name: '本次执行项', exact: true }).getByRole('listitem').filter({ hasText: 'action_scope' }).first()
  await sourceRow.getByRole('button', { name: '定位来源字段', exact: true }).click()
  const actionScope = page.getByRole('textbox', { name: '单元动作范围', exact: true })
  await actionScope.waitFor()
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '单元动作范围')
  assert.equal(await actionScope.inputValue(), '新单元动作')
  await closeWorkbenchDetails(page)
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  await page.screenshot({ path: join(output, 'manual-instruction.png'), animations: 'disabled' })
  console.log(`PASS manual unit instructions; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true, animations: 'disabled' }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
