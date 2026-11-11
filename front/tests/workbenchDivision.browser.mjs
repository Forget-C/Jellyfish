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
const output = await browserOutput('jellyfish-workbench-division-')
const api = 'http://127.0.0.1:8386'
const studio = api + '/api/v1/studio'
const project = 'canvas-project'
const chapter = 'workbench-division'
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
  const raw = '前厅点灯。后院下雨。'
  await request(studio + '/chapters', 'POST', { id: chapter, project_id: project, index: 0, title: '两处灯光', raw_text: raw })
  const source = await request(chapterApi)
  const scene = (title, position, start, end) => request(chapterApi + '/sequences', 'POST',
    { title, position, source_version: source.source_version, span: { start, end } })
  const first = await scene('前厅', 0, 0, 5)
  const second = await scene('后院', 1, 5, 10)
  const firstApi = chapterApi + '/sequences/' + first.id
  const fixedCanvas = await request(firstApi + '/canvases', 'POST', { name: '固定原文方案' })
  const readCanvas = () => request(studio + '/generation-canvases/' + project + '/' + fixedCanvas.id)
  const originalCanvas = await readCanvas()
  const extraction = await request(firstApi + '/objects/extractions', 'POST', { request_id: 'initial-preparation' })
  for (let attempt = 0; ; attempt++) {
    const objects = await request(firstApi + '/objects')
    if (objects.task?.task_id === extraction.task_id && objects.task.status === 'succeeded') {
      assert.equal(objects.objects.length, 1)
      break
    }
    assert.ok(attempt < 80 && objects.task?.status !== 'failed', JSON.stringify(objects))
    await delay(150)
  }

  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4386, strictPort: true, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  await context.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const page = await context.newPage()
  page.setDefaultTimeout(9000)
  const location = 'http://127.0.0.1:4386/projects/' + project + '/chapters/' + chapter + '/workbench-management'
  await page.goto(location + '?sequence=' + first.id + '&step=division')
  const reader = page.getByRole('region', { name: '完整章节原文' })
  await reader.waitFor()
  assert.equal(await reader.locator('.chapter-source-text').textContent(), raw)
  assert.equal(await reader.locator('.source-selection').textContent(), '前厅点灯。')
  const list = page.getByRole('complementary', { name: '本章场次' })
  const draftList = page.getByRole('complementary', { name: '划场场次列表' })
  const openDivision = page.getByRole('button', { name: '场次划分', exact: true })
  const enterProduction = { click: async () => {
    await page.getByRole('button', { name: /^返回(场次制作|章节列表)$/ }).click()
    if (new URL(page.url()).searchParams.get('tab') === 'chapters') {
      await page.locator(`[data-chapter-workbench=${JSON.stringify(chapter)}]`).click()
    }
  } }
  assert.equal(await list.count(), 0)
  await draftList.getByRole('button', { name: /后院/ }).click()
  await page.waitForFunction(() => document.querySelector('.source-selection')?.textContent === '后院下雨。')
  const title = page.getByRole('textbox', { name: '场次标题', exact: true })
  await title.fill('后院暴雨')
  await draftList.getByRole('button', { name: /前厅/ }).click()
  await draftList.getByRole('button', { name: /后院暴雨/ }).click()
  assert.equal(await title.inputValue(), '后院暴雨')
  await enterProduction.click()
  const guard = page.getByRole('dialog', { name: '有未保存的修改' })
  await guard.getByRole('button', { name: '取消，继续编辑' }).click()
  assert.equal(await title.inputValue(), '后院暴雨')
  assert.equal((await request(chapterApi)).sequences[1].title, '后院')
  await page.getByRole('button', { name: '保存新版本' }).click()
  const preview = page.getByRole('dialog', { name: '划分变更预览' })
  await preview.getByText('后院暴雨 · 名称').waitFor()
  await preview.getByRole('button', { name: '保存本章划分' }).click()
  await page.getByText('已保存，共 2 个场次').waitFor()
  assert.equal(await list.count(), 0)
  assert.equal(new URL(page.url()).pathname, new URL(location).pathname)
  assert.equal(new URL(page.url()).searchParams.get('step'), 'division')
  assert.equal((await request(chapterApi)).sequences[1].title, '后院暴雨')
  await preview.waitFor({ state: 'hidden' })
  await page.screenshot({ path: join(output, 'division.png') })

  await enterProduction.click()
  await list.getByRole('button',{name:/后院暴雨/}).click()
  await page.getByRole('heading', { name: '后院暴雨', exact: true }).waitFor()
  const metadata = page.getByRole('dialog', { name: '编辑场次名称与顺序' })
  await page.getByRole('button', { name: '编辑场次名称与顺序' }).click()
  await metadata.getByRole('textbox', { name: '场次标题' }).fill('后院雨夜')
  await metadata.getByRole('spinbutton', { name: '场次顺序' }).fill('3')
  await metadata.getByRole('button', { name: /^保\s*存$/ }).click()
  await list.getByRole('button', { name: /3\. 后院雨夜/ }).waitFor()
  const previousVersion = (await request(chapterApi)).current_version.number
  assert.equal((await request(chapterApi)).sequences[1].position, 2)

  await openDivision.click()
  await draftList.getByRole('button', { name: /后院雨夜/ }).click()
  await page.getByRole('button', { name: '移出本章草稿' }).click()
  await page.getByRole('button', { name: '保存新版本' }).click()
  await preview.getByRole('checkbox', { name: /核对拆分/ }).check()
  await preview.getByRole('button', { name: '保存本章划分' }).click()
  await page.getByText('原场次“后院雨夜”已转入历史').waitFor()
  await page.getByRole('button', { name: '查看该历史场次' }).click()
  await page.getByRole('heading', { name: '后院雨夜', exact: true }).waitFor()
  await openDivision.click()
  await page.getByRole('button', { name: '历史版本', exact: true }).click()
  const history = page.getByRole('dialog', { name: '历史版本' })
  await history.getByRole('row').filter({ has: page.getByText('v' + previousVersion, { exact: true }) })
    .getByRole('button', { name: '展开行', exact: true }).click()
  await history.getByRole('button', { name: '基于此版本编辑' }).click()
  await draftList.getByRole('button', { name: /后院雨夜/ }).waitFor()
  assert.deepEqual((await request(chapterApi)).sequences.map(row => row.id), [first.id])
  await page.getByRole('button', { name: '保存新版本' }).click()
  await preview.getByRole('checkbox', { name: /核对拆分/ }).check()
  await preview.getByRole('button', { name: '保存本章划分' }).click()
  await page.getByText('已保存，共 2 个场次').waitFor()
  assert.deepEqual((await request(chapterApi)).sequences.map(row => row.id), [first.id, second.id])

  await page.getByRole('button', { name: '编辑章节原文', exact: true }).click()
  const rawEditor = page.getByRole('dialog', { name: /编辑章节/ })
  await rawEditor.getByRole('textbox', { name: '章节原文', exact: true }).waitFor()
  await rawEditor.getByRole('textbox', { name: '章节原文', exact: true }).fill(raw + '院门开了。')
  await rawEditor.getByRole('button', { name: '保存', exact: true }).click()
  await rawEditor.getByRole('button', { name: '确认保存原文' }).click()
  await rawEditor.getByRole('button', { name: '查看本章场次并核对' }).click()
  await page.getByText('章节原文已变化，请核对场次范围。', { exact: true }).waitFor()
  await enterProduction.click()
  await list.getByRole('button', { name: /前厅/ }).click()
  await page.getByRole('button', { name: '分镜与画布' }).click()
  await page.getByRole('button', { name: '前往核对场次范围' }).click()
  await page.getByRole('button', { name: '返回场次制作' }).waitFor()
  assert.equal(await title.inputValue(), '前厅')
  assert.equal((await request(chapterApi)).sequences[0].source_text, '前厅点灯。')
  assert.equal((await request(firstApi + '/objects')).source_changed, false)
  assert.deepEqual((await readCanvas()).document, originalCanvas.document)
  await reader.waitFor()
  assert.equal(await reader.locator('.chapter-source-text').textContent(), raw + '院门开了。')
  assert.equal(await reader.locator('.source-selection').count(), 0)
  for (const name of [/前厅/, /后院雨夜/]) {
    await draftList.getByRole('button', { name }).click()
    await page.getByRole('combobox', { name: '原文出现位置' }).click()
    await page.getByText(/第 1 次出现/).filter({ visible: true }).click()
  }
  await page.getByRole('button', { name: '保存新版本' }).click()
  await preview.getByRole('button', { name: '保存本章划分' }).click()
  await page.getByText('已保存，共 2 个场次').waitFor()
  await page.getByRole('button', { name: '返回场次制作' }).click()
  await list.getByRole('button', { name: /前厅.*对象准备已过时/ }).waitFor()
  await page.getByText('对象准备依据已过时。请重新提取并采用适用对象，再创建新分镜画布。').waitFor()
  assert.equal(await page.getByText('章节原文已变化，仍使用本场已确认摘录。', { exact: true }).count(), 0)
  assert.equal((await request(firstApi + '/objects')).source_changed, true)
  const rejected = await fetch(firstApi + '/storyboards', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: 'stale-preparation', name: '不得创建的方案', mode: 'faithful' }),
  })
  assert.equal(rejected.status, 422)
  assert.match(await rejected.text(), /先刷新对象准备/)
  assert.equal((await request(firstApi + '/canvases')).canvases.length, 1)
  assert.deepEqual((await readCanvas()).document, originalCanvas.document)

  const aiChapter = 'workbench-ai-division'
  const aiApi = chapterApi.replace(chapter, aiChapter)
  await request(studio + '/chapters', 'POST', { id: aiChapter, project_id: project, index: 1, title: 'AI 划分', raw_text: raw })
  await page.goto(location.replace(chapter, aiChapter) + '?step=division')
  await page.getByRole('button', { name: 'AI智能划分' }).click()
  await page.getByText(/AI 生成 · 未保存/).waitFor()
  const analysis = (await request(aiApi + '/division/history')).items.find(row => row.kind === 'analysis')
  assert.ok(analysis?.id)
  assert.deepEqual((await request(aiApi)).sequences, [])
  await page.getByRole('textbox', { name: '场次标题' }).fill('AI 前厅人工确认')
  await page.getByRole('button', { name: '保存新版本' }).click()
  await preview.getByRole('button', { name: '保存本章划分' }).click()
  await page.getByText('已保存，共 2 个场次').waitFor()
  assert.deepEqual((await request(aiApi)).sequences.map(row => row.title), ['AI 前厅人工确认', 'AI 后院'])
  assert.equal(new URL(page.url()).searchParams.get('step'), 'division')
  assert.equal((await request(aiApi + '/workbench-management')).sequences.reduce((count, row) => count + row.object_count + row.canvas_count, 0), 0)
  await preview.waitFor({ state: 'hidden' })
  await page.setViewportSize({ width: 390, height: 844 })
  await reader.waitFor()
  const bounds = await reader.boundingBox()
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391)
  await page.screenshot({ path: join(output, 'division-mobile.png') })
  await page.getByRole('button', { name: '查看当前选区', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '场次标题', exact: true }).inputValue(), 'AI 前厅人工确认')

  await enterProduction.click()
  let taskReads = 0
  await page.route(`**/division/analyses/${analysis.id}`, async route => {
    taskReads++
    await delay(300)
    await route.continue()
  })
  await page.getByRole('button', { name: '任务中心', exact: true }).click()
  await page.getByRole('button', { name: /^历\s*史$/ }).click()
  await page.getByRole('row').filter({ hasText: '分析章节场次' }).getByRole('button', { name: /查\s*看/ }).click()
  await page.waitForURL(url => url.searchParams.get('divisionTask') === analysis.id)
  const task = page.getByRole('dialog', { name: '划分任务详情' })
  await task.getByText('1. AI 前厅', { exact: true }).waitFor()
  // The development app may run the mount effect twice in StrictMode.
  assert.ok(taskReads >= 1 && taskReads <= 2, `unexpected task detail requests: ${taskReads}`)
  await task.getByRole('button', { name: '关闭', exact: true }).last().click()
  await task.waitFor({ state: 'hidden' })
  assert.equal(new URL(page.url()).searchParams.has('divisionTask'), false)
} finally {
  await cleanup()
}
