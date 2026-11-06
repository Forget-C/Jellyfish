import { openCanvasCard, closeCanvasDetails } from './generationCanvasWorkbench.browser-helpers.mjs'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-design-focus-audit-')
const api = 'http://127.0.0.1:8694', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8694' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser, page
const cleanup = browserCleanup(() => ({ browser, server, backend }))
try {
  let ready = false
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null) throw new Error('isolated backend exited')
    try { if ((await fetch(base)).ok) { ready = true; break } } catch {}
    await delay(250)
  }
  assert.ok(ready, 'isolated backend ready')
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4694, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '全部设计卡焦点轮廓检查' }) })).json()).data
  const definitions = (await (await fetch(`${base}/${canvas.id}/catalog`)).json()).data.cards.filter(card => card.type.startsWith('direction.'))
  assert.equal(definitions.length, 25)
  const visual = new Set(['style', 'composition', 'camera', 'movement', 'lighting', 'focus'])
  const document = { ...canvas.document, cards: definitions.map(definition => {
    const id = definition.type.slice('direction.'.length)
    const fields = Object.fromEntries(definition.fields.map((field, index) => [field.id, index === 0 ? { text: '模型提取的设计参数', state: 'proposal', purpose: 'background', source_locator: '模型提取定位', authorship: 'model' } : { text: '自行填写的设计参数', state: 'fact', purpose: 'design', authorship: 'user' }]))
    return { id, type: definition.type, source_locator: '卡片原始定位', ...(id === 'movement' ? { phases: [{ id: 'focus-phase', name: '中间阶段', frame: { text: '阶段画面' } }] } : {}), ...(id === 'dialogue' ? { dialogue_id: 'audit-dialogue' } : {}), ...(visual.has(id) ? { fields } : fields) }
  }) }
  const ordinaryAnchorTargets = new Set(['anchor', 'blocking', 'activity', 'beat', 'shot', 'space_rule', 'continuity'])
  document.cards.push({ id: 'candidate-anchor', type: 'direction.anchor', anchor_id: 'candidate', name: '普通候选锚点', position: { text: '窗边', authorship: 'user' } })
  document.edges = [...ordinaryAnchorTargets].map(id => ({ id: `candidate-${id}`, source_card: 'candidate-anchor', source_port: 'anchor', target_card: id, target_port: 'anchor' }))
  document.input_order = Object.fromEntries([...ordinaryAnchorTargets].map(id => [id, { anchor: [`candidate-${id}`] }]))
  const criterion = document.cards.find(card => card.id === 'criterion')
  criterion.standard.document = { segments: [{ id: 'intro', kind: 'text', text: '参考：' }, { id: 'source', kind: 'reference', source: { canvas_id: canvas.id, card_id: 'candidate-anchor', port_id: 'text', position: 0 } }] }
  document.edges.push({ id: 'criterion-reference', source_card: 'candidate-anchor', source_port: 'text', target_card: 'criterion', target_port: 'text' })
  document.input_order.criterion = { text: ['criterion-reference'] }
  const seeded = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document }) })
  assert.ok(seeded.ok, await seeded.text())
  await page.goto(`http://127.0.0.1:4694/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const failures = []
  let checked = 0
  const retainedExamples = new Set(['anchor', 'dialogue', 'sound'])
  const inspectFocus = async (control, kind, viewport) => {
    await control.scrollIntoViewIfNeeded()
    await control.focus()
    await control.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const paint = await control.evaluate(node => {
      const target = node.closest('.ant-select')?.querySelector('.ant-select-selector') || node.closest('.ant-input-number') || node
      const css = getComputedStyle(target), box = target.getBoundingClientRect()
      const outline = css.outlineStyle !== 'none' ? Math.max(0, parseFloat(css.outlineOffset) + parseFloat(css.outlineWidth)) : 0
      const shadow = css.boxShadow.replace(/rgba?\([^)]*\)/g, '').match(/-?[\d.]+px/g)?.map(parseFloat) || []
      const outset = Math.max(outline, shadow.length >= 4 ? shadow[2] + shadow[3] : 0)
      const clipped = []
      for (let parent = target.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent), rect = parent.getBoundingClientRect()
        const left = rect.left + parent.clientLeft, top = rect.top + parent.clientTop
        const right = left + parent.clientWidth, bottom = top + parent.clientHeight
        const sides = []
        if (['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowX)) {
          if (box.left - outset < left - 0.5) sides.push('left')
          if (box.right + outset > right + 0.5) sides.push('right')
        }
        if (['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowY)) {
          if (box.top - outset < top - 0.5) sides.push('top')
          if (box.bottom + outset > bottom + 0.5) sides.push('bottom')
        }
        if (sides.length) clipped.push({ ancestor: parent.className, sides, overflow: { top: top - (box.top - outset), bottom: box.bottom + outset - bottom } })
      }
      const root = node.closest('.design-preset-editor')
      const font = getComputedStyle(node), placeholder = getComputedStyle(node, '::placeholder')
      return { label: node.getAttribute('aria-label') || node.id, clipped, font: { size: font.fontSize, weight: font.fontWeight, family: font.fontFamily }, family: (() => { const probe = document.createElement('span'); probe.style.fontFamily = root && getComputedStyle(root).getPropertyValue('--design-input-font') || ''; root?.append(probe); const family = getComputedStyle(probe).fontFamily; probe.remove(); return family })(), placeholder: { size: placeholder.fontSize, weight: placeholder.fontWeight } }
    })
    if (!await control.evaluate(node => !!node.closest('.design-title-row'))) {
      assert.deepEqual(paint.font, { size: '14px', weight: '400', family: paint.family }, `${kind} ${paint.label}: consistent input typography`)
      if (await control.evaluate(node => node.matches('input, textarea'))) assert.deepEqual(paint.placeholder, { size: '14px', weight: '400' })
    }
    checked++
    if (paint.clipped.length) failures.push({ kind, viewport, ...paint })
  }
  for (const definition of definitions) {
    const id = definition.type.slice('direction.'.length)
    const detail = await openCanvasCard(page, id)
    assert.equal(await detail.getByText('revision 1', { exact: true }).count(), 1, `${id}: saved canvas revision in footer`)
    assert.equal(await detail.locator('summary').filter({ hasText: '查看已保存完整' }).count(), 0, `${id}: no redundant output preview`)
    if (ordinaryAnchorTargets.has(id)) await detail.locator('[data-design-source]').first().waitFor()
    assert.equal(await detail.getByRole('region', { name: '被使用记录', exact: true }).count(), 0)
    if (!ordinaryAnchorTargets.has(id) || id === 'anchor') for (const heading of ['对象关系', '直接对象与空间关系', '直接关系候选与已采用']) await detail.getByRole('heading', { name: heading, exact: true }).waitFor({ state: 'detached' })
    for (const row of await detail.locator('.design-preset-relations section > div:has(> span)').all()) assert.ok(await row.getByRole('button').count() || await row.getByRole('alert').count(), `${id}: relation names have operations or warnings`)
    const advanced = detail.getByRole('button', { name: '高级设置', exact: true })
    if (await advanced.count()) await advanced.click()
    const heading = detail.locator('.design-preset-advanced-heading')
    assert.equal(await heading.evaluate(node => !!node.closest('.design-preset-advanced')), false, `${definition.title}: heading stays outside scrolling content`)
    const headingBox = await heading.boundingBox()
    await detail.locator('.design-preset-advanced').evaluate(node => { node.scrollTop = node.scrollHeight })
    assert.deepEqual(await heading.boundingBox(), headingBox, `${definition.title}: scrolling preserves the heading`)
    await detail.locator('.design-preset-advanced').evaluate(node => { node.scrollTop = 0 })
    assert.equal(await detail.locator('summary').filter({ hasText: /正向示例与反例|固定证据与前后态素材|参考素材与图片标记|直接素材参考/ }).count(), retainedExamples.has(id) ? 1 : 0, `${id}: only retained cards expose local references`)
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
      for (const token of await detail.locator('.generation-prompt-token').all()) assert.deepEqual(await token.evaluate(node => { const style = getComputedStyle(node); return [style.fontSize, style.fontWeight] }), ['14px', '400'])
      for (const metadata of await detail.locator('.design-field-metadata').all()) assert.deepEqual(await metadata.evaluate(node => { const style = getComputedStyle(node); return [style.fontSize, style.fontWeight, style.whiteSpace] }), ['11px', '400', 'nowrap'])
      const revision = detail.locator('.design-preset-revision')
      assert.equal(await revision.evaluate(node => { const box = node.getBoundingClientRect(), parent = node.closest('.generation-editor-actions').getBoundingClientRect(); return box.left >= parent.left && box.right <= parent.right && box.top >= parent.top && box.bottom <= parent.bottom }), true, `${id}: footer revision fits ${width}px`)
      const scopeButton = detail.getByRole('button', { name: /整卡适用限制/ })
      await scopeButton.click()
      for (const input of await detail.locator('.design-scope-panel input').all()) if (await input.isEnabled()) await inspectFocus(input, id, width)
      await scopeButton.click()
      await detail.locator('.design-scope-panel').waitFor({state:'hidden'})
      const controls = detail.locator('[role="textbox"], input:not([type="hidden"]), textarea')
      for (const control of await controls.all()) {
        if (await control.isVisible() && await control.isEnabled()) await inspectFocus(control, id, width)
      }
      await detail.screenshot({ path: join(output, `${id}-focus-${width}.png`) })
      const editName = detail.getByRole('button', { name: /^编辑.*名称$/ })
      if (await editName.count()) {
        await editName.click()
        const input = detail.locator('.design-title-row input')
        await inspectFocus(input, id, width)
        await input.press('Escape')
      }
    }
    await closeCanvasDetails(page)
    await page.setViewportSize({ width: 1440, height: 1000 })
    console.log('CHECKED focus', definition.type)
  }
  console.log('Focus controls checked:', checked)
  assert.deepEqual(failures, [], 'focused controls must retain their entire outline on all four sides')
} finally { await cleanup() }
