import { createStoryboardCanvas, storyboardCanvasApi, storyboardCanvasPath } from './storyboard-canvas-fixture.mjs'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-generation-canvas-')
const api = 'http://127.0.0.1:8484'
const base = `${api}/api/v1/studio/generation-canvases`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    PYTHONPATH: join(root, '../backend'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_PORT: '8484' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4484, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  page.setDefaultTimeout(8000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const created = await createStoryboardCanvas(base, '导演输出与键盘提示')
  const id = created.id
  const field = (text, state = 'proposal') => ({ text, state, purpose: 'design' })
  const samples = [
    ['photo-light','direction.lighting',{fields:{light_sources:field('窗边柔光')}} ,'窗边柔光'],
    ['photo-camera','direction.camera',{fields:{viewpoint:field('低角度观察')}} ,'低角度观察'],
    ['photo-focus','direction.focus',{fields:{focus_change:field('焦点移向远处')}} ,'焦点移向远处'],
    ['performance','direction.performance',{gaze:field('目光避开对方')},'目光避开对方'],
    ['sound','direction.sound',{action_sound:field('脚步踏过积水')},'脚步踏过积水'],
    ['guidance','direction.guidance',{prohibitions:field('禁止出现字幕')},'禁止出现字幕'],
    ['control','direction.creative_control',{keep:field('保留红色围巾')},'保留红色围巾'],
    ['beat','direction.beat',{obstacle:field('出口被封住')},'出口被封住'],
    ['anchor','direction.anchor',{spatial_relation:field('门旁固定位置')},'门旁固定位置'],
    ['space','direction.space_rule',{axis:field('主轴沿街道方向')},'主轴沿街道方向'],
    ['narrative','direction.narrative',{open_questions:field('观众尚不知道钥匙去向')},'观众尚不知道钥匙去向'],
    ['shot','direction.shot',{narrative_role:field('建立人物距离')},'建立人物距离'],
    ['blocking','direction.blocking',{initiative:field('主动向门口靠近')},'主动向门口靠近'],
    ['activity','direction.activity',{attention:field('留意窗外声音')},'留意窗外声音'],
    ['environment','direction.environment',{reason:field('以空场突出孤立')},'以空场突出孤立'],
    ['continuity','direction.continuity',{following_constraints:field('后续保持左手持杯')},'后续保持左手持杯'],
    ['phase','direction.movement',{phases:[{id:'one',frame:field('阶段结束在门框')} ]},'阶段结束在门框'],
    ['framing','direction.composition',{fields:{shot_size:{...field('', 'fact'),size:'close_up'}}},'特写'],
    ['metadata','direction.guidance',{source_locator:'不能作为设计摘要',scope:{description:'也不是正文'}},'尚未填写生成指导'],
    ['negative','direction.lighting',{fields:{light_sources:field('', 'absent')}},'明确没有'],
    ['open','direction.guidance',{prohibitions:field('可尝试留白','undecided')},'待确定'],
  ]
  const cards = samples.map(([id,type,values])=>({id,type,input_bindings:[],examples:[],scope:{},...values}))
  const save = await fetch(storyboardCanvasApi(base, id), {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:crypto.randomUUID(),expected_revision:created.revision,document:{...created.document, cards: [...cards, ...created.document.cards]}})})
  assert.ok(save.ok,await save.clone().text())
  await page.goto(`http://127.0.0.1:4484${storyboardCanvasPath(created)}`)
  for(const [cardId,, , expected] of samples){
    const card=page.locator(`[data-card-id="${cardId}"]`)
    await card.waitFor()
    assert.ok((await card.innerText()).includes(expected),`${cardId} shows its own non-primary design content: ${expected}`)
  }
  const photo=page.locator('[data-card-id="photo-light"]')
  await photo.press('Enter')
  const details=page.locator('.wb-details:visible')
  const advanced = details.getByRole('button',{name:'高级设置',exact:true})
  if (await advanced.isVisible()) await advanced.click()
  await details.getByRole('textbox',{name:'光源内容',exact:true}).fill('即时改为夜间轮廓光')
  assert.ok((await photo.innerText()).includes('即时改为夜间轮廓光'),'card reflects own edit immediately')
  await page.getByRole('button',{name:'关闭详情',exact:true}).click()
  await photo.getByRole('button',{name:'左侧连接点',exact:true}).focus()
  await page.getByRole('tooltip').filter({hasText:'文本'}).waitFor()
  await page.waitForTimeout(250)
  await page.screenshot({path:join(output,'director-focus-desktop.png'),animations:'disabled'})
  await photo.getByRole('button',{name:/^移动布局：/}).focus()
  await page.getByRole('tooltip').filter({hasText:'文本'}).waitFor({state:'hidden'})
  await page.setViewportSize({width:390,height:844})
  await page.getByRole('button',{name:'适应全部',exact:true}).click()
  await page.screenshot({path:join(output,'director-summary-mobile.png'),animations:'disabled'})
  console.log('director fallback content, field state, immediate edits and keyboard output hints verified')
} finally { await cleanup() }
