import { closeCanvasDetails, openCanvasCard } from './generationCanvasWorkbench.browser-helpers.mjs'
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
const output = await browserOutput('jellyfish-generation-canvas-named-')
const api = 'http://127.0.0.1:8281', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8281' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4281, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const json = async (path, method = 'GET', body) => {
    const response = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
    assert.ok(response.ok, await response.clone().text()); return (await response.json()).data
  }
  const canvas = await json('/api/v1/studio/generation-canvases/canvas-project', 'POST', { name: '统一参考卡 A' })
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
  const upload = async name => { const form = new FormData(); form.set('file', new Blob([Buffer.concat([png, Buffer.from(name)])], { type: 'image/png' }), name); form.set('project_id','canvas-project'); form.set('usage_kind','generation_upload'); const response = await fetch(api+'/api/v1/studio/files/upload',{method:'POST',body:form});assert.ok(response.ok);return (await response.json()).data.id }
  const image = await upload('reference-main.png'), secondImage = await upload('reference-side.png')
  const kinds = ['character','place','prop','costume']
  const cards = [...kinds.map(type => ({id:type,type:`reference.${type}`,type_version:2,name:'',angle:'正面'})),
    {id:'named',type:'reference.character',type_version:2,name:'小雪',image_binding:{file_id:secondImage}},
    {id:'other',type:'reference.prop',type_version:2,name:'长剑',image_binding:{file_id:secondImage}},
    {id:'picture',type:'content.image',file_id:image},{id:'free',type:'content.image',file_id:secondImage},
    {id:'model',type:'model.image',model_id:'canvas-image-model',prompt:{segments:[{id:'prompt',kind:'text',text:'三张参考图'}]},config:{count:3}}]
  await json(`/api/v1/studio/generation-canvases/canvas-project/${canvas.id}`,'PUT',{request_id:'seed',expected_revision:0,document:{...canvas.document,cards,edges:[{id:'linked',source_card:'picture',source_port:'image',target_card:'character',target_port:'image_source'}],input_order:{character:{image_source:['linked']}}}})
  const layoutKey = `jellyfish:generation-layout:canvas-project:${canvas.id}:view:canvas`
  const positions = Object.fromEntries(cards.map((card,index)=>[card.id,{x:100+(index%4)*360,y:180+Math.floor(index/4)*320}]))
  const sizes = Object.fromEntries(cards.map(card=>[card.id,{width:420,height:370}]))
  await page.addInitScript(({layoutKey,positions,sizes})=>{if(!sessionStorage.getItem('seeded')){localStorage.setItem(layoutKey,JSON.stringify({schema:1,positions,sizes,transform:{x:0,y:0,scale:.8},manuallyPlaced:['character','prop']}));sessionStorage.setItem('seeded','1')}},{layoutKey,positions,sizes})
  const url=`http://127.0.0.1:4281/projects/canvas-project/generation-canvas?canvas=${canvas.id}`
  await page.goto(url)
  await page.locator('[data-card-id="costume"] .generation-output-card').waitFor()
  for(const kind of [...kinds,'model']) {
    const card = page.locator(`[data-card-id="${kind}"]`), box=await card.boundingBox(), footer=await card.locator('.generation-card-footer').boundingBox()
    assert.ok(Math.abs(box.width-240)<1);assert.ok(Math.abs(box.height-200.8)<1)
    assert.ok(Math.abs(box.y+box.height-footer.y-footer.height-.8)<1)
    assert.equal(await card.evaluate(e=>e.style.left),positions[kind].x+'px');assert.equal(await card.evaluate(e=>e.style.top),positions[kind].y+'px')
  }
  await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)).sizes.character.width===300,layoutKey)
  const cached=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),layoutKey)
  assert.deepEqual(cached.positions,positions);assert.deepEqual(cached.manuallyPlaced,['character','prop']);assert.deepEqual(cached.transform,{x:0,y:0,scale:.8});assert.deepEqual(cached.sizes.picture,sizes.picture)
  const editor = page.locator('.wb-details:visible')
  const read=()=>json(`/api/v1/studio/generation-canvases/canvas-project/${canvas.id}`)
  const poll=async predicate=>{for(let i=0;i<80;i++){const state=await read();if(predicate(state))return state;await delay(100)}throw Error('save not observed')}
  const open=async id=>{await closeCanvasDetails(page);await page.getByRole('button',{name:'适应全部',exact:true}).click();await openCanvasCard(page,id)}
  const chooseAngle=async text=>{const field=editor.getByRole('combobox',{name:'参考角度',exact:true});await field.fill(text);await field.press('Enter')}
  const fillName=async text=>{await editor.getByLabel('参考名称',{exact:true}).fill(text);return poll(state=>state.document.cards.find(card=>card.id==='character').name===text)}
  const imageMenu=async()=>{await editor.getByRole('button',{name:/^(添加|更换)参考图$/,exact:true}).click();await page.getByRole('menuitem',{name:'从当前画布选择',exact:true}).click();return page.getByRole('dialog',{name:'从当前画布选择参考图',exact:true})}
  const outputFor=async id=>(await json(`/api/v1/studio/generation-canvases/canvas-project/${canvas.id}/cards/${id}/outputs`)).outputs
  await open('character')
  assert.equal(await editor.getByRole('button',{name:'更多参考设置',exact:true}).count(),0)
  assert.equal(await editor.getByRole('button',{name:'预检运行',exact:true}).count(),0)
  assert.equal(await editor.getByLabel('参考名称',{exact:true}).getAttribute('aria-required'),'true')
  await page.screenshot({path:join(output,'reference-empty.png')})
  const selector=editor.getByRole('combobox',{name:'关联图片',exact:true})
  await selector.press('ArrowDown')
  const options=page.locator('.ant-select-dropdown:visible .ant-select-item-option')
  assert.equal(await options.count(),1,'only connected images appear in select')
  assert.equal(await options.locator('img').count(),1,'each select option has a thumbnail')
  await options.first().click()
  let state=await poll(state=>state.document.cards.find(card=>card.id==='character').image_binding?.file_id===image&&state.document.cards.find(card=>card.id==='character').name)
  assert.ok(state.document.cards.find(card=>card.id==='character').name.startsWith('reference-main'))
  assert.equal(state.document.edges.length,1,'select adopts without adding a connection')
  await fillName('手工人物')
  const picker=await imageMenu()
  assert.equal(await picker.locator('[data-reference-source-card="picture"]').count(),0)
  assert.equal(await picker.locator('[data-reference-source-card="other"]').count(),0,'incompatible reference type is excluded')
  await picker.locator('[data-reference-source-card="free"]').click()
  state=await poll(state=>state.document.cards.find(card=>card.id==='character').image_binding?.source?.card_id==='free')
  assert.equal(state.document.cards.find(card=>card.id==='character').name,'手工人物')
  assert.equal(state.document.edges.filter(edge=>edge.source_card==='free'&&edge.target_card==='character').length,1)
  await fillName('')
  assert.deepEqual(await outputFor('character'),[],'empty name is a saved draft without effective outputs')
  await editor.getByText('请填写参考名称',{exact:false}).waitFor()
  await imageMenu();await picker.locator('[data-reference-source-card="named"]').click()
  state=await poll(state=>state.document.cards.find(card=>card.id==='character').name==='小雪')
  await editor.getByText('同类型、同名称、同角度的参考已存在',{exact:false}).waitFor()
  assert.deepEqual(await outputFor('character'),[])
  assert.deepEqual(await outputFor('named'),[],'same-type duplicate invalidates both references')
  await fillName('人物重命名')
  assert.equal((await outputFor('character'))[0].payload.objects.length,1)
  await chooseAngle('低机位斜侧面');await poll(state=>state.document.cards.find(card=>card.id==='character').angle==='低机位斜侧面')
  await editor.getByRole('button',{name:'更换参考图',exact:true}).hover()
  await page.getByRole('tooltip',{name:'更换参考图',exact:true}).waitFor()
  assert.equal(await editor.getByRole('button',{name:'更换参考图',exact:true}).innerText(),'')
  await editor.getByRole('button',{name:'更换参考图',exact:true}).click();await page.getByRole('menuitem',{name:'从素材库选择',exact:true}).click()
  const library=page.getByRole('dialog',{name:'项目文件库',exact:true})
  await library.getByRole('button',{name:'选用 reference-side',exact:true}).click();await library.waitFor({state:'hidden'})
  state=await poll(state=>state.document.cards.find(card=>card.id==='character').image_binding?.source==null)
  assert.equal(state.document.cards.find(card=>card.id==='character').name,'人物重命名')
  const runModel=async()=>{
    const preview=await json(`/api/v1/studio/generation-canvases/canvas-project/${canvas.id}/precheck`,'POST',{card_id:'model'})
    assert.ok(preview.can_run,JSON.stringify(preview.diagnostics))
    const accepted=await json(`/api/v1/studio/generation-canvases/canvas-project/${canvas.id}/runs`,'POST',{request_id:crypto.randomUUID(),preview_token:preview.preview_token})
    for(let i=0;i<100;i++){const runtime=await json(`/api/v1/studio/generation-canvases/canvas-project/${canvas.id}/runtime`);if(runtime.runs.some(run=>run.id===accepted.run_id&&run.nodes.every(node=>node.status==='succeeded')))return runtime.current_outputs.model;await delay(100)}throw Error('model did not publish')
  }
  const modelOutputs=await runModel()
  await imageMenu();await picker.locator('[data-reference-source-card="model"][data-reference-source-position="1"]').click()
  state=await poll(state=>state.document.cards.find(card=>card.id==='character').image_binding?.source?.card_id==='model')
  const fixed=state.document.cards.find(card=>card.id==='character').image_binding
  assert.equal(fixed.file_id,modelOutputs[1].file_id);assert.equal(fixed.result_set_id,modelOutputs[1].result_set_id)
  const nextOutputs=await runModel()
  assert.deepEqual((await read()).document.cards.find(card=>card.id==='character').image_binding,fixed)
  await selector.press('ArrowDown');await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({has:page.locator(`img[src*="${nextOutputs[1].file_id}"]`)}).click()
  await poll(state=>state.document.cards.find(card=>card.id==='character').image_binding?.file_id===nextOutputs[1].file_id)
  await editor.getByRole('button',{name:'移除参考图',exact:true}).click()
  await poll(state=>!state.document.cards.find(card=>card.id==='character').image_binding)
  const zone=editor.locator('.generation-reference-upload')
  const invalid=await page.evaluateHandle(()=>{const data=new DataTransfer();data.items.add(new File(['text'],'notes.txt',{type:'text/plain'}));return data})
  await zone.dispatchEvent('drop',{dataTransfer:invalid});await editor.getByText('仅支持上传图片文件',{exact:true}).waitFor()
  const data=await page.evaluateHandle(bytes=>{const transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array(bytes)],'dropped.png',{type:'image/png'}));return transfer},[...png])
  await zone.dispatchEvent('drop',{dataTransfer:data})
  await poll(state=>state.document.cards.find(card=>card.id==='character').image_binding?.file_id)
  for(const kind of ['place','prop','costume']) {
    await open(kind);await editor.getByLabel('参考名称',{exact:true}).fill('人物重命名')
    await editor.getByLabel('上传媒体文件',{exact:true}).setInputFiles({name:kind+'.png',mimeType:'image/png',buffer:png})
    await poll(state=>state.document.cards.find(card=>card.id===kind).image_binding?.file_id&&state.document.cards.find(card=>card.id===kind).name==='人物重命名')
    const outputs=await outputFor(kind)
    assert.equal(outputs[0].payload.objects.length,1);assert.equal(outputs[0].payload.objects[0].category,kind)
    assert.equal(await editor.getByRole('button',{name:'更多参考设置',exact:true}).count(),0)
  }
  await page.setViewportSize({width:390,height:844})
  const footer=await editor.locator('.generation-material-footer').boundingBox();assert.ok(footer.y+footer.height<=844)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  await page.screenshot({path:join(output,'reference-mobile.png')})
  await page.setViewportSize({width:1440,height:1000});await closeCanvasDetails(page)
  const before=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),layoutKey)
  await page.reload();await page.locator('[data-card-id="costume"] .generation-output-card').waitFor()
  const after=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),layoutKey)
  assert.deepEqual(after.positions,before.positions);assert.deepEqual(after.transform,before.transform)
  console.log('PASS reference cards: shared four types, connected thumbnail select, unconnected canvas picker, naming drafts, stable fixed outputs, sources, mobile and geometry')
} catch(error) { if(page) await page.screenshot({path:join(output,'failure.png'),fullPage:true});throw error } finally { await cleanup() }
