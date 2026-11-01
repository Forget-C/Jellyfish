import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import assert from 'node:assert/strict'
import * as capture from './generationCanvasWorkbench.browser-helpers.mjs'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-c55-shell-')
const api = 'http://127.0.0.1:8455', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8455' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  writeFileSync(join(output, 'openapi.json'), JSON.stringify(await (await fetch(`${api}/openapi.json`)).json()))
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4455, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '多图与未完成成果' }) })).json()).data
  const document = { ...canvas.document, cards: [
    { id: 'text', type: 'content.text', text: '共同编辑外壳验证' },
    { id: 'image', type: 'content.image' },
    { id: 'model-text', type: 'model.text', prompt: {segments: []} },
    { id: 'model-image', type: 'model.image', model_id: 'canvas-image-model', prompt: {segments: []} },
  ], edges: [] }
  const seeded = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({request_id:'seed',expected_revision:0,document}) })
  assert.ok(seeded.ok, await seeded.text())
  await page.goto(`http://127.0.0.1:4455/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  // Explicit fault scenarios exercise the public runner's failing exit and retained original error.
  if (process.env.CANVAS_CAPTURE_FAILURE) {
    assert.ok(['blocked-control', 'closed-page'].includes(process.env.CANVAS_CAPTURE_FAILURE), 'unknown capture fault scenario')
    await capture.pressCanvasControl(page, page.locator('[data-card-id="text"]'), 'Enter')
    await page.locator('.generation-card-editor:visible').waitFor()
    if (process.env.CANVAS_CAPTURE_FAILURE === 'closed-page') {
      await page.close()
      throw new Error('deliberate closed-page assertion remains original')
    }
    await page.getByRole('button', { name: '关闭详情', exact: true }).evaluate(button => {
      const rect = button.getBoundingClientRect(), obstruction = document.createElement('div')
      Object.assign(obstruction.style, { position: 'fixed', left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px`, zIndex: '2147483647', background: 'red' })
      document.body.append(obstruction)
    })
    await capture.assertControlReachable(page.getByRole('button', { name: '关闭详情', exact: true }), 'initial deliberate obstruction')
    throw new Error('blocked control was incorrectly accepted')
  }
  // Ordinary capture must preserve a readable context even when several neighbors overlap.
  for (const id of ['text', 'image', 'model-text', 'model-image']) await capture.moveCanvasCard(page, id, 200, 250)
  await capture.prepareCanvasCard(page, 'text')
  const preparedCards = await page.locator('[data-card-id]').all()
  const preparedBoxes = await Promise.all(preparedCards.map(card => card.boundingBox()))
  for (let i = 0; i < preparedBoxes.length; i++) for (let j = i + 1; j < preparedBoxes.length; j++) {
    const a = preparedBoxes[i], b = preparedBoxes[j]
    assert.ok(b.x >= a.x + a.width + 20 || b.x + b.width <= a.x - 20 || b.y >= a.y + a.height + 20 || b.y + b.height <= a.y - 20, 'ordinary capture leaves all neighboring cards separated')
  }
  writeFileSync(join(output, 'prepared-neighbors.json'), JSON.stringify(preparedBoxes, null, 2))
  const pressWithoutScroll = (control, key) => capture.pressCanvasControl(page, control, key)
  const toggle = editor => editor.getByRole('button', {name:/^(展开|收起)详情$/})
  const expand = async editor => { if(await editor.getByRole('button',{name:'展开详情',exact:true}).count())await editor.getByRole('button',{name:'展开详情',exact:true}).click() }
  const placeCardInView = async card => capture.prepareCanvasCard(page, await card.getAttribute('data-card-id'))
  for (const viewport of [{width:1440,height:960},{width:3830,height:1688},{width:390,height:844}]) {
    await page.setViewportSize(viewport)
    for (const id of ['text','image','model-text','model-image']) {
      const card=page.locator(`[data-card-id="${id}"]`)
      await placeCardInView(card)
      await pressWithoutScroll(card, 'Enter')
      const editor=page.locator('.generation-card-editor:visible')
      await editor.waitFor()
      const header=editor.locator('header').first()
      const material=id.startsWith('model-')
      assert.equal(await header.locator('.generation-editor-heading').count(),material?0:1,'only base content retains the editor heading')
      assert.equal(await header.getByRole('button',{name:'关闭详情',exact:true}).count(),material?0:1,'model editor closes with Escape and has no legacy close button')
      assert.equal(await header.getByText('修改已同步',{exact:true}).count(),0,'normal saved state does not occupy header')
      await capture.assertControlReachable(toggle(editor), 'initial')
      await toggle(editor).click({trial:true})
      if(await editor.getByRole('button',{name:'关闭详情',exact:true}).count())await editor.getByRole('button',{name:'关闭详情',exact:true}).click({trial:true})
      if(viewport.width>700){
        const rail=await page.getByRole('toolbar',{name:'卡片分类',exact:true}).boundingBox()
        const box=await editor.boundingBox()
        assert.ok(box.x >= rail.x+rail.width+8,'editor avoids permanent category rail')
      }
      await page.mouse.move(140,20)
      await capture.captureCanvasRegion(page, editor, join(output,`${id}-${viewport.width}-default-editor.png`))
      await page.screenshot({path:join(output,`${id}-${viewport.width}-default.png`)})
      await expand(editor)
      await page.waitForFunction(()=>document.querySelector('.generation-card-editor:not([hidden])')?.getAttribute('data-expanded')==='true')
      await editor.getByRole('button',{name:'收起详情',exact:true}).click({trial:true})
      if(await editor.getByRole('button',{name:'关闭详情',exact:true}).count())await editor.getByRole('button',{name:'关闭详情',exact:true}).click({trial:true})
      await page.mouse.move(140,20)
      await capture.captureCanvasRegion(page, editor, join(output,`${id}-${viewport.width}-expanded-editor.png`))
      await page.screenshot({path:join(output,`${id}-${viewport.width}-expanded.png`)})
      await capture.closeCanvasDetails(page)
      if(viewport.width===390 && id==='text') {
        await page.getByRole('toolbar',{name:'卡片分类',exact:true}).getByRole('button',{name:'基础卡',exact:true}).press('Enter')
        await page.getByRole('navigation',{name:'添加卡片',exact:true}).waitFor()
        await page.getByRole('button',{name:'关闭卡片列表',exact:true}).press('Enter')
        await card.getByRole('button',{name:'卡片操作',exact:true}).press('Enter')
        await card.getByRole('button',{name:'连接到…',exact:true}).press('Enter')
        await page.getByRole('dialog',{name:'选择连接目标',exact:true}).waitFor()
        await page.getByRole('button',{name:'取消连接',exact:true}).press('Enter')
      }
    }
  }
  await page.setViewportSize({width:1440,height:960})
  for(const id of ['text','image','model-text','model-image']) {
    const card=page.locator(`[data-card-id="${id}"]`)
    const mover=card.getByRole('button',{name:/^移动布局：/})
    for(const edge of ['left','right','bottom']) {
      await capture.moveCanvasCard(page,id,200,250)
      // Move through the public keyboard layout control, including positions under canvas chrome.
      for(let step=0;step<100;step++) {
        const box=await card.boundingBox()
        const done=edge==='left'?box.x<=24:edge==='right'?box.x>=1040:box.y+box.height>=900
        if(done)break
        await pressWithoutScroll(mover, edge==='left'?'Shift+ArrowLeft':edge==='right'?'Shift+ArrowRight':'Shift+ArrowDown')
      }
      await pressWithoutScroll(card, 'Enter')
      const editor=page.locator('.generation-card-editor:visible')
      await editor.waitFor()
      const rail=await page.getByRole('toolbar',{name:'卡片分类',exact:true}).boundingBox()
      const box=await editor.boundingBox()
      assert.ok(box.x>=rail.x+rail.width+8 && box.x+box.width<=1440,'edge editor avoids rail and viewport')
      await capture.assertControlReachable(toggle(editor), 'initial')
      await toggle(editor).click({trial:true})
      if(await editor.getByRole('button',{name:'关闭详情',exact:true}).count())await editor.getByRole('button',{name:'关闭详情',exact:true}).click({trial:true})
      await page.screenshot({path:join(output,`${id}-${edge}-avoidance.png`)})
      await expand(editor)
      await editor.getByRole('button',{name:'收起详情',exact:true}).click({trial:true})
      await page.screenshot({path:join(output,`${id}-${edge}-expanded.png`)})
      await capture.closeCanvasDetails(page)
    }
  }
  const textCard=page.locator('[data-card-id="text"]')
  await capture.moveCanvasCard(page,'text',200,250)
  await textCard.press('Enter')
  const input=page.getByRole('textbox',{name:'文本内容',exact:true})
  const beforeSave=await textCard.boundingBox()
  await input.fill('会话与保存保持')
  await page.getByRole('button',{name:'展开详情',exact:true}).click()
  assert.equal(await input.inputValue(),'会话与保存保持')
  await page.getByRole('button',{name:'收起详情',exact:true}).click()
  assert.equal(await input.inputValue(),'会话与保存保持')
  await page.getByLabel('画布保存状态').getByText('已保存',{exact:true}).waitFor()
  const afterSave=await textCard.boundingBox()
  assert.equal(afterSave.x,beforeSave.x,'saving does not pan canvas')
  assert.equal(afterSave.y,beforeSave.y,'saving does not pan canvas')
  const saved=(await(await fetch(`${base}/${canvas.id}`)).json()).data
  assert.equal(saved.document.cards.find(c=>c.id==='text').text,'会话与保存保持')
  await page.reload()
  await page.locator('[data-card-id="text"]').press('Enter')
  assert.equal(await page.getByRole('textbox',{name:'文本内容',exact:true}).inputValue(),'会话与保存保持')
  // A real overlay must fail initial hit testing, without scrolling the control into view.
  const closeControl = page.getByRole('button', { name: '关闭详情', exact: true })
  await closeControl.evaluate(button => {
    const box = button.getBoundingClientRect(), overlay = document.createElement('div')
    overlay.id = 'capture-obstruction'
    Object.assign(overlay.style, { position: 'fixed', left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px`, zIndex: '2147483647', background: 'red' })
    document.body.append(overlay)
  })
  await assert.rejects(() => capture.assertControlReachable(closeControl, 'initial'), /not reachable.*initial/)
  await page.locator('#capture-obstruction').evaluate(element => element.remove())
  await capture.assertControlReachable(closeControl, 'initial')
  const original = new Error('deliberate capture failure')
  await capture.captureCanvasFailure(page, output, original, 'deliberate')
  const diagnostic = JSON.parse(readFileSync(join(output, 'deliberate-diagnostics.json'), 'utf8'))
  assert.equal(diagnostic.error.message, original.message)
  assert.ok(diagnostic.geometry.elements.some(element => element.selector === '.wb-details-body'))
  assert.ok(diagnostic.geometry.elements.some(element => element.selector === '.generation-browse'))
  assert.ok(readFileSync(join(output, 'deliberate-page.png')).length > 100)
  assert.ok(readFileSync(join(output, 'deliberate-editor.png')).length > 100)
  const closedPage = await browser.newPage()
  await closedPage.close()
  await capture.captureCanvasFailure(closedPage, output, original, 'closed')
  const closed = JSON.parse(readFileSync(join(output, 'closed-diagnostics.json'), 'utf8'))
  assert.equal(closed.error.message, original.message)
  assert.ok(closed.diagnosticErrors.length > 0, 'closed page diagnostic errors are recorded without replacing original')
  await capture.closeCanvasDetails(page)
  await page.setViewportSize({ width: 390, height: 844 })
  const initialScroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }))
  const offscreen = await page.locator('[data-card-id="text"]').boundingBox()
  assert.ok(offscreen.x + offscreen.width > 390 || offscreen.x < 0 || offscreen.y < 0 || offscreen.y + offscreen.height > 844, 'viewport switch actually leaves the card partly outside the screen')
  await capture.moveCanvasCard(page, 'image', offscreen.x, offscreen.y)
  const neighbor = await page.locator('[data-card-id="image"]').boundingBox()
  assert.ok(neighbor.x < offscreen.x + offscreen.width && neighbor.x + neighbor.width > offscreen.x && neighbor.y < offscreen.y + offscreen.height && neighbor.y + neighbor.height > offscreen.y, 'ordinary evidence starts with a genuinely intersecting neighbor')
  await capture.prepareCanvasCard(page, 'text')
  const preparedTitle = page.locator('[data-card-id="text"]').getByRole('button', { name: /^移动布局：/ })
  await capture.assertControlReachable(preparedTitle, 'initial')
  const titleBox = await preparedTitle.boundingBox(), browseBox = await page.locator('.canvas-filters').boundingBox()
  assert.ok(titleBox.y >= browseBox.y + browseBox.height, 'wrapped mobile filters leave the title exposed')
  assert.deepEqual(await page.evaluate(() => ({ x: scrollX, y: scrollY })), initialScroll, 'offscreen preparation does not scroll the native page')
  await capture.pressCanvasControl(page, page.locator('[data-card-id="text"]'), 'Enter')
  const panel = page.locator('.generation-card-editor:visible')
  await panel.waitFor()
  const longInput = panel.getByRole('textbox', { name: '文本内容', exact: true })
  await longInput.fill('明确内部滚动。\n'.repeat(100))
  const initialReachability = await capture.assertControlReachable(longInput, 'initial')
  await capture.pressCanvasControl(page, longInput, 'ControlOrMeta+End')
  assert.ok(await longInput.evaluate(element => element.scrollTop > 0), 'explicit user key scrolls long text internally')
  const scrolledReachability = await capture.assertControlReachable(longInput, 'after explicit ControlOrMeta+End')
  writeFileSync(join(output, 'scroll-reachability.json'), JSON.stringify({ initial: initialReachability, afterUserScroll: scrolledReachability }, null, 2))
  const beforeCapture = await panel.boundingBox()
  await toggle(panel).hover()
  await page.getByRole('tooltip').getByText(/^(展开|收起)详情$/).waitFor()
  await capture.captureCanvasRegion(page, panel, join(output, 'native-region.png'))
  assert.equal(await page.locator('[role="tooltip"]:visible').count(), 0, 'capture clears real hover tooltips through pointer movement')
  assert.deepEqual(await panel.boundingBox(), beforeCapture, 'region screenshot keeps the demonstrated position')
  const png = readFileSync(join(output, 'native-region.png'))
  assert.ok(Math.abs(png.readUInt32BE(16) - beforeCapture.width) <= 1, 'native region retains CSS pixel width')
  assert.ok(Math.abs(png.readUInt32BE(20) - beforeCapture.height) <= 1, 'native region retains CSS pixel height')
  console.log('PASS four common shells, three viewports, retained session and HTTP reopen',output)
} catch (error) {
  if (page) await capture.captureCanvasFailure(page, output, error)
  throw error
} finally { await cleanup() }
