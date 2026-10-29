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
const api = 'http://127.0.0.1:8533', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8533' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4533, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '多图与未完成成果' }) })).json()).data
  const document = { ...canvas.document, cards: [{ id: 'text', type: 'content.text', text: '下方编辑内容' }, { id: 'm', type: 'model.image', model_id: 'canvas-image-model', prompt: { segments: [{id:'p',kind:'text',text:'portrait'}] }, config: {count:3} }, { id: 'image', type: 'content.image' }, { id: 'ref', type: 'reference.character', title: '参考人物', angle: '正面', objects: [] }, ...['content.basis','content.object','content.place','content.video','content.audio','reference.place','reference.prop','reference.costume','model.text','model.video'].map((type,index)=>({id:`kind-${index}`,type}))], edges: [] }
  const seeded = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document }) })
  assert.ok(seeded.ok, await seeded.text())
  await page.goto(`http://127.0.0.1:4533/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  await page.locator('[data-card-id="m"]').press('Enter')
  const editor = page.locator('.wb-details:not([hidden])')
  await editor.waitFor()
  await editor.getByText('创作描述',{exact:true}).waitFor()
  const toolbar=editor.locator('.generation-material-footer')
  const shape=await toolbar.boundingBox(), surface=await editor.boundingBox()
  assert.ok(Math.abs(shape.width-surface.width)<4,'parameter toolbar spans the full editor')
  assert.ok(shape.height<=48,'parameter toolbar remains a compact single row')
  const basis = editor.getByRole('region',{name:'本次创作依据',exact:true})
  await basis.waitFor()
  assert.match(await basis.innerText(), /尚未采用/)
  assert.equal(await editor.getByRole('region',{name:'候选参考区',exact:true}).isVisible(),false)
  await editor.getByRole('button',{name:'预检运行',exact:true}).waitFor()
  await page.screenshot({path:join(output,'material-empty.png')})
  await editor.getByLabel('管理候选与采用',{exact:true}).click()
  const close=editor.getByRole('button',{name:'关闭详情',exact:true})
  await page.screenshot({path:join(output,'material-candidates-close.png')})
  assert.equal(await close.evaluate(element=>{const box=element.getBoundingClientRect();return element.contains(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2))}),true,'candidate management must not cover the editor close button')
  await close.click()
  await editor.waitFor({state:'hidden'})
  await page.locator('[data-card-id="m"]').press('Enter')
  await editor.waitFor()
  if (!await editor.getByRole('region',{name:'候选参考区',exact:true}).isVisible()) await editor.getByLabel('管理候选与采用',{exact:true}).click()
  await editor.getByRole('button',{name:'添加文本参考',exact:true}).click()
  await page.getByLabel('画布保存状态').getByText('已保存',{exact:true}).waitFor()
  const connected=(await (await fetch(`${base}/${canvas.id}`)).json()).data
  const source=connected.document.cards.find(c=>c.id!=='text'&&c.type==='content.text')
  assert.ok(source)
  const next={...connected.document,cards:connected.document.cards.map(c=>c.id===source.id?{...c,text:'雨夜街道，张三抬头望向街角的灯光。'}:c)}
  const updated=await fetch(`${base}/${canvas.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:'basis-content',expected_revision:connected.revision,document:next})})
  assert.ok(updated.ok,await updated.text())
  await page.reload(); await page.locator('[data-card-id="m"]').press('Enter'); await editor.waitFor()
  await editor.getByLabel('管理候选与采用',{exact:true}).click()
  await editor.getByRole('button',{name:'采用 @文本1',exact:true}).click()
  await page.getByLabel('画布保存状态').getByText('已保存',{exact:true}).waitFor()
  await editor.getByLabel('管理候选与采用',{exact:true}).click()
  await basis.getByText(/雨夜街道/).first().waitFor()
  assert.match(await basis.innerText(),/雨夜街道/)
  assert.equal(await editor.getByRole('region',{name:'已保存直接输入',exact:true}).isVisible(),false)
  await editor.getByRole('textbox',{name:'模型正文',exact:true}).fill('保持雨夜氛围，以自然的光线表现人物。')
  await page.getByLabel('画布保存状态').getByText('已保存',{exact:true}).waitFor()
  await editor.getByRole('button',{name:'添加模型来源',exact:true}).click()
  await page.getByRole('menuitem',{name:'上传参考图片素材',exact:true}).click()
  const upload=page.getByRole('dialog',{name:'上传模型来源',exact:true})
  const illustration=await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=360;canvas.height=180;const ctx=canvas.getContext('2d');
    ctx.fillStyle='#455a64';ctx.fillRect(0,0,360,180);ctx.fillStyle='#263238';ctx.fillRect(0,110,360,70);
    ctx.fillStyle='#78909c';for(let x=0;x<360;x+=55)ctx.fillRect(x,25+(x%3)*12,44,95);
    ctx.fillStyle='#ffcc80';for(let x=10;x<360;x+=55){ctx.fillRect(x,50,9,15);ctx.fillRect(x+15,80,9,15)}
    ctx.fillStyle='#ffb74d';ctx.fillRect(174,95,16,48);ctx.beginPath();ctx.arc(182,85,10,0,7);ctx.fill();
    return canvas.toDataURL('image/png').split(',')[1]
  })
  await upload.getByLabel('上传媒体文件',{exact:true}).setInputFiles({name:'街道构图示意.png',mimeType:'image/png',buffer:Buffer.from(illustration,'base64')})
  await upload.getByRole('img',{name:'图片预览',exact:true}).waitFor()
  await upload.getByRole('button',{name:'Close',exact:true}).click()
  await page.getByLabel('画布保存状态').getByText('已保存',{exact:true}).waitFor()
  await editor.getByLabel('管理候选与采用',{exact:true}).click()
  await editor.getByRole('button',{name:'采用 @图片1',exact:true}).click()
  await page.getByLabel('画布保存状态').getByText('已保存',{exact:true}).waitFor()
  await editor.getByLabel('管理候选与采用',{exact:true}).click()
  await basis.getByRole('img',{name:'图片预览',exact:true}).waitFor()
  assert.equal(await editor.getByLabel('已采用引用标签',{exact:true}).count(),0,'adopted sources are not repeated above the prompt')
  const sharedSurface=await editor.locator('.generation-material-basis,.generation-material-footer').evaluateAll(es=>es.map(e=>({border:getComputedStyle(e).borderWidth,background:getComputedStyle(e).backgroundColor})))
  assert.ok(sharedSurface.every(x=>x.border==='0px'&&x.background==='rgba(0, 0, 0, 0)'),'sources and toolbar form a shared unsegmented surface')
  await page.screenshot({path:join(output,'material-adopted.png')})
  await editor.screenshot({path:join(output,'material-adopted-detail.png')})
  await editor.getByLabel('管理候选与采用',{exact:true}).click()
  await page.screenshot({path:join(output,'material-populated-candidates-close.png')})
  assert.equal(await close.evaluate(element=>{const box=element.getBoundingClientRect();return element.contains(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2))}),true,'populated candidate management must leave the close button reachable')
  await close.click()
  await editor.waitFor({state:'hidden'})
  await page.locator('[data-card-id="m"]').press('Enter')
  await editor.waitFor()
  if (await editor.getByRole('region',{name:'候选参考区',exact:true}).isVisible()) await editor.getByLabel('管理候选与采用',{exact:true}).click()

  await editor.getByRole('button',{name:'展开详情',exact:true}).click()
  await page.screenshot({path:join(output,'material-expanded.png')})
  await page.setViewportSize({width:390,height:844})
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  await delay(200)
  await page.screenshot({path:join(output,'material-mobile.png')})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  await basis.getByText(/雨夜街道/).first().waitFor()
  assert.match(await basis.innerText(),/雨夜街道/)
  await editor.getByRole('button',{name:'预检运行',exact:true}).scrollIntoViewIfNeeded()
  await page.setViewportSize({width:3830,height:1688})
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  await delay(200)
  await page.screenshot({path:join(output,'material-large.png')})
  await editor.getByRole('button',{name:'关闭详情',exact:true}).click()
  await editor.getByRole('button',{name:'预检运行',exact:true}).click()
  const preview=page.getByRole('dialog',{name:'运行预检',exact:true})
  await preview.waitFor()
  const accepted=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/runs'))
  await preview.getByRole('button',{name:'确认执行',exact:true}).click()
  const run=(await (await accepted).json()).data
  await editor.getByText('运行状态与正式输出',{exact:true}).click()
  await editor.getByRole('region',{name:'当前正式输出',exact:true}).waitFor()
  const snapshot=(await (await fetch(`${base}/${canvas.id}/runtime`)).json()).data
  assert.deepEqual(snapshot.runs.find(r=>r.id===run.run_id).nodes.map(n=>n.card_id),['m'])
  const reopened=(await (await fetch(`${base}/${canvas.id}`)).json()).data.document.cards.find(c=>c.id==='m')
  assert.equal(reopened.input_bindings.length,2)
  await page.reload(); await page.locator('[data-card-id="m"]').press('Enter'); await basis.waitFor()
  await basis.getByText(/雨夜街道/).first().waitFor()
  assert.match(await basis.innerText(),/雨夜街道/)
  await basis.getByRole('button',{name:'取消采用 @图片1',exact:true}).click()
  await page.getByLabel('画布保存状态').getByText('已保存',{exact:true}).waitFor()
  const removed=(await (await fetch(`${base}/${canvas.id}`)).json()).data.document.cards.find(c=>c.id==='m')
  assert.equal(removed.input_bindings.length,1,'compact source removal changes only the explicitly selected input')
  // All three model modalities retain the same material surface without invented parameters.
  for (const id of ['kind-8','kind-9']) {
    await page.locator(`[data-card-id="${id}"]`).press('Enter')
    await editor.getByRole('region',{name:'本次创作依据',exact:true}).waitFor()
    const emptyPrompt=editor.getByRole('textbox',{name:'模型正文',exact:true})
    await emptyPrompt.waitFor()
    assert.ok(await emptyPrompt.getAttribute('aria-placeholder'),'empty inputs have visible guidance')
    assert.equal(await editor.getByRole('button',{name:'预检运行',exact:true}).isDisabled(),true,'empty model without adopted input cannot submit')
    const firstOpen=await editor.getByRole('button',{name:'预检运行',exact:true}).boundingBox()
    assert.ok(firstOpen.y>=64&&firstOpen.y+firstOpen.height<=1688-60,'first open uses final editor geometry and keeps submit visible')
  }

  console.log('PASS material composer',output)
} catch(error) { if(page) { await page.screenshot({path:join(output,'failure.png')}); writeFileSync(join(output,'failure-geometry.json'),JSON.stringify(await page.locator('.wb-details:not([hidden]),.generation-material-footer').evaluateAll(es=>es.map(e=>({tag:e.className,rect:e.getBoundingClientRect().toJSON()}))))) } throw error } finally { await cleanup() }
