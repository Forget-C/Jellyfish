import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-generation-canvas-images-')
const api = 'http://127.0.0.1:8610', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8610' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  const port = Number(process.env.JELLYFISH_MODEL_SHELL_TEST_PORT || 4610)
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } })
  page = await context.newPage()
  page.setDefaultTimeout(12000)
  page.on('console', message => { if (message.type() === 'error') console.log('BROWSER ERROR', message.text()) })
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const request = async (path, body) => {
    const response = await fetch(api + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
    assert.ok(response.ok, await response.clone().text()); return (await response.json()).data
  }
  const defaults = await fetch(api+'/api/v1/llm/model-settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({default_text_model_id:null,default_image_model_id:null,default_video_model_id:null})})
  assert.ok(defaults.ok,await defaults.text())
  const canvas = await request('/api/v1/studio/generation-canvases/canvas-project', { name: '模型卡统一尺寸与底部状态' })
  const ids = ['short', 'long', 'empty', 'image', 'video']
  const positions = Object.fromEntries([...ids, 'content'].map((id, index) => [id, { x: 120 + index % 3 * 400, y: 200 + Math.floor(index / 3) * 500 }]))
  const contentCards = [
    {id:'content',type:'content.text',text:'长文本摘要。'.repeat(500)},
    {id:'description',type:'content.costume',object_id:'costume',name:'服装',text:'长描述。'.repeat(500)},
    {id:'basis',type:'content.basis',text:'长原文。'.repeat(500)},
  ]
  Object.assign(positions,{description:{x:1500,y:200},basis:{x:1500,y:450}})
  const sizes = { description:{width:440,height:204}, basis:{width:480,height:250}, short: {width:560,height:400}, long:{width:420,height:380}, empty:{width:300,height:160}, image:{width:300,height:251}, video:{width:450,height:500}, content:{width:360,height:180} }
  const layoutKey = `jellyfish:generation-layout:canvas-project:${canvas.id}:view:canvas`
  const transform = {x:0,y:0,scale:1}
  const seeded = await fetch(`${base}/${canvas.id}`, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:'seed',expected_revision:0,document:{...canvas.document,cards:[
    ...ids.map(id=>({id,type:`model.${['image','video'].includes(id)?id:'text'}`,...(id==='long'?{show_result_cards:true}:{})})), ...contentCards
  ],edges:[{id:'caption',source_card:'short',source_port:'text',target_card:'image',target_port:'text'}],input_order:{image:{text:['caption']}}}})})
  assert.ok(seeded.ok,await seeded.text())
  const upload = async (name, data, type) => {
    const form = new FormData(); form.append('file',new Blob([data],{type}),name); form.append('project_id','canvas-project'); form.append('usage_kind','generation_upload')
    const response = await fetch(api+'/api/v1/studio/files/upload',{method:'POST',body:form}); assert.ok(response.ok,await response.clone().text()); return (await response.json()).data.id
  }
  const imageId = await upload('reference.png',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'),'image/png')
  const videoPath = join(output,'clip.mp4')
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=gray:s=240x120:d=1','-f','lavfi','-i','sine=frequency=440:duration=1','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',videoPath])
  const videoId = await upload('clip.mp4',readFileSync(videoPath),'video/mp4')
  const out = (id,position,modality,extra) => ({source:{canvas_id:canvas.id,card_id:id,port_id:modality,position},modality,available:true,basis_current:true,...extra})
  let scenario = 'succeeded', streamedOutputs, streamFixtures = false
  await page.route(/\/events(?:\?|$)/, async route => {
    if (!streamFixtures) return route.continue()
    const cursor = Number(new URL(route.request().url()).searchParams.get('cursor') || 0)
    const event = streamedOutputs && streamedOutputs.cursor > cursor
      ? { version: 1, canvas_id: canvas.id, type: 'run.finished', cursor: streamedOutputs.cursor,
          payload: { run_id: 'run', current_outputs: streamedOutputs.outputs } }
      : undefined
    await route.fulfill({ contentType: 'text/event-stream', body: event ? `data: ${JSON.stringify(event)}\n\n` : ': waiting\n\n' })
  })
  let scenarioOutputs
  await page.route('**/runtime', async route => {
    const outputs = scenario === 'empty' ? {} : {short:[out('short',0,'text',{text:'一行短文本'})], long:[out('long',0,'text',{text:'很长的生成内容。'.repeat(1000)})], image:[out('image',0,'image',{file_id:imageId}),out('image',1,'image',{file_id:imageId})],video:[out('video',0,'video',{file_id:videoId})]}
    scenarioOutputs = outputs
    const nodes = scenario === 'empty' ? [] : ids.filter(id=>id!=='empty').map(id=>({id:'node-'+id,run_id:'run',card_id:id,task_id:null,status:scenario,stage:scenario==='running'?'generating':'finished',progress:scenario==='running'?30:100,text:scenario==='running'?'正在生成'.repeat(500):'',basis:{},outputs:outputs[id]||[],result_set_id:null,current_output_updated:scenario==='succeeded',error_code:scenario==='failed'?'fixture_failure':null,error_message:scenario==='failed'?'生成失败，保留上次结果':null}))
    await route.fulfill({json:{code:200,message:'success',data:{cursor:0,runs:nodes.length?[{id:'run',canvas_id:canvas.id,lifecycle:scenario==='running'?'active':'finished',nodes}]:[],current_outputs:outputs},meta:null}})
  })
  await page.addInitScript(({layoutKey,positions,sizes,transform})=>{
    if(!sessionStorage.getItem('model-shell-seeded')){localStorage.setItem(layoutKey,JSON.stringify({schema:1,positions,sizes,transform,manuallyPlaced:['short','video']}));sessionStorage.setItem('model-shell-seeded','1')}
  },{layoutKey,positions,sizes,transform})
  const url=`http://127.0.0.1:${port}/projects/canvas-project/generation-canvas?canvas=${canvas.id}`
  const checkGeometry = async (scale=1) => {
    for (const id of ids) {
      const card = page.locator(`[data-card-id="${id}"]`), body = card.locator(':scope > .generation-card-body'), footer=card.locator('.generation-card-footer')
      const b=await body.boundingBox(),f=await footer.boundingBox()
      assert.ok(Math.abs(b.width-360*scale)<1,`${id}: shared model card width`)
      assert.ok(Math.abs(b.height-392*scale)<1,`${id}: shared model card body height`)
      assert.ok(Math.abs(b.y+b.height-f.y-f.height-scale)<1,`${id}: footer is anchored above the bottom border`)
      const font = await card.locator('header strong').evaluate(e=>parseFloat(getComputedStyle(e).fontSize))
      const statusFont = await footer.evaluate(e=>parseFloat(getComputedStyle(e).fontSize))
      assert.ok(font*scale>=11.99,`${id}: title remains readable when zoomed out`)
      assert.ok(statusFont*scale>=10.99,`${id}: status remains readable when zoomed out`)
      assert.equal(await card.evaluate(e=>e.style.left),positions[id].x+'px');assert.equal(await card.evaluate(e=>e.style.top),positions[id].y+'px')
    }
    const endpoint=await page.locator('[data-generation-edge-id="caption"] .canvas-edge-line').evaluate(path=>{const end=path.getPointAtLength(path.getTotalLength()).matrixTransform(path.getScreenCTM()),card=document.querySelector('[data-card-id="image"]').getBoundingClientRect();return {x:end.x,y:end.y,left:card.left,right:card.right,middle:card.top+card.height/2}})
    assert.ok(Math.min(Math.abs(endpoint.x-endpoint.left),Math.abs(endpoint.x-endpoint.right))<1,'edge ends on the image card side')
    assert.ok(Math.abs(endpoint.y-endpoint.middle)<1,'edge follows the resized image card center')
    const layout=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),layoutKey)
    for (const [id, point] of Object.entries(positions)) assert.deepEqual(layout.positions[id],point)
    for (const [id, expected] of [['content',{width:400,height:172}],['description',{width:400,height:172}],['basis',{width:400,height:172}]]) {
      assert.deepEqual(layout.sizes[id],expected)
      assert.deepEqual(await page.locator(`[data-card-id="${id}"]`).evaluate(card=>({width:card.offsetWidth,height:card.offsetHeight})),expected)
    }
    assert.deepEqual(layout.manuallyPlaced,['short','video'])
    for(const id of ids) assert.deepEqual(layout.sizes[id],{width:360,height:424})
  }
  for (scenario of ['succeeded','empty','running','failed','cancelled']) {
    await page.goto(url);await page.locator('[data-card-id="video"] .generation-card-footer').waitFor()
    if(scenario!=='empty')await page.locator('[data-card-id="short"]').getByText(scenario==='succeeded'?'已完成':scenario==='running'?'运行中':scenario==='failed'?'失败 · 未完成':'已取消 · 未完成',{exact:true}).waitFor()
    await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key))?.sizes.short?.width===360,layoutKey,{timeout:2000}).catch(()=>{})
    if(scenario!=='empty') assert.equal(await page.locator('[data-card-id="image"] .generation-image-result > img').evaluate(e=>getComputedStyle(e).objectFit),'contain','generated image remains fully visible')
    await checkGeometry()
    if(scenario==='succeeded') {
      const imageCard=page.locator('[data-card-id="image"]');await imageCard.getByRole('button',{name:'预览下一张图片',exact:true}).click();await imageCard.getByText('2 / 2',{exact:true}).waitFor()
      await imageCard.getByRole('button',{name:'打开完整图片',exact:true}).click();await page.getByRole('dialog',{name:'图片预览',exact:true}).getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('dialog',{name:'图片预览',exact:true}).waitFor({state:'hidden'})
      const video=page.locator('[data-card-id="video"] video');await video.evaluate(e=>{e.muted=true;return e.play()});assert.equal(await video.evaluate(e=>e.paused),false);await video.evaluate(e=>e.pause())
    }
    await page.screenshot({path:join(output,`model-cards-${scenario}.png`),fullPage:true})
    if(scenario==='failed') {
      const explanation=page.locator('[data-card-id="short"]').getByRole('button',{name:'查看状态说明',exact:true})
      const button=await explanation.boundingBox(),footer=await page.locator('[data-card-id="short"] .generation-card-footer').boundingBox()
      assert.ok(button.y>=footer.y && button.y+button.height<=footer.y+footer.height,'status explanation button is fully visible')
      await explanation.click();await page.getByText('生成失败，保留上次结果',{exact:true}).waitFor()
    }
  }
  // Cached zoom survives reload and the fixed logical dimensions scale with the canvas.
  await page.getByRole('button',{name:'缩小',exact:true}).click();await page.reload();await page.locator('[data-card-id="video"] .generation-card-footer').waitFor();await checkGeometry(.9)
  await page.setViewportSize({width:390,height:844});await checkGeometry(.9);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  await page.screenshot({path:join(output,'model-cards-mobile.png')})
  await page.setViewportSize({width:1440,height:1200})
  const header=page.locator('[data-card-id="short"] > header')
  await header.hover()
  const box=await header.boundingBox()
  await page.mouse.move(box.x+80,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+125,box.y+box.height/2+27,{steps:8});await page.mouse.up()
  positions.short={x:positions.short.x+50,y:positions.short.y+30}
  await page.waitForFunction(point=>Math.abs(parseFloat(document.querySelector('[data-card-id="short"]').style.left)-point.x)<.1,positions.short)
  await checkGeometry(.9)
  await header.getByRole('button',{name:'移动布局：文本模型卡',exact:true}).press('ArrowRight')
  positions.short.x+=10;await checkGeometry(.9)
  await page.reload();await page.locator('[data-card-id="short"] .generation-card-footer').waitFor();await checkGeometry(.9)
  for(const scale of [.8,.7,.6,.5]) {
    await page.getByRole('button',{name:'缩小',exact:true}).click()
    await page.waitForFunction(value=>parseInt(document.querySelector('[aria-label="画布缩放比例"]').textContent)===Math.round(value*100),scale)
    await checkGeometry(scale)
  }
  // Keep the result reader's normal viewport reveal separate from the layout assertions above.
  scenario = 'succeeded'
  streamFixtures = true
  await page.goto(url)
  const linkedText = page.getByRole('article',{name:'文本生成结果 1',exact:true})
  const summary = linkedText.getByRole('region', { name:'生成结果预览' }).locator('p')
  assert.equal(await summary.evaluate(node => getComputedStyle(node).webkitLineClamp), '4')
  assert.equal(await summary.evaluate(node => getComputedStyle(node).overflowY), 'hidden')
  await linkedText.press('Enter')
  const resultDetail = page.getByRole('complementary', {name:'文本生成结果 1', exact:true})
  const resultText = resultDetail.getByRole('textbox', {name:'文本内容', exact:true})
  assert.equal(await resultText.inputValue(), '很长的生成内容。'.repeat(1000))
  streamedOutputs = { cursor: 1, outputs: { ...scenarioOutputs, long: [out('long', 0, 'text', { text: '同一输出位置的新正文' })] } }
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="文本内容"]')?.value === '同一输出位置的新正文')
  await linkedText.getByText('同一输出位置的新正文', { exact: true }).waitFor()
  streamedOutputs = { cursor: 2, outputs: { ...scenarioOutputs, long: [] } }
  await resultDetail.getByText('当前输出缺失', { exact: true }).waitFor()
  assert.equal(await resultText.count(), 0, 'missing output does not retain prior text in the detail')
  await resultDetail.getByRole('button', {name:'关闭详情', exact:true}).click()
  streamedOutputs = { cursor: 3, outputs: scenarioOutputs }
  await linkedText.waitFor()
  console.log('PASS unified model dimensions, full image preview, readable zoom, fixed footer and cached positions',output)
} catch(error) { if(page)await page.screenshot({path:join(output,'failure.png'),fullPage:true});throw error } finally { await cleanup() }
