import { workbenchControl } from './workbenchControls.mjs'
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
  const create = await fetch(versionsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), title: '引用冲突验收' }) })
  assert.equal(create.status, 200)
  const version = (await create.json()).data
  const content = version.content
  content.design.direction.shots = ['shot-one', 'shot-two'].map(id => ({ id, beat_ids: [], event_ids: [], blocking_state_ids: [], participant_ids: null, criterion_ids: [], narrative_function: {}, visible_result: { state: 'proposal', text: '相同名称', sources: [{ kind: 'human', reference: 'local-user', version: '1' }] } }))
  content.units = [{ id: 'unit-one', ratio: '16:9', coverage: [{ id: 'coverage-one', shot_id: 'shot-one', action_scope: '保留实际拍摄范围' }] }]
  const saved = await fetch(`${versionsUrl}/${version.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: version.revision, content }) })
  assert.equal(saved.status, 200, await saved.text())
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await (await workbenchControl(page, '更多操作', 'button', 'AI 设计')).click()
  await page.locator('.scene-ai-footer').getByRole('button', { name: '重新生成整场', exact: true }).click()
  await page.getByText('状态：等待执行', { exact: true }).waitFor()
  const tasks = (await (await fetch(`${versionsUrl}/${version.id}/design-suggestions`)).json()).data
  assert.equal((await fetch(`${api}/browser-test/design-tasks/${tasks[0].task_id}/complete?remove_shot_id=shot-one`, { method: 'POST' })).status, 200)
  await page.getByText('建议与当前单元引用冲突，整次应用已阻止', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '应用到当前版本', exact: true }).isDisabled(), true)
  const ai = page.getByRole('dialog', { name: 'AI 设计', exact: true })
  await ai.locator('.scene-ai-context summary').click()
  assert.equal(await ai.getByRole('region', { name: '设计要求', exact: true }).getByText('未填写', { exact: true }).count(), 1)
  assert.equal(await ai.getByRole('region', { name: '原文依据', exact: true }).getByText('未填写', { exact: true }).count(), 0)
  const newDesign = ai.getByRole('button', { name: '发起新设计', exact: true })
  assert.equal(await newDesign.locator('.anticon-plus').count(), 1)
  assert.notEqual(await newDesign.evaluate(node => getComputedStyle(node).borderStyle), 'none')
  await newDesign.click({ trial: true })
  await page.screenshot({ path: join(output, 'ai-basis-and-actions.png'), animations: 'disabled' })

  assert.equal((await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.content.design.direction.shots.length, 2)
  await page.getByRole('button', { name: '定位单元 1 · 覆盖 1', exact: true }).click()
  await page.getByRole('combobox', { name: '覆盖 1 所属镜头', exact: true }).press('ArrowDown')
  await page.getByText('镜头 2：相同名称', { exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  const repaired = (await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.content
  assert.equal(repaired.units[0].coverage[0].shot_id, 'shot-two')
  assert.equal(repaired.units[0].coverage[0].action_scope, '保留实际拍摄范围')
  assert.equal(repaired.design.direction.shots.length, 2)
  await (await workbenchControl(page, '更多操作', 'button', 'AI 设计')).click()
  await page.getByText('建议与当前单元引用冲突，整次应用已阻止', { exact: true }).waitFor({ state: 'hidden' })
  await page.route('**/design-suggestions/*/preview', route => route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ detail: '结果来源校验未通过：新增内容缺少本次模型任务来源，请重新生成' }) }))
  await page.getByRole('button', { name: '应用到当前版本', exact: true }).click()
  await ai.getByRole('button', { name: '重新生成设计', exact: true }).waitFor()
  await page.unroute('**/design-suggestions/*/preview')

  await page.getByRole('button', { name: '应用到当前版本', exact: true }).click()
  await page.getByRole('dialog', { name: 'AI 设计', exact: true }).waitFor({ state: 'hidden' })
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  const applied = (await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.content
  assert.deepEqual(applied.design.direction.shots.map(row => row.id), ['shot-two'])
  assert.deepEqual(applied.units, repaired.units)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  const undone = (await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.content
  assert.deepEqual(undone.design.direction.shots.map(row => row.id), ['shot-one', 'shot-two'])
  assert.deepEqual(undone.units, repaired.units)
  await page.screenshot({ path: join(output, 'design-reference-recovery.png'), animations: 'disabled' })
  await page.getByRole('button', { name: '导演画布', exact: true }).click()
  await page.getByRole('button', { name: '编辑六岗设计', exact: true }).click()
  await page.getByRole('button', { name: '总导演', exact: true }).click()
  await page.getByRole('button', { name: '移除镜头覆盖 2', exact: true }).click()
  await page.getByText('对象仍被单元引用，请先处理下游引用。', { exact: true }).waitFor()
  await page.getByRole('button', { name: '定位单元 1 · 覆盖 1', exact: true }).click()
  await page.getByRole('textbox', { name: '单元动作范围', exact: true }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '单元动作范围', exact: true }).inputValue(), '保留实际拍摄范围')
  assert.deepEqual((await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.content, undone)
  console.log(`PASS design reference recovery; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true, animations: 'disabled' }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
