import { openModelInspection } from './generationCanvasWorkbench.browser-helpers.mjs'
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
const output = await browserOutput('jellyfish-design-field-references-')
const api = 'http://127.0.0.1:8666', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8666' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser, debugPage
const cleanup = browserCleanup(() => ({ browser, server, backend }))
try {
  let ready = false
  for (let i = 0; i < 80; i++) {
    if (backend.exitCode !== null) throw Error('isolated photography backend exited')
    try { if ((await fetch(base)).ok) { ready = true; break } } catch {}
    await delay(250)
  }
  assert.ok(ready)
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4666, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 1440, height: 960 } })
  const page = await context.newPage()
  debugPage = page
  page.setDefaultTimeout(12000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '摄影设计' }) })).json()).data
  const kinds=[['style','direction','风格方向','notes','自定义说明'],['camera','viewpoint','观察视点','support','支撑方式'],['lighting','light_sources','光源','color_relationship','色彩关系'],['focus','depth_focus','景深与焦点','prohibitions','禁止项'],['composition','composition','构图重心','negative_space','留白'],['movement','movement_path','运动路径','end_frame','结束画面']]
  const source={canvas_id:canvas.id,card_id:'brief',port_id:'text',position:0}
  const document={...canvas.document,cards:[{id:'brief',type:'content.text',text:'张三'},{id:'loose',type:'content.text',text:'画布已有候选'},...kinds.map(([kind,key])=>({id:kind,type:'direction.'+kind,fields:{[key]:{text:'基线',state:'proposal'}}}))],edges:kinds.map(([kind])=>({id:'edge-'+kind,source_card:'brief',source_port:'text',target_card:kind,target_port:'text'})),input_order:Object.fromEntries(kinds.map(([kind])=>[kind,{text:['edge-'+kind]}]))}
  const seed=await fetch(`${base}/${canvas.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:'seed',expected_revision:0,document})})
  assert.ok(seed.ok,await seed.text())
  const read=async()=>(await(await fetch(`${base}/${canvas.id}`)).json()).data
  const poll=async predicate=>{for(let i=0;i<100;i++){const state=await read();if(predicate(state))return state;await delay(100)}throw Error('field reference save did not arrive')}
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.goto(`http://127.0.0.1:4666/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const detail=page.locator('.wb-details:visible')
  for(const [kind,key,label,other,otherLabel] of kinds){
    await page.locator(`[data-card-id="${kind}"]`).press('Enter')
    const candidate=detail.getByRole('button',{name:/^候选 @文本1 ·/})
    await candidate.waitFor();await candidate.click()
    await page.locator('.design-source-inspect:visible').waitFor()
    await page.keyboard.press('Escape');assert.equal(await detail.isVisible(),true)
    await page.locator('.design-source-inspect:visible').waitFor({state:'hidden'})
    await detail.getByRole('button',{name:'高级设置',exact:true}).click()
    const field=detail.getByRole('textbox',{name:label+'内容',exact:true})
    await field.fill('站在 ');await candidate.click();await page.keyboard.type(' 身后')
    await poll(s=>s.document.cards.find(c=>c.id===kind).fields[key].document?.segments.some(segment=>segment.kind==='reference'&&segment.source.card_id==='brief'))
    assert.equal(await candidate.getAttribute('aria-label'),'候选 @文本1 · 使用中')
    const second=detail.getByRole('textbox',{name:otherLabel+'内容',exact:true})
    await second.fill('另一字段 ');await candidate.click()
    await poll(s=>s.document.cards.find(c=>c.id===kind).fields[other].document?.segments.some(segment=>segment.kind==='reference'))
    await field.fill('第一处已清理')
    await poll(s=>!s.document.cards.find(c=>c.id===kind).fields[key].document?.segments.some(segment=>segment.kind==='reference'))
    assert.match(await candidate.getAttribute('aria-label'),/使用中/,'remaining field keeps use mark')
    await detail.getByRole('switch',{name:'显示状态与来源',exact:true}).click()
    await detail.getByRole('combobox',{name:otherLabel+'状态',exact:true}).locator('xpath=../..').click()
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option[title="不适用"]').last().click()
    await poll(s=>s.document.cards.find(c=>c.id===kind).fields[other].state==='not_applicable')
    assert.match(await candidate.getAttribute('aria-label'),/未生效/)
    await detail.getByRole('button',{name:'返回预设',exact:true}).click()
    await detail.screenshot({path:join(output,kind+'-field-references.png'),animations:'disabled'})
    await detail.getByRole('button',{name:'关闭详情',exact:true}).click()
    const saved=(await read()).document.cards.find(c=>c.id===kind)
    assert.equal(saved.fields[other].document.segments.find(segment=>segment.kind==='reference').source.card_id,'brief')
  }
  await page.reload()
  await page.locator('[data-card-id="style"]').getByRole('button',{name:'编辑设计',exact:true}).click()
  await detail.getByRole('button',{name:'添加设计来源',exact:true}).click()
  await page.getByRole('menuitem',{name:'从当前画布选择',exact:true}).click()
  const picker=page.getByRole('dialog',{name:'选择画布来源',exact:true})
  await picker.getByRole('button',{name:/· loose → 文本/}).click()
  await poll(s=>s.document.edges.some(edge=>edge.source_card==='loose'&&edge.target_card==='style'))
  await detail.getByRole('button',{name:'添加设计来源',exact:true}).click()
  await page.getByRole('menuitem',{name:/上传参考素材/}).hover()
  await page.getByRole('menuitem',{name:'上传文本参考',exact:true}).click()
  const textDialog=page.getByRole('dialog',{name:/文本参考/})
  await textDialog.waitFor()
  await textDialog.getByRole('textbox',{name:'文本内容',exact:true}).fill('新建文本候选')
  await poll(s=>s.document.cards.some(card=>card.type==='content.text'&&card.text==='新建文本候选'))
  await page.screenshot({path:join(output,'add-text-reference.png'),animations:'disabled'})
  await textDialog.locator('.ant-modal-close').click()
  await detail.getByRole('button',{name:'添加设计来源',exact:true}).click()
  await page.getByRole('menuitem',{name:/上传参考素材/}).hover()
  await page.getByRole('menuitem',{name:/上传.*图片.*素材/}).click()
  const uploadDialog=page.getByRole('dialog',{name:'添加参考素材',exact:true})
  const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')
  await uploadDialog.getByLabel('上传媒体文件').setInputFiles({name:'reference.png',mimeType:'image/png',buffer:image})
  await poll(s=>s.document.cards.some(card=>card.type==='content.image'&&card.file_id))
  await uploadDialog.locator('.ant-modal-close').click()
  await detail.getByRole('button',{name:'添加设计来源',exact:true}).click()
  await page.getByRole('menuitem',{name:/从素材库添加/}).hover()
  await page.getByRole('menuitem',{name:/选择.*图片.*素材/}).click()
  await page.getByRole('dialog',{name:'项目文件库',exact:true}).waitFor()
  await page.getByRole('dialog',{name:'项目文件库',exact:true}).getByRole('button',{name:'选用 reference',exact:true}).click()
  await poll(s=>s.document.cards.filter(card=>card.type==='content.image'&&card.file_id).length===2)
  await uploadDialog.locator('.ant-modal-close').click()
  await detail.getByRole('button',{name:'高级设置',exact:true}).click()
  const second=detail.getByRole('textbox',{name:'自定义说明内容',exact:true})
  assert.match(await second.innerText(),/@文本1/,'saved retained source survives reload')
  const color=detail.getByRole('textbox',{name:'色彩倾向内容',exact:true})
  await color.fill('');await page.keyboard.type('@');await page.getByRole('option',{name:'@文本1',exact:true}).click()
  await poll(s=>s.document.cards.find(card=>card.id==='style').fields.colors.document?.segments.some(segment=>segment.kind==='reference'))
  const beforePreset=(await read()).document.cards.find(card=>card.id==='style').fields
  await detail.getByRole('button',{name:'返回预设',exact:true}).click()
  await detail.getByRole('button',{name:'预览 手绘水彩',exact:true}).click()
  await detail.getByRole('button',{name:/覆盖 \d+ 项并应用/}).click()
  await poll(s=>!s.document.cards.find(card=>card.id==='style').fields.colors.document)
  assert.ok((await read()).document.cards.find(card=>card.id==='style').fields.notes.document,'undeclared field reference preserved')
  await detail.getByRole('button',{name:'撤销',exact:true}).click()
  await poll(s=>s.document.cards.find(card=>card.id==='style').fields.colors.document?.segments.some(segment=>segment.kind==='reference'))
  assert.deepEqual((await read()).document.cards.find(card=>card.id==='style').fields,beforePreset)
  await detail.getByRole('button',{name:'高级设置',exact:true}).click()
  await page.setViewportSize({width:390,height:844})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  await detail.screenshot({path:join(output,'mobile-field-reference.png'),animations:'disabled'})
  await detail.getByRole('button',{name:'关闭详情',exact:true}).click()
  const observer=await context.newPage();await observer.addInitScript(()=>{window.__ENV={BACKEND_URL:window.location.origin}})
  await observer.goto(page.url());await observer.getByText('此画布当前只读',{exact:true}).waitFor()
  const revision=(await read()).revision
  for(const [kind,,label] of kinds){
    await observer.locator(`[data-card-id="${kind}"]`).press('Enter')
    const readonly=observer.locator('.wb-details:visible')
    await readonly.getByRole('button',{name:'高级设置',exact:true}).click()
    assert.equal(await readonly.getByRole('textbox',{name:label+'内容',exact:true}).isDisabled(),true)
    await readonly.getByRole('button',{name:'关闭详情',exact:true}).click()
  }
  assert.equal((await read()).revision,revision)
  await observer.close()
  assert.deepEqual(errors,[])
  console.log('Six designs: candidate inspect/insert, cross-field use, inactive retained refs, reload, add and mobile passed:',output)
} catch(error) { await debugPage?.screenshot({path:join(output,'failure.png'),animations:'disabled'}); throw error } finally { await cleanup() }
