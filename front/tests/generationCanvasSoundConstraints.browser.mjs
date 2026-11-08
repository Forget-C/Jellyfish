import { openCanvasCard } from './generationCanvasWorkbench.browser-helpers.mjs'
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
const output = await browserOutput('jellyfish-sound-constraints-')
const api = 'http://127.0.0.1:8463', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8463' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4463, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  page = await context.newPage()
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const cases = [['dialogue','content','对白正文',null],['sound','environment','环境声','对白优先'],['space_rule','axis','轴线','保持轴线'],['continuity','before','前态','空间延续'],['fact','fact','不可改事实',null],['creative_control','freedom','创作控制程度','有限发挥'],['guidance','priority','编译优先级','动作可读优先'],['criterion','standard','可观察判断标准','动作结果可辨'],['performance_rule','applicability','表演适用说明','减少多余动作']]
  const canvas=(await (await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'声音约束验收'})})).json()).data
  const edges=cases.map(([id])=>({id,source_card:'brief',source_port:'text',target_card:id,target_port:'text'}))
  const document={...canvas.document,cards:[{id:'brief',type:'content.text',text:'明确的文本依据'},...cases.map(([id])=>({id,type:'direction.'+id,...(id==='dialogue'?{dialogue_id:'stable-dialogue'}:{})}))],edges,input_order:Object.fromEntries(cases.map(([id])=>[id,{text:[id]}]))}
  const seeded=await fetch(`${base}/${canvas.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:'seed',expected_revision:0,document})})
  assert.ok(seeded.ok,await seeded.text())
  await page.goto(`http://127.0.0.1:4463/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const detail=page.locator('.wb-details:not([hidden])')
  const read=async()=> (await (await fetch(`${base}/${canvas.id}`)).json()).data
  const poll=async predicate=>{for(let i=0;i<100;i++){const state=await read();if(predicate(state))return state;await delay(150)}throw Error('save timeout')}
  await page.locator('[data-card-id="creative_control"]').getByText('尚未填写创作控制', { exact: true }).waitFor({ state: 'attached' })
  for(const[id,key,label,preset]of cases){
    await openCanvasCard(page,id)
    if(['creative_control','guidance','fact','performance_rule'].includes(id)){
      assert.equal(await detail.locator('summary').filter({hasText:'作用对象'}).count(),0)
      assert.equal(await detail.getByRole('region',{name:'对象关系',exact:true}).count(),0)
      assert.equal(await detail.locator('summary').filter({hasText:'对象与制作关系'}).count(),0)
    }
    if(id==='dialogue'){
      await detail.getByRole('button',{name:'添加设计来源',exact:true}).click()
      await page.getByRole('menuitem',{name:/上传参考素材/}).hover()
      await page.getByRole('menuitem',{name:'上传音频素材',exact:true}).waitFor()
      await page.getByRole('menuitem',{name:'上传视频素材',exact:true}).waitFor()
      await page.keyboard.press('Escape');await page.keyboard.press('Escape')
    }
    if(preset){await detail.getByRole('button',{name:'预览 '+preset,exact:true}).click();await detail.getByRole('button',{name:'应用',exact:true}).click();
      await poll(state=>Object.values(state.document.cards.find(card=>card.id===id)).some(value=>value&&typeof value==='object'&&value.state==='fact'&&value.authorship==='user'))
      await detail.getByRole('button',{name:'关闭详情',exact:true}).click();await openCanvasCard(page,id)
      if(['space_rule','creative_control'].includes(id))await detail.getByText('已应用 · '+preset,{exact:true}).waitFor()
      await detail.getByRole('button',{name:'高级设置',exact:true}).click()}
    const field=detail.getByRole('textbox',{name:label+'内容',exact:true})
    await field.fill('');await field.press('@');await page.getByRole('option',{name:'@文本1',exact:true}).click()
    await poll(state=>state.document.cards.find(card=>card.id===id)[key]?.document?.segments?.some(segment=>segment.kind==='reference'))
    if(id==='dialogue')assert.equal((await read()).document.cards.find(card=>card.id===id).dialogue_id,'stable-dialogue')
    await detail.getByRole('button',{name:'关闭详情',exact:true}).click()
  }
  const baseline=await read(), recovered=structuredClone(baseline.document)
  recovered.cards.push({id:'old-prop',type:'content.prop',object_id:'key',name:'钥匙',text:'保留的完整钥匙描述'})
  const retired=['creative_control','guidance','fact','performance_rule']
  for(const id of retired){
    recovered.cards.find(card=>card.id===id).input_bindings=[{id:'old-'+id,input_port:'effect_object',source:{canvas_id:canvas.id,card_id:'old-prop',port_id:'object',object_id:'key',position:0}}]
    recovered.edges.push({id:'old-'+id,source_card:'old-prop',source_port:'object',target_card:id,target_port:'effect_object'})
    recovered.input_order[id].effect_object=['old-'+id]
  }
  await page.evaluate(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:`jellyfish:generation:canvas-project:${canvas.id}:recovery`,value:{schema:1,baseline,document:recovered}})
  await page.reload();await page.getByRole('button',{name:'恢复本地内容',exact:true}).click()
  await poll(state=>state.document.cards.some(card=>card.id==='old-prop'))
  const assertClean=async()=>{const state=await read();for(const id of retired){
    assert.deepEqual(state.document.cards.find(card=>card.id===id).input_bindings,[])
    assert.ok(state.document.edges.some(edge=>edge.id==='old-'+id&&edge.source_port==='text'&&edge.target_port==='text'))
    assert.ok(!state.document.edges.some(edge=>edge.target_card===id&&edge.target_port==='effect_object'))
    assert.ok(state.document.cards.find(card=>card.id===id)[cases.find(row=>row[0]===id)[1]].document.segments.some(segment=>segment.kind==='reference'&&segment.source.card_id==='brief'))
  }}
  await assertClean();await openCanvasCard(page,'creative_control')
  await detail.getByRole('button',{name:'编辑创作控制名称',exact:true}).click()
  await detail.getByRole('textbox',{name:'创作控制名称',exact:true}).fill('清理后编辑')
  await poll(state=>state.document.cards.find(card=>card.id==='creative_control').name==='清理后编辑')
  await detail.getByRole('button',{name:'关闭详情',exact:true}).click()
  await page.getByRole('button',{name:'撤销操作',exact:true}).click()
  await poll(state=>state.document.cards.find(card=>card.id==='creative_control').name==='');await assertClean()
  await page.getByRole('button',{name:'重做操作',exact:true}).click()
  await poll(state=>state.document.cards.find(card=>card.id==='creative_control').name==='清理后编辑');await assertClean()
  await page.reload();await assertClean()
  {
  const baseline = await read(), recovered = structuredClone(baseline.document)
  recovered.cards.push({id:'key',type:'content.prop',object_id:'sound-key',name:'音效钥匙',text:'金属钥匙'})
  const oldSound = recovered.cards.find(item=>item.id==='sound')
  oldSound.production='postproduction' /* retired local data is cleaned on restore */
  oldSound.action_sound={text:'恢复的钥匙碰撞声',authorship:'user'}
  oldSound.input_bindings=[{id:'old-sound',input_port:'effect_object',source:{canvas_id:canvas.id,card_id:'key',port_id:'object',object_id:'sound-key',position:0}}]
  recovered.edges.push({id:'old-sound',source_card:'key',source_port:'object',target_card:'sound',target_port:'effect_object'})
  recovered.input_order.sound.effect_object=['old-sound']
  await page.evaluate(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:`jellyfish:generation:canvas-project:${canvas.id}:recovery`,value:{schema:1,baseline,document:recovered}})
  await page.reload()
  await page.getByRole('button',{name:'恢复本地内容',exact:true}).click()
  await poll(state=>state.document.cards.find(item=>item.id==='sound').action_sound.text==='恢复的钥匙碰撞声')
  const assertClean=async()=>{const state=await read();const sound=state.document.cards.find(item=>item.id==='sound');assert.deepEqual(sound.input_bindings,[]);assert.equal(sound.production,undefined);assert.ok(!state.document.edges.some(edge=>edge.target_card==='sound'&&edge.target_port==='effect_object'));assert.ok(state.document.edges.some(edge=>edge.id==='old-sound'&&edge.target_port==='text'))}
  await assertClean()
  await openCanvasCard(page,'sound')
  assert.equal(await detail.getByRole('region',{name:'声源对象',exact:true}).count(),0)
  assert.equal(await detail.getByRole('button',{name:/选择声源对象/}).count(),0)
  await detail.getByRole('textbox',{name:'动作声内容',exact:true}).fill('编辑后的碰撞声')
  await poll(state=>state.document.cards.find(item=>item.id==='sound').action_sound.text==='编辑后的碰撞声')
  await detail.getByRole('button',{name:'关闭详情',exact:true}).click()
  await page.getByRole('button',{name:'撤销操作',exact:true}).click()
  await poll(state=>state.document.cards.find(item=>item.id==='sound').action_sound.text==='恢复的钥匙碰撞声')
  await assertClean()
  await page.getByRole('button',{name:'重做操作',exact:true}).click()
  await poll(state=>state.document.cards.find(item=>item.id==='sound').action_sound.text==='编辑后的碰撞声')
  await page.reload()
  await assertClean()
  }
  await page.reload();await openCanvasCard(page,'continuity');await page.setViewportSize({width:390,height:844})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  await page.screenshot({path:join(output,'sound-constraints-mobile.png'),fullPage:true})
  assert.equal(await detail.getByRole('combobox',{name:'连续性分类',exact:true}).isVisible(),true)
  const constraint=detail.getByRole('textbox',{name:'后续约束内容',exact:true})
  await constraint.fill('');await constraint.press('@');await page.getByRole('option',{name:'@文本1',exact:true}).click()
  await poll(state=>state.document.cards.find(card=>card.id==='continuity').following_constraints.document?.segments.some(segment=>segment.kind==='reference'))
  await detail.getByRole('button',{name:'返回预设',exact:true}).click()
  const beforeContinuity=(await read()).document.cards.find(card=>card.id==='continuity')
  for(const name of ['空间延续','造型延续','手部与道具延续','环境延续','摄影衔接','对白与声音衔接']) await detail.getByRole('button',{name:'预览 '+name,exact:true}).waitFor()
  await detail.getByRole('button',{name:'预览 造型延续',exact:true}).click()
  await detail.locator('.design-preset-changes').click()
  await detail.getByText('将覆盖 · 连续性分类',{exact:true}).click()
  await detail.getByText('新值：造型',{exact:true}).waitFor()
  await detail.getByText('将覆盖 · 后续约束',{exact:true}).click()
  await detail.getByText(/新值：保持已明确的服装/).waitFor()
  await detail.getByText(/原值：.*含引用（应用后替换）/).waitFor()
  assert.equal((await read()).document.cards.find(card=>card.id==='continuity').category,'space')
  await detail.getByRole('button',{name:'应用',exact:true}).click()
  await poll(state=>state.document.cards.find(card=>card.id==='continuity').category==='appearance')
  const adopted=(await read()).document.cards.find(card=>card.id==='continuity')
  for(const key of ['before','change','after']) assert.deepEqual(adopted[key],beforeContinuity[key])
  await detail.getByRole('button',{name:'高级设置',exact:true}).click()
  await detail.getByRole('combobox',{name:'连续性分类',exact:true}).press('ArrowDown')
  await page.locator('.ant-select-dropdown:visible').getByText('空间',{exact:true}).click()
  await poll(state=>state.document.cards.find(card=>card.id==='continuity').category==='space')
  assert.deepEqual((await read()).document.cards.find(card=>card.id==='continuity').following_constraints,adopted.following_constraints)
  await detail.getByRole('button',{name:'撤销',exact:true}).click()
  await poll(state=>state.document.cards.find(card=>card.id==='continuity').category==='appearance')
  await detail.getByRole('button',{name:'返回预设',exact:true}).click()
  await detail.getByText('自定义配置',{exact:true}).waitFor()
  await detail.getByRole('button',{name:'预览 空间延续',exact:true}).click()
  await detail.getByText('自定义配置',{exact:true}).waitFor()
  await detail.getByRole('button',{name:'撤销',exact:true}).click()
  await poll(state=>{const card=state.document.cards.find(card=>card.id==='continuity');return card.category==='space'&&JSON.stringify(card.following_constraints)===JSON.stringify(beforeContinuity.following_constraints)})
  await detail.getByRole('button',{name:'关闭详情',exact:true}).click()
  const observer=await page.context().newPage()
  await observer.addInitScript(()=>{window.__ENV={BACKEND_URL:window.location.origin}})
  await observer.goto(page.url());await observer.getByText('此画布当前只读',{exact:true}).waitFor()
  const revision=(await read()).revision
  for(const[id,,label,preset]of cases){
    await openCanvasCard(observer,id)
    const readonly=observer.locator('.wb-details:not([hidden])')
    assert.equal(await readonly.getByRole('textbox',{name:label+'内容',exact:true}).isDisabled(),true)
    await readonly.getByRole('button',{name:'关闭详情',exact:true}).click()
  }
  assert.equal((await read()).revision,revision)
  await observer.close()
  console.log('Nine sound/constraint/rule cards: entry modes, preset application, references, version and mobile passed:',output)
} finally { await cleanup() }
