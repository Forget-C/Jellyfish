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
    try { if ((await fetch(studio + '/generation-canvases?project_id=' + project)).ok) break } catch {}
    await delay(250)
  }
  const chapterApi = studio + '/projects/' + project + '/directing/chapters/' + chapter
  const raw = '前厅点灯。后院下雨。'
  await request(studio + '/chapters', 'POST', { id: chapter, project_id: project, index: 0, title: '两处灯光', raw_text: raw })
  const source = await request(chapterApi)
  const scene = (title, position, start, end) => request(chapterApi + '/sequences', 'POST',
    { title, position, source_version: source.source_version, span: { start, end } })
  const first = await scene('前厅', 1, 0, 5)
  const second = await scene('后院', 0, 5, 10)
  const firstApi = chapterApi + '/sequences/' + first.id
  const fixedCanvas = await request(firstApi + '/canvases', 'POST', { name: '固定原文方案' })
  const readCanvas = () => request(studio + '/generation-canvases/' + fixedCanvas.id + '?project_id=' + project)
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
  const context = await browser.newContext({ viewport: { width: 1600, height: 960 } })
  await context.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const page = await context.newPage()
  page.setDefaultTimeout(9000)
  const location = 'http://127.0.0.1:4386/projects/' + project + '/chapters/' + chapter + '/workbench-management'
  await page.goto(location + '?sequence=' + first.id + '&step=division')
  const reader = page.getByRole('region', { name: '完整章节原文' })
  await reader.waitFor()
  assert.equal(await reader.locator('.chapter-source-text').textContent(), raw)
  assert.equal(await reader.locator('.source-selection').textContent(), '前厅点灯。')
  assert.equal(await page.getByRole('button', { name: '放弃修改', exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: '编辑章节原文', exact: true }).count(), 0)
  await page.getByRole('button', { name: '保存为新版本', exact: true }).waitFor()
  const saveBox = await page.getByRole('button', { name: '保存为新版本', exact: true }).boundingBox()
  assert.ok(saveBox.x + saveBox.width > 1560, 'primary save aligns to the toolbar right')
  const sourceBox = await reader.boundingBox()
  const helperBox = await page.getByRole('complementary', { name: '划场场次列表' }).boundingBox()
  assert.ok(helperBox.x > sourceBox.x + sourceBox.width - 1, 'scene helper belongs to the right of source')
  const draftList = page.getByRole('complementary', { name: '划场场次列表' })
  assert.equal(await draftList.getByRole('button', { name: '拍摄解释', exact: true }).count(), 0)
  await draftList.locator('.chapter-division-member').filter({ hasText: '后院' }).getByRole('button', { name: '编辑场次名称', exact: true }).click()
  await page.getByRole('textbox', { name: '场次标题', exact: true }).fill('后院草稿')
  await page.getByRole('textbox', { name: '场次标题', exact: true }).press('Enter')
  const entry = page.getByRole('button', { name: '拍摄解释', exact: true })
  const prepDialog = page.getByRole('dialog', { name: '本章拍摄解释' })
  const open = async () => { await entry.click(); await prepDialog.getByText(/当前使用.*原文/).waitFor() }
  await open()
  await prepDialog.getByRole('button', { name: '新增说明' }).click()
  await prepDialog.getByRole('textbox', { name: '说明内容' }).fill('切换特写时人物仍在前厅')
  await prepDialog.getByText('原文与范围选择', { exact: true }).click()
  const sourceInput = prepDialog.getByRole('textbox', { name: '章节原文选区' })
  await sourceInput.evaluate(input => { input.focus(); input.setSelectionRange(0, 5) })
  await sourceInput.dispatchEvent('mouseup')
  await prepDialog.getByRole('button', { name: '用选区设范围' }).click()
  await prepDialog.getByRole('button', { name: '开始检查', exact: true }).click()
  await prepDialog.getByText('报告对应当前内容', { exact: true }).waitFor()
  await prepDialog.getByRole('button', { name: '交由分镜设计', exact: true }).click()
  assert.equal(await prepDialog.getByRole('textbox', { name: '说明内容' }).nth(1).inputValue(), '路线可由生成设计')
  await prepDialog.getByRole('button', { name: '删除说明' }).nth(1).click()
  await prepDialog.getByRole('button', { name: '保存', exact: true }).click()
  await prepDialog.waitFor({ state: 'hidden' })
  const after = await request(chapterApi)
  assert.equal(after.sequences.find(row => row.id === second.id).title, '后院')
  await draftList.getByRole('button', { name: /后院草稿/ }).waitFor()
  const explanationApi = chapterApi + '/shooting-explanations?source_version=' + source.source_version
  assert.deepEqual((await request(explanationApi)).preparation.notes[0].scope, { start: 0, end: 5 })
  assert.deepEqual((await readCanvas()).document.fixed_source, originalCanvas.document.fixed_source)
  assert.equal((await request(firstApi + '/storyboards/basis')).shooting_notes[0].text, '切换特写时人物仍在前厅')
  await page.getByRole('button', { name: '保存为新版本', exact: true }).click()
  const preview = page.getByRole('dialog', { name: '划分变更预览' })
  await preview.getByRole('button', { name: '保存本章划分', exact: true }).click()
  await preview.waitFor({ state: 'hidden' })
  assert.equal((await request(chapterApi)).sequences.find(row => row.id === second.id).title, '后院草稿')

  await page.goto(location + '?sequence=' + first.id + '&step=storyboard')
  await page.getByRole('button', { name: '生成新分镜画布', exact: true }).click()
  const generation = page.getByRole('dialog', { name: '生成新分镜画布' })
  await generation.getByText('切换特写时人物仍在前厅', { exact: true }).waitFor()

  await request(studio + '/chapters/' + chapter, 'PATCH', { raw_text: raw + '院门开了。', confirm_source_change: true })
  await page.goto(location + '?sequence=' + first.id + '&step=division')
  const sourceChoice = page.getByRole('dialog', { name: '原文有变动，是否使用最新原文' })
  await sourceChoice.getByRole('button', { name: '不使用，沿用原版本', exact: true }).click()
  await sourceChoice.waitFor({ state: 'hidden' })
  await page.setViewportSize({ width: 780, height: 900 })
  await open()
  await prepDialog.getByText('当前使用历史版本原文', { exact: true }).waitFor()
  assert.equal(await prepDialog.getByRole('textbox', { name: '说明内容' }).inputValue(), '切换特写时人物仍在前厅')
  await page.screenshot({ path: join(output, 'shooting-explanations-narrow.png'), fullPage: true, animations: 'disabled' })
  await page.goto(location + '?sequence=' + first.id + '&step=division')
  await sourceChoice.getByRole('button', { name: '使用最新原文', exact: true }).click()
  await sourceChoice.waitFor({ state: 'hidden' })
  await open()
  await prepDialog.getByText('当前使用最新原文', { exact: true }).waitFor()
  assert.equal(await prepDialog.getByRole('textbox', { name: '说明内容' }).inputValue(), '切换特写时人物仍在前厅')
  await prepDialog.getByText('适用范围：前厅点灯。', { exact: true }).waitFor()
  console.log('chapter shooting explanations browser passed', output)
} finally {
  await cleanup()
}
