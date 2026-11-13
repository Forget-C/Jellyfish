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
for (const actor of actors) Object.assign(actor,{project_id:null,visual_style:'现实',style:'真人都市'})
let links = actors.slice(0,3).map((a,i) => ({ id: i+1, project_id: 'actors-project', actor_id: a.id }))
let unlinkAttempts = 0
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
    if(path.endsWith('/project-assets/actor')) {
      if(req.method()==='POST') { links.push({id:4,project_id:'actors-project',actor_id:req.postDataJSON().asset_id}); return respond(links.at(-1)) }
      return respond({items:links,pagination:{total:links.length}})
    }
    if(path.includes('/project-assets/actor/')) {
      unlinkAttempts++
      if(unlinkAttempts===1) return route.fulfill({status:503,json:{detail:'取消关联失败'}})
      links=links.filter(l=>l.id!==Number(path.split('/').at(-1))); return respond({})
    }
    const actor=actors.find(a=>path.endsWith('/entities/actor/'+a.id))
    if(actor)return respond(actor)
    if(path.endsWith('/entities/actor')) return respond({items:actors,pagination:{total:actors.length}})
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
  await page.getByRole('link',{name:'在资产库编辑 ↗',exact:true}).waitFor()
  assert.equal(page.url(),originalUrl)
  await page.getByRole('button',{name:'关闭',exact:true}).click()
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
  await page.getByRole('button',{name:/从资产库关联/}).click()
  const associate=page.getByRole('dialog',{name:'从资产库关联演员',exact:true})
  await associate.getByRole('button',{name:'关联到项目',exact:true}).click()
  await associate.waitFor({state:'hidden'})
  await page.getByRole('button',{name:'待关联演员',exact:true}).waitFor()
  assert.ok(links.some(l=>l.actor_id==='actor-new'))
  await page.getByRole('button',{name:actors[0].name+'更多操作',exact:true}).click()
  await page.getByRole('menuitem',{name:'编辑共享资产 ↗',exact:true}).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('menuitem',{name:'编辑共享资产 ↗',exact:true}).waitFor({state:'hidden'})
  await page.getByRole('button',{name:actors[0].name+'更多操作',exact:true}).click()
  await page.getByRole('menuitem',{name:'取消关联',exact:true}).click()
  const confirm=page.getByRole('dialog').filter({hasText:'仅移除项目关联，不删除资产库中的共享对象'})
  await confirm.getByRole('button',{name:'取消关联',exact:true}).click()
  await page.getByText('取消关联失败',{exact:true}).waitFor()
  assert.equal(await confirm.isVisible(),true)
  await nameLink.waitFor()
  await confirm.getByRole('button',{name:'取消关联',exact:true}).click()
  await confirm.waitFor({state:'hidden'})
  await nameLink.waitFor({state:'hidden'})
  assert.equal(unlinkAttempts,2)
  links = [{id:4,project_id:'actors-project',actor_id:'actor-new'}]
  await page.reload()
  const single = page.getByRole('article').filter({has:page.getByRole('button',{name:'待关联演员',exact:true})})
  await single.waitFor()
  const singleBox = await single.boundingBox()
  assert.ok(singleBox.width >= 228 && singleBox.width < 400, 'single project resource keeps a normal column width')
  await page.getByRole('button',{name:'查看资产库',exact:true}).click()
  const libraryCard=page.getByRole('article').filter({has:page.getByRole('link',{name:'待关联演员',exact:true})})
  await libraryCard.waitFor()
  assert.ok(Math.abs((await libraryCard.boundingBox()).width-singleBox.width)<2, 'same asset uses the same card grid across project/library')
  assert.equal(await libraryCard.getByText('暂无标签',{exact:true}).count(),0)
  await libraryCard.getByText('未填写简介',{exact:true}).waitFor()
  await page.goto('http://127.0.0.1:4542/projects/actors-project?tab=actors')
  await page.getByRole('button',{name:'待关联演员更多操作',exact:true}).click()
  const popupPromise=page.waitForEvent('popup')
  await page.getByRole('menuitem',{name:'编辑共享资产 ↗',exact:true}).click()
  const popup=await popupPromise
  await popup.waitForURL('**/assets/actors/actor-new/edit')
  assert.equal(page.url(),originalUrl)
  await popup.close()
  console.log(JSON.stringify({output,passed:true}))
} finally { await cleanup() }
