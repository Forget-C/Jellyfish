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
const output = await browserOutput('jellyfish-generation-canvas-performance-')
const api = 'http://127.0.0.1:8285', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8285' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4285, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '命名图片参考' }) })).json()).data
  const extractionLocator = '第三章第2段'.repeat(20)
  const document = { ...canvas.document, cards: [
    { id: 'ref', type: 'content.character', object_id: 'alice', name: '小雪', text: '人物' },
    { id: 'ref2', type: 'content.character', object_id: 'bob', name: '小明', text: '人物' },
    { id: 'act', type: 'direction.performance', source_locator: '原文第三章', physical_action: { text: '旧动作', state: 'not_applicable', purpose: 'background', source_locator: extractionLocator, authorship: 'model' }, voice: { state: 'absent', authorship: 'model' }, hands: { authorship: 'model' }, breath: { text: '历史呼吸', state: 'proposal', source_locator: '旧记录' } },
    { id: 'situation', type: 'direction.situation' },
    { id: 'rule', type: 'direction.performance_rule' },
    { id: 'activity', type: 'direction.activity', task: { text: '持续整理' } },
    { id: 'consumer', type: 'model.image', model_id: 'canvas-image-model', config: { count: 3 } }],
    edges: [
      { id: 'person2', source_card: 'ref2', source_port: 'object', target_card: 'act', target_port: 'participant' },
      { id: 'person', source_card: 'ref', source_port: 'object', target_card: 'act', target_port: 'participant' },
      { id: 'design', source_card: 'act', source_port: 'text', target_card: 'consumer', target_port: 'text' }],
    input_order: { act: { participant: ['person', 'person2'] }, consumer: { text: ['design'] } } }
  const seeded = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document }) })
  assert.ok(seeded.ok, await seeded.text())
  await page.goto(`http://127.0.0.1:4285/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const card = page.locator('.wb-details:not([hidden])')
  const open = async (id, advanced = true) => {
    await openCanvasCard(page, id)
    if (advanced && await card.getByRole('button', { name: '高级设置', exact: true }).count()) await card.getByRole('button', { name: '高级设置', exact: true }).click()
  }
  const read = async () => (await (await fetch(`${base}/${canvas.id}`)).json()).data
  const poll = async predicate => { for (let i = 0; i < 80; i++) { const state = await read(); if (predicate(state)) return state; await delay(150) } throw Error('saved document did not reach expected state') }
  await open('act')
  const popover = page.locator('.design-source-inspect:visible')
  const candidate = name => card.getByRole('button', {name: new RegExp('候选 .*' + name)})
  await candidate('小雪').click()
  await popover.getByRole('button', {name:'用作参与对象',exact:true}).click()
  await poll(state => state.document.cards.find(item => item.id === 'act').input_bindings?.some(binding => binding.source.object_id === 'alice'))
  await popover.getByRole('button').first().press('Escape')
  await popover.waitFor({state:'hidden'})
  await candidate('小明').click()
  await popover.getByRole('button', {name:/替换参与对象/}).click()
  await poll(state => state.document.cards.find(item => item.id === 'act').input_bindings?.length === 1 && state.document.cards.find(item => item.id === 'act').input_bindings[0].source.object_id === 'bob')
  await popover.getByRole('button', {name:'解除参与对象',exact:true}).click()
  const cleared = await poll(state => state.document.cards.find(item => item.id === 'act').input_bindings?.length === 0)
  assert.ok(cleared.document.edges.some(edge => edge.id === 'person2'))
  await popover.getByRole('button').first().press('Escape')
  await popover.waitFor({state:'hidden'})
  await card.getByRole('textbox',{name:'身体动作内容',exact:true}).fill('伸手')
  const body = await card.boundingBox()
  const tabs = card.locator('.design-parameter-tabs')
  const navStyle = await tabs.locator('.ant-tabs-nav').evaluate(node => ({ border: getComputedStyle(node,'::before').borderBottomWidth, height: node.querySelector('.ant-tabs-tab').getBoundingClientRect().height }))
  assert.equal(navStyle.border,'0px')
  assert.equal(navStyle.height,32)
  assert.deepEqual(await tabs.locator('.design-tab-label').first().evaluate(node => ({ gap:getComputedStyle(node).gap, margin:getComputedStyle(node.querySelector('.anticon')).marginRight, icon:getComputedStyle(node.querySelector('.anticon')).fontSize })),{gap:'4px',margin:'0px',icon:'12px'})

  const motivation = card.getByRole('tab',{name:/动机背景/})
  const beforeWidth = (await motivation.boundingBox()).width

  await card.getByRole('tab',{name:/动机背景/}).click()
  await card.getByRole('textbox',{name:'人物目标内容',exact:true}).fill('拿到钥匙')
  assert.equal(Math.round((await card.boundingBox()).height), Math.round(body.height))
  assert.equal((await motivation.boundingBox()).width,beforeWidth,'content marker does not resize a tab')
  await motivation.focus()
  await page.getByRole('tooltip').filter({hasText:'已有内容'}).waitFor()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')

  await card.getByRole('tab',{name:/表现细节/}).click()
  await card.getByRole('textbox',{name:'手部内容',exact:true}).fill('掌心朝上')
  await page.waitForFunction(() => [...document.querySelectorAll('.ant-tooltip')].every(node => getComputedStyle(node).display === 'none' || getComputedStyle(node).opacity === '0'))
  await page.screenshot({path:join(output,'performance-tabs-desktop.png'),fullPage:true})
  assert.equal(await card.locator('.design-parameter-page:visible').evaluate(element => element.scrollHeight > element.clientHeight + 1),false,'desktop details fit without body scrolling')
  await card.getByRole('tab',{name:/动作过程/}).click()
  await card.getByRole('button',{name:'返回预设',exact:true}).click()
  assert.equal(await card.locator('.design-parameter-tabs').isVisible(),false)
  await card.getByRole('button',{name:'高级设置',exact:true}).click()
  assert.equal(await card.getByRole('tab',{name:/动作过程/}).getAttribute('aria-selected'),'true')
  assert.equal(await card.getByRole('textbox',{name:'身体动作内容',exact:true}).textContent(),'伸手')
  await open('activity')
  await card.getByRole('tab',{name:/空间与时序/}).click()
  await card.getByRole('spinbutton',{name:'反应延迟毫秒',exact:true}).fill('250')
  await poll(state => state.document.cards.find(item => item.id === 'activity').delay_ms === 250)
  await page.screenshot({path:join(output,'activity-tabs-desktop.png'),fullPage:true})
  await page.setViewportSize({width:390,height:844})
  assert.equal(await card.locator('.design-parameter-tabs .ant-tabs-tab').first().evaluate(node=>node.getBoundingClientRect().height),36)
  const activePage = card.locator('.ant-tabs-tabpane-active .design-parameter-page')
  await activePage.evaluate(element => { element.scrollTop = 100 })
  await delay(100)
  const savedScroll = await activePage.evaluate(element => element.scrollTop)
  assert.ok(savedScroll > 0)
  await card.getByRole('tab',{name:/活动内容/}).click()
  await card.getByRole('tab',{name:/空间与时序/}).click()
  await delay(100)
  assert.equal(await activePage.evaluate(element => element.scrollTop),savedScroll)
  await page.screenshot({path:join(output,'activity-tabs-mobile.png'),fullPage:true})
  const overflow = await card.evaluate(element => element.scrollWidth > element.clientWidth + 1)
  assert.equal(overflow,false)
  console.log('PASS candidate adoption/replacement/removal, retained connections, grouped fields and stable layout')
} finally { await cleanup() }
