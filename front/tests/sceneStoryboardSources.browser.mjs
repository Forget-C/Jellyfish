import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import { closeCanvasDetails } from './generationCanvasWorkbench.browser-helpers.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-canvas-source-')
const api = 'http://127.0.0.1:8327', studio = `${api}/api/v1/studio`
const project = 'canvas-project', chapter = 'storyboard-source-chapter', excerpt = '🌱开头\n'.repeat(26) + '前门的阿同拿着信封。后门的阿同等待。'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_SCENE_OBJECTS: '1', CANVAS_BROWSER_SCENE_STORYBOARD: '1', CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'),
    CANVAS_BROWSER_PORT: '8327' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser, page
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
    try { if ((await fetch(`${studio}/generation-canvases/${project}`)).ok) { ready = true; break } } catch {}
    await delay(250)
  }
  assert.ok(ready)
  await request(`${studio}/chapters`, 'POST', { id: chapter, project_id: project, index: 0, title: '候车', raw_text: excerpt })
  const scenes = `${studio}/projects/${project}/directing/chapters/${chapter}/sequences`
  const sequence = await request(scenes, 'POST', { title: '两人等候', position: 0,
    source_version: createHash('sha256').update(excerpt).digest('hex'), span: { start: 0, end: Array.from(excerpt).length } })
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4327, strictPort: true, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  page.setDefaultTimeout(16000)
  const prep = `http://127.0.0.1:4327/projects/${project}/chapters/${chapter}/sequences/${sequence.id}/canvas-workbench`
  await page.goto(prep)
  await page.getByRole('button', { name: '提取对象', exact: true }).click()
  const front = page.getByRole('region', { name: '阿同 · 前门的阿同', exact: true })
  await front.getByRole('combobox', { name: '关联资产' }).click()
  await page.getByText('已有角色（提取建议）', { exact: true }).click()
  await front.getByRole('combobox', { name: '选择参考图' }).click()
  await page.getByText('参考图 1', { exact: true }).click()
  await front.getByText('已选参考图', { exact: true }).waitFor()
  await page.getByRole('button', { name: '生成分镜', exact: true }).click()
  const config = page.getByRole('dialog', { name: '生成分镜' })
  await config.getByRole('textbox', { name: '画布名称' }).fill('忠实分镜验收')
  await config.getByRole('combobox', { name: '生产模型' }).click()
  await page.getByText('分镜测试图片模型', { exact: true }).click()
  await config.getByRole('button', { name: '开始提取', exact: true }).click()
  await page.getByRole('region', { name: '生成画布工作台' }).waitFor()
  const id = new URL(page.url()).searchParams.get('canvas')
  const canvas = `${studio}/generation-canvases/${project}/${id}`
  const read = () => request(canvas)
  const poll = async predicate => {
    for (let attempt = 0; attempt < 130; attempt++) {
      const state = await read()
      if (predicate(state)) return state
      await delay(100)
    }
    throw new Error('canvas state not saved')
  }
  const applied = await poll(state => !!state.document.storyboard)
  const { shots } = applied.document.storyboard
  const sourceCard = applied.document.fixed_source.card_id
  const compile = async () => {
    const { input } = await request(`${canvas}/precheck`, 'POST', { card_id: shots[0].model_card_ids[0] })
    delete input.revision
    return input
  }
  const compiledBefore = await compile()
  await page.getByRole('button', { name: '适应全部', exact: true }).click()
  const card = id => page.locator(`[data-card-id="${id}"]`)
  const trigger = card(shots[0].card_id).getByRole('button', { name: '引用', exact: true })
  assert.equal(await card(sourceCard).getByRole('button', { name: '引用', exact: true }).count(), 0)
  await trigger.focus()
  await page.keyboard.press('Enter')
  const popup = page.getByRole('dialog', { name: '卡片引用', exact: true })
  await popup.getByRole('button', { name: /创作依据/ }).waitFor()
  await page.keyboard.press('Escape')
  await popup.waitFor({ state: 'hidden' })
  assert.equal(await trigger.evaluate(element => document.activeElement === element), true)
  await page.keyboard.press('Enter')
  await popup.getByRole('button', { name: /创作依据/ }).click()
  const original = page.getByRole('textbox', { name: '创作依据正文', exact: true })
  await original.waitFor()
  const verifyOriginal = () => page.waitForFunction(() => {
    const element = document.querySelector('textarea[aria-label="创作依据正文"]')
    return element?.value.slice(element.selectionStart, element.selectionEnd) === '前门的阿同拿着信封。'
  })
  await verifyOriginal()
  assert.ok(await original.evaluate(element => element.scrollTop > 0), 'long source scrolls to the highlighted passage')
  assert.equal((await read()).revision, applied.revision, 'source navigation must not edit the document')
  await closeCanvasDetails(page)

  const draft = structuredClone(applied.document)
  const sourceGroup = draft.groups.find(group => group.card_ids.includes(sourceCard))
  sourceGroup.collapsed = true
  const ids = { changed: 'text-evidence', cardOnly: 'card-evidence', stack: 'stack-evidence' }
  const raw = '🌿开头\n原位置。'
  draft.cards.push({ id: ids.changed, type: 'content.text', text: raw }, { id: ids.cardOnly, type: 'content.text', text: '仅定位卡片' },
    { id: ids.stack, type: 'content.text', text: '堆叠正文' })
  draft.groups.push({ id: 'test-reading-stack', kind: 'stack', name: '核对堆叠', card_ids: [ids.stack] })
  const fieldExcerpt = '后门的阿同等待。'
  draft.storyboard.origins[shots[0].card_id].sources.push(
    { card_id: shots[1].card_id, source_field_id: 'visible_result', start: 0, end: Array.from(fieldExcerpt).length, excerpt: fieldExcerpt },
    { card_id: ids.cardOnly },
    { card_id: ids.changed, start: 4, end: 8, excerpt: '原位置。' },
    { card_id: ids.stack, start: 0, end: 2, excerpt: '堆叠' },
  )
  const save = (document, expected_revision, request_id) => request(canvas, 'PUT', { document, expected_revision, request_id })
  const saved = await save(draft, applied.revision, 'source-locations')
  const fit = () => page.getByRole('button', { name: '适应全部', exact: true }).click()
  await page.goto(`http://127.0.0.1:4327/projects/${project}/generation-canvas?canvas=${id}`)
  await trigger.waitFor()
  await fit()
  assert.equal(await card(sourceCard).count(), 0)
  const open = async () => { await trigger.click(); await popup.waitFor() }
  await open()
  await popup.getByRole('button', { name: /创作依据/ }).click()
  await verifyOriginal()
  assert.equal(await card(sourceCard).count(), 1, 'navigation reveals the member in a collapsed group')
  assert.equal((await read()).document.groups.find(group => group.id === sourceGroup.id).collapsed, true)
  await closeCanvasDetails(page)
  await fit()
  await open()
  await popup.getByRole('button', { name: /镜头 02/ }).click()
  const targetField = page.getByRole('textbox', { name: '可见结果内容', exact: true })
  await targetField.waitFor()
  await page.waitForFunction(expected => window.getSelection()?.toString() === expected, fieldExcerpt)
  assert.ok(await targetField.evaluate(element => element === document.activeElement))
  await closeCanvasDetails(page)
  await fit()
  await open()
  await popup.getByRole('button', { name: '文本内容卡', exact: true }).click()
  await page.waitForFunction(id => document.activeElement?.getAttribute('data-card-id') === id, ids.cardOnly)
  assert.equal(await page.locator('.wb-details:visible').count(), 0, 'card-only source selects the card')
  await fit()
  await open()
  await popup.getByRole('button', { name: /正文 1–2/ }).click()
  const stacked = page.getByRole('textbox', { name: '文本内容', exact: true })
  await stacked.waitFor()
  assert.equal(await stacked.getAttribute('aria-readonly'), 'true')
  await page.waitForFunction(() => {
    const element = document.activeElement
    return element instanceof HTMLTextAreaElement && element.value.slice(element.selectionStart, element.selectionEnd) === '堆叠'
  })
  await closeCanvasDetails(page)
  const actual = await read()
  assert.equal(actual.revision, saved.revision)
  assert.equal(actual.document.groups.find(group => group.id === 'test-reading-stack').kind, 'stack')

  const invalidated = actual.document
  invalidated.cards = invalidated.cards.filter(item => item.id !== ids.cardOnly).map(item => item.id === ids.changed ? { ...item, text: raw.replace('原位置。', '新内容。') } : item)
  const invalidSaved = await save(invalidated, actual.revision, 'source-locations-invalidated')
  await page.setViewportSize({ width: 390, height: 860 })
  await page.reload()
  await trigger.waitFor()
  await fit()
  await open()
  await popup.getByText('来源卡片已删除或不可用').waitFor()
  assert.equal(await popup.getByRole('button', { name: /失效来源/ }).count(), 0)
  await popup.getByText('来源文本已变化，仅定位卡片或字段').waitFor()
  await page.waitForFunction(() => {
    const panel = [...document.querySelectorAll('[role="dialog"][aria-label="卡片引用"]')].find(node => node.getClientRects().length)
    if (!panel || Number(getComputedStyle(panel.closest('.ant-popover')).opacity) < 1) return false
    const rect = panel.getBoundingClientRect()
    return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight
  })
  await page.screenshot({ path: join(output, 'source-popover-narrow.png'), animations: 'disabled' })
  await popup.getByRole('button', { name: /正文 5–8/ }).click()
  const changed = page.getByRole('textbox', { name: '文本内容', exact: true })
  await changed.waitFor()
  assert.equal(await changed.inputValue(), raw.replace('原位置。', '新内容。'))
  assert.equal(await changed.evaluate(element => element.selectionStart === element.selectionEnd), true, 'changed evidence never highlights replacement text')
  assert.equal((await read()).revision, invalidSaved.revision)
  assert.deepEqual(await compile(), compiledBefore, 'source indexes never change actual inputs')
  process.stdout.write(JSON.stringify({ output, passed: true }) + '\n')
} finally { await cleanup() }
