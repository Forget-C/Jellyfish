import { storyboardCanvasApi, storyboardCanvasPath, withFixedSource } from './storyboard-canvas-fixture.mjs'
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
const output = await browserOutput('jellyfish-generation-canvas-object-angles-')
const api = 'http://127.0.0.1:8398', base = `${api}/api/v1/studio/generation-canvases`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DYNAMIC_REFERENCE: '1', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8398' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4398, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1920, height: 790 } })
  page = await context.newPage()
  page.setDefaultTimeout(12000)
  page.on('console', message => { if (message.type() === 'error') console.log('BROWSER ERROR', message.text()) })
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const request=async(path,method='GET',body)=>{
    const r=await fetch(new URL(path, api),{method,headers:{'Content-Type':'application/json'},body:body&&JSON.stringify(body)})
    assert.ok(r.ok,await r.clone().text());return (await r.json()).data
  }
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9v8AAAAASUVORK5CYII=','base64')
  const upload=async name=>{const form=new FormData();form.set('file',new Blob([Buffer.concat([png,Buffer.from(name)])],{type:'image/png'}),name);form.set('project_id','canvas-project');form.set('usage_kind','generation_upload');const r=await fetch(api+'/api/v1/studio/files/upload',{method:'POST',body:form});assert.ok(r.ok,await r.clone().text());return(await r.json()).data.id}
  const files=await Promise.all(['first.png','second.png','third.png'].map(upload))
  const results=[]
  const fixture=async(name,{refs=[{id:'ref',type:'reference.character',name:'张三',angle:'正面',image_binding:{file_id:files[0]}}],extra=[],modelType='model.image',bindings=[],segments=[],config={}}={})=>{
    const canvas = await request('/api/v1/studio/projects/canvas-project/directing/chapters/angle-chapter/sequences/angle-scene/canvases', 'POST', { name })
    const endpoint = storyboardCanvasApi(base, canvas.id)
    const referenceImages=refs.filter(ref=>ref.image_binding).map(ref=>({id:ref.id+'-image',type:'content.image',file_id:ref.image_binding.file_id}))
    const fixedRefs=refs.map(ref=>ref.image_binding?{...ref,image_binding:{...ref.image_binding,source:{canvas_id:canvas.id,card_id:ref.id+'-image',port_id:'image',position:0}}}:ref)
    const cards=[...fixedRefs,{id:'plain',type:'content.image',file_id:files[1]},...extra,{id:'model',type:modelType,model_id:modelType==='model.image'?'canvas-image-model':null,prompt:{segments},input_bindings:bindings.map(binding=>({...binding,source:{...binding.source,canvas_id:canvas.id}})),config}]
    const linked=[...refs,{id:'plain'}],edges=linked.map((ref,index)=>({id:'edge-'+index,source_card:ref.id,source_port:'image',target_card:'model',target_port:modelType==='model.video'?'first_frame':'image'}))
    const referenceEdges=referenceImages.map(image=>({id:'source-'+image.id,source_card:image.id,source_port:'image',target_card:image.id.slice(0,-6),target_port:'image_source'}))
    cards.push(...referenceImages)
    await request(endpoint,'PUT',{request_id:'seed',expected_revision:0,document:withFixedSource(canvas,{...canvas.document,cards,edges:[...edges,...referenceEdges],input_order:{model:{[modelType==='model.video'?'first_frame':'image']:edges.map(edge=>edge.id)},...Object.fromEntries(referenceEdges.map(edge=>[edge.target_card,{image_source:[edge.id]}]))}})})
    const context=await browser.newContext({viewport:{width:1920,height:1000},reducedMotion:'reduce'});page=await context.newPage();page.setDefaultTimeout(8000)
    await page.addInitScript(({key,ids})=>{window.__ENV={BACKEND_URL:location.origin};if(!sessionStorage.getItem(key)){sessionStorage.setItem(key,'seeded');localStorage.setItem(key,JSON.stringify({schema:1,positions:Object.fromEntries(ids.map((id,i)=>[id,id==='model'?{x:400,y:250}:{x:1200+i*350,y:250}])),sizes:{},transform:{x:0,y:0,scale:.8}}))}},{key:`jellyfish:generation-layout:canvas-project:${canvas.id}:view:canvas`,ids:cards.map(card=>card.id)})
    await page.goto(`http://127.0.0.1:4398${storyboardCanvasPath(canvas)}`)
    const card=page.locator('[data-card-id="model"]');await card.press('Enter')
    const editor=page.locator('.generation-card-editor:visible'),input=editor.getByRole('textbox',{name:'模型正文',exact:true});await input.waitFor()
    await editor.locator('.generation-material-reference > small').filter({hasText:/^@图片\d+$/}).first().waitFor();await page.getByRole('status',{name:'画布保存状态',exact:true}).filter({hasText:'已保存'}).waitFor()
    return {canvas,endpoint,context,card,editor,input,read:()=>request(endpoint),outputs:()=>request(storyboardCanvasApi(base, canvas.id, '/cards/model/outputs'))}
  }
  const probe=async(name,run)=>{
    try{await run();results.push({name,status:'passed'})}
    catch(error){await page.screenshot({path:join(output,`failure-${results.length+1}.png`)});results.push({name,status:'failed',error:error.message})}
    console.log(JSON.stringify(results.at(-1)))
  }
  const saved=async predicate=>{for(let i=0;i<80;i++){if(await predicate())return;await delay(100)}throw Error('saved state not reached')}
  await probe('dynamic object main and angles are stable structured mentions',async()=>{
    const entity='/api/v1/studio/entities/character/angle-person/images'
    await request(entity,'POST',{file_id:files[0],view_angle:'BACK'})
    const side=await request(entity,'POST',{file_id:files[2],view_angle:'LEFT'})
    await request(entity+'/'+side.id,'PATCH',{is_view_default:true})
    const f=await fixture('对象动态角度',{refs:[{id:'ref',type:'reference.character',name:'张三',scene_object_source:{sequence_id:'angle-scene',object_id:'zhang'}}]})
    await f.input.fill('@张')
    let list=page.getByRole('listbox',{name:'引用候选',exact:true});await list.waitFor()
    assert.equal(await list.getByRole('option',{name:'@张三-左侧',exact:true}).isEnabled(),true)
    assert.equal(await list.getByRole('option',{name:'@张三-正面',exact:true}).isEnabled(),false)
    await list.getByRole('option',{name:'@张三-左侧',exact:true}).click()
    await saved(async()=>{const c=(await f.read()).document.cards.find(c=>c.id==='model');return c.input_bindings?.some(b=>b.source.position===2)})
    assert.equal(await f.input.locator('.generation-prompt-token').innerText(),'@张三-左侧')
    await f.input.press('End');await f.input.press(' ');await f.input.pressSequentially('@张三')
    list=page.getByRole('listbox',{name:'引用候选',exact:true});await list.getByRole('option',{name:'@张三',exact:true}).click()
    await saved(async()=>{const c=(await f.read()).document.cards.find(c=>c.id==='model');return c.input_bindings?.length===2})
    const c=(await f.read()).document.cards.find(c=>c.id==='model')
    assert.deepEqual(c.input_bindings.map(b=>b.source.position),[2,0])
    const updated=await request(entity,'POST',{file_id:files[1],view_angle:'LEFT'})
    await request(entity+'/'+updated.id,'PATCH',{is_view_default:true})
    const refreshed=(await f.outputs()).candidates.find(output=>output.source.card_id==='ref'&&output.source.position===2)
    assert.equal(refreshed.file_id,files[1])
    assert.deepEqual((await f.read()).document.cards.find(c=>c.id==='model').input_bindings,c.input_bindings)
    await page.screenshot({path:join(output,'dynamic-angle-mentions.png')})
  })
  writeFileSync(join(output,'audit.json'),JSON.stringify({results},null,2))
  assert.equal(results.filter(result=>result.status==='failed').length,0,JSON.stringify(results))
}finally{await cleanup()}
