import { openModelInspection } from './generationCanvasWorkbench.browser-helpers.mjs'
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
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 1440, height: 960 } })
  const page = await context.newPage()
  page.setDefaultTimeout(12000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '摄影设计' }) })).json()).data
  const authored = text => ({ text, state: 'fact', purpose: 'design', authorship: 'user' })
  const document = { ...canvas.document, cards: [
    { id: 'style', type: 'direction.style' },
    { id: 'consumer', type: 'model.image', model_id: 'canvas-image-model', config:{count:3} },
    { id: 'auxiliary', type: 'direction.creative_control', name: '备用约束', source_locator: '第1节', scope: { description: '仅用于室内镜头' } },
    { id: 'continuity', type: 'direction.continuity', category: 'appearance', before: authored('袖口干净'),
      following_constraints: authored('保持已明确的服装、妆发与外观变化结果；避免无依据的造型变化') },
    { id: 'fact', type: 'direction.fact' },
    { id: 'dialogue', type: 'direction.dialogue' },
    { id: 'anchor', type: 'direction.anchor' },
  ], edges: [{id:'e', source_card:'style',source_port:'text',target_card:'consumer',target_port:'text'}], input_order:{consumer:{text:['e']}} }
  const seed = await fetch(`${base}/${canvas.id}`, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:'seed',expected_revision:0,document})})
  assert.ok(seed.ok, await seed.text())
  const read = async () => (await (await fetch(`${base}/${canvas.id}`)).json()).data
  const poll = async predicate => { for (let i=0;i<80;i++) {const state=await read(); if(predicate(state)) return state;await delay(100)} throw Error('preset save did not arrive') }
  await page.goto(`http://127.0.0.1:4297/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const detail=page.locator('.wb-details:not([hidden])')
  const open=async id=>{if(await detail.count()) await detail.getByRole('button',{name:'关闭详情',exact:true}).click();const card=page.locator(`[data-card-id="${id}"]`);await card.press('Enter');await detail.waitFor();await openModelInspection(page)}
  const close=()=>detail.getByRole('button',{name:'关闭详情',exact:true}).click()
  await open('style')
  assert.equal(await detail.getByRole('button',{name:'预览 手绘水彩',exact:true}).isVisible(),true,'style opens directly in presets')
  assert.equal(await detail.getByRole('tab').count(),0,'style has no parameter/reference tabs')
  assert.equal(await detail.getByRole('button',{name:'应用',exact:true}).isDisabled(),true)
  await detail.getByRole('button',{name:'预览 手绘水彩',exact:true}).click()
  await detail.getByRole('button',{name:'对比 立体动画',exact:true}).click()
  assert.equal((await read()).document.cards.find(c=>c.id==='style').fields.direction.text,'','preview never saves')
  await detail.getByRole('button',{name:'高级设置',exact:true}).click()
  assert.equal(await detail.getByRole('textbox',{name:'自定义说明内容',exact:true}).isVisible(),true,'all fields are directly available')
  assert.equal(await detail.locator('summary').filter({hasText:'更多参数'}).count(),0)
  await detail.getByRole('button',{name:'返回预设',exact:true}).click()
  assert.equal(await detail.getByRole('button',{name:'预览 手绘水彩',exact:true}).getAttribute('aria-pressed'),'true')
  await detail.screenshot({path:join(output,'style-comparison.png'),animations:'disabled'})
  await detail.getByRole('button',{name:'应用',exact:true}).click()
  await poll(s=>s.document.cards.find(c=>c.id==='style').fields.direction.text==='手绘水彩')
  assert.equal(await detail.getByRole('button',{name:'预览 手绘水彩',exact:true}).isVisible(),true,'apply stays in gallery')
  await close();await page.reload();await open('style')
  assert.equal(await detail.locator('.design-preset-preview').isVisible(),true,'reopening an applied preset restores its visual preview')
  assert.equal(await detail.getByRole('button',{name:'预览 手绘水彩',exact:true}).getAttribute('aria-pressed'),'true')
  await detail.getByRole('button',{name:'高级设置',exact:true}).click()
  await detail.getByRole('textbox',{name:'自定义说明内容',exact:true}).fill('我自己的视觉说明')
  await poll(s=>s.document.cards.find(c=>c.id==='style').fields.notes.text==='我自己的视觉说明')
  const before=(await read()).document
  await detail.getByRole('button',{name:'返回预设',exact:true}).click()
  await detail.getByRole('button',{name:'预览 黑白光影',exact:true}).click()
  await detail.getByRole('group',{name:'预设变更清单'}).locator('summary').first().click()
  await detail.getByText('将覆盖 · 风格方向',{exact:true}).click()
  await detail.getByText(/原值：手绘水彩/).waitFor()
  await detail.getByText(/新值：黑白光影/).waitFor()
  await detail.getByRole('button',{name:'应用',exact:true}).click()
  await poll(s=>s.document.cards.find(c=>c.id==='style').fields.direction.text==='黑白光影')
  assert.equal((await read()).document.cards.find(c=>c.id==='style').fields.notes.text,'我自己的视觉说明')
  await detail.getByRole('button',{name:'撤销',exact:true}).click()
  await poll(s=>s.document.cards.find(c=>c.id==='style').fields.direction.text==='手绘水彩')
  assert.deepEqual((await read()).document,before,'one undo restores the entire pre-application document')
  await close();await open('style')
  assert.equal(await detail.getByRole('textbox',{name:'自定义说明内容',exact:true}).isVisible(),true,'extra design opens in parameters')
  await detail.getByRole('button',{name:'返回预设',exact:true}).click()
  assert.equal(await detail.getByRole('button',{name:'应用',exact:true}).isDisabled(),true,'closing discards the unapplied choice without changing applied fields')
  assert.equal(await detail.getByRole('button',{name:'预览 手绘水彩',exact:true}).getAttribute('aria-pressed'),'true','custom notes outside the preset retain its applied preview')
  assert.equal(await detail.locator('.design-preset-preview figcaption strong').innerText(),'手绘水彩')
  await detail.getByText('自定义配置',{exact:true}).waitFor()
  await detail.getByRole('button',{name:'高级设置',exact:true}).click()
  const long='长内容连续字符'.repeat(60)
  await detail.getByRole('textbox',{name:'风格方向内容',exact:true}).fill(long)
  await poll(s=>s.document.cards.find(c=>c.id==='style').fields.direction.text===long)
  let rejectSave=true
  await page.route(`**/api/v1/studio/generation-canvases/canvas-project/${canvas.id}`,async route=>{
    if(rejectSave&&route.request().method()==='PUT'){rejectSave=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({data:{code:'SAVE_FAILURE',message:'演示保存失败，请重试'}})})}else await route.continue()
  })
  await detail.getByRole('textbox',{name:'风格方向内容',exact:true}).fill(long+'保留失败输入')
  await detail.getByRole('status').filter({hasText:'SAVE_FAILURE'}).waitFor()
  assert.equal(await detail.getByRole('textbox',{name:'风格方向内容',exact:true}).innerText(),long+'保留失败输入')
  await close();await page.getByRole('button',{name:'保存画布',exact:true}).click()
  await poll(s=>s.document.cards.find(c=>c.id==='style').fields.direction.text===long+'保留失败输入')
  await open('style')
  await detail.getByRole('textbox',{name:'风格方向内容',exact:true}).fill(long)
  await poll(s=>s.document.cards.find(c=>c.id==='style').fields.direction.text===long)
  await close();await open('style')
  assert.equal(await detail.getByRole('textbox',{name:'风格方向内容',exact:true}).isVisible(),true)
  await detail.getByRole('button',{name:'返回预设',exact:true}).click()
  for(const [width,height] of [[1440,960],[1280,640],[390,844]]){
    await page.setViewportSize({width,height})
    await detail.getByRole('button',{name:'预览 立体动画',exact:true}).click()
    assert.equal(await detail.locator('.wb-details-body').evaluate(e=>e.scrollWidth<=e.clientWidth),true)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
    const apply=detail.getByRole('button',{name:'应用',exact:true})
    const statusBox=await detail.locator('.design-preset-status').boundingBox(), undoBox=await detail.getByRole('button',{name:'撤销',exact:true}).boundingBox()
    assert.ok(Math.abs(statusBox.y+statusBox.height/2-undoBox.y-undoBox.height/2)<1.5,'footer hint is vertically centered alongside undo')
    const box=await apply.boundingBox(),body=await detail.locator('.wb-details-body').boundingBox()
    assert.ok(box.y>=body.y+body.height-1&&box.y+box.height<=height,'apply outside scroll body')
    if(width===1280){
      const fixed=await detail.locator('.design-preset-detail').boundingBox()
      await detail.locator('.design-preset-grid').evaluate(e=>e.scrollTop=1000)
      assert.ok(await detail.locator('.design-preset-grid').evaluate(e=>e.scrollTop)>0)
      assert.deepEqual(await detail.locator('.design-preset-detail').boundingBox(),fixed,'only gallery scrolls')
      assert.equal(await detail.locator('.wb-details-body').evaluate(e=>e.scrollTop),0)
    }
    await detail.screenshot({path:join(output,`A-gallery-${width}.png`),animations:'disabled'})
    await detail.getByRole('button',{name:'高级设置',exact:true}).click()
    await detail.screenshot({path:join(output,`A-parameters-${width}.png`),animations:'disabled'})
    await detail.getByRole('button',{name:'返回预设',exact:true}).click()
  }
  await close();await page.reload();await open('style')
  assert.equal(await detail.getByRole('textbox',{name:'风格方向内容',exact:true}).innerText(),long)
  await close()
  const observer=await context.newPage();await observer.addInitScript(()=>{window.__ENV={BACKEND_URL:window.location.origin}})
  await observer.goto(page.url());await observer.getByText('此画布当前只读',{exact:true}).waitFor()
  await observer.locator('[data-card-id="style"]').press('Enter')
  const rd=observer.locator('.wb-details:visible')
  assert.equal(await rd.getByRole('textbox',{name:'风格方向内容',exact:true}).isVisible(),true,'read-only opens the same mode')
  await rd.getByRole('button',{name:'返回预设',exact:true}).click()
  await rd.getByRole('button',{name:'预览 手绘水彩',exact:true}).click()
  await rd.getByRole('button',{name:'对比 立体动画',exact:true}).click()
  assert.equal(await rd.getByRole('button',{name:'应用'}).isDisabled(),true)
  await rd.getByRole('button',{name:'高级设置',exact:true}).click()
  assert.equal(await rd.getByRole('textbox',{name:'风格方向内容',exact:true}).isDisabled(),true)
  const revision=(await read()).revision;await observer.keyboard.press('Escape');await rd.waitFor({state:'hidden'})
  assert.equal((await read()).revision,revision)
  await observer.close()
  await open('style')
  const watercolor = [
    ['风格方向', '手绘水彩'], ['视觉特征', '柔和边缘、半透明叠色、自然晕染'],
    ['材质倾向', '水彩颜料与纸张颗粒'], ['色彩倾向', '低饱和青绿与暖色点缀'],
  ]
  for (const label of [...watercolor.map(([label])=>label), '自定义说明']) {
    await detail.getByRole('textbox',{name:label+'内容',exact:true}).fill('')
  }
  await poll(s=>Object.values(s.document.cards.find(c=>c.id==='style').fields).every(field=>!field.text))
  assert.equal(await detail.getByRole('button',{name:'返回预设',exact:true}).isVisible(),true,'clearing design retains the open parameter session')
  await close();await open('style')
  await detail.getByRole('button',{name:'高级设置',exact:true}).click()
  for (const [label,value] of watercolor) await detail.getByRole('textbox',{name:label+'内容',exact:true}).fill(value)
  await poll(s=>s.document.cards.find(c=>c.id==='style').fields.colors.text==='低饱和青绿与暖色点缀')
  assert.equal(await detail.getByRole('button',{name:'返回预设',exact:true}).isVisible(),true,'matching a preset retains the open parameter session')
  await close();await open('style')
  assert.equal(await detail.getByRole('button',{name:'预览 手绘水彩',exact:true}).getAttribute('aria-pressed'),'true','handwritten design matches the preset')
  await detail.getByRole('button',{name:'高级设置',exact:true}).click()
  await detail.getByRole('textbox',{name:'风格方向内容',exact:true}).fill('另一种方向')
  await poll(s=>s.document.cards.find(c=>c.id==='style').fields.direction.text==='另一种方向')
  await detail.getByRole('button',{name:'撤销',exact:true}).click()
  await poll(s=>s.document.cards.find(c=>c.id==='style').fields.direction.text==='手绘水彩')
  await close();await open('style')
  assert.equal(await detail.getByRole('button',{name:'预览 手绘水彩',exact:true}).getAttribute('aria-pressed'),'true','undo restores the matched entry')
  await open('auxiliary')
  await detail.getByRole('button',{name:'预览 有限发挥',exact:true}).waitFor()
  await open('continuity')
  assert.equal(await detail.getByRole('combobox',{name:'连续性分类',exact:true}).isVisible(),true,'matched category and constraint with extra design open parameters')
  await detail.getByRole('button',{name:'返回预设',exact:true}).click()
  await detail.getByText('自定义配置',{exact:true}).waitFor()
  for (const [id,label] of [['fact','不可改事实'],['dialogue','对白正文'],['anchor','位置']]) {
    await open(id)
    await detail.getByRole('textbox',{name:label+'内容',exact:true}).waitFor()
    assert.equal(await detail.getByRole('button',{name:/高级设置|返回预设/}).count(),0)
  }
  console.log('A parameters, previews, conflict disclosure, atomic undo, session boundaries, read-only and responsive layouts passed:',output)
} finally { await cleanup() }
