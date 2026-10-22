import { closeWorkbenchDetails } from './workbenchControls.mjs'
import { unitCard } from './workbenchControls.mjs'
import { workbenchControl, workbenchShot, selectWorkbenchOption } from './workbenchControls.mjs'
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
  const content = version.content
  const note = text => ({ state: 'proposal', text, sources: [{ kind: 'human', reference: 'navigation', version: '1' }] })
  content.design.direction.shots = ['A', 'B', 'C'].map(id => ({ id, beat_ids: [], event_ids: [], blocking_state_ids: [], criterion_ids: [], narrative_function: {}, visible_result: note(id) }))
  content.design.direction.shots.push(...Array.from({ length: 57 }, (_, index) => ({ id: `dense-${index + 4}`, beat_ids: [], event_ids: [], blocking_state_ids: [], criterion_ids: [], narrative_function: {}, visible_result: note(`密集镜头 ${index + 4}`) })))
  content.units = ['A1', 'A2', 'B1', 'B2', 'C1'].map(id => ({ id, ratio: '16:9', instruction: `${id}正文`, coverage: [{ id: `${id}-coverage`, shot_id: id[0], action_scope: `${id}动作` }] }))
  const saved = await fetch(`${versionsUrl}/${version.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: 1, content }) })
  assert.equal(saved.status, 200, await saved.text())
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  await (await workbenchControl(page, '保存设置', 'switch', '自动保存')).click()
  const shot = async (index, name) => {
    await page.getByRole('button', { name: '导演画布', exact: true }).click()
    await (await workbenchShot(page, `镜头 ${index}：${name}`)).click()
  }
  await shot(1, 'A')
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await selectWorkbenchOption(page, '当前单元', '单元 2')
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).inputValue(), 'A2正文')
  await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).fill('A2未保存正文')
  await shot(3, 'C')
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).inputValue({ timeout: 5000 }), 'C1正文')
  await shot(2, 'B')
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).count(), 0)
  await page.getByRole('combobox', { name: '指令所属单元', exact: true }).press('ArrowDown')
  await page.locator('.ant-select-dropdown:visible').getByText('单元 4 · B2动作', { exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).inputValue(), 'B2正文')
  await shot(1, 'A')
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).inputValue(), 'A2未保存正文')
  await shot(2, 'B')
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await unitCard(page)
  assert.equal(await page.getByRole('textbox', { name: '单元动作范围', exact: true }).inputValue(), 'B2动作')
  assert.equal((await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.content.units[1].instruction, 'A2正文')
  await unitCard(page)
  await page.getByRole('combobox', { name: '覆盖 1 所属镜头', exact: true }).press('ArrowDown')
  const coverageMenu = page.locator('.ant-select-dropdown').filter({ visible: true })
  await coverageMenu.locator('.rc-virtual-list-holder').evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')) })
  await coverageMenu.getByText('镜头 3：C', { exact: true }).click()
  await page.getByRole('heading', { name: '覆盖 1 · 镜头 3', exact: true }).waitFor()
  await unitCard(page)
  assert.equal(await page.getByRole('textbox', { name: '单元动作范围', exact: true }).inputValue(), 'B2动作')
  await shot(1, 'A')
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).inputValue(), 'A2未保存正文')
  await shot(2, 'B')
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await unitCard(page)
  assert.equal(await page.getByRole('textbox', { name: '单元动作范围', exact: true }).inputValue(), 'B2动作', '单元子图按明确身份保留已移动的B2，不按B镜头改选B1')
  await closeWorkbenchDetails(page)
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).inputValue(), 'B2正文')
  const relations = page.getByRole('navigation', { name: '场次关系树', exact: true })
  await relations.getByRole('button', { name: '展开关系树', exact: true }).click()
  await relations.getByRole('button', { name: '展开镜头 1', exact: true }).click({ timeout: 5000 })
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).inputValue(), 'B2正文')
  await relations.getByRole('button', { name: '展开单元 2', exact: true }).click()
  await relations.getByRole('button', { name: '定位单元 2 的指令', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).inputValue(), 'A2未保存正文')
  await relations.getByRole('button', { name: '定位单元 1：镜头 1 — 单元 1', exact: true }).click()
  await unitCard(page)
  assert.equal(await page.getByRole('textbox', { name: '单元动作范围', exact: true }).inputValue(), 'A1动作')
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).inputValue(), 'A1正文')
  await relations.getByRole('button', { name: '定位镜头 3：C', exact: true }).click()
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).inputValue(), 'B2正文')
  await relations.getByRole('button', { name: '定位单元 2 的指令', exact: true }).focus()
  await page.keyboard.press('Enter')
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).inputValue(), 'A2未保存正文')
  assert.equal((await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.content.units[1].instruction, 'A2正文')
  await page.screenshot({ path: join(output, 'relations.png'), fullPage: true, animations: 'disabled' })
  const longInstruction = '窄屏长指令：人物递出信封，保持动作与视线连续。'.repeat(120) + '末尾验收标记'
  await page.setViewportSize({ width: 390, height: 844 })
  await relations.getByRole('button', { name: '定位单元 2 的指令', exact: true }).click()
  await relations.getByRole('button', { name: '展开关系树', exact: true }).waitFor({ timeout: 5000 })
  await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).fill(longInstruction)
  await relations.getByRole('button', { name: '展开关系树', exact: true }).click()
  await relations.getByRole('button', { name: '定位单元 1：镜头 1 — 单元 1', exact: true }).click()
  await unitCard(page)
  await page.getByRole('textbox', { name: '单元动作范围', exact: true }).fill('窄屏 A1 动作')
  await closeWorkbenchDetails(page)
  await relations.getByRole('button', { name: '展开关系树', exact: true }).click()
  await relations.getByRole('button', { name: '定位单元 2 的指令', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).inputValue(), longInstruction)
  const primary = page.getByRole('navigation', { name: '当前指令主操作', exact: true })
  await primary.getByRole('button', { name: '核对当前单元指令依据', exact: true }).waitFor()
  const toolbarBounds = await page.locator('.canvas-workbench-toolbar').boundingBox()
  const primaryBounds = await primary.boundingBox()
  assert.ok(primaryBounds.y >= toolbarBounds.y && primaryBounds.y + primaryBounds.height <= toolbarBounds.y + toolbarBounds.height, '窄屏主操作位于工具栏操作区内')
  await primary.getByRole('button', { name: '核对当前单元指令依据', exact: true }).click()
  await relations.getByRole('button', { name: '展开关系树', exact: true }).click()
  await relations.getByRole('button', { name: '定位镜头 60：密集镜头 60', exact: true }).click()
  await page.locator('[data-layout-view="shot:dense-60"]').waitFor()
  assert.match(await page.locator('.canvas-director-location').innerText(), /镜头 60 子图/)
  await relations.getByRole('button', { name: '展开关系树', exact: true }).click()
  await relations.getByRole('button', { name: '定位单元 2 的指令', exact: true }).click()
  const longBody = page.getByRole('textbox', { name: '当前单元指令正文', exact: true })
  assert.equal(await longBody.inputValue(), longInstruction)
  await longBody.focus()
  await longBody.press('ControlOrMeta+A')
  await longBody.press('ArrowRight')
  assert.equal(await longBody.evaluate(node => node.selectionEnd), longInstruction.length)
  assert.equal((await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.content.units[1].instruction, 'A2正文')
  await page.screenshot({ path: join(output, 'relations-narrow.png'), fullPage: true, animations: 'disabled' })

  console.log(`PASS per-shot unit memory, unique selection and unsaved cross-canvas navigation; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true, animations: 'disabled' }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
