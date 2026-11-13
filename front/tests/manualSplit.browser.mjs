import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-manual-split-')
const api = 'http://127.0.0.1:8386'
const studio = api + '/api/v1/studio'
const project = 'canvas-project'
const chapter = 'manual-split-closure'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.directing.workbench_division_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_PORT: '8386' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser
const cleanup = browserCleanup(() => ({ browser, server, backend }))
const request = async (url, method = 'GET', body) => {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
  assert.ok(response.ok, await response.clone().text())
  return (await response.json()).data
}

try {
  for (let attempt = 0; ; attempt++) {
    if (backend.exitCode !== null || attempt >= 80) throw new Error('isolated backend did not start')
    try { if ((await fetch(studio + '/generation-canvases/' + project)).ok) break } catch {}
    await delay(250)
  }
  const chapterApi = studio + '/projects/' + project + '/directing/chapters/' + chapter
  const raw = '前厅点灯。'
  await request(studio + '/chapters', 'POST', { id: chapter, project_id: project, index: 0, title: '手动拆分闭环', raw_text: raw })
  const source = await request(chapterApi)
  const original = await request(chapterApi + '/sequences', 'POST', { title: '前厅', position: 0, source_version: source.source_version, span: { start: 0, end: 5 } })
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4386, strictPort: true, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(9000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  const location = `http://127.0.0.1:4386/projects/${project}/chapters/${chapter}/workbench-management?step=division&sequence=${original.id}`
  await page.goto(location)
  await page.getByRole('radio', { name: '键盘／触屏选择', exact: true }).locator('xpath=ancestor::label').click()
  const text = page.getByRole('textbox', { name: '键盘或触屏选择原文', exact: true })
  await text.press('Home')
  await text.press('ArrowRight')
  await text.press('ArrowRight')
  await text.press('Shift+ArrowRight')
  assert.equal(await page.getByRole('button', { name: '拆分当前场次', exact: true }).isVisible(), true,
    'selecting the split position first must not hide the split entry')
  await page.getByRole('button', { name: '拆分当前场次', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: '确认拆分', exact: true }).isDisabled(), false, 'entering split retains the selected position')
  await page.getByRole('button', { name: '确认拆分', exact: true }).click()
  await page.getByRole('dialog', { name: '确认拆分场次', exact: true }).getByRole('button', { name: '确认加入草稿', exact: true }).click()
  await page.getByRole('button', { name: '保存为新版本', exact: true }).click()
  const preview = page.getByRole('dialog', { name: '划分变更预览', exact: true })
  await preview.getByRole('checkbox', { name: /核对拆分/ }).check()
  await preview.getByRole('button', { name: '保存本章划分', exact: true }).click()
  await preview.waitFor({ state: 'hidden' })
  const saved = await request(chapterApi)
  assert.equal(saved.sequences.length, 2)
  assert.equal(saved.sequences[0].id, original.id)
  assert.deepEqual(saved.sequences.map(row => row.source_text), ['前厅', '点灯。'])
  await page.reload()
  const list = page.getByRole('complementary', { name: '划场场次列表' })
  await list.getByRole('button', { name: '1. 前厅', exact: true }).waitFor()
  await list.getByRole('button', { name: '2. 前厅（拆分）', exact: true }).waitFor()
  await page.screenshot({ path: join(output, 'split-saved.png') })
} finally {
  await cleanup()
}
