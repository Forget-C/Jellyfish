import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
const { chromium } = createRequire(import.meta.url)('playwright')

/** 退役旧摄影用例沿用真实HTTP/DB页面，分别验证清理、六类编辑及卡面。 */
export async function verifyIndependentDesigns(scenario, port) {
  const root=fileURLToPath(new URL('..',import.meta.url)), output=await browserOutput('jellyfish-independent-designs-')
  const api=`http://127.0.0.1:${port+4000}`, base=`${api}/api/v1/studio/generation-canvases/canvas-project`
  const backend=spawn('uv',['run','--no-sync','python','-m','tests.generation_canvas_images_browser_server'],{cwd:join(root,'../backend'),env:{...process.env,PYTHONPATH:join(root,'../backend'),UV_CACHE_DIR:'/tmp/jellyfish-uv-cache',CANVAS_BROWSER_PORT:String(port+4000),CANVAS_BROWSER_DATABASE:join(output,'browser.sqlite'),CANVAS_BROWSER_MEDIA_STORAGE:join(output,'media')},stdio:['ignore','pipe','pipe']})
  captureBackend(backend,output)
  let browser,server
  const cleanup=browserCleanup(()=>({browser,server,backend}))
  try {
    for(let i=0;i<80;i++){try{if((await fetch(base)).ok)break}catch{}await delay(250)}
    server=await createServer({root,cacheDir:join(output,'vite-cache'),server:{host:'127.0.0.1',port,strictPort:true,proxy:{'/api':api}}});await server.listen()
    browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL})
    const context=await browser.newContext({viewport:{width:1440,height:960}}), page=await context.newPage()
    await page.addInitScript(()=>{window.__ENV={BACKEND_URL:window.location.origin}})
    const canvas=(await (await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'六类设计'})})).json()).data
    const types=['style','composition','camera','movement','lighting','focus']
    const fieldKeys=['direction','composition','viewpoint','movement_path','light_sources','depth_focus']
    const fieldLabels=['风格方向','构图重心','观察视点','运动路径','光源','景深与焦点']
    const cards=types.map((kind,i)=>({id:kind,type:'direction.'+kind,fields:{[fieldKeys[i]]:{text:`独立设计${i}`,state:'fact'}}}))
    if(scenario==='retirement')cards.push({id:'old',type:'direction.photography'},{id:'model',type:'model.text',input_bindings:[{id:'old-use',input_port:'text',source:{canvas_id:canvas.id,card_id:'old',port_id:'text',position:0},photography_scope:['whole']}]})
    const document={...canvas.document,cards,edges:scenario==='retirement'?[{id:'retired',source_card:'old',source_port:'text',target_card:'model',target_port:'text'}]:[],input_order:{}}
    const saved=await fetch(`${base}/${canvas.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:'seed',expected_revision:0,document})});assert.ok(saved.ok,await saved.text())
    const read=async()=> (await (await fetch(`${base}/${canvas.id}`)).json()).data
    const poll=async predicate=>{for(let i=0;i<80;i++){if(predicate(await read()))return;await delay(100)}throw Error('save timeout')}
    await page.goto(`http://127.0.0.1:${port}/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
    const detail=page.locator('.wb-details:visible')
    if(scenario==='retirement'){
      assert.equal(await page.locator('[data-card-type="direction.photography"]').count(),0)
      await page.locator('[data-card-id="model"]').press('Enter')
      const inspection=detail.getByRole('button',{name:'打开模型配置与检查',exact:true});if(await inspection.count())await inspection.click()
      await detail.getByText('旧摄影设计已移除，需要补充设计依据',{exact:true}).waitFor()
      await page.screenshot({path:join(output,'missing-design.png')})
      assert.ok((await (await fetch(`${base}/${canvas.id}/cards/model/compile`)).json()).data.diagnostics.some(item=>item.code==='DESIGN_BASIS_MISSING'))
      await detail.getByRole('button',{name:'已处理缺失设计',exact:true}).click();await poll(s=>s.document.cards.find(c=>c.id==='model').missing_designs.length===0)
      await page.keyboard.press('Escape');await detail.waitFor({state:'hidden'})
    }
    for(let i=0;i<types.length;i++){
      const kind=types[i], card=page.locator(`[data-card-id="${kind}"]`)
      await card.press('Enter')
      await detail.getByRole('button',{name:'高级设置',exact:true}).waitFor()
      assert.equal(await detail.getByRole('tab').count(),0)
      await detail.getByRole('button',{name:'高级设置',exact:true}).click()
      const field=detail.getByRole('textbox',{name:fieldLabels[i]+'内容',exact:true});assert.equal(await field.evaluate(element => 'value' in element ? element.value : element.innerText),`独立设计${i}`)
      if(scenario==='editor'){
        await field.fill(`已编辑${kind}`);await poll(s=>s.document.cards.find(c=>c.id===kind).fields[fieldKeys[i]].text===`已编辑${kind}`)
        await detail.getByRole('switch',{name:'显示状态与来源',exact:true}).click();assert.equal(await detail.getByRole('combobox',{name:fieldLabels[i]+'状态',exact:true}).isVisible(),true)
        await detail.getByRole('button',{name:'返回预设',exact:true}).click();await detail.getByRole('button',{name:/预览 /}).first().click()
        await detail.getByRole('button',{name:'高级设置',exact:true}).click();assert.equal(await field.evaluate(element => 'value' in element ? element.value : element.innerText),`已编辑${kind}`)
      }
      await detail.getByRole('button',{name:'关闭详情',exact:true}).click()
    }
    await page.setViewportSize({width:390,height:844});await page.locator('[data-card-id="composition"]').press('Enter');await detail.getByRole('button',{name:'高级设置',exact:true}).waitFor()
    await page.screenshot({path:join(output,`${scenario}-mobile.png`)});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
    const catalog=(await (await fetch(`${base}/${canvas.id}/catalog`)).json()).data.cards.filter(c=>c.category==='画面设计');assert.equal(catalog.length,6);assert.ok(catalog.every(c=>c.outputs[0].adoption==='whole_card'&&c.entries.length===0))
    console.log(`PASS ${scenario}: six independent designs, no legacy navigation, saved fields, narrow layout`)
  } finally {await cleanup()}
}
