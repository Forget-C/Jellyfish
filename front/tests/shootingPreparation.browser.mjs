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
  const selectSource = async (start, end) => prepDialog.locator('.shooting-source-text').evaluate((root, span) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const range = document.createRange()
    let offset = 0
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const next = offset + node.length
      if (span.start >= offset && span.start < next) range.setStart(node, span.start - offset)
      if (span.end > offset && span.end <= next) { range.setEnd(node, span.end - offset); break }
      offset = next
    }
    getSelection().removeAllRanges()
    getSelection().addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  }, { start, end })
  await open()
  await prepDialog.getByRole('button', { name: '选段添加解释' }).click()
  await selectSource(0, 5)
  await prepDialog.getByRole('textbox', { name: '新增解释内容' }).fill('点灯动作发生在前厅')
  await prepDialog.getByRole('button', { name: '确认解释' }).click()
  await prepDialog.getByRole('button', { name: 'AI 分析全文', exact: true }).click()
  const review = page.getByRole('dialog', { name: '核对 AI 拍摄解释' })
  await review.locator('section').filter({ hasText: '点灯动作可以补充说明' }).getByText('采用本项', { exact: true }).click()
  await review.getByRole('button', { name: '将选中项加入草稿（1）' }).click()
  assert.equal(await prepDialog.getByRole('textbox', { name: '说明内容' }).nth(1).inputValue(), '人物走到灯旁再点灯')
  const marks = prepDialog.getByRole('button', { name: '查看此处拍摄解释：前厅点灯。' })
  assert.equal(await marks.count(), 1)
  await marks.press('Enter')
  await prepDialog.getByRole('heading', { name: '此处的解释' }).waitFor()
  assert.equal(await prepDialog.getByRole('textbox', { name: '说明内容' }).count(), 2)
  await prepDialog.getByRole('button', { name: '删除说明' }).nth(1).click()
  await prepDialog.getByRole('button', { name: '选段添加解释' }).click()
  await selectSource(2, 7)
  await prepDialog.getByText('所选文字与已有选段相交', { exact: true }).waitFor()
  await prepDialog.getByRole('button', { name: /使用已有选段/ }).click()
  await prepDialog.getByRole('button', { name: '取消本次选择' }).click()
  await prepDialog.getByRole('button', { name: '调整范围' }).click()
  await selectSource(0, 4)
  await prepDialog.getByRole('button', { name: '确认解释' }).click()
  await prepDialog.getByText('适用范围：前厅点灯', { exact: true }).waitFor()
  await prepDialog.getByRole('button', { name: '调整范围' }).click()
  await selectSource(0, 5)
  await prepDialog.getByRole('button', { name: '确认解释' }).click()

  let releasePoll
  const blockedPoll = new Promise(resolve => { releasePoll = resolve })
  await page.route('**/shooting-checks/*', async route => { await blockedPoll; await route.continue() })
  await prepDialog.getByRole('button', { name: 'AI 分析全文', exact: true }).click()
  const explanation = prepDialog.getByRole('textbox', { name: '说明内容' })
  await explanation.fill('点灯动作发生在前厅，走近后再点灯')
  releasePoll()
  await prepDialog.getByText('当前解释已变动，请对照分析结果核对').waitFor()
  assert.equal(await review.isVisible(), false)
  assert.equal(await explanation.inputValue(), '点灯动作发生在前厅，走近后再点灯')
  await prepDialog.getByRole('button', { name: /查看分析结果/ }).click()
  const revision = review.locator('section').filter({ hasText: '明确点灯位置' })
  await revision.getByText('分析后原解释已有改动，请核对最新文字').waitFor()
  await revision.getByText('采用本项', { exact: true }).click()
  await review.getByRole('button', { name: '将选中项加入草稿（1）' }).click()
  assert.equal(await explanation.count(), 1)
  assert.equal(await explanation.inputValue(), '人物在前厅的灯旁点灯')
  await explanation.fill('点灯动作发生在前厅')
  await prepDialog.getByRole('button', { name: '保存', exact: true }).click()
  await prepDialog.waitFor({ state: 'hidden' })
  const after = await request(chapterApi)
  assert.equal(after.sequences.find(row => row.id === second.id).title, '后院')
  await draftList.getByRole('button', { name: /后院草稿/ }).waitFor()
  const explanationApi = chapterApi + '/shooting-explanations?source_version=' + source.source_version
  assert.deepEqual((await request(explanationApi)).preparation.notes[0].scope, { start: 0, end: 5 })
  assert.deepEqual((await readCanvas()).document.fixed_source, originalCanvas.document.fixed_source)
  assert.equal((await request(firstApi + '/storyboards/basis')).shooting_notes[0].text, '点灯动作发生在前厅')
  await page.getByRole('button', { name: '保存为新版本', exact: true }).click()
  const preview = page.getByRole('dialog', { name: '划分变更预览' })
  await preview.getByRole('button', { name: '保存本章划分', exact: true }).click()
  await preview.waitFor({ state: 'hidden' })
  assert.equal((await request(chapterApi)).sequences.find(row => row.id === second.id).title, '后院草稿')

  await page.goto(location + '?sequence=' + first.id + '&step=storyboard')
  await page.getByRole('button', { name: '生成新分镜画布', exact: true }).click()
  const generation = page.getByRole('dialog', { name: '生成新分镜画布' })
  await generation.getByText('点灯动作发生在前厅', { exact: true }).waitFor()

  await request(studio + '/chapters/' + chapter, 'PATCH', { raw_text: raw + '院门开了。', confirm_source_change: true })
  await page.goto(location + '?sequence=' + first.id + '&step=division')
  const sourceChoice = page.getByRole('dialog', { name: '原文有变动，是否使用最新原文' })
  await sourceChoice.getByRole('button', { name: '不使用，沿用原版本', exact: true }).click()
  await sourceChoice.waitFor({ state: 'hidden' })
  await page.setViewportSize({ width: 390, height: 900 })
  await open()
  await prepDialog.getByText('当前使用历史版本原文', { exact: true }).waitFor()
  assert.equal(await prepDialog.getByRole('textbox', { name: '说明内容' }).inputValue(), '点灯动作发生在前厅')
  await prepDialog.getByRole('button', { name: '查看此处拍摄解释：前厅点灯。' }).click()
  await prepDialog.getByRole('button', { name: '返回原文' }).click()
  assert.equal(await prepDialog.getByRole('button', { name: '查看此处拍摄解释：前厅点灯。' }).evaluate(node => node === document.activeElement), true)
  await prepDialog.screenshot({ path: join(output, 'shooting-explanations-narrow.png'), animations: 'disabled' })
  await page.goto(location + '?sequence=' + first.id + '&step=division')
  await sourceChoice.getByRole('button', { name: '使用最新原文', exact: true }).click()
  await sourceChoice.waitFor({ state: 'hidden' })
  await open()
  await prepDialog.getByText('当前使用最新原文', { exact: true }).waitFor()
  assert.equal(await prepDialog.getByRole('textbox', { name: '说明内容' }).inputValue(), '点灯动作发生在前厅')
  await prepDialog.getByText('适用范围：前厅点灯。', { exact: true }).waitFor()
  console.log('chapter shooting explanations browser passed', output)
} finally {
  await cleanup()
}
