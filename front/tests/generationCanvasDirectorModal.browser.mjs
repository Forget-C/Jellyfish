import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import assert from 'node:assert/strict'
import { openCardList, closeCanvasDetails } from './generationCanvasWorkbench.browser-helpers.mjs'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-generation-canvas-')
const api = 'http://127.0.0.1:8437'
const base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    PYTHONPATH: join(root, '../backend'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_PORT: '8437' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4437, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  page.setDefaultTimeout(8000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const created = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '导演输出与键盘提示' }) })).json()).data
  const id = created.id
  const field = (text, state = 'proposal') => ({ text, state, purpose: 'design' })
  const types = ['lighting','composition','camera','movement','focus','style','situation','performance','performance_rule','anchor','blocking','activity','environment','narrative','beat','event','shot','dialogue','sound','space_rule','continuity','fact','creative_control','guidance','criterion']
  const cards = types.map(type => ({id:type,type:'direction.'+type,input_bindings:[],examples:[],scope:{},...(type==='dialogue'?{dialogue_id:'dialogue-one'}:{})}))
  const save = await fetch(`${base}/${id}`, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:crypto.randomUUID(),expected_revision:created.revision,document:{...created.document,cards}})})
  assert.ok(save.ok,await save.clone().text())
  await page.goto(`http://127.0.0.1:4437/projects/canvas-project/generation-canvas?canvas=${id}`)
  const photo = page.locator('[data-card-id="lighting"]')
  await photo.locator('.generation-card-body').click()
  const details=page.locator('.wb-details:visible')
  assert.equal(await details.getAttribute('role'),'dialog','complex editor is a modal')
  await details.getByRole('button',{name:'高级设置',exact:true}).click()
  await details.getByRole('textbox',{name:'光源内容',exact:true}).fill('保存后的夜间轮廓光')
  await page.locator('.generation-editor-mask').click({position:{x:10,y:10}})
  await details.waitFor({state:'hidden'})
  await photo.locator('.generation-card-body').click()
  assert.equal(await details.getByRole('textbox',{name:'光源内容',exact:true}).evaluate(element => 'value' in element ? element.value : element.innerText),'保存后的夜间轮廓光')
  await page.screenshot({path:join(output,'director-modal-desktop.png')})
  await closeCanvasDetails(page)
  for (const type of types) {
    const card=page.locator(`[data-card-id="${type}"]`)
    await card.press('Enter')
    await details.waitFor()
    assert.equal(await card.getAttribute('data-selected'),'true','keyboard activation selects the card')
    assert.equal(await details.getAttribute('role'),'dialog',type)
    assert.equal(await details.getByRole('button',{name:'关闭详情',exact:true}).count(),1,'complex card retains its close control')
    await closeCanvasDetails(page)
  }
  await page.setViewportSize({width:390,height:844})
  await photo.press('Enter')
  assert.ok(await details.evaluate(e=>e.scrollWidth<=e.clientWidth),'mobile editor has no horizontal overflow')
  await page.screenshot({path:join(output,'director-modal-mobile.png')})
  await page.keyboard.press('Escape');await details.waitFor({state:'hidden'})
  await page.getByLabel('画布保存状态').getByText('已保存',{exact:true}).waitFor()
  const saved=(await (await fetch(`${base}/${id}`)).json()).data
  assert.equal(saved.document.cards.find(c=>c.id==='lighting').fields.light_sources.text,'保存后的夜间轮廓光')
  await page.reload();await photo.press('Enter')
  assert.equal(await details.getByRole('textbox',{name:'光源内容',exact:true}).evaluate(element => 'value' in element ? element.value : element.innerText),'保存后的夜间轮廓光')
  await closeCanvasDetails(page)
  await page.setViewportSize({width:1440,height:960})
  for (const [entry,kind] of [['景别与构图卡','composition'],['机位与视角卡','camera'],['运镜卡','movement'],['光影与色彩卡','lighting'],['焦点与成像卡','focus']]) {
    await openCardList(page,'画面设计')
    await page.getByRole('navigation',{name:'添加卡片',exact:true}).getByRole('button',{name:entry,exact:true}).click()
    assert.equal(await page.locator('.wb-details:visible').count(),0,'new director card is selected without opening modal')
    const addedId=await page.locator('[data-card-id][data-selected="true"]').getAttribute('data-card-id')
    const added=page.locator(`[data-card-id="${addedId}"]`)
    await added.press('Enter')
    await details.getByRole('button',{name:'高级设置',exact:true}).waitFor({state:'visible'})
    await page.getByLabel('画布保存状态').getByText('已保存',{exact:true}).waitFor()
    const latest=(await (await fetch(`${base}/${id}`)).json()).data
    assert.equal(latest.document.cards.find(c=>c.id===addedId).type,'direction.'+kind)
    await closeCanvasDetails(page)
  }
  console.log('all director card modal entry, backdrop close, retained edits, autosave and reopen passed')
} finally { await cleanup() }
