import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { makeWorkspace } from './directing-fixtures.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const output = await mkdtemp(join(tmpdir(), 'jellyfish-design-scope-'))
const api = 'http://127.0.0.1:8198'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.directing.scene_version_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8198' }, stdio: ['ignore', 'pipe', 'pipe'],
})
let logs = '', server, browser, page
backend.stdout.on('data', data => { logs += data })
backend.stderr.on('data', data => { logs += data })
const errors = []
async function request(url, body, method = 'POST') {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const result = await response.json()
  assert.equal(response.status, 200, JSON.stringify(result))
  return result.data
}
try {
  let chapter
  for (let i = 0; i < 100; i++) {
    if (backend.exitCode !== null) throw new Error(logs)
    try { const response = await fetch(`${api}/api/v1/studio/projects/canvas-project/directing/chapters/canvas-chapter`); if (response.ok) { chapter = (await response.json()).data; break } } catch {}
    await delay(250)
  }
  assert.ok(chapter, logs)
  const sequence = chapter.sequences[0].id
  const versions = `${api}/api/v1/studio/projects/canvas-project/directing/sequences/${sequence}/versions`
  let version = await request(versions, { request_id: crypto.randomUUID(), title: '范围完整性验收' })
  const shape = makeWorkspace().designs[0].content
  const design = version.content.design
  const note = text => ({ state: 'proposal', text, sources: [{ kind: 'human', reference: 'browser', version: '1' }] })
  design.direction.shots = [{ ...shape.direction.shots[0], id: 'shot1', beat_ids: [], event_ids: [],
    criterion_ids: [], participant_ids: [], blocking_state_ids: [], visible_result: note('看见空旷的门口') }]
  design.cinematography = [{ ...shape.cinematography[0], id: 'camera1', shot_id: 'shot1', criterion_ids: [] }]
  design.direction.anchors = [{ id: 'anchor1', description: note('门口的固定位置') }]
  version = await request(`${versions}/${version.id}`, { request_id: crypto.randomUUID(), expected_revision: version.revision,
    content: { ...version.content, design } }, 'PUT')
  assert.equal(version.relationship_graph.complete, true)
  assert.deepEqual(version.relationship_graph.nodes.find(row => row.key === 'camera:camera1').shot_ids, ['shot1'])
  assert.ok(version.relationship_graph.preparation_issues.length > 0)
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4198, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  await page.goto(`http://127.0.0.1:4198/projects/canvas-project/chapters/canvas-chapter/sequences/${sequence}?version=${version.id}`)
  await page.getByRole('status').filter({ hasText: '设计范围完整' }).waitFor()
  const anchor = page.locator('[data-canvas-node="anchor:anchor1"]')
  assert.match(await anchor.innerText(), /全场背景/)
  assert.doesNotMatch(await anchor.innerText(), /未建立镜头关联/)
  await page.getByRole('button', { name: '附加信息', exact: true }).click()
  await page.getByText(/拍摄分工待补 · /).click()
  await page.getByText('应拍内容尚未分配负责的生产单元', { exact: false }).waitFor()
  await page.screenshot({ path: join(output, 'scope-desktop.png'), animations: 'disabled' })
  await page.getByRole('button', { name: '隐藏附加信息', exact: true }).click()
  await page.getByRole('button', { name: 'AI 设计', exact: true }).click()
  await page.locator('.scene-ai-footer').getByRole('button', { name: '重新生成整场', exact: true }).click()
  await page.getByText('状态：等待执行', { exact: true }).waitFor()
  const tasks = (await (await fetch(`${versions}/${version.id}/design-suggestions`)).json()).data
  await request(`${api}/browser-test/design-tasks/${tasks[0].task_id}/complete?incomplete=true`, {})
  await page.getByText('状态：未完成 · 可查看结果', { exact: true }).waitFor()
  const diagnostics = page.getByRole('region', { name: '未完成设计结果', exact: true })
  await diagnostics.getByText('查看模型输出 · 只读', { exact: true }).click()
  assert.match(await diagnostics.locator('pre').innerText(), /activity-incomplete/)
  assert.equal(await page.getByRole('button', { name: '应用设计', exact: true }).count(), 0)
  assert.deepEqual((await (await fetch(`${versions}/${version.id}`)).json()).data.content, version.content)
  await page.screenshot({ path: join(output, 'incomplete-result-desktop.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: join(output, 'incomplete-result-narrow.png'), animations: 'disabled' })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  assert.deepEqual(errors, [])
  console.log(`PASS scope ownership, global background, preparation gaps and read-only failed result; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), animations: 'disabled' }).catch(() => {})
  console.error(`Evidence: ${output}`)
  throw error
} finally {
  if (browser) await browser.close()
  if (server) await server.close()
  backend.kill('SIGTERM')
  await Promise.race([new Promise(resolve => backend.once('exit', resolve)), delay(5000)])
}
