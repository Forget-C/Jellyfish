import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-c50-image-editor-')
const api = 'http://127.0.0.1:8560'
const base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8560' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser
const cleanup = browserCleanup(() => ({ browser, server, backend }))
try {
  let ready = false
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null) throw new Error('isolated backend exited')
    try { if ((await fetch(base)).ok) { ready = true; break } } catch { /* waiting for isolated server */ }
    await delay(250)
  }
  assert.ok(ready, 'isolated backend ready')
  writeFileSync(join(output, 'openapi.json'), JSON.stringify(await (await fetch(`${api}/openapi.json`)).json()))
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4560, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  const page = await context.newPage()
  page.setDefaultTimeout(8000)
  await context.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const response = await fetch(base, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'基础图片编辑'})})
  const canvas=(await response.json()).data
  const seeded=await fetch(`${base}/${canvas.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:'seed',expected_revision:0,document:{...canvas.document,cards:[{id:'image',type:'content.image'}],edges:[]}})})
  assert.ok(seeded.ok,await seeded.text())
  const read=async()=>(await(await fetch(`${base}/${canvas.id}`)).json()).data
  const saved=async()=>{for(let i=0;i<80;i++){const v=await read();if(v.document.cards[0].file_id)return v;await delay(100)}throw Error('image was not saved')}
  await page.goto(`http://127.0.0.1:4560/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  await page.locator('[data-card-id="image"]').press('Enter')
  const detail=page.locator('.wb-details:not([hidden])')
  await detail.getByText('添加一张图片',{exact:true}).waitFor({timeout:2000})
  assert.equal(await detail.getByRole('button',{name:'预检运行',exact:true}).count(),0)
  assert.equal(await detail.locator('input[type="file"]').isVisible(),false)
  await detail.screenshot({path:join(output,'image-empty.png')})
  const snapshots = []
  const closeEditor = async () => {
    for(let attempt=0;attempt<3 && await detail.isVisible();attempt++){ await page.keyboard.press('Escape'); await page.waitForTimeout(100) }
    assert.equal(await detail.isVisible(),false)
  }
  const capture = async (id, expanded = false) => {
    for (const [width,height] of [[1440,960],[390,844],[3830,1688]]) {
      await closeEditor()
      await page.setViewportSize({width,height})
      await page.getByRole('button',{name:'适应全部',exact:true}).click()
      const card=page.locator('[data-card-id="image"]')
      await card.waitFor()
      await card.screenshot({path:join(output,`${id}-${width}-card.png`)})
      await card.press('Enter')
      await detail.waitFor()
      if (expanded && width > 767) await detail.getByRole('button',{name:'展开详情',exact:true}).click()
      await page.waitForFunction(({width,expanded})=>{const d=document.querySelector('.wb-details:not([hidden])');return innerWidth===width&&!!d&&d.getAttribute('data-expanded')===String(expanded||width<768)}, {width,expanded})
      await page.waitForTimeout(150)
      await page.screenshot({path:join(output,`${id}-${width}-page.png`),fullPage:true})
      await detail.screenshot({path:join(output,`${id}-${width}-editor.png`)})
      await detail.getByRole('button',{name:id==='F06'?'上传图片':'替换图片',exact:true}).focus()
      assert.ok(await detail.getByRole('button',{name:id==='F06'?'上传图片':'替换图片',exact:true}).evaluate(el=>el===document.activeElement))
      assert.ok(await detail.getByRole('button',{name:id==='F06'?'从素材中选择':'选择素材',exact:true}).isVisible())
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
      snapshots.push({id,width,height,expanded,card:`${id}-${width}-card.png`,page:`${id}-${width}-page.png`,editor:`${id}-${width}-editor.png`})
    }
    await closeEditor()
    await page.setViewportSize({width:1440,height:960})
    await page.getByRole('button',{name:'适应全部',exact:true}).click()
    await page.locator('[data-card-id="image"]').press('Enter')
    await detail.waitFor()
  }
  await capture('F06')

  const input=detail.getByLabel('上传媒体文件')
  await detail.getByRole('button',{name:'上传图片',exact:true}).waitFor()
  const chooserPromise=page.waitForEvent('filechooser')
  await detail.getByRole('button',{name:'上传图片',exact:true}).click()
  await(await chooserPromise).setFiles([])
  assert.equal((await read()).document.cards[0].file_id,null,'cancelled chooser does not select a file')
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=slategray:s=320x180','-vf','drawbox=x=20:y=20:w=90:h=140:color=0xd3d3d3:t=fill,drawbox=x=160:y=60:w=120:h=80:color=0x404040:t=fill','-frames:v','1',join(output,'image-fixture.png')])
  const png={name:'街道素材-原始图片.png',mimeType:'image/png',buffer:readFileSync(join(output,'image-fixture.png'))}
  await input.setInputFiles(png)
  await detail.getByText('街道素材-原始图片',{exact:true}).waitFor()
  await detail.getByText('320 × 180',{exact:true}).waitFor()
  await detail.getByText('项目文件',{exact:true}).waitFor()
  await saved()
  const original=await detail.locator('img[alt="图片预览"]').getAttribute('src')
  await detail.screenshot({path:join(output,'image-ready.png')})
  await capture('F04')
  await capture('F05',true)
  writeFileSync(join(output,'matrix.json'),JSON.stringify(snapshots,null,2))
  const fileId=(await read()).document.cards[0].file_id
  const downloadPattern=`**/api/v1/studio/files/${fileId}/download`
  let releaseImage
  const imageHeld=new Promise(resolve=>{releaseImage=resolve})
  await page.route(downloadPattern,async route=>{await imageHeld;await route.continue()})
  await page.reload({waitUntil:'domcontentloaded'})
  await page.locator('[data-card-id="image"]').press('Enter')
  await detail.getByText('图片加载中',{exact:true}).waitFor()
  await detail.getByText('未知',{exact:true}).waitFor()
  await page.waitForTimeout(150)
  await detail.screenshot({path:join(output,'image-loading-unknown-dimensions.png')})
  releaseImage()
  await detail.getByText('320 × 180',{exact:true}).waitFor()
  await page.locator('[data-card-id="image"]').getByText('320 × 180',{exact:true}).waitFor()
  await page.unroute(downloadPattern)
  const infoPattern=`**/api/v1/studio/files/${fileId}`
  await page.route(infoPattern,route=>route.fulfill({status:503,contentType:'application/json',body:'{}'}))
  await page.reload()
  await page.locator('[data-card-id="image"]').press('Enter')
  await detail.getByText('文件信息不可用',{exact:true}).waitFor()
  await page.waitForTimeout(150)
  assert.equal(await detail.getByRole('button',{name:'替换图片',exact:true}).evaluate(button=>{const r=button.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!hit&&button.contains(hit)}),true,'first reopen must leave replacement action actually reachable')
  await detail.screenshot({path:join(output,'image-unknown-file-info.png')})
  assert.equal((await read()).document.cards[0].file_id,fileId)
  await page.unroute(infoPattern)
  await page.reload()
  await page.locator('[data-card-id="image"]').press('Enter')
  await detail.getByText('街道素材-原始图片',{exact:true}).waitFor()

  let releaseUpload
  const uploadHeld=new Promise(resolve=>{releaseUpload=resolve})
  await page.route('**/api/v1/studio/files/upload',async route=>{await uploadHeld;await route.fulfill({status:500,body:'{}'})},{times:1})
  await input.setInputFiles({...png,name:'失败替换.png'})
  await detail.getByText('上传中，暂不发布有效输出',{exact:true}).waitFor()
  await detail.screenshot({path:join(output,'image-uploading.png')})
  releaseUpload()
  await detail.getByText('上传失败，原文件已保留。请选择文件重试。').waitFor()
  assert.equal(await detail.locator('img[alt="图片预览"]').getAttribute('src'),original)
  await detail.getByText('街道素材-原始图片',{exact:true}).waitFor()
  await detail.getByRole('alert').scrollIntoViewIfNeeded()
  await detail.screenshot({path:join(output,'image-replacement-failed.png')})
  const retryChooser=page.waitForEvent('filechooser')
  await detail.getByRole('button',{name:'替换图片',exact:true}).click()
  await (await retryChooser).setFiles([])
  assert.equal((await read()).document.cards[0].file_id,fileId,'cancelled retry retains original identity')
  await detail.getByRole('button',{name:'展开详情',exact:true}).click()
  await detail.getByText('街道素材-原始图片',{exact:true}).waitFor()
  await detail.screenshot({path:join(output,'image-expanded.png')})
  await detail.getByRole('button',{name:'收起详情',exact:true}).click()
  await page.reload()
  await page.locator('[data-card-id="image"]').press('Enter')
  await detail.getByText('街道素材-原始图片',{exact:true}).waitFor()
  assert.equal(await detail.locator('img[alt="图片预览"]').getAttribute('src'),original)
  await detail.getByRole('button',{name:'选择素材',exact:true}).click()
  await page.getByRole('button',{name:'选用 街道素材-原始图片',exact:true}).click()
  await page.getByRole('dialog',{name:'项目文件库',exact:true}).waitFor({state:'hidden'})
  const observer=await page.context().newPage()
  await observer.goto(page.url())
  await observer.getByText('此画布当前只读',{exact:true}).waitFor()
  await observer.locator('[data-card-id="image"]').press('Enter')
  const readonly=observer.locator('.wb-details:visible')
  await readonly.getByText('只读，无法上传或替换图片',{exact:true}).waitFor()
  assert.ok(await readonly.getByRole('button',{name:'替换图片',exact:true}).isDisabled())
  await readonly.getByText('只读，无法上传或替换图片',{exact:true}).scrollIntoViewIfNeeded()
  await page.waitForTimeout(150)
  await readonly.screenshot({path:join(output,'image-readonly.png')})
  await observer.close()
  for(const [width,height] of [[1440,960],[390,844]]){
    await page.setViewportSize({width,height})
    await detail.getByText('街道素材-原始图片',{exact:true}).waitFor()
    await page.waitForFunction(width=>{const d=document.querySelector('.wb-details:not([hidden])');return innerWidth===width&&!!d&&(width>767?d.getAttribute('data-expanded')==='false':d.getAttribute('data-expanded')==='true')},width)
    await page.screenshot({path:join(output,`image-${width}.png`),fullPage:true})
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  }
  console.log('C57 F04–F06 three viewports; direct actions, metadata, replacement failure, selection, readonly and HTTP reopen passed:',output)
} finally { await cleanup() }
