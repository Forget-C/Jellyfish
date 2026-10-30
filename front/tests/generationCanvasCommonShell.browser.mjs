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
  const pressWithoutScroll = async (control, key) => {
    await control.evaluate(element => element.focus({ preventScroll: true }))
    await page.keyboard.press(key)
  }
  const placeCardInView = async card => {
    const mover = card.getByRole('button',{name:/^移动布局：/})
    const browse = await page.locator('.generation-browse').boundingBox()
    const x = page.viewportSize().width === 390 ? 74 : 200
    const y = Math.max(180, (browse?.y || 0) + (browse?.height || 0) + 16)
    for (let step=0;step<150;step++) {
      const box = await card.boundingBox()
      if (Math.abs(box.x-x)<=20 && Math.abs(box.y-y)<=20) return
      await pressWithoutScroll(mover, Math.abs(box.x-x)>20 ? box.x<x?'ArrowRight':'ArrowLeft' : box.y<y?'ArrowDown':'ArrowUp')
    }
    throw Error('cannot place card in the visible canvas')
  }
  for (const viewport of [{width:1440,height:960},{width:3830,height:1688},{width:390,height:844}]) {
    await page.setViewportSize(viewport)
    for (const id of ['text','image','model-text','model-image']) {
      const card=page.locator(`[data-card-id="${id}"]`)
      await placeCardInView(card)
      await pressWithoutScroll(card, 'Enter')
      const editor=page.locator('.generation-card-editor:visible')
      await editor.waitFor()
      const header=editor.locator('header').first()
      assert.ok(await header.locator('[aria-hidden="true"]').count(), 'editor has modality icon')
      assert.equal(await header.getByText('修改已同步',{exact:true}).count(),0,'normal saved state does not occupy header')
      await editor.getByRole('button',{name:'展开详情',exact:true}).click({trial:true})
      await editor.getByRole('button',{name:'关闭详情',exact:true}).click({trial:true})
      if(viewport.width>700){
        const rail=await page.getByRole('toolbar',{name:'卡片分类',exact:true}).boundingBox()
        const box=await editor.boundingBox()
        assert.ok(box.x >= rail.x+rail.width+8,'editor avoids permanent category rail')
      }
      await page.mouse.move(140,20)
      await page.waitForTimeout(150)
      await page.screenshot({path:join(output,`${id}-${viewport.width}-default.png`)})
      await page.screenshot({path:join(output,`${id}-${viewport.width}-default-editor.png`),clip:await editor.boundingBox()})
      await editor.getByRole('button',{name:'展开详情',exact:true}).click()
      await page.waitForFunction(()=>document.querySelector('.generation-card-editor:not([hidden])')?.getAttribute('data-expanded')==='true').catch(()=>{})
      await editor.getByRole('button',{name:'收起详情',exact:true}).click({trial:true})
      await editor.getByRole('button',{name:'关闭详情',exact:true}).click({trial:true})
      await page.mouse.move(140,20)
      await page.waitForTimeout(150)
      await page.screenshot({path:join(output,`${id}-${viewport.width}-expanded.png`)})
      await page.screenshot({path:join(output,`${id}-${viewport.width}-expanded-editor.png`),clip:await editor.boundingBox()})
      await editor.getByRole('button',{name:'收起详情',exact:true}).click()
      await editor.getByRole('button',{name:'关闭详情',exact:true}).click()
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
      for(let step=0;step<200;step++) {
        const box=await card.boundingBox()
        if(Math.abs(box.x-200)<=20 && Math.abs(box.y-250)<=20)break
        const key=Math.abs(box.x-200)>20?(box.x<200?'ArrowRight':'ArrowLeft'):(box.y<250?'ArrowDown':'ArrowUp')
        await pressWithoutScroll(mover, key)
      }
      // Move through the public keyboard layout control, including positions under canvas chrome.
      for(let step=0;step<100;step++) {
        const box=await card.boundingBox()
        const done=edge==='left'?box.x<=24:edge==='right'?box.x>=1040:box.y+box.height>=900
        if(done)break
        await pressWithoutScroll(mover, edge==='left'?'ArrowLeft':edge==='right'?'ArrowRight':'ArrowDown')
      }
      await pressWithoutScroll(card, 'Enter')
      const editor=page.locator('.generation-card-editor:visible')
      await editor.waitFor()
      const rail=await page.getByRole('toolbar',{name:'卡片分类',exact:true}).boundingBox()
      const box=await editor.boundingBox()
      assert.ok(box.x>=rail.x+rail.width+8 && box.x+box.width<=1440,'edge editor avoids rail and viewport')
      await editor.getByRole('button',{name:'展开详情',exact:true}).click({trial:true})
      await editor.getByRole('button',{name:'关闭详情',exact:true}).click({trial:true})
      await page.screenshot({path:join(output,`${id}-${edge}-avoidance.png`)})
      await editor.getByRole('button',{name:'展开详情',exact:true}).click()
      await editor.getByRole('button',{name:'收起详情',exact:true}).click({trial:true})
      await page.screenshot({path:join(output,`${id}-${edge}-expanded.png`)})
      await editor.getByRole('button',{name:'收起详情',exact:true}).click()
      await editor.getByRole('button',{name:'关闭详情',exact:true}).click()
    }
  }
  const textCard=page.locator('[data-card-id="text"]')
  const textMover=textCard.getByRole('button',{name:/^移动布局：/})
  for(let step=0;step<200;step++) {
    const box=await textCard.boundingBox()
    if(Math.abs(box.x-200)<=20 && Math.abs(box.y-250)<=20)break
    await textMover.press(Math.abs(box.x-200)>20?(box.x<200?'ArrowRight':'ArrowLeft'):(box.y<250?'ArrowDown':'ArrowUp'))
  }
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
  console.log('PASS four common shells, three viewports, retained session and HTTP reopen',output)
} catch (error) {
  if (page) await page.screenshot({path:join(output,'failed-page.png'),fullPage:true}).catch(()=>{})
  throw error
} finally { await cleanup() }
