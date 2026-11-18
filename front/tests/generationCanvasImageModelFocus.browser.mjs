import { closeCanvasDetails } from './generationCanvasWorkbench.browser-helpers.mjs'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url)), output = await browserOutput('jellyfish-c59-image-model-')
const api='http://127.0.0.1:8459', base=`${api}/api/v1/studio/generation-canvases`
const backend=spawn('uv',['run','--no-sync','python','-m','tests.generation_canvas_images_browser_server'],{cwd:join(root,'../backend'),env:{...process.env,PYTHONPATH:join(root,'../backend'),UV_CACHE_DIR:'/tmp/jellyfish-uv-cache',CANVAS_BROWSER_DATABASE:join(output,'browser.sqlite'),CANVAS_BROWSER_MEDIA_STORAGE:join(output,'media'),CANVAS_BROWSER_PORT:'8459'},stdio:['ignore','pipe','pipe']})
captureBackend(backend,output)
let server,browser,page
const cleanup=browserCleanup(()=>({browser,server,backend}))
const request=async(url,body,method='POST')=>{const response=await fetch(url,body?{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);assert.ok(response.ok,await response.clone().text());return response.json()}
try{
  for(let i=0;i<80;i++){try{if((await fetch(base)).ok)break}catch{}await delay(250)}
  server=await createServer({root,cacheDir:join(output,'vite-cache'),server:{host:'127.0.0.1',port:4459,strictPort:true,proxy:{'/api':api}}});await server.listen()
  browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL})
  const context=await browser.newContext({viewport:{width:1440,height:960}})
  page=await context.newPage();page.setDefaultTimeout(12000);await context.addInitScript(()=>{window.__ENV={BACKEND_URL:window.location.origin}})
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=slategray:s=320x180','-vf','drawbox=x=20:y=20:w=90:h=140:color=0xd3d3d3:t=fill,drawbox=x=160:y=60:w=120:h=80:color=0x404040:t=fill','-frames:v','1',join(output,'reference.png')])
  const form=new FormData();form.set('file',new Blob([readFileSync(join(output,'reference.png'))],{type:'image/png'}),'街道参考.png');form.set('project_id','canvas-project');form.set('usage_kind','generation_upload')
  const uploaded=await fetch(`${api}/api/v1/studio/files/upload`,{method:'POST',body:form});assert.ok(uploaded.ok);const file=(await uploaded.json()).data
  const canvas=(await request(base,{name:'C图片模型逐类验收'})).data
  const prompt='清晨，林夏走过安静的街道，回头望向镜头。保持人物身份、自然步态与柔和侧光。'
  const model=(id,text='')=>({id,type:'model.image',model_id:'canvas-image-model',prompt:{segments:text?[{id:'p',kind:'text',text}]:[]},config:{count:3,target_ratio:'1:1',resolution_profile:'standard'}})
  await request(`${base}/${canvas.id}`,{request_id:'seed',expected_revision:0,document:{...canvas.document,cards:[{id:'source-text',type:'content.text',text:'保持人物身份、自然步态与柔和侧光。'},{id:'source-image',type:'content.image',file_id:file.id},model('m',prompt),model('empty'),{...model('unselected'),model_id:null}],edges:[{id:'text-edge',source_card:'source-text',source_port:'text',target_card:'m',target_port:'text'},{id:'image-edge',source_card:'source-image',source_port:'image',target_card:'m',target_port:'image'}],input_order:{m:{text:['text-edge'],image:['image-edge']}}}},'PUT')
  const read=async()=>(await request(`${base}/${canvas.id}`)).data
  const runtime=async()=>(await request(`${base}/${canvas.id}/runtime`)).data
  await page.goto(`http://127.0.0.1:4459/canvases/${canvas.id}`)
  const editor=page.locator('.wb-details:not([hidden])'), card=page.locator('[data-card-id="m"]')
  const close=()=>closeCanvasDetails(page)
  const open=async id=>{await close();await page.locator(`[data-card-id="${id}"]`).press('Enter');await editor.waitFor();await delay(150)}
  await open('m')
  assert.match(await editor.getByRole('spinbutton',{name:'图片数量',exact:true}).inputValue(),/3\s*张/,'quantity carries its unit in compact toolbar')
  assert.equal((await read()).document.cards.find(c=>c.id==='m').input_bindings.length,0,'connected candidates are not adopted')
  const material=editor.getByLabel('管理候选与采用',{exact:true})
  await material.click();const inputs=editor.getByRole('region',{name:'已保存直接输入',exact:true})
  await inputs.getByRole('button',{name:'采用 @文本1',exact:true}).click();await inputs.getByRole('button',{name:'采用 @图片1',exact:true}).click();await material.press('Escape')
  await page.getByLabel('画布保存状态').getByText('已保存',{exact:true}).waitFor()
  assert.equal((await read()).document.cards.find(c=>c.id==='m').input_bindings.length,2,'text and image are independently adopted')
  const start=async()=>{await editor.getByRole('button',{name:'预检运行',exact:true}).click();const preview=page.getByRole('dialog',{name:'运行预检',exact:true});await preview.getByRole('button',{name:'确认执行',exact:true}).click()}
  await start();for(let i=0;i<120;i++){if((await runtime()).current_outputs.m?.length===3)break;await delay(100)}
  const originals=(await runtime()).current_outputs.m;assert.equal(originals.length,3)
  await close()
  const preview=card.getByRole('region',{name:'媒体成果预览',exact:true})
  await preview.getByRole('button',{name:'预览下一张图片',exact:true}).click();await preview.getByRole('button',{name:'预览下一张图片',exact:true}).click()
  assert.equal(await preview.locator('img').getAttribute('src'),`http://127.0.0.1:4459/api/v1/studio/files/${originals[2].file_id}/download`)
  assert.equal(await preview.locator(':scope > p').count(),0,'counter does not add a row above the image')
  assert.deepEqual((await runtime()).current_outputs.m,originals,'previewing a result preserves the complete published output')
  const revision=(await read()).revision
  await card.getByRole('button',{name:'打开完整图片',exact:true}).click()
  const full=page.getByRole('dialog',{name:'图片预览',exact:true});await full.waitFor();await full.getByRole('button',{name:'Close',exact:true}).click()
  assert.equal((await read()).revision,revision,'full preview does not modify document')
  const manifest=[]
  for(const [width,height] of [[1440,960],[390,844],[3830,1688]]){
    await page.setViewportSize({width,height});await delay(180)
    for(const [id,f,state] of [['m','F10','default'],['m','F11','expanded'],['empty','F12','empty']]){
      await open(id);if(state==='expanded'&&await editor.getAttribute('data-expanded')!=='true')await editor.getByRole('button',{name:'展开详情',exact:true}).click();await delay(180)
      const prefix=`${f}-image-model-${width}-${state}`
      await page.mouse.move(width-4,height/2);await delay(180)
      await page.screenshot({path:join(output,`${prefix}-page.png`),fullPage:true});await page.waitForFunction(()=>document.querySelector('.wb-details:not([hidden])')?.getBoundingClientRect().height>200);await page.screenshot({path:join(output,`${prefix}-editor.png`),clip:await editor.boundingBox()})
      if(width>700)await page.locator(`[data-card-id="${id}"]`).screenshot({path:join(output,`${prefix}-card.png`)})
      manifest.push({f,width,height,state,prefix})
      assert.ok(await editor.getByRole('button',{name:'预检运行',exact:true}).evaluate(e=>{const b=e.getBoundingClientRect();return b.right<=innerWidth&&b.bottom<=innerHeight&&b.width>=32}))
      if(id==='empty'){assert.ok(await editor.getByRole('button',{name:'预检运行',exact:true}).isDisabled());assert.ok(await editor.getByRole('textbox',{name:'模型正文',exact:true}).getAttribute('aria-placeholder'))}
    }
  }
  await page.setViewportSize({width:1440,height:960});await open('m')
  await request(`${api}/test/image-controls`,{fail_next:true,response_delay:2})
  await start();await page.getByRole('dialog',{name:'运行预检',exact:true}).waitFor({state:'hidden'});await card.getByRole('region',{name:'模型状态摘要',exact:true}).getByText('运行中',{exact:true}).waitFor()
  await page.screenshot({path:join(output,'image-model-running.png'),fullPage:true})
  for(let i=0;i<120;i++){if((await runtime()).runs.some(r=>r.nodes.some(n=>n.card_id==='m'&&n.status==='failed')))break;await delay(100)}
  assert.deepEqual((await runtime()).current_outputs.m,originals,'failed replacement retains prior formal result')
  await card.getByRole('region',{name:'模型状态摘要',exact:true}).getByText('失败 · 未完成',{exact:true}).waitFor()
  await page.screenshot({path:join(output,'image-model-failed-retained.png'),fullPage:true})
  const body=editor.getByRole('textbox',{name:'模型正文',exact:true})
  await body.click();await body.press('ControlOrMeta+End');await body.pressSequentially(' 修改后的画面描述，原有正式成果需要复核。')
  for(let i=0;i<80;i++){if((await read()).document.cards.find(c=>c.id==='m').prompt.segments.some(s=>s.text?.includes('修改后的画面描述')))break;await delay(100)}
  assert.ok((await read()).document.cards.find(c=>c.id==='m').prompt.segments.some(s=>s.text?.includes('修改后的画面描述')),'typed creation text is saved through HTTP')
  await card.getByText('依据已变',{exact:true}).waitFor()
  await page.screenshot({path:join(output,'image-model-stale.png'),fullPage:true})
  await request(`${api}/api/v1/llm/models/canvas-image-model`,{name:'image-model-具有较长名称的受控图片模型能力示例'},'PATCH')
  const saved=(await read()).document.cards.find(c=>c.id==='m');await page.reload();await open('m');assert.equal((await read()).document.cards.find(c=>c.id==='m').config.count,saved.config.count)
  await editor.getByRole('textbox',{name:'模型正文',exact:true}).fill('保留多素材，长正文仍可独立阅读。\n'.repeat(50))
  assert.ok(await editor.getByRole('textbox',{name:'模型正文',exact:true}).evaluate(e=>e.scrollHeight>e.clientHeight))
  await editor.getByRole('spinbutton',{name:'图片数量',exact:true}).fill('2');await editor.getByRole('spinbutton',{name:'图片数量',exact:true}).press('Tab')
  for(let i=0;i<80;i++){if((await read()).document.cards.find(c=>c.id==='m').config.count===2)break;await delay(100)}
  assert.equal((await read()).document.cards.find(c=>c.id==='m').config.count,2,'compact quantity remains editable through public UI')
  await editor.getByText('正在读取直接候选',{exact:true}).waitFor({state:'hidden'});await page.mouse.move(4,300)
  await page.screenshot({path:join(output,'image-model-long-name-text-and-sources.png'),fullPage:true})
  await page.setViewportSize({width:390,height:844});await delay(200)
  await editor.getByRole('spinbutton',{name:'图片数量',exact:true}).focus()
  assert.ok(await editor.getByRole('spinbutton',{name:'图片数量',exact:true}).evaluate(e=>{const r=e.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth}),'hidden parameters can be reached by focus while material and submit stay reachable')
  await page.screenshot({path:join(output,'image-model-mobile-parameters.png'),fullPage:true})
  await page.setViewportSize({width:1440,height:960});await delay(200)
  const observer=await context.newPage();await observer.goto(page.url());await observer.getByText('此画布当前只读',{exact:true}).waitFor();await observer.locator('[data-card-id="m"]').press('Enter')
  const ro=observer.locator('.wb-details:not([hidden])');assert.ok(await ro.getByRole('button',{name:'预检运行',exact:true}).isDisabled());await observer.screenshot({path:join(output,'image-model-readonly.png'),fullPage:true});await observer.close()
  await open('unselected')
  await editor.getByRole('spinbutton',{name:'图片数量',exact:true}).waitFor({state:'hidden'})
  assert.equal(await editor.getByRole('combobox',{name:'图片画幅',exact:true}).count(),0,'no adapter capability does not fabricate parameter controls')
  assert.equal(await editor.getByRole('combobox',{name:'图片分辨率',exact:true}).count(),0)
  await page.screenshot({path:join(output,'image-model-unselected-parameters.png'),fullPage:true})
  writeFileSync(join(output,'manifest.json'),JSON.stringify(manifest,null,2));console.log('PASS C59 real image outputs/parameters/preview and F10–F12 threeviewports',output)
}catch(error){if(page)await page.screenshot({path:join(output,'failure.png'),fullPage:true});throw error}finally{await cleanup()}
