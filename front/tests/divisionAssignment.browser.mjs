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
  const list = page.getByRole('complementary', { name: '划场场次列表' })
  const reader = page.getByRole('region', { name: '完整章节原文' })
  assert.equal(await list.getByRole('button', { name: '新建场次', exact: true }).count(), 0)
  await reader.getByRole('radio', { name: '键盘／触屏选择', exact: true }).locator('xpath=ancestor::label').click()
  const text = page.getByRole('textbox', { name: '键盘或触屏选择原文', exact: true })
  const select = async (start, end) => {
    await text.press('ControlOrMeta+Home')
    for (let n = 0; n < start; n++) await text.press('ArrowRight')
    for (let n = start; n < end; n++) await text.press('Shift+ArrowRight')
  }
  const confirm = async () => {
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: '确认加入草稿', exact: true }) })
    await dialog.locator('button.ant-btn-loading').waitFor({ state: 'hidden' })
    assert.equal(await dialog.locator('.ant-alert-error').count(), 0, await dialog.innerText())
    await dialog.getByRole('button', { name: '确认加入草稿', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
  }
  await select(1, 3)
  await reader.getByRole('button', { name: '新建场次', exact: true }).click()
  assert.deepEqual(await text.evaluate(el => [el.selectionStart, el.selectionEnd]), [1, 3])
  await reader.getByRole('textbox', { name: '新场次名称' }).fill('抽取 C')
  await reader.getByRole('button', { name: '创建场次', exact: true }).click()
  const operation = page.getByRole('dialog', { name: '确认新建场次', exact: true })
  await operation.waitFor()
  await operation.getByRole('textbox', { name: /结果名称/ }).nth(1).fill('结果 C 已编辑')
  await operation.getByRole('radio', { name: '后段', exact: true }).check()
  assert.equal(await operation.getByRole('textbox', { name: /结果名称/ }).nth(1).inputValue(), '结果 C 已编辑')
  assert.equal((await request(chapterApi)).sequences.length, 1, 'operation preview does not persist')
  await page.getByRole('button', { name: '继续调整', exact: true }).click()
  assert.equal(await reader.getByRole('textbox', { name: '新场次名称' }).inputValue(), '抽取 C')
  await reader.getByRole('button', { name: '创建场次', exact: true }).click()
  assert.equal(await operation.getByRole('textbox', { name: /结果名称/ }).nth(1).inputValue(), '结果 C 已编辑')
  await confirm()
  assert.equal(await list.locator('.chapter-scene-select').count(), 3)
  await reader.getByRole('button', { name: '撤销上一步', exact: true }).click()
  assert.equal(await list.locator('.chapter-scene-select').count(), 1)
  await select(1, 3)
  await reader.getByRole('button', { name: '并入／合并场次', exact: true }).click()
  await page.getByRole('menuitem', { name: /并入前场/ }).click()
  await confirm()
  assert.equal(await list.locator('.chapter-scene-select').count(), 2)
  await page.getByRole('button', { name: '保存为新版本', exact: true }).click()
  const preview = page.getByRole('dialog', { name: '划分变更预览', exact: true })
  const identity = preview.getByRole('checkbox', { name: /核对拆分/ })
  await identity.check()
  await preview.getByRole('button', { name: '保存本章划分', exact: true }).click()
  await preview.waitFor({ state: 'hidden' })
  const saved = await request(chapterApi)
  assert.deepEqual(saved.sequences.map(row => row.source_text), ['前厅点', '灯。'])
  assert.equal(saved.sequences[0].id, original.id)
  assert.equal(await reader.getByRole('button', { name: '撤销上一步', exact: true }).isDisabled(), true)
  await page.screenshot({ path: join(output, 'assignment-desktop.png') })
  // Cancelling a whole-scene merge retains its edited name and guards all exits.
  await reader.getByRole('button', { name: '并入／合并场次', exact: true }).click()
  await page.getByRole('menuitem', { name: /与后场合并/ }).click()
  const whole = page.getByRole('dialog', { name: '确认合并场次', exact: true })
  await whole.getByRole('textbox', { name: /结果名称/ }).fill('缓存合并名称')
  await whole.getByRole('button', { name: '继续调整' }).click()
  assert.equal(await page.getByRole('button', { name: '保存为新版本', exact: true }).isDisabled(), true)
  await list.locator('.chapter-scene-select').last().click()
  const stageGuard = page.getByRole('dialog').filter({ has: page.getByText('放弃本次操作？', { exact: true }) })
  await stageGuard.getByRole('button', { name: '继续当前操作', exact: true }).click()
  await reader.getByRole('button', { name: '继续当前操作', exact: true }).click()
  assert.equal(await whole.getByRole('textbox', { name: /结果名称/ }).inputValue(), '缓存合并名称')
  await whole.getByRole('button', { name: '继续调整' }).click()
  await page.getByRole('button', { name: '返回章节列表', exact: true }).click()
  const leaveGuard = page.getByRole('dialog').filter({ has: page.getByText('有未保存的修改', { exact: true }) })
  assert.equal(await leaveGuard.getByRole('button', { name: '保存后继续', exact: true }).isDisabled(), true)
  await leaveGuard.getByRole('button', { name: '取消，继续编辑', exact: true }).click()
  await reader.getByRole('button', { name: '取消本次操作', exact: true }).click()
  // An unselected newline blocks whole-scene merge; selecting it permits append.
  const gapChapter = 'assignment-gap'
  const gapApi = chapterApi.replace(chapter, gapChapter)
  await request(studio + '/chapters', 'POST', { id: gapChapter, project_id: project, index: 1, title: '连续边界', raw_text: '甲\n乙' })
  const gapSource = await request(gapApi)
  const gapA = await request(gapApi + '/sequences', 'POST', { title: 'A', position: 0, source_version: gapSource.source_version, span: { start: 0, end: 1 } })
  await request(gapApi + '/sequences', 'POST', { title: 'B', position: 1, source_version: gapSource.source_version, span: { start: 2, end: 3 } })
  await page.goto(location.replace(chapter, gapChapter).replace(original.id, gapA.id))
  await reader.getByRole('button', { name: '并入／合并场次', exact: true }).click()
  assert.equal(await page.getByRole('menuitem', { name: /与后场合并/ }).getAttribute('aria-disabled'), 'true')
  await page.keyboard.press('Escape')
  await reader.getByRole('radio', { name: '键盘／触屏选择', exact: true }).locator('xpath=ancestor::label').click()
  await select(1, 2)
  await reader.getByRole('button', { name: '并入／合并场次', exact: true }).click()
  await page.getByRole('menuitem', { name: /并入前场/ }).click()
  await confirm()
  await reader.getByRole('button', { name: '撤销上一步', exact: true }).click()
  await reader.getByRole('button', { name: '并入／合并场次', exact: true }).click()
  assert.equal(await page.getByRole('menuitem', { name: /与后场合并/ }).getAttribute('aria-disabled'), 'true')
  await page.keyboard.press('Escape')
  // A server blocker must leave the candidate and chapter unchanged.
  await page.route('**/division/preview', async route => {
    const response = await route.fetch()
    const value = await response.json()
    value.data.blockers = ['任务仍在执行，暂不能退出']
    await route.fulfill({ response, json: value })
  })
  await select(0, 3)
  await reader.getByRole('button', { name: '新建场次', exact: true }).click()
  await reader.getByRole('textbox', { name: '新场次名称' }).fill('受阻候选')
  await reader.getByRole('button', { name: '创建场次', exact: true }).click()
  const blocked = page.getByRole('dialog', { name: '确认新建场次', exact: true })
  await blocked.getByText('任务仍在执行，暂不能退出', { exact: true }).waitFor()
  assert.equal(await blocked.getByRole('button', { name: '确认加入草稿' }).isDisabled(), true)
  await blocked.getByRole('button', { name: '继续调整' }).click()
  assert.equal(await reader.getByRole('textbox', { name: '新场次名称' }).inputValue(), '受阻候选')
  assert.equal((await request(gapApi)).sequences.length, 2)
  await reader.getByRole('button', { name: '取消新建', exact: true }).click()
  await page.unroute('**/division/preview')
  // Another unresolved scene must not let an empty result name bypass validation.
  await page.route('**/directing/chapters/' + gapChapter, async route => {
    const response = await route.fetch()
    const value = await response.json()
    value.data.sequences[1].source_changed = true
    await route.fulfill({ response, json: value })
  })
  await page.reload()
  await reader.getByRole('radio', { name: '键盘／触屏选择', exact: true }).locator('xpath=ancestor::label').click()
  await select(0, 1)
  await reader.getByRole('button', { name: '新建场次', exact: true }).click()
  await reader.getByRole('textbox', { name: '新场次名称' }).fill('待定位并存')
  await reader.getByRole('button', { name: '创建场次', exact: true }).click()
  const unresolved = page.getByRole('dialog', { name: '确认新建场次', exact: true })
  await unresolved.getByText(/本章还有待定位场次/).waitFor()
  await unresolved.getByRole('textbox', { name: /结果名称/ }).fill('')
  await unresolved.getByText('请输入全部结果名称', { exact: true }).waitFor()
  assert.equal(await unresolved.getByRole('button', { name: '确认加入草稿' }).isDisabled(), true)
  await unresolved.getByRole('button', { name: '继续调整' }).click()
  await reader.getByRole('button', { name: '取消新建', exact: true }).click()
  await page.unroute('**/directing/chapters/' + gapChapter)
  await page.setViewportSize({ width: 390, height: 844 })
  await reader.getByRole('button', { name: '新建场次', exact: true }).click()
  await reader.getByRole('textbox', { name: '新场次名称' }).fill('窄屏临时名称')
  const bounds = await reader.getByRole('textbox', { name: '新场次名称' }).boundingBox()
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391)
  await page.getByRole('button', { name: '本章场次', exact: true }).click()
  await page.locator('.ant-drawer-close').click()
  await page.locator('.ant-drawer-open').waitFor({ state: 'hidden' })
  assert.equal(await reader.getByRole('textbox', { name: '新场次名称' }).inputValue(), '窄屏临时名称')
  await page.screenshot({ path: join(output, 'assignment-mobile.png') })
} finally { await cleanup() }
