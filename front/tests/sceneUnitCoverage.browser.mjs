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
    { id: 'coverage-two', shot_id: 'shot-one', beat_ids: [], event_ids: [], action_scope: '' },
  ] }]
  const saved = await fetch(`${versionsUrl}/${version.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: version.revision, content }) })
  assert.equal(saved.status, 200, await saved.text())
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await (await workbenchShot(page, '镜头 1：读信反应')).click()
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await page.getByRole('combobox', { name: '当前单元', exact: true }).press('ArrowDown')
  await page.getByRole('combobox', { name: '当前单元', exact: true }).press('Enter')
  await unitSettings(page)
  await page.getByRole('button', { name: '明确覆盖 2 的动作范围', exact: true }).click()
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '覆盖 2 动作范围')
  await unitSettings(page)
  assert.equal(await page.getByRole('textbox', { name: '覆盖 2 动作范围', exact: true }).evaluate(field => {
    const box = field.getBoundingClientRect(), viewport = field.closest('.wb-details-body').getBoundingClientRect()
    return box.top >= viewport.top - 2 && box.bottom <= viewport.bottom + 2
  }), true, 'missing-field navigation must reveal the focused coverage field')
  await unitSettings(page)
  await page.getByRole('textbox', { name: '覆盖 2 动作范围', exact: true }).fill('抬头看向门口')
  await unitSettings(page)
  await page.getByRole('combobox', { name: '覆盖 2 节拍', exact: true }).press('ArrowDown')
  await page.locator('.ant-select-dropdown:visible').getByText('节拍 2：目标 2', { exact: true }).click()
  await page.keyboard.press('Escape')
  await unitSettings(page)
  await page.getByRole('combobox', { name: '覆盖 2 事件', exact: true }).press('ArrowDown')
  await page.locator('.ant-select-dropdown:visible').getByText('事件 1：拆开信封', { exact: true }).click()
  await page.keyboard.press('Escape')
  await page.getByText('参与对象：读信者', { exact: true }).first().waitFor()
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  const read = (await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.content.units[0]
  assert.deepEqual(read.coverage.map(row => row.action_scope), ['拆开信封', '抬头看向门口'])
  assert.deepEqual(read.coverage[0].beat_ids, ['beat-one'])
  assert.deepEqual(read.coverage[1].beat_ids, ['beat-two'])
  assert.deepEqual(read.coverage[1].event_ids, ['event-one'])
  await page.screenshot({ path: join(output, 'unit-coverage.png'), animations: 'disabled' })
  await (await workbenchControl(page, '保存设置', 'switch', '自动保存')).click()
  await unitSettings(page)
  await page.getByRole('textbox', { name: '覆盖 2 动作范围', exact: true }).fill('恢复后继续拍摄门口反应')
  await unitSettings(page)
  await page.getByRole('button', { name: '编辑模型参数', exact: true }).click()
  await page.getByRole('spinbutton', { name: '单元随机种子', exact: true }).fill('84')
  await page.getByRole('button', { name: '返回单元设置', exact: true }).click()
  page.once('dialog', dialog => dialog.accept())
  await page.reload()
  await page.getByRole('button', { name: '恢复编辑', exact: true }).click()
  await (await workbenchShot(page, '镜头 1：读信反应')).click()
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await page.getByRole('combobox', { name: '当前单元', exact: true }).press('ArrowDown')
  await page.getByRole('combobox', { name: '当前单元', exact: true }).press('Enter')
  await unitSettings(page)
  assert.equal(await page.getByRole('textbox', { name: '覆盖 2 动作范围', exact: true }).inputValue(), '恢复后继续拍摄门口反应')
  await unitSettings(page)
  await page.getByRole('button', { name: '编辑模型参数', exact: true }).click()
  assert.equal(await page.getByRole('spinbutton', { name: '单元随机种子', exact: true }).inputValue(), '84')
  await page.getByRole('button', { name: '返回单元设置', exact: true }).click()
  assert.deepEqual((await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.content.units[0], read)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await unitSettings(page)
  assert.equal(await page.getByRole('textbox', { name: '覆盖 2 动作范围', exact: true }).inputValue(), '恢复后继续拍摄门口反应')
  await unitSettings(page)
  await page.getByRole('button', { name: '编辑模型参数', exact: true }).click()
  assert.equal(await page.getByRole('spinbutton', { name: '单元随机种子', exact: true }).inputValue(), '')
  await page.getByRole('button', { name: '返回单元设置', exact: true }).click()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await unitSettings(page)
  assert.equal(await page.getByRole('textbox', { name: '覆盖 2 动作范围', exact: true }).inputValue(), '抬头看向门口')
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  const restored = (await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.content.units
  assert.equal(restored.length, 1)
  assert.equal(restored[0].id, 'unit-one')
  assert.equal(restored[0].coverage[1].action_scope, '恢复后继续拍摄门口反应')
  assert.deepEqual(restored[0].coverage[0], read.coverage[0])
  assert.deepEqual(restored[0].parameters, { seed: 84 })
  await unitSettings(page)
  await page.getByRole('spinbutton', { name: '单元预计时长', exact: true }).fill('3.5')
  await page.getByRole('button', { name: '当前执行器要求整秒时长，请修改预计时长', exact: true }).waitFor()
  await page.getByRole('button', { name: '当前执行器要求整秒时长，请修改预计时长', exact: true }).click()
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '单元预计时长')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  assert.equal((await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.content.units[0].duration_ms, 3500)
  assert.equal(await page.getByText('当前单元基础准备已齐备', { exact: true }).count(), 0)
  await unitSettings(page)
  await page.getByRole('textbox', { name: '覆盖 2 动作范围', exact: true }).fill('交接后继续核对的动作')
  const otherPage = await context.newPage()
  await otherPage.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  await otherPage.goto(page.url())
  await otherPage.getByRole('button', { name: '转到此页编辑', exact: true }).waitFor()
  await (await workbenchShot(otherPage, '镜头 1：读信反应')).click()
  await otherPage.getByRole('button', { name: '单元画布', exact: true }).click()
  await otherPage.getByRole('combobox', { name: '当前单元', exact: true }).press('ArrowDown')
  await otherPage.getByRole('combobox', { name: '当前单元', exact: true }).press('Enter')
  await unitSettings(otherPage)
  assert.equal(await otherPage.getByRole('textbox', { name: '覆盖 2 动作范围', exact: true }).isDisabled(), true)
  await closeWorkbenchDetails(otherPage)
  await otherPage.getByRole('button', { name: '转到此页编辑', exact: true }).click()
  await otherPage.getByRole('button', { name: '保存并交接', exact: true }).click()
  await otherPage.waitForFunction(() => !document.querySelector('[aria-label="覆盖 2 动作范围"]')?.disabled)
  await unitSettings(otherPage)
  assert.equal(await otherPage.getByRole('textbox', { name: '覆盖 2 动作范围', exact: true }).inputValue(), '交接后继续核对的动作')
  await unitSettings(page)
  assert.equal(await page.getByRole('textbox', { name: '覆盖 2 动作范围', exact: true }).isDisabled(), true)
  await otherPage.getByRole('textbox', { name: '覆盖 2 动作范围', exact: true }).fill('新编辑页保存的动作')
  await otherPage.getByRole('button', { name: '保存', exact: true }).click()
  await otherPage.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  const handedOff = (await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.content.units
  assert.equal(handedOff.length, 1)
  assert.equal(handedOff[0].id, 'unit-one')
  assert.equal(handedOff[0].coverage[1].action_scope, '新编辑页保存的动作')
  assert.deepEqual(handedOff[0].coverage[0], read.coverage[0])
  assert.deepEqual(handedOff[0].parameters, { seed: 84 })
  await otherPage.close()
  console.log(`PASS unit coverage browser workflow; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true, animations: 'disabled' }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
