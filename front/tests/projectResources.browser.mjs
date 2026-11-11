import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { browserCleanup, browserOutput } from './browser-runtime.mjs'
const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-project-resources-')
const server = await createServer({ root, server: { host: '127.0.0.1', port: 4546, strictPort: true, open: false } })
let browser
const cleanup = browserCleanup(() => ({ browser, server }))
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(10000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  for(const [kind,tab,label] of [['scene','scenes','场所'],['prop','props','道具'],['costume','costumes','服装']]) {
    const assets=[{id:'one',name:`${label}长名称测试`,description:'真实简介',thumbnail:'/api/cover'}, {id:'missing',name:`无图${label}`}, {id:'new',name:`新增${label}`},{id:'broken',name:`失效${label}`,thumbnail:'/api/broken'}]
    let links=[assets[0],assets[1],assets[3]].map((a,i)=>({id:i+1,project_id:'resources',[kind+'_id']:a.id})), attempts=0
    await page.route('**/api/**',async route=>{
      const req=route.request(),path=new URL(req.url()).pathname
      const respond=data=>route.fulfill({json:{success:true,data}})
      if(path==='/api/broken') return route.fulfill({status:404,body:'missing'})
      if(path==='/api/cover') return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="240" height="100"><rect width="240" height="100" fill="navy"/></svg>'})
      if(path.endsWith('/projects/resources')) return respond({id:'resources',name:'资源测试项目',stats:{}})
      if(path.endsWith('/project-assets/'+kind)) {
        if(req.method()==='POST') {links.push({id:4,project_id:'resources',[kind+'_id']:req.postDataJSON().asset_id});return respond(links.at(-1))}
        return respond({items:links,pagination:{total:links.length}})
      }
      if(path.includes('/project-assets/'+kind+'/')) {
        attempts++
        if(attempts===1)return route.fulfill({status:503,json:{detail:'取消关联失败'}})
        links=links.filter(l=>l.id!==Number(path.split('/').at(-1)));return respond({})
      }
      if(path.endsWith('/entities/'+kind))return respond({items:assets,pagination:{total:assets.length}})
      const asset=assets.find(a=>path.endsWith('/entities/'+kind+'/'+a.id))
      if(asset)return respond(asset)
      return respond({items:[],next_cursor:null})
    })
    await page.goto(`http://127.0.0.1:4546/projects/resources?tab=${tab}`)
    const preview=page.getByRole('button',{name:'预览'+assets[0].name,exact:true})
    await preview.waitFor()
    assert.equal(await preview.locator('img').evaluate(img=>getComputedStyle(img).objectFit),kind==='scene'?'cover':'contain')
    await preview.press('Enter')
    const image=page.getByRole('dialog',{name:assets[0].name,exact:true})
    await image.getByRole('button',{name:'Close'}).click({trial:true})
    await image.getByRole('button',{name:'Close'}).focus();await page.keyboard.press('Escape');await image.waitFor({state:'hidden'})
    await preview.and(page.locator(':focus')).waitFor()
    assert.equal(await page.getByRole('button',{name:'预览'+assets[1].name,exact:true}).count(),0)
    await page.getByText('未填写简介',{exact:true}).first().waitFor()
    await page.getByText('图片加载失败',{exact:true}).waitFor()
    assert.equal(await page.getByRole('button',{name:'预览'+assets[3].name,exact:true}).count(),0)
    for(const appearance of ['雾蓝微渐变','雾蓝纯色']) {
      await page.getByRole('button',{name:'用户与语言设置'}).click()
      await page.getByRole('menuitemradio',{name:appearance}).click()
      await page.getByRole('menuitemradio',{name:appearance}).waitFor({state:'hidden'})
      for(const [width,height] of [[1440,900],[1366,768],[1024,440],[375,768]]) {
        await page.setViewportSize({width,height});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
      const titleEdge = (await page.getByRole('heading', { name: kind === 'scene' ? '项目场景' : `项目${label}`, exact: true }).boundingBox()).x
      const cardEdge = (await page.getByRole('article').first().boundingBox()).x
      assert.ok(Math.abs(cardEdge - titleEdge) <= 1, 'resource cards align with the content title and share one page gutter')
        await page.screenshot({path:join(output,`${kind}-${appearance}-${width}.png`),animations:'disabled'})
      }
    }
    await page.setViewportSize({width:1440,height:900})
    const title=page.getByRole('link',{name:assets[0].name,exact:true})
    assert.ok((await title.getAttribute('href')).includes(`/assets/${tab}/one/edit?returnTo=`))
    await page.getByRole('button',{name:/从资产库关联/}).click()
    const associate=page.getByRole('dialog').filter({hasText:'从资产库关联'})
    await associate.getByRole('button',{name:'关联到项目',exact:true}).click();await associate.waitFor({state:'hidden'})
    await page.getByRole('link',{name:assets[2].name,exact:true}).waitFor()
    await page.getByRole('button',{name:assets[0].name+'更多操作',exact:true}).click()
    await page.getByRole('menuitem',{name:'取消关联',exact:true}).click()
    const confirm=page.getByRole('dialog').filter({hasText:'仅移除'})
    await confirm.getByRole('button',{name:'取消关联',exact:true}).click()
    await page.getByText('取消关联失败',{exact:true}).waitFor();assert.equal(await confirm.isVisible(),true)
    await confirm.getByRole('button',{name:'取消关联',exact:true}).click();await confirm.waitFor({state:'hidden'});await title.waitFor({state:'hidden'})
    assert.equal(attempts,2)
    await page.getByRole('button',{name:assets[2].name+'更多操作',exact:true}).click()
    await page.getByRole('menuitem',{name:'编辑',exact:true}).click();await page.waitForURL(`**/assets/${tab}/new/edit?returnTo=**`)
    links=[]
    await page.goto(`http://127.0.0.1:4546/projects/resources?tab=${tab}`)
    await page.getByText(/暂无项目/).waitFor()
    await page.getByRole('button',{name:/新建/}).click()
    const create=page.getByRole('dialog',{name:kind==='scene'?'新建场景':`新建${label}`,exact:true})
    await create.waitFor()
    await create.getByRole('button',{name:/^取\s*消$/}).click()
    await create.waitFor({state:'hidden'})
    await page.unroute('**/api/**')
  }
  console.log(JSON.stringify({output,passed:true}))
} finally {await cleanup()}
