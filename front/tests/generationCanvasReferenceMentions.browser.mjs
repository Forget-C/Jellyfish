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
const output = await browserOutput('jellyfish-generation-canvas-images-')
const api = 'http://127.0.0.1:8633', base = `${api}/api/v1/studio/generation-canvases`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8633' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4633, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1920, height: 790 } })
  page = await context.newPage()
  page.setDefaultTimeout(12000)
  page.on('console', message => { if (message.type() === 'error') console.log('BROWSER ERROR', message.text()) })
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const request=async(path,method='GET',body)=>{
    const r=await fetch(api+path,{method,headers:{'Content-Type':'application/json'},body:body&&JSON.stringify(body)})
    assert.ok(r.ok,await r.clone().text());return (await r.json()).data
  }
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9v8AAAAASUVORK5CYII=','base64')
  const upload=async name=>{const form=new FormData();form.set('file',new Blob([Buffer.concat([png,Buffer.from(name)])],{type:'image/png'}),name);form.set('project_id','canvas-project');form.set('usage_kind','generation_upload');const r=await fetch(api+'/api/v1/studio/files/upload',{method:'POST',body:form});assert.ok(r.ok,await r.clone().text());return(await r.json()).data.id}
  const files=await Promise.all(['first.png','second.png','third.png'].map(upload))
  const results=[]
  const fixture=async(name,{refs=[{id:'ref',type:'reference.character',name:'张三',angle:'正面',image_binding:{file_id:files[0]}}],extra=[],modelType='model.image',bindings=[],segments=[],config={}}={})=>{
    const canvas=await request('/api/v1/studio/generation-canvases','POST',{name}),endpoint=`/api/v1/studio/generation-canvases/${canvas.id}`
    const referenceImages=refs.filter(ref=>ref.image_binding).map(ref=>({id:ref.id+'-image',type:'content.image',file_id:ref.image_binding.file_id}))
    const fixedRefs=refs.map(ref=>ref.image_binding?{...ref,image_binding:{...ref.image_binding,source:{canvas_id:canvas.id,card_id:ref.id+'-image',port_id:'image',position:0}}}:ref)
    const cards=[...fixedRefs,{id:'plain',type:'content.image',file_id:files[1]},...extra,{id:'model',type:modelType,model_id:modelType==='model.image'?'canvas-image-model':'canvas-subject-model',prompt:{segments},input_bindings:bindings.map(binding=>({...binding,source:{...binding.source,canvas_id:canvas.id}})),config}]
    const linked=[...refs,{id:'plain'}],edges=linked.map((ref,index)=>({id:'edge-'+index,source_card:ref.id,source_port:'image',target_card:'model',target_port:modelType==='model.video'?'first_frame':'image'}))
    const referenceEdges=referenceImages.map(image=>({id:'source-'+image.id,source_card:image.id,source_port:'image',target_card:image.id.slice(0,-6),target_port:'image_source'}))
    cards.push(...referenceImages)
    await request(endpoint,'PUT',{request_id:'seed',expected_revision:0,document:{...canvas.document,cards,edges:[...edges,...referenceEdges],input_order:{model:{[modelType==='model.video'?'first_frame':'image']:edges.map(edge=>edge.id)},...Object.fromEntries(referenceEdges.map(edge=>[edge.target_card,{image_source:[edge.id]}]))}}})
    const context=await browser.newContext({viewport:{width:1920,height:1000},reducedMotion:'reduce'});page=await context.newPage();page.setDefaultTimeout(8000)
    await page.addInitScript(({key,ids})=>{window.__ENV={BACKEND_URL:location.origin};if(!sessionStorage.getItem(key)){sessionStorage.setItem(key,'seeded');localStorage.setItem(key,JSON.stringify({schema:1,positions:Object.fromEntries(ids.map((id,i)=>[id,id==='model'?{x:400,y:250}:{x:1200+i*350,y:250}])),sizes:{},transform:{x:0,y:0,scale:.8}}))}},{key:`jellyfish:generation-layout::${canvas.id}:view:canvas`,ids:cards.map(card=>card.id)})
    await page.goto(`http://127.0.0.1:4633/canvases/${canvas.id}`)
    const card=page.locator('[data-card-id="model"]');await card.press('Enter')
    const editor=page.locator('.generation-card-editor:visible'),input=editor.getByRole('textbox',{name:'模型正文',exact:true});await input.waitFor()
    await editor.locator('.generation-material-reference > small').filter({hasText:/^@图片\d+$/}).first().waitFor();await page.getByRole('status',{name:'画布保存状态',exact:true}).filter({hasText:'已保存'}).waitFor()
    return {canvas,endpoint,context,card,editor,input,read:()=>request(endpoint),outputs:()=>request(endpoint+'/cards/model/outputs')}
  }
  const probe=async(name,run)=>{
    try{await run();results.push({name,status:'passed'})}
    catch(error){await page.screenshot({path:join(output,`failure-${results.length+1}.png`)});results.push({name,status:'failed',error:error.message})}
    console.log(JSON.stringify(results.at(-1)))
  }
  const saved=async predicate=>{for(let i=0;i<80;i++){if(await predicate())return;await delay(100)}throw Error('saved state not reached')}
  await probe('named reference labels keep source identity and unnamed image numbering',async()=>{
    const {editor,input,read}=await fixture('名称引用基础')
    assert.deepEqual(await editor.locator('.generation-material-reference > small').allTextContents(),['@张三','@图片2'])
    await input.fill('@张');const list=page.getByRole('listbox',{name:'引用候选',exact:true});await list.waitFor()
    await list.getByRole('option',{name:'@张三',exact:true}).click()
    assert.equal(await input.locator('.generation-prompt-token').innerText(),'@张三')
    await saved(async()=>{const card=(await read()).document.cards.find(card=>card.id==='model');return card.input_bindings?.[0]?.source.card_id==='ref'})
    const model=(await read()).document.cards.find(card=>card.id==='model')
    assert.equal(model.prompt.segments[0].kind,'reference');assert.equal(model.prompt.segments[0].binding_id,model.input_bindings[0].id)
  })
  await probe('same names use angle then type qualifiers only within the receiving model',async()=>{
    let f=await fixture('同名不同角度',{refs:[{id:'front',type:'reference.character',name:'张三',angle:'正面',image_binding:{file_id:files[0]}},{id:'side',type:'reference.character',name:'张三',angle:'侧面',image_binding:{file_id:files[2]}}],extra:[{id:'unconnected',type:'reference.character',name:'张三',angle:'背面'}]})
    assert.deepEqual(await f.editor.locator('.generation-material-reference > small').allTextContents(),['@张三（正面）','@张三（侧面）','@图片3'])
    f=await fixture('同名同角度不同类型',{refs:[{id:'person',type:'reference.character',name:'张三',angle:'正面',image_binding:{file_id:files[0]}},{id:'prop',type:'reference.prop',name:'张三',angle:'正面',image_binding:{file_id:files[2]}}]})
    assert.deepEqual(await f.editor.locator('.generation-material-reference > small').allTextContents(),['@张三（人物·正面）','@张三（道具·正面）','@图片3'])
  })
  await probe('numbered names stay qualified and unavailable connected names still disambiguate',async()=>{
    let f=await fixture('编号名称',{refs:[{id:'reserved',type:'reference.character',name:'图片2',angle:'正面',image_binding:{file_id:files[0]}}]})
    assert.deepEqual(await f.editor.locator('.generation-material-reference > small').allTextContents(),['@图片2（人物·正面）','@图片2'])
    f=await fixture('无对应编号的保留名称',{refs:[{id:'reserved-absent',type:'reference.prop',name:'音频99',angle:'正面',image_binding:{file_id:files[0]}}]})
    assert.deepEqual(await f.editor.locator('.generation-material-reference > small').allTextContents(),['@音频99（道具·正面）','@图片2'])
    f=await fixture('暂不可用同名来源',{refs:[{id:'ready',type:'reference.character',name:'张三',angle:'正面',image_binding:{file_id:files[0]}},{id:'missing',type:'reference.character',name:'张三',angle:'侧面'}]})
    assert.ok((await f.editor.locator('.generation-material-reference > small').allTextContents()).includes('@张三（正面）'))
  })
  await probe('candidate refresh keeps highlighted source and clears unavailable selection without sending',async()=>{
    const f=await fixture('候选身份刷新')
    let unavailable=false
    await page.route('**/cards/model/outputs?project_id=*',async route=>{
      const response=await route.fetch(),json=await response.json()
      json.data.candidates.reverse()
      if(unavailable) for(const item of json.data.candidates) if(item.source.card_id==='ref') item.available=false
      await route.fulfill({response,json})
    })
    let refreshed=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/cards/model/outputs')&&r.ok())
    await f.input.fill('@');await refreshed;await page.getByRole('listbox',{name:'引用候选',exact:true}).waitFor()
    const list=page.getByRole('listbox',{name:'引用候选',exact:true})
    assert.equal(await list.locator('[aria-selected="true"]').getAttribute('aria-label'),'@张三')
    unavailable=true;refreshed=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/cards/model/outputs')&&r.ok())
    await f.input.press('End');await f.input.press('@');await refreshed;await delay(150)
    assert.equal(await list.locator('[aria-selected="true"]').count(),0)
    await f.input.press('Enter');assert.equal(await f.input.innerText(),'@@')
    assert.equal(await list.isVisible(),true);assert.equal(await page.getByRole('region',{name:'运行预检',exact:true}).count(),0)
    await f.input.press('ArrowDown');assert.equal(await list.locator('[aria-selected="true"]').getAttribute('aria-label'),'@图片2')
  })
  await probe('renaming and collision changes update existing references without rebinding; clearing restores numbering',async()=>{
    const f=await fixture('改名同步',{refs:[{id:'front',type:'reference.character',name:'张三',angle:'正面',image_binding:{file_id:files[0]}},{id:'side',type:'reference.character',name:'李四',angle:'侧面',image_binding:{file_id:files[2]}}]})
    await f.input.fill('@张');await f.input.press('Enter')
    await saved(async()=>(await f.read()).document.cards.find(c=>c.id==='model').input_bindings?.length===1)
    const binding=(await f.read()).document.cards.find(c=>c.id==='model').input_bindings[0]
    const rename=async(id,name)=>{
      await page.locator('[data-card-id="'+id+'"]').press('Enter')
      const nameInput=page.getByRole('combobox',{name:'参考名称',exact:true})
      await nameInput.fill(name);await page.getByTitle('使用“'+name+'”',{exact:true}).click()
      await page.locator('[data-card-id="model"]').press('Enter');await f.input.waitFor()
      await saved(async()=>(await f.read()).document.cards.find(c=>c.id===id).name===name)
    }
    await rename('side','张三')
    assert.equal(await f.input.locator('.generation-prompt-token').innerText(),'@张三（正面）')
    await rename('side','李四')
    assert.equal(await f.input.locator('.generation-prompt-token').innerText(),'@张三')
    await rename('front','王五')
    assert.equal(await f.input.locator('.generation-prompt-token').innerText(),'@王五')
    assert.deepEqual((await f.read()).document.cards.find(c=>c.id==='model').input_bindings[0],binding)
    await page.locator('[data-card-id="front"]').press('Enter')
    await page.locator('.generation-card-editor:visible .ant-select-clear').first().click()
    await page.locator('[data-card-id="model"]').press('Enter')
    await saved(async()=>(await f.read()).document.cards.find(c=>c.id==='front').name==='')
    assert.equal(await f.input.locator('.generation-prompt-token').innerText(),'@图片1')
  })
  await probe('video models offer named references and plain names never auto-bind',async()=>{
    for(const modelType of ['model.video']){
      const f=await fixture('跨模型名称引用 '+modelType,{modelType})
      await f.input.fill('@张');await page.getByRole('listbox',{name:'引用候选',exact:true}).getByRole('option',{name:'@张三',exact:true}).click()
      assert.equal(await f.input.locator('.generation-prompt-token').innerText(),'@张三')
      if(modelType==='model.video') assert.match(await f.editor.getByRole('region',{name:'视频实际输入',exact:true,includeHidden:true}).textContent(),/@张三 · 候选/)
    }
    const f=await fixture('普通名称保留文本')
    await f.input.fill('@张三 ');await f.input.blur()
    await saved(async()=>(await f.read()).document.cards.find(c=>c.id==='model').prompt.segments.some(s=>s.kind==='text'&&s.text==='@张三 '))
    assert.equal((await f.read()).document.cards.find(c=>c.id==='model').input_bindings?.length||0,0)
    await f.input.fill('@图片1 ');await f.input.blur()
    await saved(async()=>(await f.read()).document.cards.find(c=>c.id==='model').input_bindings?.[0]?.source.card_id==='ref')
    assert.equal(await f.input.locator('.generation-prompt-token').innerText(),'@张三')
  })
  await probe('preflight maps named references to actual media without changing canonical input',async()=>{
    const f=await fixture('预检名称映射',{config:{count:3}})
    await f.input.fill('@张');await f.input.press('Enter')
    await f.editor.getByRole('button',{name:'预检运行',exact:true}).click()
    const preview=page.getByRole('dialog',{name:'运行预检',exact:true});await preview.waitFor()
    assert.match(await preview.textContent(),/@张三 → image 1/)
    const compiled=await request(f.endpoint+'/cards/model/compile')
    assert.equal(compiled.mapping.find(item=>item.token).token,'@图片1')
    assert.equal(compiled.mapping.find(item=>item.token).media_position,1)
    assert.equal(compiled.media[0].source.card_id,'ref')
    const accepted=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/runs')&&r.request().method()==='POST')
    await preview.getByRole('button',{name:'确认执行',exact:true}).click()
    const runId=(await(await accepted).json()).data.run_id
    await saved(async()=>(await request(f.endpoint+'/runtime')).runs.some(run=>run.id===runId&&run.nodes.every(node=>node.status==='succeeded')))
    await preview.waitFor({state:'hidden'})
    await page.waitForFunction(()=>![...document.querySelectorAll('.generation-card-editor')].some(element=>!element.hidden&&element.inert))
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    const historic=(await request(f.endpoint+'/runtime')).runs.find(run=>run.id===runId).nodes[0].basis
    await page.locator('[data-card-id="ref"]').press('Enter')
    await page.getByRole('combobox',{name:'参考名称',exact:true}).press('ArrowDown')
    await page.getByRole('combobox',{name:'参考名称',exact:true}).fill('王五')
    await page.getByTitle('使用“王五”',{exact:true}).click()
    await saved(async()=>(await f.read()).document.cards.find(c=>c.id==='ref').name==='王五')
    assert.deepEqual((await request(f.endpoint+'/runtime')).runs.find(run=>run.id===runId).nodes[0].basis,historic)
    await page.getByRole('button',{name:'运行历史',exact:true}).click()
    const history=page.getByLabel('画布运行历史',{exact:true});await history.locator('summary').first().click()
    await history.getByText('本次实际输入与模型参数',{exact:true}).click()
    assert.match(await history.getByLabel('历史实际输入',{exact:true}).textContent(),/张三/)
    assert.doesNotMatch(await history.getByLabel('历史实际输入',{exact:true}).textContent(),/王五/)

  })
  await probe('same type and angle retain original numbered suffix and generated labels remain unique',async()=>{
    const refs=['one','two'].map((id,index)=>({id,type:'reference.costume',name:'礼服',angle:'正面',image_binding:{file_id:files[index]}}))
    let f=await fixture('完整消歧',{refs,bindings:refs.map((ref,index)=>({id:'b'+index,source:{card_id:ref.id,port_id:'image',position:0},input_port:'image'})),segments:refs.map((_,index)=>({id:'p'+index,kind:'reference',binding_id:'b'+index}))})
    assert.deepEqual(await f.input.locator('.generation-prompt-token').allTextContents(),['@礼服（服装·正面·图片1）','@礼服（服装·正面·图片2）'])
    f=await fixture('名称包含消歧文本',{refs:[{id:'front',type:'reference.character',name:'张三',angle:'正面',image_binding:{file_id:files[0]}},{id:'side',type:'reference.character',name:'张三',angle:'侧面',image_binding:{file_id:files[2]}},{id:'literal',type:'reference.place',name:'张三（正面）',angle:'正面',image_binding:{file_id:files[1]}}]})
    assert.deepEqual(await f.editor.locator('.generation-material-reference > small').allTextContents(),['@张三（人物·正面）','@张三（人物·侧面）','@张三（正面）','@图片4'])
  })
  await probe('IME defers candidate refresh and preserves chip nodes, caret and saved content',async()=>{
    const f=await fixture('组合输入候选更新')
    let release,started
    const gate=new Promise(resolve=>{release=resolve}),pending=new Promise(resolve=>{started=resolve})
    await page.route('**/cards/model/outputs?project_id=*',async route=>{
      const response=await route.fetch(),json=await response.json();started();await gate
      for(const item of json.data.candidates) if(item.source.card_id==='ref') item.available=false
      await route.fulfill({response,json})
    })
    await f.input.fill('@张');await pending
    const list=page.getByRole('listbox',{name:'引用候选',exact:true})
    await f.input.dispatchEvent('compositionstart',{data:''})
    const caret=()=>f.input.evaluate(element=>{const s=getSelection();return {text:element.textContent,offset:s.anchorOffset,focus:s.focusOffset}})
    const before=await caret(),snapshot=await f.read()
    const response=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/cards/model/outputs')&&r.ok());release();await response;await delay(150)
    assert.equal(await list.getByRole('option',{name:'@张三',exact:true}).getAttribute('aria-selected'),'true')
    assert.equal(await list.getByRole('option',{name:'@张三',exact:true}).isDisabled(),false)
    assert.deepEqual(await caret(),before)
    await f.input.dispatchEvent('compositionend',{data:''});await delay(100)
    assert.equal(await list.getByRole('option',{name:'@张三',exact:true}).isDisabled(),true)
    assert.equal(await list.locator('[aria-selected="true"]').count(),0)
    assert.deepEqual(await caret(),before)
    const after=await f.read();assert.equal(after.revision,snapshot.revision);assert.deepEqual(after.document,snapshot.document)
  })
  await probe('exact canonical numbers win over reserved names and pasted qualified names remain text',async()=>{
    const f=await fixture('编号优先与粘贴名称',{refs:[{id:'reserved',type:'reference.character',name:'图片2',angle:'正面',image_binding:{file_id:files[0]}}]})
    await f.input.fill('@图片2');await f.input.press('Enter')
    await saved(async()=>(await f.read()).document.cards.find(c=>c.id==='model').input_bindings?.length===1)
    assert.equal((await f.read()).document.cards.find(c=>c.id==='model').input_bindings[0].source.card_id,'plain')
    await f.input.fill('');await f.input.evaluate(element=>{
      const clipboardData=new DataTransfer();clipboardData.setData('text/plain','@图片2（人物·正面）')
      element.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData}))
    });await f.input.blur()
    await saved(async()=>(await f.read()).document.cards.find(c=>c.id==='model').prompt.segments.some(s=>s.kind==='text'&&s.text==='@图片2（人物·正面）'))
    assert.equal((await f.read()).document.cards.find(c=>c.id==='model').input_bindings?.length||0,0)
  })
  await probe('terminal qualifier collisions still produce unique labels',async()=>{
    const refs=[{id:'one',type:'reference.character',name:'张三',angle:'正面',image_binding:{file_id:files[0]}},{id:'two',type:'reference.character',name:'张三',angle:'正面',image_binding:{file_id:files[2]}},{id:'literal',type:'reference.place',name:'张三（人物·正面·图片1）',angle:'正面',image_binding:{file_id:files[1]}}]
    const f=await fixture('终级消歧碰撞',{refs,bindings:refs.slice(0,2).map((ref,index)=>({id:'b'+index,source:{card_id:ref.id,port_id:'image',position:0},input_port:'image'})),segments:refs.slice(0,2).map((_,index)=>({id:'p'+index,kind:'reference',binding_id:'b'+index}))})
    const labels=await f.editor.locator('.generation-material-reference > small').allTextContents()
    assert.equal(new Set(labels).size,labels.length)
    assert.ok(labels.includes('@张三（人物·正面·图片1）（正面）'))
  })
  await probe('IME delimiter confirmation uses refreshed availability instead of frozen candidates',async()=>{
    const f=await fixture('组合输入结束确认')
    let release,started;const gate=new Promise(resolve=>{release=resolve}),pending=new Promise(resolve=>{started=resolve})
    await page.route('**/cards/model/outputs?project_id=*',async route=>{const response=await route.fetch(),json=await response.json();started();await gate;for(const item of json.data.candidates) if(item.source.card_id==='ref') item.available=false;await route.fulfill({response,json})})
    await f.input.dispatchEvent('compositionstart',{data:''});await f.input.fill('@图片1 ');await pending
    const refreshed=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/cards/model/outputs')&&r.ok());release();await refreshed;await delay(150)
    await f.input.dispatchEvent('compositionend',{data:' '});await delay(150)
    assert.equal(await f.input.locator('.generation-prompt-token').count(),0)
    assert.equal(await f.input.innerText(),'@图片1 ')
    await saved(async()=>(await f.read()).document.cards.find(c=>c.id==='model').prompt.segments.some(s=>s.kind==='text'&&s.text==='@图片1 '))
    assert.equal((await f.read()).document.cards.find(c=>c.id==='model').input_bindings?.length||0,0)
  })
  await probe('a highlighted candidate which stops matching never transfers Enter to another source',async()=>{
    const f=await fixture('候选不再匹配')
    await page.route('**/cards/model/outputs?project_id=*',async route=>{const response=await route.fetch(),json=await response.json();for(const item of json.data.candidates) if(item.source.card_id==='ref') item.token='@图片9';await route.fulfill({response,json})})
    const refreshed=page.waitForResponse(async r=>new URL(r.url()).pathname.endsWith('/cards/model/outputs')&&r.ok()&&(await r.json()).data.candidates.some(item=>item.token==='@图片9'))
    await f.input.fill('@图片1');await refreshed;await delay(150)
    const list=page.getByRole('listbox',{name:'引用候选',exact:true})
    await list.getByText('没有匹配候选，将保留为普通文本',{exact:true}).waitFor()
    assert.equal(await list.locator('[aria-selected="true"]').count(),0)
    await f.input.press('Enter');assert.equal(await f.input.innerText(),'@图片1')
    assert.equal(await list.isVisible(),true)
    assert.equal((await f.read()).document.cards.find(c=>c.id==='model').input_bindings?.length||0,0)
  })
  await probe('long reference names stay inside the candidate popup and editor',async()=>{
    const name='Z'.repeat(255),f=await fixture('长名称布局',{refs:[{id:'long',type:'reference.place',name,angle:'正面',image_binding:{file_id:files[0]}}]})
    await f.input.fill('@ZZZ');const option=page.getByRole('option',{name:'@'+name,exact:true});await option.waitFor()
    assert.equal(await option.evaluate(element=>element.scrollWidth<=element.clientWidth+1),true,'candidate label must not overflow its row')
    await option.click()
    assert.equal(await f.input.locator('.generation-prompt-token').innerText(),'@'+name)
    assert.equal(await f.input.evaluate(element=>element.scrollWidth<=element.clientWidth+1),true,'chip must not widen the text editor')
  })
  const paste=async(input,text,payload)=>input.evaluate((element,{text,payload})=>{
    element.focus();const selection=getSelection(),range=document.createRange();range.selectNodeContents(element);range.collapse(false);selection.removeAllRanges();selection.addRange(range)
    const clipboardData=new DataTransfer();clipboardData.setData('text/plain',text)
    if(payload)clipboardData.setData('application/x-jellyfish-prompt+json',JSON.stringify(payload))
    element.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData}))
  },{text,payload})
  await probe('plain pasted names containing canonical numbers never adopt the numbered image',async()=>{
    const f=await fixture('名称内含编号',{refs:[{id:'ref',type:'reference.character',name:'背景 @图片2',angle:'正面',image_binding:{file_id:files[0]}}]})
    const literal='前缀 @背景 @图片2 后缀'
    await paste(f.input,literal);await f.input.blur()
    assert.equal(await f.input.locator('.generation-prompt-token').count(),0)
    await saved(async()=>{const model=(await f.read()).document.cards.find(c=>c.id==='model');return !model.input_bindings.length&&model.prompt.segments.every(s=>s.kind==='text')&&model.prompt.segments.map(s=>s.text).join('')===literal})
    await page.reload();await f.card.press('Enter');await f.input.waitFor()
    assert.equal(await f.input.innerText(),literal);assert.equal(await f.input.locator('.generation-prompt-token').count(),0)
  })
  await probe('qualified names from other models stay literal while independent numbers still bind',async()=>{
    const f=await fixture('未关联限定名称'),literal='@图片2（人物·正面）'
    await paste(f.input,literal);await f.input.blur()
    assert.equal(await f.input.locator('.generation-prompt-token').count(),0)
    await saved(async()=>{const model=(await f.read()).document.cards.find(c=>c.id==='model');return !model.input_bindings.length&&model.prompt.segments.map(s=>s.text||'').join('')===literal})
    await f.input.fill('');await f.input.pressSequentially(literal+' ',{delay:1})
    assert.equal(await f.input.locator('.generation-prompt-token').count(),0)
    await f.input.fill('');await paste(f.input,'独立 @图片2 (说明)');await f.input.blur()
    await saved(async()=>(await f.read()).document.cards.find(c=>c.id==='model').input_bindings?.[0]?.source.card_id==='plain')
    assert.equal(await f.input.locator('.generation-prompt-token').innerText(),'@图片2')
  })
  await probe('typing and split-node paste preserve names containing numbered text',async()=>{
    const f=await fixture('名称连续输入',{refs:[{id:'ref',type:'reference.character',name:'背景 @图片2 补充',angle:'正面',image_binding:{file_id:files[0]}}]})
    await f.input.pressSequentially('@背景 @图片2 补充 ',{delay:1})
    assert.equal(await f.input.locator('.generation-prompt-token').count(),0)
    await f.input.fill('');await f.input.pressSequentially('@背景 ',{delay:1});await paste(f.input,'@图片2 补充');await f.input.blur()
    assert.equal(await f.input.locator('.generation-prompt-token').count(),0)
    await saved(async()=>{const model=(await f.read()).document.cards.find(c=>c.id==='model');return !model.input_bindings.length&&model.prompt.segments.map(s=>s.text||'').join('')==='@背景 @图片2 补充'})
    await f.input.press('End');await f.input.pressSequentially('，独立 @图片2 ',{delay:1});await f.input.blur()
    assert.equal(await f.input.locator('.generation-prompt-token').count(),1)
    await saved(async()=>(await f.read()).document.cards.find(c=>c.id==='model').input_bindings?.[0]?.source.card_id==='plain')
  })
  await probe('real cross-canvas copy retains its source without borrowing local names or identities',async()=>{
    const copy=async input=>input.evaluate(element=>{const selection=getSelection(),range=document.createRange();range.selectNodeContents(element);selection.removeAllRanges();selection.addRange(range);const clipboardData=new DataTransfer();element.dispatchEvent(new ClipboardEvent('copy',{bubbles:true,clipboardData}));return {text:clipboardData.getData('text/plain'),payload:JSON.parse(clipboardData.getData('application/x-jellyfish-prompt+json'))}})
    const origin=await fixture('原画布李四',{refs:[{id:'ref',type:'reference.character',name:'李四',angle:'正面',image_binding:{file_id:files[0]}}]})
    await origin.input.fill('@李');await origin.input.press('Enter')
    const copied=await copy(origin.input);assert.equal(copied.text,'@李四')
    const f=await fixture('目标画布张三');await paste(f.input,copied.text,copied.payload)
    await f.input.blur()
    const foreign = JSON.parse(await f.input.locator('.generation-prompt-token').getAttribute('data-segment'))
    assert.deepEqual(foreign.source,copied.payload.segments[0].source)
    await f.editor.getByRole('alert').filter({hasText:'来源属于其他画布'}).waitFor()
    assert.deepEqual(await f.editor.locator('.generation-material-reference > small').allTextContents(),['@张三','@图片2'])
    assert.equal((await f.read()).document.cards.find(c=>c.id==='model').input_bindings?.length||0,0)
    await f.editor.getByRole('button',{name:'取消编辑',exact:true}).click()
    await f.input.fill('@张');await f.input.press('Enter')
    await saved(async()=>{const bindings=(await f.read()).document.cards.find(c=>c.id==='model').input_bindings;return bindings.length===1&&bindings[0].source.canvas_id===f.canvas.id&&bindings[0].source.card_id==='ref'})
    await page.reload();await f.card.press('Enter');await f.input.waitFor()
    await saved(async()=>await f.input.locator('.generation-prompt-token').innerText()==='@张三')
    assert.equal(await f.input.locator('.generation-prompt-token').innerText(),'@张三')
  })
  await probe('association hover exposes complete disambiguation for truncated long names at desktop and narrow widths',async()=>{
    const name='同名参考卡可读性测试',f=await fixture('同名长名称悬停',{refs:[{id:'front',type:'reference.character',name,angle:'正面',image_binding:{file_id:files[0]}},{id:'side',type:'reference.character',name,angle:'侧面',image_binding:{file_id:files[0]}}]})
    const revision=(await f.read()).revision
    for(const width of [1920,390]){
      await page.setViewportSize({width,height:1000})
      for(const label of ['@同名参考卡可读性测试（正面）','@同名参考卡可读性测试（侧面）']){
        const button=f.editor.getByRole('button',{name:`${name} ${label} · 候选`,exact:true})
        await button.hover();assert.equal(await button.getAttribute('title'),`${name} ${label} · 候选`)
        assert.equal(await button.locator('small').evaluate(element=>element.scrollWidth>element.clientWidth),true)
      }
      assert.equal(await f.editor.getByRole('button',{name:'图片内容卡 @图片3 · 候选',exact:true}).count(),1,'ordinary media remains independently identified')
    }
    assert.equal((await f.read()).revision,revision,'viewing full display labels must not save canvas content')
  })
  await probe('bare canonical numbers retain priority over complete and unfinished reserved names',async()=>{
    for(const name of ['图片2','图片20','图片2 背景']){
      const f=await fixture('裸编号优先 '+name,{refs:[{id:'ref',type:'reference.character',name,angle:'正面',image_binding:{file_id:files[0]}}]})
      for(const literal of ['@图片2','@图片2 ']){
        await f.input.fill('');await paste(f.input,literal);await f.input.blur()
        assert.equal(await f.input.locator('.generation-prompt-token').count(),1)
        assert.equal(await f.input.locator('.generation-prompt-token').innerText(),'@图片2')
        await saved(async()=>{const bindings=(await f.read()).document.cards.find(c=>c.id==='model').input_bindings;return bindings.length===1&&bindings[0].source.card_id==='plain'})
      }
    }
  })
  writeFileSync(join(output,'audit.json'),JSON.stringify({results},null,2))
  assert.equal(results.filter(result=>result.status==='failed').length,0,JSON.stringify(results))
}finally{await cleanup()}
