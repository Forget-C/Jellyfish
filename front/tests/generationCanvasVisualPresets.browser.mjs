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
const output = await browserOutput('jellyfish-generation-canvas-presets-')
const api = 'http://127.0.0.1:8297', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8297' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser
const cleanup = browserCleanup(() => ({ browser, server, backend }))
try {
  let ready = false
  for (let i = 0; i < 80; i++) {
    if (backend.exitCode !== null) throw Error('isolated photography backend exited')
    try { if ((await fetch(base)).ok) { ready = true; break } } catch {}
    await delay(250)
  }
  assert.ok(ready)
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4297, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(12000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '摄影设计' }) })).json()).data
  const document = { ...canvas.document, cards: [{ id: 'style', type: 'direction.style' }, { id: 'photo', type: 'direction.photography', fields: { light_sources: {text: '保留自定义灯光', state: 'fact'} } }, { id: 'consumer', type: 'model.image', model_id: 'canvas-image-model', config:{count:3} }], edges: [{id:'e', source_card:'style',source_port:'text',target_card:'consumer',target_port:'text'}], input_order:{consumer:{text:['e']}} }
  const seed = await fetch(`${base}/${canvas.id}`, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:'seed',expected_revision:0,document})})
  assert.ok(seed.ok, await seed.text())
  const read = async () => (await (await fetch(`${base}/${canvas.id}`)).json()).data
  const poll = async predicate => { for (let i=0;i<80;i++) {const state=await read(); if(predicate(state)) return state;await delay(100)} throw Error('preset save did not arrive') }
  await page.goto(`http://127.0.0.1:4297/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const detail=page.locator('.wb-details:not([hidden])')
  const open=async id=>{if(await detail.count()) await detail.getByRole('button',{name:'关闭详情',exact:true}).click();const card=page.locator(`[data-card-id="${id}"]`);await card.press('Enter');if(['style','photo'].includes(id)) await card.getByRole('button',{name:'编辑卡片',exact:true}).click();await detail.waitFor()}
  await open('style')
  const effects=detail.getByRole('region',{name:'风格效果选择',exact:true})
  await effects.waitFor({timeout:2000})
  assert.equal(await page.getByRole('dialog').count(),1,'effect choices belong to the existing editor')
  await effects.getByRole('button',{name:'预览 手绘水彩',exact:true}).click()
  await effects.getByRole('button',{name:'对比 立体动画',exact:true}).click()
  await detail.screenshot({path:join(output,'style-compare.png'),animations:'disabled'})
  assert.equal((await read()).document.cards.find(c=>c.id==='style').fields.direction.text,'')
  await effects.getByRole('button',{name:'暂不应用',exact:true}).click()
  assert.equal((await read()).document.cards.find(c=>c.id==='style').fields.direction.text,'')
  await effects.getByRole('button',{name:'预览 手绘水彩',exact:true}).click()
  await effects.getByRole('button',{name:'应用到当前卡片',exact:true}).click()
  await poll(s=>s.document.cards.find(c=>c.id==='style').fields.direction.text==='手绘水彩')
  await detail.getByText('专业字段与来源',{exact:true}).click()
  await detail.getByRole('textbox',{name:'自定义说明内容',exact:true}).fill('我自己的视觉说明')
  await poll(s=>s.document.cards.find(c=>c.id==='style').fields.notes.text==='我自己的视觉说明')
  assert.equal((await read()).document.cards.find(c=>c.id==='consumer').input_bindings.length,0)
  await open('photo')
  for(const entry of ['景别与构图','机位与视角','运镜','光影与色彩','焦点与成像']) {
    await detail.getByRole('button',{name:'编辑'+entry,exact:true}).click()
    const region=detail.getByRole('region',{name:entry+'效果选择',exact:true})
    await region.waitFor()
    assert.equal(await page.getByRole('dialog').count(),1)
    if(entry==='运镜') {
      const video=region.locator('video');await video.evaluate(v=>v.play());
      await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2)
      assert.ok(await video.evaluate(v=>v.getBoundingClientRect().height>200),'large motion preview remains visible at its native aspect ratio')
      await region.getByRole('region',{name:'运镜起止对照',exact:true}).waitFor()
      await detail.screenshot({path:join(output,'photography-motion.png'),animations:'disabled'})
    }
    await region.getByRole('button',{name:'应用到当前卡片',exact:true}).click()
    if(entry==='景别与构图') {await poll(s=>s.document.cards.find(c=>c.id==='photo').fields.shot_size.text==='特写');assert.equal((await read()).document.cards.find(c=>c.id==='photo').fields.light_sources.text,'保留自定义灯光')}
    await detail.screenshot({path:join(output,entry+'.png'),animations:'disabled'})
  }
  await poll(s=>s.document.cards.find(c=>c.id==='photo').fields.depth_focus.text.includes('浅景深'))
  await page.reload();await open('style')
  await detail.getByText('专业字段与来源',{exact:true}).click()
  assert.equal(await detail.getByRole('textbox',{name:'自定义说明内容',exact:true}).inputValue(),'我自己的视觉说明')
  await detail.screenshot({path:join(output,'professional-fields.png'),animations:'disabled'})
  await detail.getByText('专业字段与来源',{exact:true}).click()
  for (const [width,height] of [[1440,960],[390,844],[3830,1688]]) {
    await page.setViewportSize({width,height})
    await detail.locator(".wb-details-body").evaluate(e=>{e.scrollTop=0})
    assert.equal(await detail.evaluate(e=>e.scrollWidth<=e.clientWidth),true)
    await detail.screenshot({path:join(output,`style-${width}.png`),animations:'disabled'})
    await page.screenshot({path:join(output,`style-full-${width}.png`),animations:'disabled'})
  }
  await page.setViewportSize({width:390,height:844})
  const mobileApply=detail.getByRole('button',{name:'应用到当前卡片',exact:true})
  await mobileApply.scrollIntoViewIfNeeded()
  await mobileApply.focus()
  await detail.screenshot({path:join(output,'style-mobile-actions.png'),animations:'disabled'})
  await detail.getByRole('button',{name:'关闭详情',exact:true}).click()
  await page.setViewportSize({width:1440,height:960})
  await open('photo')
  await detail.getByRole('button',{name:'编辑光影与色彩',exact:true}).click()
  await detail.getByRole('textbox',{name:'光源内容',exact:true}).fill('保存后的轮廓光')
  await poll(s=>s.document.cards.find(c=>c.id==='photo').fields.light_sources.text==='保存后的轮廓光')
  await page.locator('.generation-editor-mask').click({position:{x:2,y:2}})
  await detail.waitFor({state:'hidden'})
  await open('photo');await detail.getByRole('button',{name:'编辑光影与色彩',exact:true}).click()
  assert.equal(await detail.getByRole('textbox',{name:'光源内容',exact:true}).inputValue(),'保存后的轮廓光')
  await detail.getByRole('button',{name:'关闭详情',exact:true}).click()
  await open('consumer')
  await page.screenshot({path:join(output,'before-adopt.png'),fullPage:true})
  await detail.getByRole('button',{name:'采用 @文本1',exact:true}).click()
  await poll(s=>s.document.cards.find(c=>c.id==='consumer').input_bindings.length===1)
  await detail.getByRole('button',{name:'预检运行',exact:true}).click()
  const preview=page.getByRole('region',{name:'运行预检',exact:true})
  const text=await preview.getByRole('region',{name:'实际提交文本',exact:true}).textContent()
  assert.match(text,/手绘水彩/);assert.match(text,/我自己的视觉说明/)
  assert.doesNotMatch(text,/\.mp4|preset|演示主体|media|file_id/)
  writeFileSync(join(output,'submitted-text.txt'),text)
  await preview.getByRole('button',{name:'确认执行',exact:true}).click()
  await detail.getByRole('region',{name:'当前正式输出',exact:true}).getByRole('button',{name:'预览输出 1',exact:true}).waitFor()
  console.log('B effects-first default, comparison/cancel/apply, five entries, preserved professional fields/autosave, three viewports passed:',output)
} finally { await cleanup() }
