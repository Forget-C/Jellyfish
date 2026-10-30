import { recordVisualState, writeVisualEvidence } from './visual-evidence-output.mjs'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import assert from 'node:assert/strict'
import { prepareCanvasCard, moveCanvasCard, clearCanvasNeighbors, pressCanvasControl, assertControlReachable, captureCanvasRegion, captureCanvasFailure } from './generationCanvasWorkbench.browser-helpers.mjs'
import { spawn, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url)), output = await browserOutput('jellyfish-c60-four-cards-')
const api = 'http://127.0.0.1:8460', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const sample = '清晨，林夏走过安静的街道，回头望向镜头。保持人物身份、自然步态与柔和侧光。'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_four_card_browser_server'], {cwd:join(root,'../backend'),env:{...process.env,PYTHONPATH:join(root,'../backend'),UV_CACHE_DIR:'/tmp/jellyfish-uv-cache',CANVAS_BROWSER_DATABASE:join(output,'browser.sqlite'),CANVAS_BROWSER_MEDIA_STORAGE:join(output,'media'),CANVAS_BROWSER_PORT:'8460'},stdio:['ignore','pipe','pipe']})
captureBackend(backend,output)
let server,browser,page
const cleanup=browserCleanup(()=>({browser,server,backend}))
const request=async(url,body,method='POST')=>{const r=await fetch(url,body?{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);assert.ok(r.ok,await r.clone().text());return(await r.json()).data}
const waitFor=async(fn,message)=>{for(let i=0;i<120;i++){if(await fn())return;await delay(100)}throw Error(message)}
try{
  await waitFor(async()=>{try{return(await fetch(base)).ok}catch{return false}},'isolated server ready')
  server=await createServer({root,cacheDir:join(output,'vite-cache'),server:{host:'127.0.0.1',port:4460,strictPort:true,proxy:{'/api':api}}});await server.listen()
  browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL})
  const context=await browser.newContext({viewport:{width:1440,height:960}});page=await context.newPage();page.setDefaultTimeout(8000)
  await context.addInitScript(()=>{window.__ENV={BACKEND_URL:window.location.origin}})
  const canvas=await request(base,{name:'四类C统一集成验收'})
  const textModel=(id,prompt='')=>({id,type:'model.text',model_id:'canvas-text-model',prompt:{segments:prompt?[{id:'p',kind:'text',text:prompt}]:[]}})
  const imageModel=(id,prompt='')=>({id,type:'model.image',model_id:'canvas-image-model',prompt:{segments:prompt?[{id:'p',kind:'text',text:prompt}]:[]},config:{count:3,target_ratio:'1:1',resolution_profile:'standard'}})
  const cards=[{id:'text',type:'content.text',text:''},{id:'image',type:'content.image'},textModel('model-text',sample),imageModel('model-image',sample),{id:'text-empty',type:'content.text',text:''},{id:'image-empty',type:'content.image'},textModel('model-text-empty'),imageModel('model-image-empty'),textModel('basis-no-output'),{...textModel('unselected'),model_id:null},{id:'person',type:'content.object',object_id:'linxia',name:'林夏',category:'character',text:'只用于对象描述的保密正文，不应跨级提交'}, {id:'reference',type:'reference.character',objects:[],input_bindings:[],angle:'正面'}]
  const edges=[{id:'tt',source_card:'text',source_port:'text',target_card:'model-text',target_port:'text'},{id:'ti',source_card:'text',source_port:'text',target_card:'model-image',target_port:'text'},{id:'ii',source_card:'image',source_port:'image',target_card:'model-image',target_port:'image'},{id:'tb',source_card:'text',source_port:'text',target_card:'basis-no-output',target_port:'text'},{id:'ri',source_card:'image',source_port:'image',target_card:'reference',target_port:'image_source'},{id:'rn',source_card:'person',source_port:'object',target_card:'reference',target_port:'name'},{id:'ref-model',source_card:'reference',source_port:'image',target_card:'model-image',target_port:'image'}]
  await request(`${base}/${canvas.id}`,{request_id:'seed',expected_revision:0,document:{...canvas.document,cards,edges,input_order:{'model-text':{text:['tt']},'model-image':{text:['ti'],image:['ii','ref-model']},'basis-no-output':{text:['tb']},reference:{name:['rn'],image_source:['ri']}}}},'PUT')
  const read=()=>request(`${base}/${canvas.id}`), runtime=()=>request(`${base}/${canvas.id}/runtime`)
  const controls=async()=>{const r=await fetch(`${api}/test/image-controls`);return r.json()}
  await page.goto(`http://127.0.0.1:4460/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const editor=page.locator('.generation-card-editor:visible')
  const close=async()=>{if(await editor.isVisible()){if(await editor.getByRole('button',{name:'收起详情',exact:true}).isVisible())await editor.getByRole('button',{name:'收起详情',exact:true}).click();await editor.getByRole('button',{name:'关闭详情',exact:true}).click()}}
  const move=(id,x,y)=>moveCanvasCard(page,id,x,y)
  const clearNeighbors=id=>clearCanvasNeighbors(page,id)
  const open=async id=>{await close();await prepareCanvasCard(page,id);await pressCanvasControl(page,page.locator(`[data-card-id="${id}"]`),'Enter');await editor.waitFor()}
  const captureCard=async(id,name)=>{const card=page.locator(`[data-card-id="${id}"]`);await assertControlReachable(card.getByRole('button',{name:/^移动布局：/}),'initial title');await captureCanvasRegion(page,card,join(output,name))}
  const saved=async()=>{await page.getByLabel('画布保存状态').getByText('已保存',{exact:true}).waitFor()}
  // Import and replace through visible actions before any model adopts these candidates.
  await open('text');const chooser=page.waitForEvent('filechooser');await editor.getByRole('button',{name:'导入文本',exact:true}).click();await(await chooser).setFiles({name:'街角创作笔记.md',mimeType:'text/markdown',buffer:Buffer.from(sample)});await waitFor(async()=>(await read()).document.cards.find(c=>c.id==='text').text===sample,'import saved');await saved();assert.equal((await read()).document.cards.find(c=>c.id==='text').text,sample)
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=slategray:s=320x180','-vf','drawbox=x=20:y=20:w=90:h=140:color=0xd3d3d3:t=fill,drawbox=x=160:y=60:w=120:h=80:color=0x404040:t=fill','-frames:v','1',join(output,'reference.png')])
  const picture={name:'街角参考.png',mimeType:'image/png',buffer:readFileSync(join(output,'reference.png'))}
  await open('image');const upload=page.waitForEvent('filechooser');await editor.getByRole('button',{name:'上传图片',exact:true}).click();await(await upload).setFiles(picture);await waitFor(async()=>(await read()).document.cards.find(c=>c.id==='image').file_id,'image upload saved')
  const oldFile=(await read()).document.cards.find(c=>c.id==='image').file_id
  const replace=page.waitForEvent('filechooser');await editor.getByRole('button',{name:'替换图片',exact:true}).click();await(await replace).setFiles({...picture,name:'街角参考-替换.png'});await waitFor(async()=>(await read()).document.cards.find(c=>c.id==='image').file_id!==oldFile,'replacement saved')
  assert.equal((await controls()).calls.length,0);assert.equal((await controls()).text_calls.length,0)
  const adopt=async(id,token)=>{await open(id);await editor.getByLabel('管理候选与采用',{exact:true}).click();if(id==='model-image')await editor.getByRole('region',{name:'已保存直接输入',exact:true}).getByRole('button',{name:`采用 ${token}`,exact:true}).click();else{await editor.locator('summary').filter({hasText:'＠ 引用与指令'}).click();await editor.getByRole('button',{name:token,exact:true}).click()}await editor.getByLabel('管理候选与采用',{exact:true}).press('Escape');await saved()}
  await adopt('model-text','@文本1');await adopt('model-image','@文本1');await adopt('model-image','@图片1')
  assert.equal((await read()).document.cards.find(c=>c.id==='model-image').input_bindings.length,2)
  assert.equal((await controls()).calls.length,0,'adoption never generates')
  const start=async id=>{await open(id);await editor.getByRole('button',{name:'预检运行',exact:true}).click();const preview=page.getByRole('dialog',{name:'运行预检',exact:true});await preview.waitFor();await preview.getByRole('button',{name:'确认执行',exact:true}).click();await waitFor(async()=>(await runtime()).current_outputs[id]?.length>0,`${id} formal output`);await preview.waitFor({state:'hidden'});await delay(200)}
  await start('model-text');await start('model-image');assert.equal((await controls()).text_calls.length,1);assert.equal((await controls()).calls.length,1)
  const outputs=(await runtime()).current_outputs;assert.equal(outputs['model-text'][0].text,sample);assert.equal(outputs['model-image'].length,3)
  const targets=process.env.C60_PROTOTYPE_MANIFEST?JSON.parse(readFileSync(process.env.C60_PROTOTYPE_MANIFEST,'utf8')):undefined
  const matrix=[]
  const captureBusinessState=async()=>({
    cards:(await read()).document.cards.map(({id,file_id,input_bindings,model_id})=>({id,file_id,input_bindings,model_id})),
    calls:{text:(await controls()).text_calls.length,image:(await controls()).calls.length},
  })
  const beforeEvidence=await captureBusinessState()

  const captureContexts={}
  const explicitScrollEvidence=[]
  const capture=async(f,kind,state,id)=>{
    await saved();await page.mouse.move(page.viewportSize().width-3,15)
    const {width,height}=page.viewportSize(),prefix=`${f}-${kind}-${state}-${width}x${height}`
    await assertControlReachable(editor.getByRole('button',{name:'关闭详情',exact:true}),'initial')
    await assertControlReachable(editor.getByRole('button',{name:state==='expanded'?'收起详情':'展开详情',exact:true}),'initial')
    captureContexts[prefix]=await captureCanvasRegion(page,editor,join(output,`${prefix}-editor.png`))
    await page.screenshot({path:join(output,`${prefix}-page.png`),fullPage:true})
    const target=targets?.groups.find(g=>g.id===f&&g.viewport.width===width)
    matrix.push({id:f,kind,state,viewport:{width,height},formal:{page:`${prefix}-page.png`,editor:`${prefix}-editor.png`,card:`${prefix}-card.png`},target:target||'Use retained C prototype manifest by matching F and viewport'})
    await recordVisualState(output,prefix,{viewport:page.viewportSize(),zoom:Number.parseFloat(await page.getByLabel('画布缩放比例').innerText())/100,card:(await read()).document.cards.find(c=>c.id===id),outputs:(await runtime()).current_outputs[id]||[],media:await editor.locator('img').evaluateAll(images=>images.map(image=>({src:image.getAttribute('src'),width:image.naturalWidth,height:image.naturalHeight})))})
    return prefix
  }
  for(const [width,height] of [[1440,960],[390,844],[3830,1688]]){
    await close();await page.setViewportSize({width,height});await delay(180)
    for(const [kind,id,empty,f1,f2,f3] of [['text','text','text-empty','F01','F02','F03'],['image','image','image-empty','F04','F05','F06'],['model-text','model-text','model-text-empty','F07','F08','F09'],['model-image','model-image','model-image-empty','F10','F11','F12']]){
      await open(id);const p1=await capture(f1,kind,'default',id)
      if(kind==='model-image'){
        // Verify permitted local scrolling explicitly, after retaining the untouched initial originals.
        const basis=editor.getByRole('region',{name:'本次创作依据',exact:true}), basisBox=await basis.boundingBox()
        await page.mouse.move(basisBox.x+basisBox.width/2,basisBox.y+basisBox.height/2);await page.mouse.wheel(0,500)
        await page.waitForFunction(element=>element.scrollTop>0,await basis.elementHandle())
        const source=await assertControlReachable(basis.getByText('查看来源',{exact:true}).last(),'after explicit material wheel')
        const remove=await assertControlReachable(basis.getByRole('button',{name:/^取消采用/}).last(),'after explicit material wheel')
        await captureCanvasRegion(page,editor,join(output,`${p1}-scrolled-source-editor.png`))
        explicitScrollEvidence.push({group:p1,source,remove,scroll:await basis.evaluate(element=>({top:element.scrollTop,height:element.clientHeight,total:element.scrollHeight}))})
        await page.mouse.move(basisBox.x+basisBox.width/2,basisBox.y+basisBox.height/2);await page.mouse.wheel(0,-500)
        await page.waitForFunction(element=>element.scrollTop===0,await basis.elementHandle())
        if(width===390){
          const parameters=editor.locator('.generation-material-parameters'), box=await parameters.boundingBox()
          await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(600,0)
          await pressCanvasControl(page,editor.getByRole('combobox',{name:'图片分辨率',exact:true}),'Tab')
          const quantity=await assertControlReachable(editor.getByRole('spinbutton',{name:'图片数量',exact:true}),'after explicit parameter wheel')
          assert.match(await editor.getByRole('spinbutton',{name:'图片数量',exact:true}).inputValue(),/3\s*张/)
          await assertControlReachable(editor.getByRole('button',{name:'预检运行',exact:true}),'fixed submit after parameter wheel')
          await assertControlReachable(editor.getByRole('button',{name:'关闭详情',exact:true}),'fixed close after parameter wheel')
          await captureCanvasRegion(page,editor,join(output,`${p1}-scrolled-parameters-editor.png`))
          explicitScrollEvidence.push({group:p1,action:'horizontal wheel plus explicit Tab from resolution to quantity',quantity,scroll:await parameters.evaluate(element=>({left:element.scrollLeft,width:element.clientWidth,total:element.scrollWidth}))})
          await page.keyboard.press('Shift+Tab');await page.keyboard.press('Shift+Tab');await page.keyboard.press('Shift+Tab')
          await assertControlReachable(editor.getByRole('combobox',{name:'选择模型',exact:true}),'after keyboard return to first parameter')
        }
      }
      await editor.getByRole('button',{name:'展开详情',exact:true}).click();const p2=await capture(f2,kind,'expanded',id)
      await close();await prepareCanvasCard(page,id);await captureCard(id,`${p1}-card.png`);await captureCard(id,`${p2}-card.png`)
      await open(empty);const p3=await capture(f3,kind,'empty',empty);if(kind.startsWith('model'))assert.ok(await editor.getByRole('button',{name:'预检运行',exact:true}).isDisabled());await close();await prepareCanvasCard(page,empty);await captureCard(empty,`${p3}-card.png`)
    }
  }
  assert.deepEqual(await captureBusinessState(),beforeEvidence,'capturing the matrix does not adopt candidates, replace media or execute a model')
  writeFileSync(join(output,'explicit-scroll-evidence.json'),JSON.stringify(explicitScrollEvidence,null,2))
  writeFileSync(join(output,'matrix.json'),JSON.stringify(matrix,null,2))
  writeFileSync(join(output,'capture-contexts.json'),JSON.stringify(captureContexts,null,2))
  // No-output-with-basis and unselected-model are separate states, never a substitute for ready.
  await page.setViewportSize({width:1440,height:960});await adopt('basis-no-output','@文本1');await open('basis-no-output');await page.screenshot({path:join(output,'text-model-basis-no-output.png'),fullPage:true});assert.equal((await runtime()).current_outputs['basis-no-output'],undefined)
  await open('unselected');await page.screenshot({path:join(output,'text-model-unselected.png'),fullPage:true})
  // Bind a name and image, then explicitly adopt at the model: mapping is one-level only.
  await open('reference');await editor.getByRole('button',{name:'关联名称 林夏',exact:true}).click();await saved();await editor.getByRole('button',{name:'选为主图 @图片1',exact:true}).click();await saved()
  await adopt('model-image','@图片2');await open('model-image');await editor.getByRole('button',{name:'预检运行',exact:true}).click();const precheck=page.getByRole('dialog',{name:'运行预检',exact:true});await precheck.waitFor();const compiled=await precheck.getByRole('region',{name:'实际提交文本',exact:true}).textContent();assert.match(compiled,/林夏 = image 2/);assert.doesNotMatch(compiled,/保密正文/);await precheck.getByRole('button',{name:'确认执行',exact:true}).click();await waitFor(async()=>(await controls()).calls.length===2,'named image submitted');assert.equal((await controls()).text_calls.length,1,'only current image model runs')
  await waitFor(async()=>(await runtime()).runs.every(r=>r.nodes.every(n=>['succeeded','failed','cancelled','abandoned'].includes(n.status))),'runs settled')
  // Saving a cycle is rejected at the same public seam, without mutating the document.
  const state=await read();const cyclic={...state.document,edges:[...state.document.edges,{id:'cycle',source_card:'model-image',source_port:'image',target_card:'reference',target_port:'image_source'}]};const cycle=await fetch(`${base}/${canvas.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:'cycle',expected_revision:state.revision,document:cyclic})});assert.ok(cycle.status>=400);assert.match(await cycle.text(),/GRAPH_CYCLE/);assert.equal((await read()).revision,state.revision)
  await close();await page.getByRole('button',{name:'运行历史',exact:true}).click();await page.getByRole('region',{name:'画布运行历史',exact:true}).waitFor();await page.screenshot({path:join(output,'integrated-history.png'),fullPage:true});await page.getByRole('button',{name:'运行历史',exact:true}).click();await page.reload();await open('model-image');assert.equal((await read()).document.cards.find(c=>c.id==='model-image').input_bindings.length,3);assert.equal((await runtime()).current_outputs['model-text'][0].text,sample)
  // The same four retained editors must remain usable near each persistent toolbar.
  const exercise=async(id,action)=>{if(id==='text'||id==='image'){const choosing=page.waitForEvent('filechooser');await action.click();await(await choosing).setFiles([])}else{await action.press('Enter');await editor.getByRole('region',{name:'已保存直接输入',exact:true}).waitFor();await action.press('Escape')}await pressCanvasControl(page,editor.getByRole('button',{name:'关闭详情',exact:true}),'Tab');assert.equal(await editor.isVisible(),true)}
  const edgesEvidence=[]
  for(const id of ['text','image','model-text','model-image']){
    for(const edge of ['left','right','bottom']){
      await close();await move(id,edge==='left'?20:edge==='right'?1100:200,edge==='bottom'?820:210);await clearNeighbors(id)
      const positionBeforeOpen=await page.locator(`[data-card-id="${id}"]`).boundingBox()
      await pressCanvasControl(page,page.locator(`[data-card-id="${id}"]`),'Enter');await editor.waitFor();await delay(200)
      const positionAfterOpen=await page.locator(`[data-card-id="${id}"]`).boundingBox()
      const action=id==='text'?editor.getByRole('button',{name:'导入文本',exact:true}):id==='image'?editor.getByRole('button',{name:'替换图片',exact:true}):editor.getByLabel('管理候选与采用',{exact:true})
      const initialHit=await assertControlReachable(action,'initial');await exercise(id,action);await editor.getByRole('button',{name:'展开详情',exact:true}).click({trial:true});await page.screenshot({path:join(output,`${id}-${edge}-default.png`),fullPage:true})
      await editor.getByRole('button',{name:'展开详情',exact:true}).click();const expandedHit=await assertControlReachable(action,'initial expanded');await exercise(id,action);await page.screenshot({path:join(output,`${id}-${edge}-expanded.png`),fullPage:true});edgesEvidence.push({id,edge,positionBeforeOpen,positionAfterOpen,initialHit,expandedHit,action:'real file-picker cancel or material Enter/Escape, default/expanded'})
    }
  }
  writeFileSync(join(output,'edge-evidence.json'),JSON.stringify(edgesEvidence,null,2));writeFileSync(join(output,'final-document.json'),JSON.stringify(await read(),null,2));await writeVisualEvidence(output,{behavior:'passed',manifest:process.env.C60_PROTOTYPE_MANIFEST,browserVersion:browser.version()});console.log('C60 behavior assertions passed: same-canvas four-card F01–F12/three-viewports, real import/replace/adopt/generate/mapping/history/reopen and edge interaction',output)
}catch(error){if(!error.evidenceFailure)await writeVisualEvidence(output,{behavior:'failed',manifest:process.env.C60_PROTOTYPE_MANIFEST,browserVersion:browser?.version()}).catch(summaryError=>console.error('evidence summary unavailable:',summaryError.message));if(page)await captureCanvasFailure(page,output,error);throw error}finally{await cleanup()}
