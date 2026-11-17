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
  const list = page.getByRole('complementary', { name: '本章场次' })
  const draftList = page.getByRole('complementary', { name: '划场场次列表' })
  await draftList.locator('.chapter-division-member').filter({ hasText: '前厅' }).getByRole('button', { name: '拍摄准备', exact: true }).click()
  const prepDialog = page.getByRole('dialog', { name: /拍摄准备/ })
  await prepDialog.getByRole('button', { name: '新增说明' }).click()
  await prepDialog.getByRole('textbox', { name: '说明内容' }).fill('切换特写时人物仍在前厅')
  await prepDialog.getByRole('button', { name: '保存', exact: true }).click()
  await prepDialog.waitFor({ state: 'hidden' })
  const prepSaved = await request(chapterApi)
  assert.equal(prepSaved.sequences.find(row => row.id === first.id).shooting_preparation.notes[0].text, '切换特写时人物仍在前厅')

  await draftList.locator('.chapter-division-member').filter({ hasText: '后院' }).getByRole('button', { name: '编辑场次名称', exact: true }).click()
  await page.getByRole('textbox', { name: '场次标题', exact: true }).fill('后院草稿')
  await page.getByRole('textbox', { name: '场次标题', exact: true }).press('Enter')
  await draftList.locator('.chapter-division-member').filter({ hasText: '前厅' }).getByRole('button', { name: '拍摄准备', exact: true }).click()
  await prepDialog.getByRole('textbox', { name: '说明内容' }).fill('切换特写时其余人物仍在前厅')
  await prepDialog.getByRole('button', { name: '开始检查', exact: true }).click()
  await prepDialog.getByText('报告对应当前内容', { exact: true }).waitFor()
  await prepDialog.getByText('可由生成安排可行路线', { exact: true }).waitFor()
  await page.screenshot({ path: join(output, 'shooting-preparation-desktop.png'), fullPage: true, animations: 'disabled' })
  await prepDialog.getByRole('button', { name: '保存', exact: true }).click()
  await prepDialog.waitFor({ state: 'hidden' })
  assert.equal((await request(chapterApi)).sequences.find(row => row.id === second.id).title, '后院')
  await draftList.getByRole('button', { name: /后院草稿/ }).waitFor()
  await draftList.locator('.chapter-division-member').filter({ hasText: '后院草稿' }).getByRole('button', { name: '拍摄准备', exact: true }).click()
  await prepDialog.getByRole('button', { name: '新增说明' }).click()
  await prepDialog.getByRole('textbox', { name: '说明内容' }).fill('后院雨势作为环境参考')
  await prepDialog.getByRole('button', { name: '保存到场次草稿', exact: true }).click()
  await prepDialog.waitFor({ state: 'hidden' })
  assert.equal((await request(chapterApi)).sequences.find(row => row.id === second.id).shooting_preparation.notes.length, 0)
  await page.getByRole('button', { name: '保存为新版本', exact: true }).click()
  const preview = page.getByRole('dialog', { name: '划分变更预览' })
  await preview.getByRole('button', { name: '保存本章划分', exact: true }).click()
  await preview.waitFor({ state: 'hidden' })
  const saved = await request(chapterApi)
  assert.equal(saved.sequences.find(row => row.id === second.id).shooting_preparation.notes[0].text, '后院雨势作为环境参考')
  assert.equal(saved.sequences.find(row => row.id === second.id).title, '后院草稿')
  assert.deepEqual((await readCanvas()).document.fixed_source, originalCanvas.document.fixed_source)
  await page.setViewportSize({ width: 780, height: 900 })
  await page.getByRole('button', { name: '本章场次', exact: true }).click()
  await page.locator('.chapter-division-member').filter({ hasText: '前厅' }).getByRole('button', { name: '拍摄准备', exact: true }).click()
  await prepDialog.getByRole('textbox', { name: '说明内容' }).click()
  await page.screenshot({ path: join(output, 'shooting-preparation-narrow.png'), fullPage: true, animations: 'disabled' })
  await prepDialog.getByRole('textbox', { name: '说明内容' }).fill('暂不保存的编辑')
  await prepDialog.getByRole('button', { name: '取消', exact: true }).click()
  const discard = page.locator('.ant-modal-confirm')
  await discard.getByRole('button', { name: '继续编辑', exact: true }).click()
  assert.equal(await prepDialog.getByRole('textbox', { name: '说明内容' }).inputValue(), '暂不保存的编辑')
  await prepDialog.getByRole('button', { name: '取消', exact: true }).click()
  await discard.getByRole('button', { name: '放弃修改', exact: true }).click()
  await prepDialog.waitFor({ state: 'hidden' })
  await request(studio + '/chapters/' + chapter, 'PATCH', { raw_text: raw + '院门开了。', confirm_source_change: true })
  await page.goto(location + '?sequence=' + first.id + '&step=division')
  const sourceChoice = page.getByRole('dialog', { name: '原文有变动，是否使用最新原文' })
  await sourceChoice.getByRole('button', { name: '不使用，沿用原版本', exact: true }).click()
  await sourceChoice.waitFor({ state: 'hidden' })
  assert.equal(await reader.locator('.chapter-source-text').textContent(), raw)
  await page.getByRole('button', { name: '本章场次', exact: true }).click()
  await page.locator('.chapter-division-member').filter({ hasText: '前厅' }).getByRole('button', { name: '拍摄准备', exact: true }).click()
  await prepDialog.getByRole('textbox', { name: '说明内容' }).fill('继续沿用旧场次，人物仍在前厅')
  await prepDialog.getByRole('button', { name: '保存', exact: true }).click()
  await prepDialog.waitFor({ state: 'hidden' })
  const oldBasis = await request(chapterApi)
  assert.equal(oldBasis.sequences.find(row => row.id === first.id).source_text, '前厅点灯。')
  assert.equal(oldBasis.sequences.find(row => row.id === first.id).shooting_preparation.notes[0].text, '继续沿用旧场次，人物仍在前厅')
  await page.goto(location + '?sequence=' + first.id + '&step=division')
  await sourceChoice.getByRole('button', { name: '使用最新原文', exact: true }).click()
  await sourceChoice.waitFor({ state: 'hidden' })
  assert.equal(await reader.locator('.chapter-source-text').textContent(), raw + '院门开了。')
  console.log('shooting preparation browser passed', output)
} finally {
  await cleanup()
}
