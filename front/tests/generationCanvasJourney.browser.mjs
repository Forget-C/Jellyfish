import { openCardList, closeCardList, openCanvasManagement, closePrecheck, openCanvasCard, closeCanvasDetails } from './generationCanvasWorkbench.browser-helpers.mjs'
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
const output = await browserOutput('jellyfish-generation-canvas-journey-')
const api = 'http://127.0.0.1:8303', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8303' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4303, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'B素材编排完整旅程' }) })).json()).data
  await page.route('**/catalog', route => route.abort())
  await page.goto(`http://127.0.0.1:4303/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  await page.getByRole('alert').filter({ hasText: '卡片目录读取失败' }).waitFor()
  await page.unroute('**/catalog')
  await page.getByRole('button', { name: '重试卡片目录', exact: true }).click()
  await openCardList(page, '表演与调度')
  await page.getByRole('button', { name: '添加人物表演卡', exact: true }).waitFor()
  const catalog=(await (await fetch(`${base}/${canvas.id}/catalog`)).json()).data
  writeFileSync(join(output,'catalog.json'),JSON.stringify(catalog,null,2))
  assert.equal(catalog.cards.reduce((count,card)=>count+(card.entries.length||1),0),39)
  let entryCount = 0
  for (const category of ['基础卡', '参考卡', '模型生成', '画面设计', '表演与调度', '叙事与镜头', '声音设计', '连续性与约束']) {
    await openCardList(page, category)
    entryCount += await page.getByRole('navigation', { name: '添加卡片', exact: true }).getByRole('button', { name: /^添加/ }).count()
  }
  assert.equal(entryCount, 39)
  await closeCardList(page)
  const source = {canvas_id:canvas.id,card_id:'person',port_id:'object',position:0,object_id:'alice'}
  const document = {...canvas.document,cards:[{id:'person',type:'content.object',object_id:'alice',name:'小雪',text:'仅模型直接采用的外貌'},
    {id:'performance',type:'direction.performance',physical_action:{state:'proposal',text:'伸手'},input_bindings:[{id:'actor',source,input_port:'participant'}]}],
    edges:[{id:'actor-edge',source_card:'person',source_port:'object',target_card:'performance',target_port:'participant'},{id:'unused-edge',source_card:'person',source_port:'object',target_card:'performance',target_port:'effect_object'}],
    input_order:{performance:{participant:['actor-edge'],effect_object:['unused-edge']}}}
  const seeded=await fetch(`${base}/${canvas.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:'seed-delete',expected_revision:0,document})})
  assert.ok(seeded.ok,await seeded.text())
  await page.reload()
  await openCanvasCard(page, 'performance')
  await page.getByText('候选连接管理',{exact:true}).click()
  await page.getByRole('button',{name:'断开连接 unused-edge',exact:true}).click()
  for(let i=0;i<30;i++) {
    const state=(await (await fetch(`${base}/${canvas.id}`)).json()).data
    if(!state.document.edges.some(edge=>edge.id==='unused-edge'))break
    if(i===29)throw Error('pure candidate edge was blocked by another adopted input purpose')
    await delay(100)
  }
  const current=(await (await fetch(`${base}/${canvas.id}`)).json()).data
  assert.ok(current.document.edges.some(edge=>edge.id==='actor-edge'))
  assert.equal(current.document.cards[1].input_bindings.length,1)
  await page.getByRole('button',{name:'关闭详情',exact:true}).click()
  await page.getByRole('button',{name:'返回项目',exact:true}).click()
  await page.getByRole('tab',{name:/画布生成/}).click()
  await page.getByRole('button',{name:'画布管理',exact:true}).click()
  await page.getByRole('button',{name:'新建画布',exact:true}).click()
  await page.getByRole('button',{name:'画布管理',exact:true}).click()
  await openCardList(page)
  await page.getByRole('button',{name:'添加文本卡',exact:true}).waitFor()
  const journeyId=new URL(page.url()).searchParams.get('canvas')
  assert.notEqual(journeyId,canvas.id)
  const read=async()=>(await (await fetch(`${base}/${journeyId}`)).json()).data
  const poll=async predicate=>{for(let i=0;i<80;i++){const state=await read();if(predicate(state))return state;await delay(150)}throw Error('journey saved state did not match')}
  const detail=page.locator('.wb-details:not([hidden])')
  const open=async id=>openCanvasCard(page,id)
  const add=async(label,type)=>{
    await openCardList(page, type.startsWith('model.') ? '模型生成' : type.startsWith('reference.') ? '参考卡' : ['direction.photography','direction.style'].includes(type) ? '画面设计' : type === 'direction.dialogue' ? '声音设计' : type.startsWith('direction.') ? '表演与调度' : '基础卡')
    const before=(await read()).document.cards.map(card=>card.id)
    await page.getByRole('button',{name:label,exact:true}).click()
    const state=await poll(state=>state.document.cards.some(card=>card.type===type&&!before.includes(card.id)))
    const id = state.document.cards.find(card=>card.type===type&&!before.includes(card.id)).id
    if(type.startsWith('direction.'))await open(id)
    return id
  }
  const connectExisting=async(target,sourceId,inputLabel)=>{
    await open(target)
    const chooser=detail.getByRole('combobox',{name:'连接已有卡',exact:true})
    if(!await chooser.isVisible())await detail.getByText('候选连接管理',{exact:true}).click()
    await selectOption(chooser,new RegExp(`${sourceId.slice(0,8)} → ${inputLabel}$`))
    await poll(state=>state.document.edges.some(edge=>edge.source_card===sourceId&&edge.target_card===target))
  }
  const selectOption=async(chooser,label)=>{
    await chooser.press('ArrowDown')
    for(let i=0;i<40;i++){
      const listId=await chooser.getAttribute('aria-controls')
      const active=page.locator(`.ant-select-dropdown:has([id="${listId}"]) .ant-select-item-option-active`)
      if(await active.count() && (typeof label==='string'?(await active.innerText()).trim()===label:label.test((await active.innerText()).trim()))){await active.click();return}
      await chooser.press('ArrowDown');await delay(30)
    }
    throw Error(`keyboard option not reachable: ${label}`)
  }
  const adopt=async(model,sourceId)=>{
    await open(model)
    const candidates=(await (await fetch(`${base}/${journeyId}/cards/${model}/outputs`)).json()).data.candidates
    const candidate=candidates.find(item=>item.source.card_id===sourceId)
    assert.ok(candidate)
    await detail.getByRole('button',{name:`采用 ${candidate.token}`,exact:true}).click()
    await poll(state=>state.document.cards.find(card=>card.id===model).input_bindings?.some(binding=>binding.source.card_id===sourceId))
  }
  await openCanvasManagement(page)
  await page.getByRole('textbox',{name:'画布名称',exact:true}).fill('小雨的清晨探索')
  await page.getByRole('button',{name:'画布管理',exact:true}).click()
  const basis=await add('添加原文／创作依据卡','content.basis')
  await detail.getByLabel('文本文件选择',{exact:true}).setInputFiles({name:'清晨.txt',mimeType:'text/plain',buffer:Buffer.from('清晨，小雨在门边停下。')})
  await poll(state=>state.document.cards.find(card=>card.id===basis).text==='清晨，小雨在门边停下。')
  const person=await add('添加人物／物件描述卡','content.object')
  await detail.getByRole('textbox',{name:'对象名称',exact:true}).fill('小雨')
  await detail.getByRole('textbox',{name:'对象描述正文',exact:true}).fill('未直接采用的外貌秘密')
  await poll(state=>state.document.cards.find(card=>card.id===person).text==='未直接采用的外貌秘密')
  const image=await add('添加图片卡','content.image')
  const street=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=360;canvas.height=180;const ctx=canvas.getContext('2d');ctx.fillStyle='#455a64';ctx.fillRect(0,0,360,180);ctx.fillStyle='#263238';ctx.fillRect(0,110,360,70);ctx.fillStyle='#78909c';for(let x=0;x<360;x+=55)ctx.fillRect(x,25+(x%3)*12,44,95);ctx.fillStyle='#ffcc80';for(let x=10;x<360;x+=55){ctx.fillRect(x,50,9,15);ctx.fillRect(x+15,80,9,15)}ctx.fillStyle='#ffb74d';ctx.fillRect(174,95,16,48);ctx.beginPath();ctx.arc(182,85,10,0,7);ctx.fill();return canvas.toDataURL('image/png').split(',')[1]})
  await detail.getByLabel('上传媒体文件',{exact:true}).setInputFiles({name:'原创街道构图.png',mimeType:'image/png',buffer:Buffer.from(street,'base64')})
  await poll(state=>state.document.cards.find(card=>card.id===image).file_id)
  const reference=await add('添加角色参考卡','reference.character')
  await connectExisting(reference,person,'名称关联')
  await detail.getByText(`小雨 · ${person.slice(0,8)}`,{exact:true}).waitFor()
  await detail.getByRole('button',{name:'关联名称 小雨',exact:true}).click()
  await poll(state=>state.document.cards.find(card=>card.id===reference).input_bindings?.length===1)
  assert.equal(await detail.getByText('未直接采用的外貌秘密',{exact:false}).count(),0)
  await connectExisting(reference,image,'图片来源')
  await detail.getByRole('button',{name:'选为主图 @图片1',exact:true}).click()
  await poll(state=>state.document.cards.find(card=>card.id===reference).image_binding?.file_id)
  const performance=await add('添加人物表演卡','direction.performance')
  await detail.getByRole('textbox',{name:'身体动作内容',exact:true}).fill('轻轻伸手推开门')
  await connectExisting(performance,reference,'参与对象')
  await detail.getByRole('button',{name:'选择参与对象 小雨',exact:true}).click()
  await poll(state=>state.document.cards.find(card=>card.id===performance).input_bindings?.length===1)
  await connectExisting(performance,image,'图片素材')
  await detail.getByText('正向示例与反例',{exact:true}).click()
  await detail.getByRole('button',{name:'关联示例 @图片1',exact:true}).click()
  await selectOption(detail.getByRole('combobox',{name:'示例定位字段',exact:true}),'身体动作')
  await selectOption(detail.getByRole('combobox',{name:'示例用途',exact:true}),'反例')
  await poll(state=>state.document.cards.find(card=>card.id===performance).examples?.[0]?.field_id==='physical_action')
  const line=await add('添加对白卡','direction.dialogue')
  await detail.getByRole('textbox',{name:'对白正文内容',exact:true}).fill('今天会是晴天。')
  await connectExisting(line,person,'说话对象')
  await detail.getByRole('button',{name:'选择说话对象 小雨',exact:true}).click()
  await poll(state=>state.document.cards.find(card=>card.id===line).input_bindings?.length===1)
  await connectExisting(performance,line,'对白依据')
  await detail.getByRole('button',{name:/^采用对白/}).click()
  await poll(state=>state.document.cards.find(card=>card.id===performance).input_bindings?.length===2)
  assert.equal(await detail.getByText('今天会是晴天。',{exact:false}).count(),0)
  const anchor=await add('添加空间锚点卡','direction.anchor')
  await detail.getByRole('textbox',{name:'锚点名称',exact:true}).fill('门口')
  await detail.getByRole('textbox',{name:'位置内容',exact:true}).fill('画面左侧门框')
  await connectExisting(anchor,image,'图片素材')
  await detail.getByText('参考素材与图片标记',{exact:true}).click()
  await detail.getByRole('button',{name:'关联素材 @图片1',exact:true}).click()
  await selectOption(detail.getByRole('combobox',{name:'素材定位字段',exact:true}),'位置')
  await selectOption(detail.getByRole('combobox',{name:'素材用途',exact:true}),'反例')
  await poll(state=>state.document.cards.find(card=>card.id===anchor).examples?.[0]?.field_id==='position')
  const photo=await add('添加光影与色彩','direction.photography')
  await detail.getByRole('textbox',{name:'光源内容',exact:true}).fill('清晨窗边柔和侧光')
  await poll(state=>state.document.cards.find(card=>card.id===photo).fields.light_sources.text==='清晨窗边柔和侧光')
  await detail.getByRole('button',{name:'编辑景别与构图',exact:true}).click()
  const photographicEffects=detail.getByRole('region',{name:'景别与构图效果选择',exact:true})
  await detail.getByRole('button',{name:'应用到当前卡片',exact:true}).click()
  await poll(state=>state.document.cards.find(card=>card.id===photo).fields.shot_size?.text)
  await detail.getByRole('button',{name:'编辑运镜',exact:true}).click()
  const motion=detail.getByRole('region',{name:'运镜效果选择',exact:true}).locator('video')
  await motion.evaluate(video=>video.play())
  await detail.getByRole('region',{name:'运镜起止对照',exact:true}).waitFor()
  await detail.screenshot({path:join(output,'b-motion-modal.png'),animations:'disabled'})
  await detail.getByRole('button',{name:'编辑光影与色彩',exact:true}).click()
  const model=await add('添加图片模型卡','model.image')
  await selectOption(detail.getByRole('combobox',{name:'选择模型',exact:true}),'image-model')
  await poll(state=>state.document.cards.find(card=>card.id===model).model_id==='canvas-image-model')
  await connectExisting(model,basis,'文本')
  await connectExisting(model,performance,'文本')
  await connectExisting(model,reference,'参考图片')
  assert.equal((await read()).document.cards.find(card=>card.id===model).input_bindings.length,0)
  await connectExisting(model,photo,'文本')
  for(const id of [basis,performance,reference,photo])await adopt(model,id)
  const photographyCandidate=(await (await fetch(`${base}/${journeyId}/cards/${model}/outputs`)).json()).data.candidates.find(item=>item.source.card_id===photo)
  const scope=detail.getByRole('combobox',{name:`摄影采用范围 ${photographyCandidate.token}`,exact:true})
  await scope.click();await scope.press('Backspace');await scope.fill('光影与色彩')
  const activeScope=page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getByText('光影与色彩',{exact:true})
  await activeScope.click();await scope.press('Escape')
  await poll(state=>state.document.cards.find(card=>card.id===model).input_bindings.some(binding=>binding.photography_scope?.includes('region:lighting')))

  let compiled=(await (await fetch(`${base}/${journeyId}/cards/${model}/compile`)).json()).data
  assert.match(compiled.text,/清晨，小雨在门边停下。/)
  assert.match(compiled.text,/轻轻伸手推开门/)
  assert.match(compiled.text,/清晨窗边柔和侧光/)
  assert.doesNotMatch(compiled.text,/特写|浅景深|缓慢平移/)
  assert.doesNotMatch(compiled.text,/今天会是晴天|未直接采用的外貌秘密/)
  assert.equal(compiled.media.length,1)
  assert.equal(compiled.mapping.filter(mapping=>'object_id' in mapping).length,1)
  await connectExisting(model,line,'文本')
  await adopt(model,line)
  compiled=(await (await fetch(`${base}/${journeyId}/cards/${model}/compile`)).json()).data
  assert.equal(compiled.text.split('今天会是晴天。').length-1,1)
  await detail.getByRole('spinbutton',{name:'图片数量',exact:true}).fill('3')
  await poll(state=>state.document.cards.find(card=>card.id===model).config.count===3)
  await detail.getByRole('textbox',{name:'模型正文',exact:true}).fill('晨光温柔，保持主角身份。')
  const unchangedView=await page.locator('.generation-world').getAttribute('style')
  if(await page.getByRole('button',{name:'关闭卡片列表',exact:true}).isVisible())await page.getByRole('button',{name:'关闭卡片列表',exact:true}).click()
  const category=page.getByRole('combobox',{name:'卡片分类',exact:true})
  await category.press('ArrowDown')
  await page.locator('.ant-select-dropdown:visible').getByText('模型生成',{exact:true}).click()
  await page.locator(`[data-card-id="${reference}"]`).waitFor({state:'visible'})
  assert.equal(await page.locator(`[data-card-id="${reference}"]`).getAttribute('data-filter-match'),'false')
  assert.equal(await page.locator('.generation-world').getAttribute('style'),unchangedView)
  await page.screenshot({path:join(output,'journey-model-desktop.png'),fullPage:true})
  await detail.getByRole('button',{name:'预检运行',exact:true}).click()
  await page.getByRole('button',{name:'确认执行',exact:true}).click()
  let runtime
  for(let i=0;i<100;i++){
    runtime=(await (await fetch(`${base}/${journeyId}/runtime`)).json()).data
    if(runtime.current_outputs?.[model]?.length)break
    if(i===99)throw Error('image worker did not publish results')
    await delay(120)
  }
  writeFileSync(join(output,'runtime.json'),JSON.stringify(runtime,null,2))
  const controls=await (await fetch(`${api}/test/image-controls`)).json()
  assert.equal(controls.calls.length,1)
  assert.match(controls.calls[0].prompt,/小雨/)
  assert.equal(controls.calls[0].prompt.split('今天会是晴天。').length-1,1)
  assert.doesNotMatch(controls.calls[0].prompt,/未直接采用的外貌秘密/)
  await detail.getByRole('button',{name:'关闭详情',exact:true}).click()
  await category.press('ArrowDown')
  await page.locator('.ant-select-dropdown:visible').getByText('全部分类',{exact:true}).click()
  const beforeVisual=await read()
  const positions=Object.fromEntries(beforeVisual.document.cards.map((card,index)=>[card.id,{x:1100+(index%3)*440,y:1000+Math.floor(index/3)*280}]))
  positions[photo]={x:0,y:0};positions[reference]={x:0,y:310};positions[model]={x:470,y:0}
  await page.addInitScript(({key,positions,photo,reference,model})=>localStorage.setItem(key,JSON.stringify({schema:1,transform:{x:150,y:170,scale:1},positions,sizes:{[photo]:{width:360,height:240},[reference]:{width:360,height:250},[model]:{width:560,height:270}}})),{key:`jellyfish:generation-layout:canvas-project:${journeyId}:view:canvas`,positions,photo,reference,model})
  await page.reload()
  await page.getByRole('button',{name:'收起筛选',exact:true}).click()
  const modifier=await page.evaluate(()=>/Mac|iPhone|iPad/.test(navigator.platform)?'Meta':'Control')
  await page.locator(`[data-card-id="${photo}"]`).click({modifiers:[modifier]})
  await page.locator(`[data-card-id="${reference}"]`).click({modifiers:[modifier]})
  await page.getByRole('toolbar',{name:'所选卡片操作',exact:true}).getByRole('button',{name:'编组',exact:true}).click()
  await poll(state=>state.document.groups.some(group=>group.card_ids.includes(photo)&&group.card_ids.includes(reference)))
  const plainOpen=async id=>{const current=page.locator('.wb-details:visible');if(await current.count())await current.getByRole('button',{name:'关闭详情',exact:true}).click();await page.locator(`[data-card-id="${id}"]`).press('Enter');if(id===photo)await page.locator(`[data-card-id="${id}"]`).getByRole('button',{name:'编辑卡片',exact:true}).click();await detail.waitFor()}
  const stable=async()=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await delay(150)}
  for(const [width,height] of [[1440,960],[390,844],[3830,1688]]){
    await page.setViewportSize({width,height});await stable()
    await plainOpen(model)
    await detail.getByRole('region',{name:'本次创作依据',exact:true}).getByRole('img',{name:'图片预览',exact:true}).waitFor()
    assert.equal(await detail.getByRole('region',{name:'已保存直接输入',exact:true}).isVisible(),false)
    const submitBounds=await detail.getByRole('button',{name:'预检运行',exact:true}).boundingBox(), editorBody=await detail.boundingBox()
    assert.ok(submitBounds.y>=editorBody.y&&submitBounds.y+submitBounds.height<=editorBody.y+editorBody.height,'multi-source submit stays visible before any scrolling')
    assert.doesNotMatch(await detail.getByRole('region',{name:'本次创作依据',exact:true}).innerText(),new RegExp(beforeVisual.document.cards.find(card=>card.id===person).object_id),'default design summary uses human fields')
    await page.screenshot({path:join(output,`b-canvas-${width}.png`),animations:'disabled'})
    await detail.screenshot({path:join(output,`b-composer-${width}.png`),animations:'disabled'})
    await detail.getByRole('button',{name:'预检运行',exact:true}).scrollIntoViewIfNeeded()
    await detail.screenshot({path:join(output,`b-submit-${width}.png`),animations:'disabled'})
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
    await plainOpen(photo)
    await detail.getByRole('button',{name:'编辑光影与色彩',exact:true}).click()
    await page.screenshot({path:join(output,`b-photography-${width}.png`),animations:'disabled'})
    await detail.screenshot({path:join(output,`b-photography-region-${width}.png`),animations:'disabled'})
    await detail.getByRole('button',{name:'关闭详情',exact:true}).click()
  }
  await page.setViewportSize({width:1440,height:960});await stable()
  await page.getByRole('button',{name:/运行历史/}).click()
  await page.locator('[data-history-run] > summary').first().click()
  await page.getByRole('button',{name:'另存为图片内容卡',exact:true}).first().click()
  const copied=await poll(state=>state.document.cards.some(card=>card.type==='content.image'&&card.origin))
  const savedImage=copied.document.cards.find(card=>card.type==='content.image'&&card.origin)
  assert.equal(savedImage.file_id,runtime.current_outputs[model][0].file_id)
  await page.getByRole('button',{name:'关闭详情',exact:true}).click()
  const downstream=await add('添加图片模型卡','model.image')
  await selectOption(detail.getByRole('combobox',{name:'选择模型',exact:true}),'image-model')
  await connectExisting(downstream,savedImage.id,'参考图片')
  assert.equal((await read()).document.cards.find(card=>card.id===downstream).input_bindings.length,0)
  await adopt(downstream,savedImage.id)
  await detail.getByRole('textbox',{name:'模型正文',exact:true}).fill('沿用图片探索冷色版本')
  const nextPreview=page.waitForResponse(response=>response.url().endsWith('/precheck')&&response.request().method()==='POST')
  await detail.getByRole('button',{name:'预检运行',exact:true}).click()
  const nextCheck=(await (await nextPreview).json()).data
  assert.ok(nextCheck.can_run)
  assert.deepEqual(nextCheck.execution_nodes,[downstream])
  assert.equal(nextCheck.input.media[0].file_id,savedImage.file_id)
  assert.doesNotMatch(nextCheck.input.text,/今天会是晴天|轻轻伸手推开门|清晨，小雨/)
  await page.getByRole('dialog', { name: '运行预检', exact: true }).waitFor()
  await closePrecheck(page)
  if(await page.getByRole('button',{name:'展开筛选',exact:true}).isVisible())await page.getByRole('button',{name:'展开筛选',exact:true}).click()
  await category.press('ArrowDown')
  await page.locator('.ant-select-dropdown:visible').getByText('全部分类',{exact:true}).click()
  await page.reload()
  await open(anchor)
  await detail.getByText('参考素材与图片标记',{exact:true}).click()
  assert.equal((await read()).document.cards.find(card=>card.id===anchor).examples[0].field_id,'position')
  await page.setViewportSize({width:390,height:844})
  await open(model)
  assert.equal(await detail.getByRole('textbox',{name:'模型正文',exact:true}).evaluate(element=>{
    for(let current=element;current;current=current.parentElement){const color=getComputedStyle(current).backgroundColor;if(color!=='rgba(0, 0, 0, 0)'&&color!=='transparent')return color}
  }),'rgb(27, 27, 27)')
  const narrowLayout = await detail.evaluate(element=>({panel:[element.scrollWidth,element.clientWidth],body:[element.querySelector('.wb-details-body').scrollWidth,element.querySelector('.wb-details-body').clientWidth],page:[document.documentElement.scrollWidth,innerWidth]}))
  writeFileSync(join(output,'narrow-layout.json'),JSON.stringify(narrowLayout))
  assert.ok(narrowLayout.body[0]<=narrowLayout.body[1] && narrowLayout.page[0]<=narrowLayout.page[1])
  await page.screenshot({path:join(output,'journey-model-narrow.png'),fullPage:true})
  await open(performance)
  await detail.getByRole('textbox',{name:'身体动作内容',exact:true}).waitFor()
  const performanceLayout=await detail.evaluate(element=>({panel:[element.scrollWidth,element.clientWidth],body:[element.querySelector('.wb-details-body').scrollWidth,element.querySelector('.wb-details-body').clientWidth],page:[document.documentElement.scrollWidth,innerWidth]}))
  writeFileSync(join(output,'performance-narrow-layout.json'),JSON.stringify(performanceLayout))
  assert.ok(performanceLayout.body[0]<=performanceLayout.body[1] && performanceLayout.page[0]<=performanceLayout.page[1])
  await page.screenshot({path:join(output,'journey-narrow.png'),fullPage:true})
  await page.keyboard.press('Escape')
  assert.ok(!await detail.isVisible())
  writeFileSync(join(output,'submitted-text.txt'),controls.calls[0].prompt)
  console.log('generation canvas journey browser assertions passed', output)
} catch(error) { if(page){console.log('failed URL',page.url());writeFileSync(join(output,'failed-body.txt'),await page.locator('body').innerText());await page.screenshot({path:join(output,'failed.png'),fullPage:true})}throw error } finally { await cleanup() }
