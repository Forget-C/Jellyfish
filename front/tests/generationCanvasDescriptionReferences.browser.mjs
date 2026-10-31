import { closeCanvasDetails, openCanvasCard, connectCanvasCards } from './generationCanvasWorkbench.browser-helpers.mjs'
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
const output = await browserOutput('jellyfish-generation-canvas-descriptions-')
const api = 'http://127.0.0.1:8623', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8623' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4623, strictPort: true, open: false, proxy: { '/api': api } } })
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
  const canvas = await json('/api/v1/studio/generation-canvases/canvas-project','POST',{name:'四类描述与参考关联'})
  const endpoint=`/api/v1/studio/generation-canvases/canvas-project/${canvas.id}`
  const kinds=['character','place','prop','costume']
  const cards=[...kinds.map(kind=>({id:'d-'+kind,type:kind==='place'?'content.place':'content.object',category:kind,object_id:'entity-'+kind,name:'名称-'+kind,text:'保密正文-'+kind})),
    ...kinds.map(kind=>({id:'r-'+kind,type:'reference.'+kind,name:'',angle:'正面'})),
    {id:'side',type:'reference.character',name:'',angle:'正面'},
    {id:'basis',type:'content.basis',text:'保留原文依据',source_locator:'第3章'}]
  const edges=[...kinds.map(kind=>({id:'name-'+kind,source_card:'d-'+kind,source_port:'object',target_card:'r-'+kind,target_port:'name'})),
    {id:'side-name',source_card:'d-character',source_port:'object',target_card:'side',target_port:'name'}]
  const initialEdges=edges.filter(edge=>edge.id!=='name-character')
  const orders=Object.fromEntries(initialEdges.map(edge=>[edge.target_card,{name:[edge.id]}]))
  await json(endpoint,'PUT',{request_id:'seed',expected_revision:0,document:{...canvas.document,cards,edges:initialEdges,input_order:orders}})
  // 重现旧规则下已保存的跨类候选，仅修改本用例的隔离数据库。
  execFileSync(join(root,'../backend/.venv/bin/python'),['-c',`
import json,sqlite3,sys
with sqlite3.connect(sys.argv[1]) as db:
    document=json.loads(db.execute('SELECT document FROM generation_canvases WHERE id=?',(sys.argv[2],)).fetchone()[0])
    document['edges'].append({'id':'legacy-image','source_card':'r-prop','source_port':'image','target_card':'r-character','target_port':'image_source'})
    document['input_order'].setdefault('r-character',{})['image_source']=['legacy-image']
    db.execute('UPDATE generation_canvases SET document=? WHERE id=?',(json.dumps(document),sys.argv[2]))
`,join(output,'browser.sqlite'),canvas.id])
  const layoutKey=`jellyfish:generation-layout:canvas-project:${canvas.id}:view:canvas`
  const positions=Object.fromEntries(cards.map((card,index)=>[card.id,{x:80+(index%4)*380,y:140+Math.floor(index/4)*320}]))
  await page.addInitScript(({layoutKey,positions})=>{if(!sessionStorage.getItem('seeded')){localStorage.setItem(layoutKey,JSON.stringify({schema:1,positions,sizes:{'d-costume':{width:440,height:204}},transform:{x:0,y:0,scale:.8},manuallyPlaced:['d-character']}));sessionStorage.setItem('seeded','1')}},{layoutKey,positions})
  await page.goto(`http://127.0.0.1:4623/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  await page.locator('[data-card-id="basis"]').waitFor()
  writeFileSync(join(output,'description-geometry.json'),JSON.stringify(await page.locator('[data-card-type^="content."]').evaluateAll(cards=>cards.filter(card=>['content.character','content.place','content.prop','content.costume'].includes(card.dataset.cardType)).map(card=>({id:card.dataset.cardId,width:card.offsetWidth,height:card.offsetHeight,bodyHeight:card.querySelector('.generation-card-body').offsetHeight}))),null,2))
  const geometry=await page.locator('[data-card-type^="content."]').evaluateAll(cards=>cards.filter(card=>['content.character','content.place','content.prop','content.costume'].includes(card.dataset.cardType)).map(card=>({id:card.dataset.cardId,width:card.offsetWidth,height:card.offsetHeight})))
  for(const item of geometry)assert.deepEqual({width:item.width,height:item.height},item.id==='d-costume'?{width:440,height:204}:{width:400,height:172},'description size remains unchanged')
  assert.deepEqual(await page.locator('[data-card-id="r-character"]').evaluate(card=>({width:card.offsetWidth,height:card.offsetHeight})),{width:300,height:251},'reference geometry remains independent')
  const editor=page.locator('.wb-details:visible')
  const read=()=>json(endpoint)
  const poll=async predicate=>{for(let i=0;i<100;i++){const state=await read();if(predicate(state))return state;await delay(100)}throw Error('saved state not reached')}
  const open=async id=>{await closeCanvasDetails(page);await page.getByRole('button',{name:'适应全部',exact:true}).click();await openCanvasCard(page,id)}
  const outputs=async id=>(await json(endpoint+`/cards/${id}/outputs`)).outputs
  const nameField=()=>editor.getByRole('combobox',{name:'参考名称',exact:true})
  await connectCanvasCards(page,'d-character','r-character','名称关联')
  await poll(state=>state.document.edges.some(edge=>edge.source_card==='d-character'&&edge.target_card==='r-character'&&edge.target_port==='name'))
  assert.equal((await read()).document.edges.some(edge=>edge.id==='legacy-image'),false,'conflicting legacy image candidate is removed without blocking the name connection')

  for(const kind of kinds){
    assert.equal((await read()).document.cards.find(card=>card.id==='d-'+kind).type,'content.'+kind)
    await open('d-'+kind)
    assert.equal(await editor.getByRole('textbox').count(),2,'description editor has only name and text')
    assert.equal(await editor.getByRole('combobox').count(),0,'no mutable category selector')
    assert.equal(await editor.getByRole('textbox',{name:'对象描述正文',exact:true}).evaluate(field=>getComputedStyle(field).backgroundColor),'rgba(0, 0, 0, 0)','description body shares the borderless composer surface')
    assert.equal(await editor.getAttribute('data-material'),'true','description uses shared compact editor')
    assert.equal(await editor.getByRole('heading').count(),0)
    assert.equal(await editor.getByRole('button',{name:'关闭详情',exact:true}).count(),0)
    assert.equal(await editor.getByRole('button',{name:'预检运行',exact:true}).count(),0)
    const nameBox=await editor.getByRole('textbox',{name:'对象名称',exact:true}).boundingBox()
    const textBox=await editor.getByRole('textbox',{name:'对象描述正文',exact:true}).boundingBox()
    const statusBox=await editor.locator('.generation-material-footer').boundingBox()
    assert.ok(nameBox.y+nameBox.height<=textBox.y&&textBox.y+textBox.height<=statusBox.y+1,'name, body and fixed status are separate regions')

    assert.equal(await editor.getByLabel('描述来源定位',{exact:true}).count(),0)
    await open('r-'+kind)
    await nameField().fill('名称')
    const option=page.locator('.ant-select-dropdown:visible .ant-select-item-option')
    await option.first().waitFor()
    await option.first().click()
    await poll(state=>state.document.cards.find(card=>card.id==='r-'+kind).name_binding?.card_id==='d-'+kind)
    assert.equal(await nameField().isDisabled(),true)
    const nameEdge=(await read()).document.edges.find(edge=>edge.source_card==='d-'+kind&&edge.target_card==='r-'+kind&&edge.target_port==='name')
    assert.equal(await page.locator(`[data-generation-edge-id="${nameEdge.id}"] .generation-edge-adopted`).count(),1,'selected name is shown as an adopted edge')
    const candidateState=await json(endpoint+`/cards/r-${kind}/outputs`)
    assert.deepEqual(candidateState.candidates.map(item=>item.source.card_id),['d-'+kind])
    const result=candidateState.outputs
    assert.equal(result[0].payload.object_id,'entity-'+kind)
    assert.equal(result[0].payload.category,kind)
    assert.ok(!JSON.stringify(result).includes('保密正文'))
  }
  await open('side');await nameField().fill('名称');await page.locator('.ant-select-dropdown:visible .ant-select-item-option').first().click()
  await poll(state=>state.document.cards.find(card=>card.id==='side').name_binding)
  await editor.getByText('同类型、同名称、同角度的参考已存在',{exact:false}).waitFor()
  assert.deepEqual(await outputs('r-character'),[])
  const angle=editor.getByRole('combobox',{name:'参考角度',exact:true})
  await angle.fill('侧面');await angle.press('Enter')
  await poll(state=>state.document.cards.find(card=>card.id==='side').angle==='侧面')
  assert.equal((await outputs('side'))[0].payload.object_id,(await outputs('r-character'))[0].payload.object_id)
  await open('d-character')
  const longText='很长的描述正文，用于确认只滚动内容区。\n'.repeat(180)
  const descriptionText=editor.getByRole('textbox',{name:'对象描述正文',exact:true})
  await descriptionText.fill(longText)
  await poll(state=>state.document.cards.find(card=>card.id==='d-character').text===longText)
  assert.equal(await descriptionText.evaluate(field=>field.scrollHeight>field.clientHeight),true)
  assert.equal(await editor.locator('.wb-details-body').evaluate(body=>body.scrollHeight<=body.clientHeight+1),true,'long description does not scroll the editor shell')
  await editor.getByRole('button',{name:'展开详情',exact:true}).click()
  await page.locator('.wb-details[aria-modal="true"]:visible').waitFor()
  assert.equal(await descriptionText.inputValue(),longText)
  await page.screenshot({path:join(output,'description-expanded.png')})
  await editor.getByRole('button',{name:'收起详情',exact:true}).click()
  await page.locator('.wb-details:not([aria-modal]):visible').waitFor()
  await page.screenshot({path:join(output,'description-compact.png')})
  await editor.getByRole('textbox',{name:'对象名称',exact:true}).fill('林夏')
  await editor.getByRole('textbox',{name:'对象描述正文',exact:true}).fill('新的保密正文')
  await poll(state=>state.document.cards.find(card=>card.id==='side').name==='林夏')
  await open('r-character');assert.equal(await editor.locator('.generation-reference-name .ant-select-selection-item').innerText(),'林夏')
  assert.equal(await editor.getByText('新的保密正文',{exact:false}).count(),0)
  await page.screenshot({path:join(output,'description-reference-linked-desktop.png')})
  await editor.getByRole('button',{name:'取消名称关联',exact:true}).click()
  await poll(state=>!state.document.cards.find(card=>card.id==='r-character').name_binding)
  await nameField().fill('独立人物');await nameField().press('Enter')
  await poll(state=>state.document.cards.find(card=>card.id==='r-character').name==='独立人物')
  assert.equal((await outputs('r-character'))[0].payload.object_id,'r-character')
  const current=await read()
  current.document.cards.push({id:'performance',type:'direction.performance',input_bindings:[{id:'use-side',input_port:'participant',source:{canvas_id:canvas.id,card_id:'side',port_id:'object',position:0,object_id:'entity-character'}}]})
  current.document.edges.push({id:'performance-edge',source_card:'side',source_port:'object',target_card:'performance',target_port:'participant'})
  current.document.input_order.performance={participant:['performance-edge']}
  await json(endpoint,'PUT',{request_id:'adopt',expected_revision:current.revision,document:current.document})
  await page.reload();await open('side')
  await editor.getByRole('button',{name:'取消名称关联',exact:true}).click()
  await editor.getByText('请先取消下游采用，再切换或取消名称关联',{exact:false}).waitFor()
  assert.ok((await read()).document.cards.find(card=>card.id==='side').name_binding)
  await closeCanvasDetails(page)
  await page.locator('[data-generation-edge-id="side-name"]').getByRole('button').press('Enter')
  await page.getByRole('button',{name:'删除此候选连接',exact:true}).click()
  await page.getByRole('status').filter({hasText:'先取消'}).waitFor()
  assert.ok((await read()).document.edges.some(edge=>edge.id==='side-name'))
  await open('basis');assert.equal(await editor.getByRole('textbox',{name:'卡片文本',exact:true}).count()>0||await editor.getByRole('textbox').count()>0,true)
  await open('side');await page.setViewportSize({width:390,height:844})
  await page.locator('.wb-details[aria-modal="true"]:visible').waitFor()
  assert.equal(await editor.locator('.generation-reference-name .ant-select-selection-item').innerText(),'林夏')
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  const footer=await editor.locator('.generation-material-footer').boundingBox();assert.ok(footer.y+footer.height<=844)
  await page.screenshot({path:join(output,'description-reference-mobile.png')})
  await open('d-character')
  await page.locator('.wb-details[aria-modal="true"]:visible').waitFor()
  assert.equal(await editor.getByRole('textbox',{name:'对象名称',exact:true}).inputValue(),'林夏')
  assert.equal(await editor.getByRole('textbox',{name:'对象描述正文',exact:true}).inputValue(),'新的保密正文')
  const descriptionFooter=await editor.locator('.generation-material-footer').boundingBox()
  assert.ok(descriptionFooter.y+descriptionFooter.height<=844)
  assert.equal(await editor.locator('.wb-details-body').evaluate(body=>body.scrollHeight<=body.clientHeight+1),true)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  await page.screenshot({path:join(output,'description-mobile.png')})
  const cached=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),layoutKey)
  assert.deepEqual(cached.sizes['d-costume'],{width:440,height:204})
  for(const id of Object.keys(positions))assert.deepEqual(cached.positions[id],positions[id])
  console.log('PASS four shared description editors, legacy migration, selected same-type names, shared multi-angle identity, live rename, independent names, adoption protection, basis and layout')
} catch(error) { if(page)await page.screenshot({path:join(output,'failure.png'),fullPage:true});throw error } finally {await cleanup()}
