import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { browserCleanup, browserOutput } from './browser-runtime.mjs'
const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-project-actors-')
const server = await createServer({ root, server: { host: '127.0.0.1', port: 4542, strictPort: true, open: false } })
let browser
const cleanup = browserCleanup(() => ({ browser, server }))
const actors = [
  { id: 'actor-one', name: '长名字演员用于验证完整名称', description: '真实演员简介', thumbnail: '/api/cover' },
  { id: 'actor-missing', name: '无图演员', description: '' },
  { id: 'actor-broken', name: '失败图片演员', thumbnail: '/api/broken' },
  { id: 'actor-new', name: '待关联演员' },
]
for (const actor of actors) Object.assign(actor,{project_id:actor.id==='actor-new'?null:'actors-project',visual_style:'现实',style:'真人都市'})
let deleteAttempts = 0
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(10000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  await page.route('**/api/**', async route => {
    const req=route.request(), path=new URL(req.url()).pathname
    const respond=data=>route.fulfill({json:{success:true,data}})
    if(path==='/api/cover') return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="240" height="100"><rect width="240" height="100" fill="navy"/></svg>'})
    if(path==='/api/broken') return route.fulfill({status:404,body:'missing'})
    if(path.endsWith('/projects/actors-project')) return respond({id:'actors-project',name:'演员测试项目',stats:{}})
    assert.ok(!path.includes('/project-assets/actor'), 'the list and deletion use independent project objects')
    const actor=actors.find(a=>path.endsWith('/entities/actor/'+a.id))
    if(actor) {
      if(req.method()==='DELETE') {
        deleteAttempts++
        if(deleteAttempts===1) return route.fulfill({status:503,json:{detail:'删除失败'}})
        actors.splice(actors.indexOf(actor),1)
        return respond({})
      }
      return respond(actor)
    }
    if(path.endsWith('/entities/actor')) {
      const projectId=new URL(req.url()).searchParams.get('project_id')
      const items=actors.filter(a=>a.project_id===projectId)
      return respond({items,pagination:{total:items.length}})
    }
    return respond({items:[],next_cursor:null})
  })
  await page.goto('http://127.0.0.1:4542/projects/actors-project?tab=actors')
  await page.getByRole('button',{name:'预览长名字演员用于验证完整名称',exact:true}).waitFor()
  assert.equal(await page.getByLabel('当前位置').count(),0, '普通项目页不显示面包屑')
  assert.equal(await page.getByRole('link',{name:'返回项目列表',exact:true}).count(),0)
  assert.equal(await page.getByText('已关联项目',{exact:true}).count(),0)
  const preview=page.getByRole('button',{name:'预览长名字演员用于验证完整名称',exact:true})
  await preview.press('Enter')
  const image=page.getByRole('dialog',{name:'长名字演员用于验证完整名称',exact:true})
  await image.waitFor(); await image.getByRole('button', { name: 'Close' }).click({ trial: true }); await image.getByRole('button', { name: 'Close' }).focus(); await page.keyboard.press('Escape'); await image.waitFor({state:'hidden'})
  await preview.and(page.locator(':focus')).waitFor()
  assert.equal(await page.getByRole('button',{name:'预览无图演员',exact:true}).count(),0)
  await page.getByText('图片加载失败',{exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'预览失败图片演员',exact:true}).count(),0)
  await page.getByText('未填写简介',{exact:true}).first().waitFor()
  assert.equal(await page.getByText(/actor_id：/).count(),0)
  const nameLink=page.getByRole('button',{name:actors[0].name,exact:true})
  const originalUrl=page.url()
  await nameLink.click()
  await page.getByRole('textbox',{name:'名称',exact:true}).waitFor()
  assert.equal(await page.getByRole('link',{name:'在资产库编辑 ↗',exact:true}).count(),0)
  assert.equal(page.url(),originalUrl)
  await page.getByRole('button',{name:'返回',exact:true}).click()
  await nameLink.waitFor()

  for(const appearance of ['雾蓝微渐变','雾蓝纯色']) {
    await page.getByRole('button',{name:'用户与语言设置'}).click()
    await page.getByRole('menuitemradio',{name:appearance}).click()
    await page.getByRole('menuitemradio',{name:appearance}).waitFor({state:'hidden'})
    for(const [width,height] of [[1440,900],[1366,768],[1024,440],[375,768]]) {
      await page.setViewportSize({width,height})
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
      const titleEdge = (await page.getByRole('heading', { name: '项目演员', exact: true }).boundingBox()).x
      const cardEdge = (await page.getByRole('article').first().boundingBox()).x
      assert.ok(Math.abs(cardEdge - titleEdge) <= 1, 'resource cards align with the content title and share one page gutter')
      await page.screenshot({path:join(output,`actors-${appearance}-${width}.png`),animations:'disabled'})
    }
  }
  await page.setViewportSize({width:1440,height:900})
  await page.getByRole('button',{name:actors[0].name+'更多操作',exact:true}).click()
  await page.getByRole('menuitem',{name:'删除项目对象',exact:true}).click()
  const confirm=page.getByRole('dialog').filter({hasText:'删除此项目对象'})
  await confirm.getByRole('button',{name:'删除项目对象',exact:true}).click()
  await confirm.getByText('删除失败',{exact:true}).waitFor()
  await confirm.getByRole('button',{name:'删除项目对象',exact:true}).click()
  await confirm.waitFor({state:'hidden'})
  await nameLink.waitFor({state:'hidden'})
  assert.equal(deleteAttempts,2)
  await page.getByRole('button',{name:'查看资产库',exact:true}).click()
  await page.getByRole('link',{name:'待关联演员',exact:true}).waitFor()
  console.log(JSON.stringify({output,passed:true}))
} finally { await cleanup() }
