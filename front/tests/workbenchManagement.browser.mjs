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
  await page.locator('.management-flow-sidebar').getByRole('button', { name: '返回章节列表', exact: true }).waitFor()
  assert.equal(await page.locator('.management-toolbar').getByRole('button', { name: '返回章节列表', exact: true }).count(), 0)
  assert.equal(await page.getByRole('heading', { name: '对象参考', exact: true }).evaluate(el => getComputedStyle(el).fontSize), '16px')
  assert.equal(await page.locator('.management-toolbar').getByRole('group', { name: '选择场次' }).count(), 1, '场次切换与标题同排')
  await page.locator('.management-browse-toolbar').getByRole('button', { name: '提取对象', exact: true }).waitFor()
  const titleBox = await page.locator('.management-identity').boundingBox()
  const firstSceneBox = await page.getByRole('group', { name: '选择场次' }).getByRole('button').first().boundingBox()
  assert.ok(firstSceneBox.x - titleBox.x - titleBox.width <= 20, '场次选择紧跟标题左侧聚合')
  const titleHeight = (await page.locator('.management-toolbar').boundingBox()).height
  await steps.getByRole('button', { name: /场次划分/ }).click()
  await page.getByRole('heading', { name: '场次划分', exact: true }).waitFor()
  assert.equal((await page.locator('.management-division-heading').boundingBox()).height, titleHeight, 'step toolbars have matching height')
  await page.locator('.management-division-heading').getByRole('button', { name: '保存为新版本', exact: true }).waitFor()
  await steps.getByRole('button', { name: /对象参考/ }).click()
  await page.getByRole('group', { name: '选择场次' }).getByRole('button', { name: /后院/ }).click()
  assert.equal(new URL(page.url()).searchParams.get('sequence'), second.id)
  await steps.getByRole('button', { name: /分镜画布/ }).click()
  await page.getByRole('heading', { name: '分镜画布', exact: true }).waitFor()
  assert.equal(new URL(page.url()).searchParams.get('sequence'), second.id)
  const contentBefore = await page.locator('.management-panel').boundingBox()
  await page.getByRole('button', { name: '全部场次' }).click()
  assert.deepEqual(await page.locator('.management-panel').boundingBox(), contentBefore, '浮层不挤压内容')
  const sceneDrawer = page.getByRole('dialog', { name: '本章场次' })
  await sceneDrawer.waitFor()
  assert.equal(await sceneDrawer.locator('ul').first().evaluate(el => getComputedStyle(el).listStyleType), 'none')
  await page.screenshot({ path: join(output, 'scene-popup.png'), animations: 'disabled' })
  if (await sceneDrawer.getByRole('button', { name: '查看历史场次' }).count()) await sceneDrawer.getByRole('button', { name: '查看历史场次' }).click()
  await sceneDrawer.getByRole('button', { name: /旧码头/ }).click()
  await sceneDrawer.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: /历史场次：.*旧码头/ }).waitFor()
  await page.getByRole('button', { name: '历史方案', exact: true }).waitFor()
  const overviewRoute = '**/directing/chapters/' + chapter + '/workbench-management'
  await page.route(overviewRoute, async route => {
    const response = await route.fetch()
    const payload = await response.json()
    const rows = payload.data.sequences
    payload.data.sequences = [rows[0], ...Array.from({ length: 6 }, (_, index) => ({ ...rows[0], id: `overflow-${index}`, position: index + 1, title: `较长的场次名称用于测试省略与布局 ${index}` })), { ...rows[1], position: 7 }]
    await route.fulfill({ response, json: payload })
  })
  await page.goto(location + '?sequence=' + first.id + '&step=objects')
  await page.getByRole('heading', { name: '对象参考', exact: true }).waitFor()
  const selector = page.getByRole('group', { name: '选择场次' })
  assert.ok(await selector.getByRole('button').count() <= 4)
  await selector.getByRole('button', { name: '全部场次' }).click()
  const popup = page.getByRole('dialog', { name: '本章场次' })
  await popup.getByRole('textbox', { name: '搜索场次' }).fill('8.')
  await popup.getByRole('button', { name: /8. 后院/ }).click()
  await popup.waitFor({ state: 'hidden' })
  await selector.getByRole('button', { name: '8. 后院', exact: true }).waitFor()
  assert.equal(new URL(page.url()).searchParams.get('sequence'), second.id)
  await selector.getByRole('button', { name: '全部场次' }).click()
  await popup.getByRole('textbox', { name: '搜索场次' }).press('Escape')
  await popup.waitFor({ state: 'hidden' })
  assert.equal(await selector.getByRole('button', { name: '全部场次' }).evaluate(el => el === document.activeElement), true)
  await page.unroute(overviewRoute)
  await page.goto(location + '?sequence=unavailable')
  await page.getByText('此场次不属于当前章节或已不可用').waitFor()
  await page.goto(location + '?sequence=' + first.id + '&step=objects')
  for (const [width, height] of [[1440,900],[1366,768],[1024,440],[375,812]]) {
    await page.setViewportSize({ width, height })
    await page.getByRole('heading', { name: '对象参考', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), true, '页面整体不滚动')
    if (width === 375) {
      await page.waitForFunction(() => {
        const back = document.querySelector('.management-flow-trigger button[aria-label="返回章节列表"]')?.getBoundingClientRect()
        const menu = document.querySelector('.management-flow-trigger button[aria-label="制作步骤"]')?.getBoundingClientRect()
        return back && menu && back.width >= 35.9 && back.height >= 35.9 && menu.height >= 35.9
      })
      const back = await page.getByRole('button', { name: '返回章节列表', exact: true }).boundingBox()
      const menu = await page.getByRole('button', { name: '制作步骤', exact: true }).boundingBox()
      assert.ok(back.width >= 35.9 && back.height >= 35.9 && menu.height >= 35.9, JSON.stringify({ back, menu }))
    }
    await page.screenshot({ path: join(output, `steps-${width}.png`), animations: 'disabled' })
  }
  await page.getByRole('group', { name: '选择场次' }).getByRole('button').click()
  await page.getByRole('dialog', { name: '本章场次' }).getByRole('button', { name: /后院/ }).click()
  assert.equal(new URL(page.url()).searchParams.get('sequence'), second.id)
  await page.getByRole('button', { name: '制作步骤', exact: true }).click()
  const navigation = page.getByRole('dialog').filter({ has: page.getByRole('navigation', { name: '制作步骤' }) })
  await navigation.getByRole('button', { name: /分镜画布/ }).click()
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
  await page.getByRole('heading', { name: '场次划分', exact: true }).waitFor()
  await page.getByRole('navigation', { name: '制作步骤' }).waitFor()

} finally {
  await cleanup()
}
