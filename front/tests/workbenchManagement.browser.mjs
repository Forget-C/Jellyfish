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
  const list = page.getByRole('complementary', { name: '本章场次' })
  const regions = page.getByRole('navigation', { name: '工作台区域' })
  const productionMenu = page.getByRole('button', { name: '场次制作', exact: true })
  const openDivision = async (trigger = productionMenu) => {
    await trigger.press('Enter')
    await page.getByRole('menuitem', { name: '场次划分', exact: true }).and(page.locator(':focus')).waitFor()
    assert.equal(await trigger.getAttribute('aria-expanded'), 'true')
    await page.keyboard.press('Escape')
    await trigger.and(page.locator(':focus')).waitFor()
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false')
    await page.keyboard.press('Enter')
    await page.getByRole('menuitem', { name: '场次划分', exact: true }).and(page.locator(':focus')).waitFor()
    await page.keyboard.press('Enter')
    await page.getByRole('heading', { name: '本章场次划分' }).waitFor()
  }
  const enterProduction = page.getByRole('button', { name: '进入场次制作', exact: true })
  const steps = page.getByRole('navigation', { name: '工作台步骤' })
  const taskWrites = []
  const heavyReads = []
  page.on('request', req => {
    const path = new URL(req.url()).pathname
    if (req.method() === 'POST' && /\/directing\/|\/tasks/.test(path)) taskWrites.push(path)
    if (req.method() === 'GET' && /\/directing\/.*\/(?:objects|canvases)$/.test(path)) heavyReads.push(path)
  })
  await page.goto(location)
  await openDivision(list.getByRole('button', { name: '场次制作', exact: true }))
  assert.equal(await regions.count(), 0)
  await enterProduction.click()
  assert.equal(await page.getByRole('link', { name: '返回章节', exact: true }).count(), 0)
  await page.getByRole('heading', { name: '前厅', exact: true }).waitFor()
  const labels = await list.getByRole('button', { name: /前厅|后院/ }).allTextContents()
  assert.equal(await page.getByRole('complementary', { name: '划场场次列表' }).count(), 0)
  assert.equal(await steps.getByRole('button', { name: '对象与参考〔本场〕' }).getAttribute('aria-current'), 'step')
  assert.deepEqual(labels.map(label => label.match(/前厅|后院/)[0]), ['前厅', '后院'])
  assert.equal(await list.getByRole('button', { name: /旧码头/ }).count(), 0)
  await list.getByRole('textbox', { name: '搜索场次' }).fill('雨')
  await list.getByText('没有匹配的场次').waitFor()
  await list.getByRole('textbox', { name: '搜索场次' }).fill('')
  await list.getByRole('button', { name: /后院/ }).press('Enter')
  await steps.getByRole('button', { name: '对象与参考〔本场〕' }).click()
  await page.getByRole('heading', { name: '后院', exact: true }).waitFor()
  await page.getByText(/^尚未提取对象/).waitFor()
  await page.goto(location)
  await page.getByRole('heading', { name: '后院', exact: true }).waitFor()
  assert.equal(await steps.getByRole('button', { name: '对象与参考〔本场〕' }).getAttribute('aria-current'), 'step')
  await page.goto(location + '?sequence=' + first.id + '&step=storyboard')
  await page.getByRole('heading', { name: '前厅', exact: true }).waitFor()
  assert.equal(await steps.getByRole('button', { name: '分镜与画布〔本场〕' }).getAttribute('aria-current'), 'step')
  await page.getByText('本场尚无画布，可生成新分镜画布开始设计', { exact: true }).waitFor()
  await page.screenshot({ path: join(output, 'desktop.png') })
  assert.ok(heavyReads.some(path => path.endsWith(`/sequences/${second.id}/objects`)))
  assert.ok(heavyReads.some(path => path.endsWith(`/sequences/${first.id}/canvases`)))
  assert.ok(heavyReads.every(path => [`/sequences/${first.id}/objects`, `/sequences/${second.id}/objects`, `/sequences/${first.id}/canvases`].some(target => path.endsWith(target))))

  await list.getByRole('button', { name: '查看历史场次' }).click()
  await list.getByRole('button', { name: /旧码头.*1 张画布/ }).click()
  await page.getByRole('heading', { name: '旧码头', exact: true }).waitFor()
  await page.getByRole('list', { name: '本场画布' }).getByRole('button', { name: '打开画布' }).click()
  await page.waitForURL(url => url.searchParams.get('canvas') === canvas.id)
  await page.getByRole('region', { name: '生成画布工作台' }).waitFor()
  assert.deepEqual(taskWrites, [])

  await page.goto(location + '?sequence=unavailable')
  await page.getByText('此场次不属于当前章节或已不可用').waitFor()
  assert.equal(await page.getByRole('heading', { name: '前厅', exact: true }).count(), 0)
  await page.goto(location.replace('/projects/' + project + '/', '/projects/another-project/'))
  await page.getByText('章节不属于当前项目', { exact: false }).waitFor()
  await page.goto(location.replace(chapter, 'management-empty') + '?step=objects')
  await page.getByText('本章尚未填写原文').waitFor()
  await page.getByRole('heading', { name: '本章场次划分' }).waitFor()
  assert.equal(await enterProduction.isDisabled(), true)
  assert.equal(await list.count(), 0)

  await page.goto(location)
  await page.getByRole('navigation', { name: '当前位置' }).getByRole('link', { name: '章节', exact: true }).click()
  await page.locator(`[data-chapter-workbench=${JSON.stringify(chapter)}]:focus`).waitFor()
  await page.getByRole('textbox', { name: '搜索章节' }).fill('空章节')
  await page.goto(location)
  await page.getByRole('navigation', { name: '当前位置' }).getByRole('link', { name: '章节', exact: true }).click()
  await page.getByText('返回章节：两个场景').waitFor()
  await page.locator(`[data-chapter-workbench=${JSON.stringify(chapter)}]:focus`).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '搜索章节' }).inputValue(), '空章节')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(location)
  const openScenes = page.getByRole('button', { name: '切换场次' })
  await openScenes.press('Enter')
  const drawer = page.getByRole('dialog').filter({ hasText: '本章场次' })
  await drawer.waitFor()
  await drawer.getByRole('button', { name: /后院/ }).press('Enter')
  await drawer.waitFor({ state: 'hidden' })
  await page.getByRole('heading', { name: '后院', exact: true }).waitFor()
  await openScenes.and(page.locator(':focus')).waitFor()
  await openDivision()
  assert.equal(await openScenes.count(), 0)
  await enterProduction.click()
  await page.getByRole('heading', { name: '后院', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: join(output, 'mobile.png') })

  const latest = await request(chapterApi)
  const retireAll = { source_version: latest.source_version,
    baseline: latest.sequences.map(row => ({ sequence_id: row.id, version: row.version })),
    members: [], lineage: latest.sequences.map(row => ({ sequence_id: row.id, target_keys: [] })),
    exited_sequence_ids: latest.sequences.map(row => row.id) }
  const retirement = await request(chapterApi + '/division/preview', 'POST', retireAll)
  await request(chapterApi + '/division', 'PUT', { request_id: 'management-all-history', draft: retireAll,
    preview_token: retirement.preview_token, identity_changes_confirmed: true })
  await page.goto(location)
  await page.getByRole('heading', { name: '本章场次划分' }).waitFor()
  assert.equal(await openScenes.count(), 0)
  await page.getByRole('button', { name: '查看历史场次', exact: true }).click()
  await openScenes.press('Enter')
  await drawer.getByRole('button', { name: /旧码头/ }).click()
  await page.getByRole('heading', { name: '旧码头', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '生成新分镜画布' }).count(), 0)
} finally {
  await cleanup()
}
