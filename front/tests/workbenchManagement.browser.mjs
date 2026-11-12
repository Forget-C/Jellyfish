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
const output = await browserOutput('jellyfish-workbench-management-')
const api = 'http://127.0.0.1:8384'
const studio = api + '/api/v1/studio'
const project = 'canvas-project'
const chapter = 'workbench-management-chapter'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_PORT: '8384' },
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
  let ready = false
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null) throw new Error('isolated backend exited')
    try { if ((await fetch(studio + '/generation-canvases/' + project)).ok) { ready = true; break } } catch {}
    await delay(250)
  }
  assert.ok(ready)
  const chapterApi = studio + '/projects/' + project + '/directing/chapters/' + chapter
  const raw = '前厅点灯。后院下雨。旧码头。'
  await request(studio + '/chapters', 'POST', { id: chapter, project_id: project, index: 0, title: '两个场景', raw_text: raw })
  await request(studio + '/chapters', 'POST', { id: 'management-empty', project_id: project, index: 1, title: '空章节' })
  const source = await request(chapterApi)
  const scene = (title, position, start, end) => request(chapterApi + '/sequences', 'POST',
    { title, position, source_version: source.source_version, span: { start, end } })
  const second = await scene('后院', 1, 5, 10)
  const first = await scene('前厅', 0, 0, 5)
  const historical = await scene('旧码头', 2, 10, raw.length)
  const canvas = await request(chapterApi + '/sequences/' + historical.id + '/canvases', 'POST', { name: '历史方案' })
  const draft = {
    source_version: source.source_version,
    baseline: [first, second, historical].map(row => ({ sequence_id: row.id, version: row.version })),
    members: [first, second].map(row => ({ key: row.id, sequence_id: row.id, title: row.title, span: row.span })),
    lineage: [first, second, historical].map(row => ({ sequence_id: row.id, target_keys: row === historical ? [] : [row.id] })),
    exited_sequence_ids: [historical.id],
  }
  const preview = await request(chapterApi + '/division/preview', 'POST', draft)
  await request(chapterApi + '/division', 'PUT', { request_id: 'management-history', draft, preview_token: preview.preview_token, identity_changes_confirmed: true })

  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4384, strictPort: true, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  await context.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const page = await context.newPage()
  page.setDefaultTimeout(9000)
  const location = 'http://127.0.0.1:4384/projects/' + project + '/chapters/' + chapter + '/workbench-management'
  const steps = page.getByRole('navigation', { name: '制作步骤' })
  await page.goto(location)
  await steps.waitFor()
  await page.getByRole('heading', { name: '对象参考', exact: true }).waitFor()
  assert.equal(Math.round((await page.locator('.management-flow-sidebar').boundingBox()).width), 216)
  await steps.getByRole('button', { name: /1\s*场次划分/ }).click()
  await page.getByRole('heading', { name: '本章场次划分' }).waitFor()
  await page.locator('.management-division-heading').getByRole('button', { name: '保存新版本', exact: true }).waitFor()
  await steps.getByRole('button', { name: /2\s*对象参考/ }).click()
  await page.getByRole('group', { name: '选择场次' }).getByRole('button', { name: /后院/ }).click()
  assert.equal(new URL(page.url()).searchParams.get('sequence'), second.id)
  await steps.getByRole('button', { name: /3\s*分镜画布/ }).click()
  await page.getByRole('heading', { name: '分镜画布', exact: true }).waitFor()
  assert.equal(new URL(page.url()).searchParams.get('sequence'), second.id)
  await page.getByRole('button', { name: '全部场次⌄' }).click()
  const sceneDrawer = page.getByRole('dialog').filter({ hasText: '本章场次' })
  await sceneDrawer.waitFor()
  if (await sceneDrawer.getByRole('button', { name: '查看历史场次' }).count()) await sceneDrawer.getByRole('button', { name: '查看历史场次' }).click()
  await sceneDrawer.getByRole('button', { name: /旧码头/ }).click()
  await sceneDrawer.waitFor({ state: 'hidden' })
  await page.getByText('历史场次：旧码头', { exact: true }).waitFor()
  await page.getByRole('button', { name: '历史方案', exact: true }).waitFor()
  await page.goto(location + '?sequence=unavailable')
  await page.getByText('此场次不属于当前章节或已不可用').waitFor()
  await page.goto(location + '?sequence=' + first.id + '&step=objects')
  for (const [width, height] of [[1440,900],[1366,768],[1024,440],[375,812]]) {
    await page.setViewportSize({ width, height })
    await page.getByRole('heading', { name: '对象参考', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), true, '页面整体不滚动')
    await page.screenshot({ path: join(output, `steps-${width}.png`), animations: 'disabled' })
  }
  await page.getByRole('combobox', { name: '选择场次', exact: true }).press('ArrowDown')
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getByText('2. 后院', { exact: true }).click()
  assert.equal(new URL(page.url()).searchParams.get('sequence'), second.id)
  await page.getByRole('button', { name: '制作步骤', exact: true }).click()
  const navigation = page.getByRole('dialog').filter({ has: page.getByRole('navigation', { name: '制作步骤' }) })
  await navigation.getByRole('button', { name: /3\s*分镜画布/ }).click()
  await navigation.waitFor({ state: 'hidden' })
  await page.getByRole('heading', { name: '分镜画布', exact: true }).waitFor()

  await page.setViewportSize({ width: 1366, height: 900 })
  await page.goto(location)
  await page.getByRole('button', { name: '返回章节列表', exact: true }).click()
  await page.locator(`[data-chapter-workbench=${JSON.stringify(chapter)}]:focus`).waitFor()
  await page.getByRole('textbox', { name: '搜索章节' }).fill('不存在的章节')
  await page.goto(location)
  await page.getByRole('button', { name: '返回章节列表', exact: true }).click()
  await page.getByText('返回章节：两个场景').waitFor()
  await page.locator(`[data-chapter-workbench=${JSON.stringify(chapter)}]:focus`).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '搜索章节' }).inputValue(), '不存在的章节')
  await page.goto(location.replace('/projects/' + project + '/', '/projects/another-project/'))
  await page.getByRole('alert').waitFor()
  const emptyChapter = 'management-empty'
  await page.goto(location.replace(chapter, emptyChapter))
  await page.getByRole('heading', { name: '本章场次划分' }).waitFor()
  await page.getByRole('navigation', { name: '制作步骤' }).waitFor()

} finally {
  await cleanup()
}
