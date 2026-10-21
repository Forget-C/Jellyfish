import { closeWorkbenchDetails } from './workbenchControls.mjs'
import { makeWorkspace } from './directing-fixtures.mjs'
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
const api = 'http://127.0.0.1:8197'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.directing.scene_version_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8197' },
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4197, strictPort: true, open: false, proxy: { '/api': api } } })
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
  content.design.direction.shots = [{ id: 'shot-one', beat_ids: ['beat-one', 'beat-two'], event_ids: ['event-one'], blocking_state_ids: [], participant_ids: ['reader'], criterion_ids: [], narrative_function: {}, visible_result: note('拆信、读信、抬头') }]
  content.design.cinematography = content.design.direction.shots.map((shot, index) => ({ ...makeWorkspace().designs[0].content.cinematography[0], id: `camera-${index}`, shot_id: shot.id, criterion_ids: [] }))
  content.units = []
  const saved = await fetch(`${versionsUrl}/${version.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: version.revision, content }) })
  assert.equal(saved.status, 200, await saved.text())
  await page.goto(`http://127.0.0.1:4197/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await (await workbenchShot(page, '镜头 1：拆信、读信、抬头')).click()
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  for (const [index, action] of ['拆开信封', '只拍抬头'].entries()) {
    await page.getByRole('button', { name: index ? '为当前镜头增加补拍单元' : '为当前镜头建立单元', exact: true }).click()
    await unitSettings(page)
    await page.getByRole('textbox', { name: '单元动作范围', exact: true }).fill(action)
    await page.getByRole('combobox', { name: '覆盖 1 节拍', exact: true }).press('ArrowDown')
    await page.locator('.ant-select-dropdown:visible').getByText(`节拍 ${index + 1}：目标 ${index + 1}`, { exact: true }).click()
    await page.keyboard.press('Escape')
    await closeWorkbenchDetails(page)
    await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  }
  await page.reload()
  await (await workbenchShot(page, '镜头 1：拆信、读信、抬头')).click()
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  const current = (await (await fetch(`${versionsUrl}/${version.id}`)).json()).data
  assert.equal(current.content.units.length, 2)
  for (const [index, unit] of current.content.units.entries()) {
    const action = index ? '只拍抬头' : '拆开信封'
    await page.getByRole('combobox', { name: '当前单元', exact: true }).press('ArrowDown')
    await page.locator('.ant-select-dropdown:visible').getByText(`单元 ${index + 1} · ${action}`, { exact: true }).click()
    await unitSettings(page)
    assert.equal(await page.getByRole('textbox', { name: '单元动作范围', exact: true }).inputValue(), action)
    await closeWorkbenchDetails(page)
    const response = await fetch(`${versionsUrl}/${version.id}/units/${unit.id}/instruction-basis`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: current.content }),
    })
    assert.equal(response.status, 200)
    const basis = (await response.json()).data
    assert.equal(basis.status, 'empty')
    assert.deepEqual(basis.current.scope.execution.map(row => row.text), [action, `可拍变化 ${index + 1}`])
    assert.ok(basis.current.scope.background.some(row => row.text === '拆信、读信、抬头'))
  }
  console.log(`PASS separate partial units persist and retain distinct instruction scopes; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true, animations: 'disabled' }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
