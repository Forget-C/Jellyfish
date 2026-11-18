import { createStoryboardCanvas, storyboardCanvasApi, storyboardCanvasPath } from './storyboard-canvas-fixture.mjs'
import { closeCanvasDetails, closePrecheck } from './generationCanvasWorkbench.browser-helpers.mjs'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-generation-canvas-rules-')
const api = 'http://127.0.0.1:8611', base = `${api}/api/v1/studio/generation-canvases`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8611' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser, page
const cleanup = browserCleanup(() => ({ browser, server, backend }))
try {
  let ready = false
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null)
      throw new Error('isolated backend exited')
    try {
      if ((await fetch(base)).ok) {
        ready = true
        break
      }
    }
    catch {
    }
    await delay(250)
  }
  assert.ok(ready, 'isolated backend ready')
  writeFileSync(join(output, 'openapi.json'), JSON.stringify(await (await fetch(`${api}/openapi.json`)).json()))
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4611, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1920, height: 790 } })
  page = await context.newPage()
  page.setDefaultTimeout(12000)
  page.on('console', message => {
    if (message.type() === 'error')
      console.log('BROWSER ERROR', message.text())
  })
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => {
    window.__ENV = { BACKEND_URL: window.location.origin }
  })
  const request = async (path, body) => {
    const response = await fetch(new URL(path, api), body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
    assert.ok(response.ok, await response.clone().text())
    return (await response.json()).data
  }
  // Q1 uses separate browser storage fixtures, then observes public opening/zoom actions.
  const results = []
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  const mainPage = page
  for (const [side, x, y, width, height] of [['bottom', 200, 180, 1920, 1100], ['lower-edge', 200, 650, 1920, 1100], ['short-desktop', 200, 300, 1920, 850], ['right-edge', 1300, 300, 1920, 850], ['narrow', 200, 250, 900, 650]]) {
    const fixture = await createStoryboardCanvas(base, `Q1 ${side}`)
    const seeded = await fetch(storyboardCanvasApi(base, fixture.id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document: { ...fixture.document, cards: [...fixture.document.cards,
            { id: 'anchor', type: 'reference.place', name: '场所', angle: '正面' }
          ], edges: [] } }) })
    assert.ok(seeded.ok, await seeded.text())
    const isolated = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' })
    page = await isolated.newPage()
    page.setDefaultTimeout(8000)
    page.on('pageerror', error => pageErrors.push(error.message))
    await page.addInitScript(({ key, x, y }) => {
      window.__ENV = { BACKEND_URL: window.location.origin }
      localStorage.setItem(key, JSON.stringify({ schema: 1, positions: { anchor: { x, y } }, sizes: {}, transform: { x: 0, y: 0, scale: 1 } }))
    }, { key: `jellyfish:generation-layout:canvas-project:${fixture.id}:view:canvas`, x, y })
    await page.goto(`http://127.0.0.1:4611${storyboardCanvasPath(fixture)}`)
    const anchor = page.locator('[data-card-id="anchor"]')
    await anchor.waitFor()
    const initial = await anchor.boundingBox(), view = await page.locator('.generation-world').getAttribute('style')
    await anchor.press('Enter')
    const panel = page.locator('.generation-card-editor:visible')
    await panel.waitFor()
    await delay(50)
    const settled = await anchor.boundingBox(), editor = await panel.boundingBox()
    assert.equal(await panel.getAttribute('data-expanded'), String(side === 'narrow'))
    assert.deepEqual(await anchor.evaluate(node=>({x:parseFloat(node.style.left),y:parseFloat(node.style.top)})),{x,y},'opening changes viewport, not card coordinates')
    if(side!=='narrow') {
      assert.ok(Math.abs(editor.y-settled.y-settled.height-16)<1,'editor always stays below the card')
      assert.ok(Math.abs(editor.x-settled.x)<1,'editor shares the card left edge')
      assert.ok(editor.x>=16 && editor.x+editor.width<=width-16 && editor.y>=80,'editor is inside usable viewport')
      assert.ok(editor.y+editor.height<=(await page.locator('.generation-view-tools').boundingBox()).y-9,'editor avoids bottom controls')
      if(side==='bottom')assert.equal(await page.locator('.generation-world').getAttribute('style'),view,'enough space does not move canvas')
      else assert.notEqual(await page.locator('.generation-world').getAttribute('style'),view,'insufficient space pans canvas')
    }
    if (side !== 'narrow') {
      const font = await panel.locator('input').first().evaluate(e => getComputedStyle(e).fontSize)
      await page.getByRole('button', { name: '放大', exact: true }).click()
      assert.equal(await panel.locator('input').first().evaluate(e => getComputedStyle(e).fontSize), font, 'canvas zoom preserves editor font size')
    }
    if (side === 'bottom') {
      const origin = await anchor.boundingBox()
      await page.mouse.move(origin.x + 60, origin.y + 60)
      await page.mouse.down()
      await page.mouse.move(origin.x + 100, origin.y + 80, { steps: 4 })
      const dragScale = await page.getByLabel('画布缩放比例').textContent()
      await page.keyboard.press('0')
      assert.equal(await page.getByLabel('画布缩放比例').textContent(), dragScale, 'Q6: fit shortcut must not zoom during drag')
      await page.keyboard.press('Escape')
      await page.mouse.up()
      const frames = () => page.evaluate(() => new Promise(resolve => {
        let remaining = 8
        const tick = () => --remaining ? requestAnimationFrame(tick) : resolve()
        requestAnimationFrame(tick)
      }))
      const transform = () => page.locator('.generation-world').evaluate(e => {
        const m = new DOMMatrix(getComputedStyle(e).transform)
        return { x: m.e, y: m.f, scale: m.a }
      })
      const edgeX = width - 2, pointerY = origin.y + 80
      const idle = await transform()
      await page.mouse.move(edgeX, pointerY)
      await frames()
      assert.deepEqual(await transform(), idle, 'Q2: hovering near edge does not pan')
      const start = await anchor.boundingBox(), editorStart = await panel.boundingBox()
      const grab = {x:60,y:60}
      await page.mouse.move(start.x + grab.x, start.y + grab.y)
      await page.mouse.down()
      await page.mouse.move(width - 36, pointerY, { steps: 6 })
      const slowStart = await transform()
      await frames()
      const slowEnd = await transform()
      assert.ok(slowEnd.x < slowStart.x, 'Q2: dragging near edge pans')
      await page.mouse.move(edgeX, pointerY)
      const fastStart = await transform()
      await frames()
      const fastEnd = await transform()
      assert.ok(fastStart.x - fastEnd.x > (slowStart.x - slowEnd.x) * 3, 'Q2: approaching edge increases speed')
      const held = await anchor.boundingBox(), editorHeld = await panel.boundingBox()
      assert.ok(Math.abs(held.x + grab.x - edgeX)<1 && Math.abs(held.y + grab.y - pointerY)<1,'Q2: grabbed point stays under the actual pointer')
      assert.ok(Math.abs((editorHeld.x-held.x)-(editorStart.x-start.x))<1,'Q2: editor preserves horizontal offset while auto-panning')
      assert.ok(Math.abs((editorHeld.y - held.y) - (editorStart.y - start.y)) < 1, 'Q2: editor preserves card offset while auto-panning')
      await frames()
      assert.ok(Math.abs((await anchor.boundingBox()).x - held.x) < 1, 'Q2: auto-pan keeps card under pointer')
      await page.mouse.move(width / 2, pointerY, { steps: 6 })
      await frames()
      const away = await transform()
      await frames()
      assert.deepEqual(await transform(), away, 'Q2: leaving edge stops auto-pan')
      await page.mouse.move(edgeX, pointerY, { steps: 6 })
      await frames()
      await page.mouse.up()
      const released = await transform()
      await frames()
      assert.deepEqual(await transform(), released, 'Q2: release stops auto-pan')
      results.push({ name: 'Q2 edge speed, hover isolation, editor following and immediate stop', status: 'passed' })
    }
    await page.screenshot({ path: join(output, `q1-${side}.png`) })
    if (side === 'lower-edge') {
      await panel.getByRole('button', { name: '展开详情', exact: true }).click()
      await page.getByRole('dialog').waitFor()
      await page.keyboard.press('Escape')
      assert.equal(await panel.getAttribute('data-expanded'), 'false', 'Q7 first Escape collapses expanded editor')
      await page.keyboard.press('Escape')
      await panel.waitFor({ state: 'hidden' })
      assert.equal(await anchor.getAttribute('data-selected'), 'true', 'Q7 second Escape closes editor but retains selection')
      await page.keyboard.press('Escape')
      assert.equal(await anchor.getAttribute('data-selected'), 'false', 'Q7 final Escape clears selection')
    }
    if (side === 'narrow') {
      await page.keyboard.press('Escape')
      await panel.waitFor({ state: 'hidden' })
      assert.equal(await anchor.getAttribute('data-selected'), 'true', 'Q7 insufficient room closes expanded editor without clearing selection')
    }
    results.push({ name: `Q1 placement ${side}`, status: 'passed' })
    console.log(`PASS Q1 ${side}`)
    // Keep fixture contexts alive until browser cleanup; cancelling SSE mid-transaction can lock the isolated SQLite harness.
    page = mainPage
  }
  const mediaForm = new FormData()
  mediaForm.set('file', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9v8AAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }), 'retained.png')
  mediaForm.set('project_id', 'canvas-project')
  mediaForm.set('usage_kind', 'generation_upload')
  const uploaded = await fetch(`${api}/api/v1/studio/files/upload`, { method: 'POST', body: mediaForm })
  assert.ok(uploaded.ok, await uploaded.clone().text())
  const mediaFile = (await uploaded.json()).data
  const canvas = await createStoryboardCanvas(base, '画布交互回归')
  const seeded = await fetch(storyboardCanvasApi(base, canvas.id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document: { ...canvas.document, cards: [...canvas.document.cards,
          { id: 'place', type: 'reference.place', angle: '正面' },
          { id: 'other', type: 'content.image', file_id: mediaFile.id },
          { id: 'spare', type: 'model.image', model_id: 'canvas-image-model', prompt: { segments: [{ id: 'ready', kind: 'text', text: '三张完整图片' }] }, config: { count: 3, target_ratio: '1:1', resolution_profile: 'standard' } },
          { id: 'note', type: 'content.text', text: '编辑输入测试' },
          { id: 'dependent', type: 'model.text', prompt: { segments: [{ id: 'ref', kind: 'reference', source: { canvas_id: canvas.id, card_id: 'note', port_id: 'text', position: 0 } }] } }
        ], edges: [
          { id: 'image-candidate', source_card: 'other', source_port: 'image', target_card: 'spare', target_port: 'image' },
          { id: 'note-input', source_card: 'note', source_port: 'text', target_card: 'dependent', target_port: 'text' }
        ], input_order: { spare: { image: ['image-candidate'] }, dependent: { text: ['note-input'] } } } }) })
  assert.ok(seeded.ok, await seeded.text())
  const layoutKey = `jellyfish:generation-layout:canvas-project:${canvas.id}:view:canvas`
  await page.addInitScript(({ layoutKey }) => {
    if (!sessionStorage.getItem('interaction-seeded')) {
      sessionStorage.setItem('interaction-seeded', '1')
      localStorage.setItem(layoutKey, JSON.stringify({ schema: 1, positions: { place: { x: 400, y: 250 }, other: { x: 1000, y: 250 }, note: { x: 1500, y: 250 }, dependent: { x: 1800, y: 700 }, spare: { x: 2200, y: 700 } }, sizes: { place: { width: 300, height: 251 } }, transform: { x: 0, y: 0, scale: .8 } }))
    }
  }, { layoutKey })
  await page.goto(`http://127.0.0.1:4611${storyboardCanvasPath(canvas)}`)
  const card = page.locator('[data-card-id="place"]')
  await card.waitFor()
  const check = async (name, fn) => {
    try {
      await fn()
      results.push({ name, status: 'passed' })
      console.log('PASS', name)
    }
    catch (e) {
      results.push({ name, status: 'failed', error: e.message })
      await page.screenshot({ path: join(output, `failure-${results.length}.png`) })
      throw e
    }
  }
  const wait = () => delay(80)
  const pos = () => card.evaluate(e => ({ x: parseFloat(e.style.left), y: parseFloat(e.style.top) }))
  const dragBegin = async () => {
    const r = await card.boundingBox()
    await page.mouse.move(r.x + 60, r.y + 60)
    await page.mouse.down()
    await page.mouse.move(r.x + 100, r.y + 80, { steps: 4 })
    await wait()
  }
  await check('Q8 lost pointer capture retains final position and records one undo', async () => {
    const initial = await pos()
    const captured = card.evaluate(e => new Promise(resolve => e.addEventListener('pointerdown', event => resolve(event.pointerId), { once: true })))
    await dragBegin()
    const last = await pos()
    await card.evaluate((e, id) => e.releasePointerCapture(id), await captured)
    await page.mouse.up()
    await wait()
    assert.deepEqual(await pos(), last)
    assert.notDeepEqual(last, initial)
    await card.focus()
    await page.keyboard.press('ControlOrMeta+z')
    assert.deepEqual(await pos(), initial)
  })
  await check('Q8 window blur retains final position and one undo', async () => {
    const initial = await pos()
    await dragBegin()
    const last = await pos()
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await page.mouse.up()
    await wait()
    assert.deepEqual(await pos(), last)
    await card.focus()
    await page.keyboard.press('ControlOrMeta+z')
    assert.deepEqual(await pos(), initial)
  })
  await check('Q8 real touch cancellation keeps final position and ignores sub-threshold movement', async () => {
    const touch = await page.context().newCDPSession(page)
    await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true })
    for (const distance of [40, 4]) {
      const initial = await pos(), box = await card.boundingBox()
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 60, y: box.y + 60 }] })
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + 60 + distance, y: box.y + 60 }] })
      await wait()
      const last = await pos()
      await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
      await wait()
      assert.deepEqual(await pos(), last)
      assert.equal(await page.locator('.generation-card-editor:visible').count(), 0, 'cancel never activates editor')
      if (distance === 40) {
        assert.notDeepEqual(last, initial)
        await card.focus()
        await page.keyboard.press('ControlOrMeta+z')
        assert.deepEqual(await pos(), initial)
      }
      else
        assert.deepEqual(last, initial, 'below touch threshold does not move')
    }
    await touch.send('Emulation.setTouchEmulationEnabled', { enabled: false })
    await touch.detach()
  })
  await check('Q6/Q9 held Shift arrow fifty units each repeat and one undo', async () => {
    const initial = await pos()
    await card.focus()
    await page.keyboard.down('Shift')
    await page.keyboard.down('ArrowRight')
    await page.keyboard.down('ArrowRight')
    await page.keyboard.down('ArrowRight')
    await page.keyboard.up('ArrowRight')
    await page.keyboard.up('Shift')
    await wait()
    assert.equal((await pos()).x, initial.x + 150)
    await page.keyboard.press('ControlOrMeta+z')
    assert.deepEqual(await pos(), initial)
    await page.keyboard.press('Control+y')
    assert.equal((await pos()).x, initial.x + 150)
    await page.keyboard.press('ControlOrMeta+z')
  })
  await check('Q5 middle drag on card pans without moving layout', async () => {
    const initial = await pos()
    const old = await page.locator('.generation-world').getAttribute('style')
    const r = await card.boundingBox()
    await page.mouse.move(r.x + 70, r.y + 70)
    await page.mouse.down({ button: 'middle' })
    await page.mouse.move(r.x + 110, r.y + 90, { steps: 4 })
    await page.mouse.up({ button: 'middle' })
    assert.deepEqual(await pos(), initial)
    assert.notEqual(await page.locator('.generation-world').getAttribute('style'), old)
  })
  await check('Q9 ordinary viewport browsing never consumes document or layout history', async () => {
    const initial = await pos()
    await card.focus(); await page.keyboard.press('ArrowRight')
    const surface = page.getByLabel('生成画布视口',{exact:true})
    await surface.press('ArrowDown'); await surface.press('+')
    const browsed = await page.locator('.generation-world').getAttribute('style')
    await surface.press('ControlOrMeta+z')
    assert.deepEqual(await pos(),initial,'undo reaches card movement across pan and zoom')
    assert.equal(await page.locator('.generation-world').getAttribute('style'),browsed,'undo does not revert browsing')
    await surface.press('ControlOrMeta+Shift+z')
    assert.equal((await pos()).x,initial.x+10)
    await surface.press('ControlOrMeta+z')
  })
  await check('Q9 native text undo does not consume canvas movement history', async () => {
    const initial = await pos()
    await card.focus()
    await page.keyboard.press('ArrowRight')
    const note = page.locator('[data-card-id="note"]')
    await note.press('Enter')
    const input = page.getByRole('textbox', { name: '文本内容', exact: true }), original = await input.inputValue()
    await input.press('End')
    await input.pressSequentially(' native undo')
    await input.press('ControlOrMeta+z')
    const undone = await input.inputValue()
    assert.ok(undone.startsWith(original) && undone.length < (original + ' native undo').length, 'native undo removes typed text')
    assert.equal((await pos()).x, initial.x + 10, 'text undo leaves canvas movement untouched')
    await input.fill(original)
    await page.keyboard.press('Escape')
  })
  await check('Q9 interleaved content then movement undo/redo chronological', async () => {
    const note = page.locator('[data-card-id="note"]')
    await note.press('Enter')
    const input = page.getByRole('textbox', { name: '文本内容', exact: true })
    await input.waitFor()
    await input.fill('九项规则核对')
    await page.keyboard.press('Escape')
    await wait()
    const initial = await pos()
    await card.focus()
    await page.keyboard.press('ArrowRight')
    assert.equal((await pos()).x, initial.x + 10)
    await page.keyboard.press('ControlOrMeta+z')
    assert.deepEqual(await pos(), initial)
    await page.keyboard.press('ControlOrMeta+z')
    await note.press('Enter')
    assert.equal(await input.inputValue(), '编辑输入测试')
    await page.keyboard.press('Escape')
    await wait()
    await card.focus()
    await page.keyboard.press('ControlOrMeta+Shift+z')
    await page.keyboard.press('ControlOrMeta+Shift+z')
    assert.equal((await pos()).x, initial.x + 10)
    await note.press('Enter')
    assert.equal(await input.inputValue(), '九项规则核对')
    await page.keyboard.press('Escape')
  })
  await check('Q3 dragging an unselected card replaces selection without opening editor', async () => {
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    const other = page.locator('[data-card-id="other"]'), note = page.locator('[data-card-id="note"]')
    await card.click({ modifiers: ['ControlOrMeta'] })
    await other.click({ modifiers: ['ControlOrMeta'] })
    const before = await pos(), otherBefore = await other.boundingBox(), box = await note.boundingBox()
    await page.mouse.move(box.x + 60, box.y + 60)
    await page.mouse.down()
    await page.mouse.move(box.x + 100, box.y + 80, { steps: 4 })
    await page.mouse.up()
    assert.deepEqual(await page.locator('[data-card-id][data-selected="true"]').evaluateAll(nodes => nodes.map(n => n.dataset.cardId)), ['note'])
    assert.deepEqual(await pos(), before)
    assert.deepEqual(await other.boundingBox(), otherBefore)
    assert.equal(await page.locator('.generation-card-editor:visible').count(), 0)
  })
  await check('Q3 multi-selection closes editor and retains its draft through dragging', async () => {
    const note = page.locator('[data-card-id="note"]'), other = page.locator('[data-card-id="other"]')
    await note.press('Enter')
    const input = page.getByRole('textbox',{name:'文本内容',exact:true})
    await input.fill('多选拖动后保留草稿')
    await card.click({modifiers:['ControlOrMeta']}); await other.click({modifiers:['ControlOrMeta']})
    assert.equal(await page.locator('.generation-card-editor:visible').count(),0)
    const ids=await page.locator('[data-card-id][data-selected="true"]').evaluateAll(nodes=>nodes.map(node=>node.dataset.cardId))
    await dragBegin(); await page.mouse.up()
    assert.deepEqual(await page.locator('[data-card-id][data-selected="true"]').evaluateAll(nodes=>nodes.map(node=>node.dataset.cardId)),ids)
    assert.equal(await page.locator('.generation-card-editor:visible').count(),0)
    await note.press('Enter'); assert.equal(await input.inputValue(),'多选拖动后保留草稿')
    await closeCanvasDetails(page)
  })
  await check('Q5 Shift marquee appends selected card and Escape cancels marquee', async () => {
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await card.press('Enter')
    await page.keyboard.press('Escape')
    await wait()
    const other = page.locator('[data-card-id="other"]')
    const r = await other.boundingBox()
    await page.keyboard.down('Shift')
    await page.mouse.move(r.x - 8, r.y - 8)
    await page.mouse.down()
    await page.mouse.move(r.x + 40, r.y + 40, { steps: 4 })
    await page.mouse.up()
    await page.keyboard.up('Shift')
    assert.equal(await card.getAttribute('data-selected'), 'true')
    assert.equal(await other.getAttribute('data-selected'), 'true')
    await page.mouse.move(1700, 120)
    await page.mouse.down()
    await page.mouse.move(1750, 150, { steps: 3 })
    await page.keyboard.press('Escape')
    await page.mouse.up()
    assert.equal(await card.getAttribute('data-selected'), 'true')
    assert.equal(await other.getAttribute('data-selected'), 'true')
  })
  await check('marquee survives window blur until pointer release', async () => {
    await page.mouse.move(1700, 120)
    await page.mouse.down()
    await page.mouse.move(1750, 150, { steps: 3 })
    assert.equal(await page.locator('.generation-selection-box').count(), 1)
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    assert.equal(await page.locator('.generation-selection-box').count(), 1)
    await page.mouse.up()
    assert.equal(await page.locator('.generation-selection-box').count(), 0)
  })
  await check('Q6 wheel preserves pointer world position and plus preserves viewport center', async () => {
    await page.keyboard.press('Escape')
    const view = () => page.locator('.generation-world').evaluate(e => {
      const t = getComputedStyle(e).transform
      const m = new DOMMatrix(t)
      return { x: m.e, y: m.f, scale: m.a }
    })
    const surface = page.getByLabel('生成画布视口', { exact: true })
    const box = await surface.boundingBox()
    const initial = await view()
    const p = { x: box.width / 2, y: 200 }
    await page.mouse.move(box.x + p.x, box.y + p.y)
    await page.mouse.wheel(0, -100)
    await wait()
    const next = await view()
    assert.ok(Math.abs((p.x - initial.x) / initial.scale - (p.x - next.x) / next.scale) < .1)
    assert.ok(Math.abs((p.y - initial.y) / initial.scale - (p.y - next.y) / next.scale) < .1)
    await surface.focus()
    await page.keyboard.press('+')
    const zoom = await view()
    assert.ok(Math.abs((box.height / 2 - next.y) / next.scale - (box.height / 2 - zoom.y) / zoom.scale) < .1)
    assert.ok(Math.abs((box.width / 2 - next.x) / next.scale - (box.width / 2 - zoom.x) / zoom.scale) < .1)
    await surface.press('-')
    const smaller = await view()
    assert.ok(Math.abs(smaller.scale - next.scale) < .001 && Math.abs(smaller.x - next.x) < .1 && Math.abs(smaller.y - next.y) < .1, 'minus reverses center zoom')
    const posBefore = await pos()
    const panBefore = await view()
    await surface.press('ArrowRight')
    assert.deepEqual(await pos(), posBefore)
    assert.notEqual((await view()).x, panBefore.x, 'blank arrows pan viewport')
    await surface.press('0')
    const fit = await view()
    assert.ok(await page.locator('[data-card-id]').evaluateAll(cards => cards.every(card => {
      const r = card.getBoundingClientRect()
      return r.left >= 79 && r.right <= innerWidth - 23 && r.top >= 140 && r.bottom <= innerHeight - 79
    })), 'zero fits every card inside canvas chrome')
    await page.getByRole('button', { name: '适应全部', exact: true }).click()
    assert.deepEqual(await view(), fit)
  })
  await check('Q9 IME composition blocks Delete and arrow movement', async () => {
    const before = await pos()
    await card.focus()
    await card.evaluate(e => {
      e.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, isComposing: true }))
      e.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, isComposing: true }))
    })
    assert.deepEqual(await pos(), before)
    assert.equal(await page.getByRole('button', { name: '确认删除', exact: true }).count(), 0)
  })
  await check('Q4 batch delete undo restores cards connections grouping and positions', async () => {
    const other = page.locator('[data-card-id="other"]')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await card.click({ modifiers: ['ControlOrMeta'] })
    await other.click({ modifiers: ['ControlOrMeta'] })
    await page.getByRole('toolbar', { name: '所选卡片操作', exact: true }).getByRole('button', { name: '编组', exact: true }).click()
    await page.getByLabel('画布保存状态').getByText('已保存', { exact: true }).waitFor()
    const doc = await request(storyboardCanvasApi(base, canvas.id))
    const group = page.locator('[data-group-id]')
    await group.waitFor()
    await card.click({ modifiers: ['ControlOrMeta'] })
    await other.click({ modifiers: ['ControlOrMeta'] })
    const before = await pos()
    await card.focus()
    await page.keyboard.press('Backspace')
    await page.getByRole('button', { name: '确认删除', exact: true }).click()
    await card.waitFor({ state: 'detached' })
    await other.waitFor({ state: 'detached' })
    await page.getByLabel('画布保存状态').getByText('已保存', { exact: true }).waitFor()
    const deleted = await request(storyboardCanvasApi(base, canvas.id))
    assert.equal(deleted.document.edges.some(edge => edge.id === 'image-candidate'), false, 'related candidate is deleted')
    assert.ok((await fetch(`${api}/api/v1/studio/files/${mediaFile.id}/download`)).ok, 'card deletion retains media file')
    await page.getByRole('button', { name: '确认删除', exact: true }).waitFor({ state: 'hidden' })
    await page.getByLabel('生成画布视口', { exact: true }).focus()
    await page.keyboard.press('ControlOrMeta+z')
    await card.waitFor()
    assert.deepEqual(await pos(), before)
    await page.getByLabel('画布保存状态').getByText('已保存', { exact: true }).waitFor()
    const restored = await request(storyboardCanvasApi(base, canvas.id))
    assert.deepEqual(restored.document.groups, doc.document.groups)
    assert.deepEqual(restored.document.edges, doc.document.edges)
    assert.deepEqual(restored.document.input_order, doc.document.input_order)
    assert.deepEqual(restored.document.cards, doc.document.cards)
    assert.ok((await fetch(`${api}/api/v1/studio/files/${mediaFile.id}/download`)).ok)
  })
  await check('Q4 stack protection rejects the entire batch before confirmation', async () => {
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    const spare = page.locator('[data-card-id="spare"]'), dependent = page.locator('[data-card-id="dependent"]'), other = page.locator('[data-card-id="other"]')
    await spare.click({ modifiers: ['ControlOrMeta'] })
    await dependent.click({ modifiers: ['ControlOrMeta'] })
    await page.getByRole('toolbar', { name: '所选卡片操作', exact: true }).getByRole('button', { name: '堆叠', exact: true }).click()
    const stack = page.locator('[data-stack-id]')
    await stack.waitFor()
    await page.getByLabel('画布保存状态').getByText('已保存', { exact: true }).waitFor()
    const before = await request(storyboardCanvasApi(base, canvas.id))
    await card.click({ modifiers: ['ControlOrMeta'] })
    await other.click({ modifiers: ['ControlOrMeta'] })
    await card.focus()
    await page.keyboard.press('Delete')
    await page.getByRole('status').filter({ hasText: '请先解除相关堆叠后删除' }).waitFor()
    assert.equal(await page.getByRole('button', { name: '确认删除', exact: true }).count(), 0)
    assert.equal(await card.count(), 1)
    assert.equal(await other.count(), 1)
    assert.deepEqual((await request(storyboardCanvasApi(base, canvas.id))).document, before.document)
    await stack.hover()
    await stack.getByRole('button', { name: '解除堆叠', exact: true }).click()
    await spare.waitFor()
    await dependent.waitFor()
  })
  await check('Q4 running protection rejects all selected cards and completed deletion retains generated files', async () => {
    const spare = page.locator('[data-card-id="spare"]')
    await request('/test/image-controls', { response_delay: 5 })
    await spare.press('Enter')
    await page.locator('.generation-card-editor:visible').getByRole('button', { name: '预检运行', exact: true }).click()
    const preview = page.getByRole('dialog', { name: '运行预检', exact: true })
    await preview.waitFor()
    // Dialog keys must not leak to the selected canvas cards.
    const before = await pos()
    await preview.press('ArrowRight')
    await preview.press('Delete')
    assert.deepEqual(await pos(), before)
    await preview.getByRole('button', { name: '确认执行', exact: true }).click()
    await closePrecheck(page)
    await closeCanvasDetails(page)
    await page.mouse.click(1850,150)
    assert.equal(await page.locator('[data-card-id][data-selected="true"]').count(),0,'blank click clears previous editor selection')
    await page.getByRole('button',{name:'适应全部',exact:true}).click()
    await spare.click({ modifiers: ['ControlOrMeta'] })
    await card.click({ modifiers: ['ControlOrMeta'] })
    assert.equal(await page.locator('[data-card-id][data-selected="true"]').count(),2)
    await card.focus()
    await page.keyboard.press('Delete')
    await page.getByRole('status').filter({ hasText: '卡片正在运行，结束前不可删除' }).waitFor()
    assert.equal(await page.getByRole('button', { name: '确认删除', exact: true }).count(), 0)
    assert.equal(await card.count(), 1)
    assert.equal(await spare.count(), 1)
    await spare.getByLabel('模型状态摘要').getByText('已完成', { exact: true }).waitFor()
    const snapshot = await request(storyboardCanvasApi(base, canvas.id, '/runtime'))
    const file = snapshot.current_outputs.spare[0].file_id
    await card.focus()
    await page.keyboard.press('Delete')
    const confirmation = page.getByRole('dialog').filter({ hasText: '删除 2 张卡片' })
    await confirmation.waitFor()
    await confirmation.getByRole('button', { name: '取消', exact: true }).press('Escape')
    await confirmation.waitFor({ state: 'hidden' })
    assert.equal(await card.count(), 1)
    assert.equal(await spare.count(), 1, 'cancel preserves both cards')
    await card.focus()
    await page.keyboard.press('Backspace')
    await confirmation.waitFor()
    // Another accepted run may start while the user is reviewing deletion.
    const accepted = await request(storyboardCanvasApi(base, canvas.id, '/precheck'), {card_id:'spare'})
    await request(storyboardCanvasApi(base, canvas.id, '/runs'), {request_id:'delete-race',preview_token:accepted.preview_token})
    await spare.getByLabel('模型状态摘要').getByText('运行中',{exact:true}).waitFor()
    await confirmation.getByRole('button', {name:'确认删除',exact:true}).click()
    await confirmation.waitFor({state:'hidden'})
    assert.equal(await card.count(),1);assert.equal(await spare.count(),1,'confirmation rechecks runtime and protects the entire batch')
    await spare.getByLabel('模型状态摘要').getByText('已完成',{exact:true}).waitFor()
    await card.focus();await page.keyboard.press('Delete')
    await page.getByRole('button', { name: '确认删除', exact: true }).click()
    await spare.waitFor({ state: 'detached' })
    assert.ok((await fetch(`${api}/api/v1/studio/files/${file}/download`)).ok, 'generated image survives card deletion')
    await page.getByRole('button', { name: '确认删除', exact: true }).waitFor({ state: 'hidden' })
    await page.getByLabel('生成画布视口', { exact: true }).focus()
    await page.keyboard.press('ControlOrMeta+z')
    await spare.waitFor()
    await card.waitFor()
  })
  assert.deepEqual(pageErrors, [], 'no browser runtime errors')
  writeFileSync(join(output, 'rules.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results, null, 2))
}
catch (error) {
  if (page) {
    await page.screenshot({ path: join(output, 'failure.png') })
    console.log(await page.locator('body').innerText())
  }
  throw error
}
finally {
  await cleanup()
}
