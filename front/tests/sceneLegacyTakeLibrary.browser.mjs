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
  env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8193', SCENE_BROWSER_TEST_LEGACY_TAKE: '1' },
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
  const sceneUrl = `${api}/api/v1/studio/projects/canvas-project/directing/sequences/${sequenceId}`
  const originalTakes = (await (await fetch(sceneUrl)).json()).data.takes
  assert.equal(originalTakes.length, 1)
  const library = (await (await fetch(`${versionsUrl}/${version.id}/take-library`)).json()).data
  assert.equal(library.length, 1)
  assert.equal(library[0].take_kind, 'production_plan')
  assert.equal(library[0].file_id, 'legacy-take-file')
  assert.equal(library[0].task_id, 'legacy-video-task')
  assert.equal(library[0].prompt.text, '旧生产计划的固定拍摄指令')
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await page.getByRole('switch', { name: '自动保存', exact: true }).click()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  await page.getByRole('button', { name: '选择素材 1', exact: true }).click()
  await page.getByText('旧生产计划素材：请按当前方案人工核对适用性', { exact: true }).waitFor()
  await page.getByText(`原所属生产计划：${library[0].origin_id}`, { exact: true }).waitFor()
  assert.equal(await page.locator('video').count(), 0)
  await page.getByRole('button', { name: '预览当前素材', exact: true }).click()
  const video = page.getByLabel('当前素材视频', { exact: true })
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1)
  assert.equal(await video.evaluate(node => node.duration), 2)
  assert.equal(await video.evaluate(node => node.paused), true)
  await page.getByRole('combobox', { name: '当前方案素材审查', exact: true }).click()
  await page.getByText('保留', { exact: true }).click()
  await page.getByRole('textbox', { name: '素材审查说明', exact: true }).fill('新方案复用旧素材，保留前段')
  await page.getByRole('button', { name: '新增可用区间', exact: true }).click()
  await page.getByRole('spinbutton', { name: '可用区间 1 出点毫秒', exact: true }).fill('1200')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  const a = (await (await fetch(`${versionsUrl}/${version.id}`)).json()).data
  assert.deepEqual(a.content.units, [])
  assert.equal(a.content.take_judgments[0].take_id, library[0].take_id)
  assert.equal(a.content.take_judgments[0].annotation.verdict, 'retain')
  assert.deepEqual(a.content.take_judgments[0].annotation.retained_ranges, [{ source_in_ms: 0, source_out_ms: 1200 }])
  const second = await fetch(versionsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), title: '另一个旧素材方案' }) })
  assert.equal(second.status, 200)
  const b = (await second.json()).data
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${b.id}`)
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  await page.getByRole('button', { name: '选择素材 1', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '素材审查说明', exact: true }).inputValue(), '')
  await page.getByRole('combobox', { name: '当前方案素材审查', exact: true }).click()
  await page.getByText('需修复', { exact: true }).click()
  await page.getByRole('textbox', { name: '素材审查说明', exact: true }).fill('B 方案需要修复')
  await page.getByRole('button', { name: '新增可用区间', exact: true }).click()
  await page.getByRole('spinbutton', { name: '可用区间 1 入点毫秒', exact: true }).fill('1200')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await page.reload()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  await page.getByRole('button', { name: '选择素材 1', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '素材审查说明', exact: true }).inputValue(), 'B 方案需要修复')
  const savedB = (await (await fetch(`${versionsUrl}/${b.id}`)).json()).data
  assert.deepEqual(savedB.content.units, [])
  assert.equal(savedB.content.take_judgments[0].annotation.verdict, 'repair')
  assert.deepEqual(savedB.content.take_judgments[0].annotation.retained_ranges, [{ source_in_ms: 1200, source_out_ms: 2000 }])
  assert.deepEqual((await (await fetch(`${versionsUrl}/${version.id}`)).json()).data, a)
  assert.deepEqual((await (await fetch(`${versionsUrl}/${b.id}/take-library`)).json()).data, library)
  assert.deepEqual((await (await fetch(sceneUrl)).json()).data.takes, originalTakes)
  console.log(`PASS existing production Take reuse without new generation; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
