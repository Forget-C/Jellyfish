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
const output = await browserOutput('jellyfish-generation-canvas-images-')
const api = 'http://127.0.0.1:8439', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8439' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4439, strictPort: true, open: false, proxy: { '/api': api } } })
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
  await page.goto(`http://127.0.0.1:4439/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  await page.locator('[data-card-id="m"]').press('Enter')
  await page.locator('.generation-material-composer').waitFor(); await openModelInspection(page)
  const editor = page.locator('.wb-details:not([hidden])')
  await editor.waitFor()
  assert.equal(await page.getByRole('button',{name:/运行到此处|运行所选模型/}).count(),0)
  await editor.getByRole('button',{name:'添加模型来源',exact:true}).click()
  await page.getByRole('menuitem',{name:'从当前画布选择',exact:true}).click()
  const picker=page.getByRole('dialog',{name:'选择画布来源',exact:true})
  await picker.getByRole('button',{name:/下方编辑内容|文本内容卡/}).first().click()
  await page.getByLabel('画布保存状态').getByText('已保存',{exact:true}).waitFor()
  const saved=(await (await fetch(`${base}/${canvas.id}`)).json()).data.document
  assert.equal(saved.edges.length,1)
  assert.equal(saved.cards.find(c=>c.id==='m').input_bindings?.length||0,0)
  await editor.getByRole('button',{name:'添加模型来源',exact:true}).click()
  await page.getByRole('menuitem',{name:'上传参考图片素材',exact:true}).click()
  const upload=page.getByRole('dialog',{name:'上传模型来源',exact:true})
  await upload.getByLabel('上传媒体文件',{exact:true}).setInputFiles({name:'tiny.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')})
  await upload.getByRole('img',{name:'图片预览',exact:true}).waitFor()
  await upload.getByRole('button',{name:'Close',exact:true}).click()
  await page.getByLabel('画布保存状态').getByText('已保存',{exact:true}).waitFor()
  const afterUpload=(await (await fetch(`${base}/${canvas.id}`)).json()).data.document
  assert.equal(afterUpload.edges.length,2)
  assert.equal(afterUpload.cards.find(c=>c.id==='m').input_bindings?.length||0,0)
  assert.ok(afterUpload.cards.some(c=>c.type==='content.image'&&c.file_id))
  await editor.getByRole('button',{name:'预检运行',exact:true}).click()
  const preview=page.getByRole('dialog',{name:'运行预检',exact:true})
  await preview.waitFor()
  await page.screenshot({path:join(output,'single-model-precheck.png')})
  const accepted=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/runs'))
  await preview.getByRole('button',{name:'确认执行',exact:true}).click()
  const run=(await (await accepted).json()).data
  await editor.getByRole('region',{name:'当前正式输出',exact:true}).waitFor()
  const snapshot=(await (await fetch(`${base}/${canvas.id}/runtime`)).json()).data
  assert.deepEqual(snapshot.runs.find(r=>r.id===run.run_id).nodes.map(n=>n.card_id),['m'])
  const controls=await (await fetch(`${api}/test/image-controls`)).json()
  assert.equal(controls.calls.length,1)
  await page.screenshot({path:join(output,'single-model-result.png')})
  await editor.getByRole('button',{name:'展开详情',exact:true}).click()
  await editor.getByRole('button',{name:'预检运行',exact:true}).waitFor()
  await page.screenshot({path:join(output,'expanded-submit.png')})
  console.log('PASS single model editor sources and admission',output)
} finally { await cleanup() }
