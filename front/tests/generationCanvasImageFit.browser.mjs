import { openCanvasCard } from './generationCanvasWorkbench.browser-helpers.mjs'
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
const output = await browserOutput('jellyfish-generation-canvas-named-')
const api = 'http://127.0.0.1:8621', base = `${api}/api/v1/studio/generation-canvases`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8621' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4621, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const json=async(path,method='GET',body)=>{const response=await fetch(api+path,{method,headers:{'Content-Type':'application/json'},body:body&&JSON.stringify(body)});assert.ok(response.ok,await response.clone().text());return(await response.json()).data}
  const canvas=await json('/api/v1/studio/generation-canvases','POST',{name:'大图完整缩放'})
  const cards=[],modelOutputs={}
  for(const [shape,size] of [['landscape','3000x2000'],['portrait','2000x3000'],['panorama','6000x300']]){
    const file=join(output,shape+'.png')
    execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i',`color=c=slategray:s=${size}`,'-vf','drawbox=x=0:y=0:w=iw:h=ih:color=yellow:t=20','-frames:v','1',file])
    const form=new FormData();form.set('file',new Blob([readFileSync(file)],{type:'image/png'}),shape+'.png');form.set('project_id','canvas-project');form.set('usage_kind','generation_upload')
    const response=await fetch(api+'/api/v1/studio/files/upload',{method:'POST',body:form});assert.ok(response.ok);const fileId=(await response.json()).data.id
    modelOutputs['model-'+shape]=[{source:{canvas_id:canvas.id,card_id:'model-'+shape,port_id:'image',position:0},modality:'image',available:true,basis_current:true,file_id:fileId}]
    cards.push({id:'model-'+shape,type:'model.image',model_id:null},{id:'image-'+shape,type:'content.image',file_id:fileId},{id:'reference-'+shape,type:'reference.place',name:shape,angle:'正面',image_binding:{file_id:fileId,source:{canvas_id:canvas.id,card_id:'image-'+shape,port_id:'image',position:0}}})
  }
  await json(`/api/v1/studio/generation-canvases/${canvas.id}`,'PUT',{request_id:'seed',expected_revision:0,document:{...canvas.document,cards,edges:cards.filter(card=>card.type==='reference.place').map(card=>({id:card.id,source_card:card.id.replace('reference-','image-'),source_port:'image',target_card:card.id,target_port:'image_source'})),input_order:Object.fromEntries(cards.filter(card=>card.type==='reference.place').map(card=>[card.id,{image_source:[card.id]}]))}})
  await page.route('**/runtime?project_id=*',route=>route.fulfill({json:{code:200,message:'success',data:{cursor:0,runs:[],current_outputs:modelOutputs},meta:null}}))
  const failures=[],measurements=[]
  const editor=page.locator('.generation-card-editor:visible')
  const close=async()=>{for(let i=0;i<3&&await editor.isVisible();i++){await page.keyboard.press('Escape');await delay(100)}assert.equal(await editor.isVisible(),false)}
  const check=async(image,container,label)=>{
    await image.evaluate(async img=>{if(!img.complete)await new Promise(resolve=>img.addEventListener('load',resolve,{once:true}))})
    const info=await image.evaluate(img=>({fit:getComputedStyle(img).objectFit,rect:img.getBoundingClientRect().toJSON(),natural:[img.naturalWidth,img.naturalHeight]})),bounds=await container.boundingBox()
    measurements.push({label,...info,bounds})
    if(!info.natural[0]||!info.natural[1])failures.push(label+': image did not load')
    if(info.fit!=='contain')failures.push(label+': image is cropped ('+info.fit+')')
    if(info.rect.width>bounds.width+1||info.rect.height>bounds.height+1)failures.push(label+': intrinsic dimensions overflow the preview')
  }
  const url=`http://127.0.0.1:4621/canvases/${canvas.id}`
  await page.goto(url)
  for(const [width,height]of[[1440,960],[390,844]]){
    await close();await page.setViewportSize({width,height});await page.getByRole('button',{name:'适应全部',exact:true}).click()
    for(const card of cards){
      const node=page.locator(`[data-card-id="${card.id}"]`)
      await check(node.locator('img').first(),node.locator('.generation-card-body'),`${card.id}/${width}/card`)
      if(card.type==='model.image')continue
      await close();await page.getByRole('button',{name:'适应全部',exact:true}).click();await openCanvasCard(page,card.id)
      for(const mode of width===1440?['normal','expanded']:['mobile']){
        if(mode==='expanded' && await editor.getAttribute('role') !== 'dialog')await editor.getByRole('button',{name:'展开详情',exact:true}).click()
        const actualMode = width === 1440 && await editor.getAttribute('role') === 'dialog' ? 'expanded' : mode
        const preview=editor.locator(card.type==='content.image'?'.generation-image-preview':'.generation-reference-image')
        await check(preview.locator('img'),preview,`${card.id}/${width}/${actualMode}`)
        const scroll=await editor.locator('.wb-details-body').evaluate(e=>({height:e.clientHeight,scroll:e.scrollHeight,width:e.clientWidth,scrollWidth:e.scrollWidth}))
        if(scroll.scroll>scroll.height+1||scroll.scrollWidth>scroll.width+1)failures.push(`${card.id}/${width}/${mode}: image editor scrolls ${JSON.stringify(scroll)}`)
        await page.screenshot({path:join(output,`${card.id}-${width}-${mode}.png`)})
      }
    }
  }
  for(const kind of ['image','reference'])for(const [width,modes]of [[1440,['normal','expanded']],[390,['mobile']]])for(const mode of modes){const heights=measurements.filter(item=>item.label.startsWith(kind+'-')&&item.label.endsWith(`/${width}/${mode}`)).map(item=>item.bounds.height);if(Math.max(...heights)-Math.min(...heights)>1)failures.push(`${kind}/${width}/${mode}: preview height depends on original aspect ratio`)}
  writeFileSync(join(output,'measurements.json'),JSON.stringify(measurements,null,2))
  assert.deepEqual(failures,[])
  console.log('PASS landscape, portrait and panorama fit content/reference/model cards and image editors without cropping')
} catch(error){if(page)await page.screenshot({path:join(output,'failure.png')});throw error}finally{await cleanup()}
