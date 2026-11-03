import { closeCanvasDetails, openCanvasCard } from './generationCanvasWorkbench.browser-helpers.mjs'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
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
  const canvas=await json('/api/v1/studio/generation-canvases/canvas-project','POST',{name:'参考来源统一'})
  const endpoint=`/api/v1/studio/generation-canvases/canvas-project/${canvas.id}`
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')
  const upload=async name=>{const form=new FormData();form.set('file',new Blob([Buffer.concat([png,Buffer.from(name)])],{type:'image/png'}),name);form.set('project_id','canvas-project');form.set('usage_kind','generation_upload');const response=await fetch(api+'/api/v1/studio/files/upload',{method:'POST',body:form});assert.ok(response.ok);return(await response.json()).data.id}
  const image=await upload('reference-main.png'),secondImage=await upload('reference-side.png')
  const kinds=['character','place','prop','costume']
  const cards=[...kinds.map(kind=>({id:kind,type:'reference.'+kind,name:'',angle:'正面'})),
    {id:'person',type:'content.character',object_id:'alice',name:'林夏',text:'不会传入参考的正文'},
    {id:'picture',type:'content.image',file_id:image},{id:'free',type:'content.image',file_id:secondImage},{id:'third',type:'content.image'},
    {id:'uploading',type:'content.image',file_id:image,uploading:true},
    {id:'named',type:'reference.character',name:'旧对象'},
    {id:'legacy-model',type:'reference.place',name:'保留旧模型图'},
    {id:'legacy-ref',type:'reference.prop',name:'保留旧参考图'},
    {id:'consumer',type:'model.image',model_id:'canvas-image-model',input_bindings:[{id:'keep-adoption',input_port:'image',source:{canvas_id:canvas.id,card_id:'legacy-model',port_id:'image',position:0}}]},
    {id:'model',type:'model.image',model_id:'canvas-image-model',prompt:{segments:[{id:'p',kind:'text',text:'生成旧图'}]},config:{count:3}}]
  const edges=[{id:'linked',source_card:'picture',source_port:'image',target_card:'character',target_port:'image_source'},
    {id:'name',source_card:'person',source_port:'object',target_card:'character',target_port:'name'},
    {id:'consumer',source_card:'legacy-model',source_port:'image',target_card:'consumer',target_port:'image'}]
  const initialDocument={...canvas.document,cards,edges,input_order:{character:{image_source:['linked'],name:['name']},consumer:{image:['consumer']}}}
  await json(endpoint,'PUT',{request_id:'seed',expected_revision:0,document:initialDocument})
  const preview=await json(endpoint+'/precheck','POST',{card_id:'model'})
  assert.ok(preview.can_run,JSON.stringify(preview.diagnostics))
  const accepted=await json(endpoint+'/runs','POST',{request_id:crypto.randomUUID(),preview_token:preview.preview_token})
  let produced
  for(let i=0;i<100;i++){const state=await json(endpoint+'/runtime');if(state.runs.some(run=>run.id===accepted.run_id&&run.nodes.every(node=>node.status==='succeeded'))){produced=state.current_outputs.model[1];break}await delay(100)}
  assert.ok(produced,'real model result is available, but cannot be newly selected by references')
  execFileSync(join(root,'../backend/.venv/bin/python'),['-c',`
import json,sqlite3,sys
with sqlite3.connect(sys.argv[1]) as db:
    document=json.loads(db.execute('SELECT document FROM generation_canvases WHERE id=?',(sys.argv[2],)).fetchone()[0])
    cards={card['id']:card for card in document['cards']}
    cards['character']['image_binding']={'file_id':sys.argv[3]}
    cards['named']['image_binding']={'file_id':sys.argv[4]}
    cards['legacy-model']['image_binding']=json.loads(sys.argv[5])
    cards['legacy-ref']['image_binding']={'file_id':sys.argv[3],'source':{'canvas_id':sys.argv[2],'card_id':'named','port_id':'image','position':0}}
    for key,source,target in [('old-model','model','legacy-model'),('old-ref','named','legacy-ref')]:
        document['edges'].append({'id':key,'source_card':source,'source_port':'image','target_card':target,'target_port':'image_source'})
        document['input_order'].setdefault(target,{})['image_source']=[key]
    db.execute('UPDATE generation_canvases SET document=? WHERE id=?',(json.dumps(document),sys.argv[2]))
`,join(output,'browser.sqlite'),canvas.id,image,secondImage,JSON.stringify({file_id:produced.file_id,source:produced.source,result_set_id:produced.result_set_id})])
  const layoutKey=`jellyfish:generation-layout:canvas-project:${canvas.id}:view:canvas`
  const positions=Object.fromEntries(cards.map((card,index)=>[card.id,{x:100+(index%4)*380,y:180+Math.floor(index/4)*320}]))
  await page.addInitScript(({layoutKey,positions})=>{if(!sessionStorage.getItem('seeded')){localStorage.setItem(layoutKey,JSON.stringify({schema:1,positions,sizes:{},transform:{x:0,y:0,scale:.8},manuallyPlaced:['character']}));sessionStorage.setItem('seeded','1')}},{layoutKey,positions})
  await page.goto(`http://127.0.0.1:4281/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const editor=page.locator('.wb-details:visible'),read=()=>json(endpoint)
  const poll=async predicate=>{for(let i=0;i<100;i++){const state=await read();if(predicate(state))return state;await delay(100)}throw Error('save not observed')}
  const open=async id=>{await closeCanvasDetails(page);await page.getByRole('button',{name:'适应全部',exact:true}).click();await openCanvasCard(page,id)}
  const field=()=>editor.getByRole('combobox',{name:'参考名称',exact:true})
  const setName=async name=>{await field().fill(name);await field().press('Enter');return poll(state=>state.document.cards.find(card=>card.id===kindBeingEdited).name===name)}
  let kindBeingEdited='character'
  const picker=page.getByRole('dialog',{name:'从当前画布选择参考图',exact:true})
  const choose=async id=>{await editor.getByRole('button',{name:/^(从当前画布选择|更换参考图)$/,exact:true}).click();await picker.waitFor();assert.equal(await picker.locator('[data-reference-source-card="model"],[data-reference-source-card="named"],[data-reference-source-card="uploading"]').count(),0);await picker.locator(`[data-reference-source-card="${id}"]`).click();await picker.waitFor({state:'hidden'})}
  let state=await poll(state=>!state.document.edges.some(edge=>['old-model','old-ref'].includes(edge.id)))
  assert.equal(state.document.cards.find(card=>card.id==='legacy-model').image_binding.file_id,produced.file_id)
  assert.equal(state.document.cards.find(card=>card.id==='legacy-model').image_binding.result_set_id,produced.result_set_id)
  assert.equal(state.document.cards.find(card=>card.id==='legacy-model').image_binding.source,null)
  assert.equal(state.document.cards.find(card=>card.id==='legacy-ref').image_binding.file_id,image)
  assert.equal(state.document.cards.find(card=>card.id==='consumer').input_bindings[0].source.card_id,'legacy-model')
  assert.ok((await json(endpoint+'/cards/consumer/compile')).can_run,'legacy downstream adoption remains usable')
  await open('character')
  assert.deepEqual(await editor.locator('.generation-attribute-label').allTextContents(),['参考名称 *','角度','关联图片'])
  assert.equal(await editor.locator('.generation-attribute-hint[role=alert]').first().textContent(),'请填写参考名称')
  assert.equal(await editor.locator('.generation-attribute .ant-select-selector').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(27, 27, 27)')
  assert.doesNotMatch(await editor.locator('.generation-material-footer').innerText(),/请填写参考名称/)
  await page.screenshot({path:join(output,'reference-attributes-desktop.png')})
  assert.equal(await editor.locator('input[type=file]').count(),0)
  assert.equal(await editor.getByRole('button',{name:/上传参考图|浏览并上传/}).count(),0)
  const pictureSelect=editor.getByRole('combobox',{name:'关联图片',exact:true})
  assert.equal(await pictureSelect.getAttribute('readonly'),'','picture select does not accept input')
  await pictureSelect.press('x');assert.equal(await pictureSelect.inputValue(),'')
  await pictureSelect.press('ArrowDown')
  const options=page.locator('.ant-select-dropdown:visible .ant-select-item-option')
  await options.first().locator('img').click()
  state=await poll(state=>state.document.cards.find(card=>card.id==='character').image_binding?.source?.card_id==='picture'&&state.document.cards.find(card=>card.id==='character').name)
  assert.ok(state.document.cards.find(card=>card.id==='character').name.startsWith('reference-main'))
  assert.equal(await editor.locator('.generation-reference-name .ant-select-arrow').count(),1,'name is a Select with an arrow')
  assert.ok(await field().getAttribute('aria-describedby'),'reference validation is associated with the field')
  await field().fill('自定义人物')
  assert.notEqual((await read()).document.cards.find(card=>card.id==='character').name,'自定义人物','typing does not prematurely save a custom choice')
  await field().press('Enter');await poll(state=>state.document.cards.find(card=>card.id==='character').name==='自定义人物')
  await field().fill('临时搜索');await field().press('Escape')
  assert.equal(await editor.isVisible(),true);assert.equal((await read()).document.cards.find(card=>card.id==='character').name,'自定义人物')
  await field().fill('林夏');await page.locator('.ant-select-dropdown:visible .ant-select-item-option').getByText('林夏',{exact:true}).click()
  await poll(state=>state.document.cards.find(card=>card.id==='character').name_binding?.card_id==='person')
  assert.equal(await field().isDisabled(),true)
  await choose('free')
  state=await poll(state=>state.document.cards.find(card=>card.id==='character').image_binding?.source?.card_id==='free')
  assert.equal(state.document.cards.find(card=>card.id==='character').name,'林夏')
  assert.equal(await editor.getByText('已关联',{exact:true}).count(),1)
  await editor.getByRole('button',{name:'取消名称关联',exact:true}).click();await poll(state=>!state.document.cards.find(card=>card.id==='character').name_binding)
  await setName('旧对象');await editor.getByText('同类型、同名称、同角度的参考已存在',{exact:false}).waitFor()
  const angle=editor.getByRole('combobox',{name:'参考角度',exact:true});await angle.fill('侧面');await angle.press('Enter')
  await poll(state=>state.document.cards.find(card=>card.id==='character').angle==='侧面')
  await setName('自定义人物')
  await editor.getByRole('button',{name:'移除参考图',exact:true}).click();await poll(state=>!state.document.cards.find(card=>card.id==='character').image_binding)
  await editor.getByRole('button',{name:'从当前画布选择',exact:true}).waitFor()
  assert.equal(await editor.getByText(/拖拽|浏览文件|从其他来源选择/).count(),0)
  await page.screenshot({path:join(output,'reference-canvas-only-empty.png')})
  // 文件导入仍在图片内容卡，参考卡只选择该卡的实际输出。
  await open('third')
  assert.equal(await editor.getByRole('button',{name:'上传图片',exact:true}).count(),1)
  assert.equal(await editor.getByRole('button',{name:'从素材中选择',exact:true}).count(),1)
  await editor.getByLabel('上传媒体文件',{exact:true}).setInputFiles({name:'third-new.png',mimeType:'image/png',buffer:Buffer.concat([png,Buffer.from('third')])})
  state=await poll(state=>state.document.cards.find(card=>card.id==='third').file_id)
  const thirdFile=state.document.cards.find(card=>card.id==='third').file_id
  await open('character');await choose('third');await poll(state=>state.document.cards.find(card=>card.id==='character').image_binding?.file_id===thirdFile)
  await open('third');await editor.getByRole('button',{name:'选择素材',exact:true}).click()
  const library=page.getByRole('dialog',{name:'项目文件库',exact:true});await library.getByRole('button',{name:'选用 reference-side',exact:true}).click();await library.waitFor({state:'hidden'})
  state=await poll(state=>state.document.cards.find(card=>card.id==='third').file_id===secondImage)
  assert.equal(state.document.cards.find(card=>card.id==='character').image_binding.file_id,thirdFile,'changing the picture card keeps the adopted fixed file')
  await open('character');await pictureSelect.press('ArrowDown');await options.nth(2).click()
  state=await poll(state=>state.document.cards.find(card=>card.id==='character').image_binding?.file_id===secondImage&&state.document.cards.find(card=>card.id==='character').image_binding?.source?.card_id==='third')
  for(const kind of ['place','prop','costume']){
    kindBeingEdited=kind;await open(kind)
    assert.equal(await editor.locator('input[type=file]').count(),0)
    assert.equal(await editor.getByRole('combobox',{name:'关联图片',exact:true}).getAttribute('readonly'),'')
    await setName('名称-'+kind);await choose('picture')
    await poll(state=>state.document.cards.find(card=>card.id===kind).image_binding?.source?.card_id==='picture')
    assert.equal(await editor.locator('.generation-reference-name .ant-select-arrow').count(),1)
  }
  await page.setViewportSize({width:390,height:844});await page.locator('.wb-details[aria-modal="true"]:visible').waitFor()
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  const footer=await editor.locator('.generation-material-footer').boundingBox();assert.ok(footer.y+footer.height<=844)
  await page.screenshot({path:join(output,'reference-canvas-only-mobile.png')})
  const longName='很长的场所名称'.repeat(18)
  kindBeingEdited='costume';await setName(longName)
  await field().focus();await editor.locator('.generation-attribute-control').first().hover()
  await page.getByRole('tooltip',{name:longName,exact:true}).waitFor()
  const tooltipBox=await page.getByRole('tooltip',{name:longName,exact:true}).boundingBox()
  assert.ok(tooltipBox.x>=0 && tooltipBox.x+tooltipBox.width<=390,'full name tooltip fits the narrow viewport')
  assert.ok((await editor.locator('.generation-attribute-control').first().boundingBox()).width<390,'long values do not widen narrow fields')
  await closeCanvasDetails(page);await open('person')
  const descriptionName=editor.getByRole('textbox',{name:'对象名称',exact:true})
  await descriptionName.fill(longName)
  assert.equal(await editor.locator('.generation-attribute-label').textContent(),'名称 *')
  assert.ok(await descriptionName.getAttribute('aria-describedby'))
  await descriptionName.press('Tab')
  assert.equal(await descriptionName.evaluate(el=>getComputedStyle(el).textOverflow),'ellipsis')
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  await page.screenshot({path:join(output,'description-attributes-mobile.png')})
  const cached=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),layoutKey)
  assert.deepEqual(cached.positions,positions);assert.deepEqual(cached.manuallyPlaced,['character'])
  console.log('PASS pure picture Select, custom name Select, canvas-only reference sources, legacy fixed files and adoption, conflict cleanup, picture import/library, four shared types and layout')
} catch(error){if(page)await page.screenshot({path:join(output,'failure.png'),fullPage:true});throw error}finally{await cleanup()}
