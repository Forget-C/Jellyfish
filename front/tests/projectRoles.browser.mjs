import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { browserCleanup, browserOutput } from './browser-runtime.mjs'
const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-project-roles-')
const origin='http://127.0.0.1:4543'
const server = await createServer({ root, server: { host: '127.0.0.1', port: 4543, strictPort: true, open: false } })
let browser, releaseDelete
const cleanup = browserCleanup(() => ({ browser, server }))
const roles = [
  {id:'role-one',project_id:'roles-project',name:'主角长名称用于验证卡片截断后仍能获取完整名字',description:'真实角色简介',actor_id:'actor-one',costume_id:'costume-one',thumbnail:'/api/cover'},
  {id:'role-missing',project_id:'roles-project',name:'无图角色',description:'',actor_id:'unavailable-actor',costume_id:null},
  {id:'role-broken',project_id:'roles-project',name:'失败图片角色',actor_id:'actor-one',costume_id:'unavailable-costume',thumbnail:'/api/broken'},
]
let attempts=0
const creates=[],errors=[]
try {
  await server.listen()
  browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL})
  const page=await browser.newPage({viewport:{width:1440,height:900}})
  page.setDefaultTimeout(10000)
  await page.addInitScript(()=>{window.__ENV={BACKEND_URL:location.origin}})
  page.on('pageerror',e=>errors.push(e.message))
  await page.route('**/api/**',route=>{
    const req=route.request(),path=new URL(req.url()).pathname
    const respond=data=>route.fulfill({json:{success:true,data}})
    if(path==='/api/cover')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="240" height="100"><rect width="240" height="100" fill="navy"/></svg>'})
    if(path==='/api/broken')return route.fulfill({status:404,body:'missing'})
    if(path.endsWith('/projects/roles-project'))return respond({id:'roles-project',name:'角色测试项目',visual_style:'现实',style:'真人都市'})
    if(path.endsWith('/entities/character')) {
      if(req.method()==='POST'){creates.push(req.postDataJSON());roles.push(req.postDataJSON());return respond(req.postDataJSON())}
      return respond({items:roles,pagination:{total:roles.length}})
    }
    if(path.endsWith('/entities/character/role-one')&&req.method()==='DELETE') {
      attempts++
      return new Promise(resolve=>{releaseDelete=async fail=>{
        if(fail)await route.fulfill({status:503,json:{detail:'角色删除暂不可用'}})
        else {roles.splice(roles.findIndex(r=>r.id==='role-one'),1);await respond({})}
        resolve()
      }})
    }
    if(path.endsWith('/project-assets/actor'))return respond({items:[{id:1,actor_id:'actor-one'}]})
    if(path.endsWith('/project-assets/costume'))return respond({items:[{id:2,costume_id:'costume-one'}]})
    if(path.endsWith('/entities/actor/actor-one'))return respond({id:'actor-one',name:'真实关联演员长名称应自然换行'})
    if(path.endsWith('/entities/costume/costume-one'))return respond({id:'costume-one',name:'真实关联服装长名称应自然换行'})
    return respond({items:[],pagination:{total:0}})
  })
  await page.goto(`${origin}/projects/roles-project?tab=roles`)
  const roleName=roles[0].name
  const nameLink=page.getByRole('link',{name:roleName,exact:true})
  await nameLink.waitFor()
  assert.equal(await nameLink.getAttribute('href'),'/projects/roles-project/roles/role-one/edit')
  assert.equal(await page.getByRole('button',{name:'新建角色',exact:true}).count(),1)
  await page.getByRole('article').filter({has:nameLink}).getByText('演员：真实关联演员长名称应自然换行',{exact:true}).waitFor()
  await page.getByRole('article').filter({has:nameLink}).getByText('服装：真实关联服装长名称应自然换行',{exact:true}).waitFor()
  await page.getByText('未关联服装',{exact:false}).waitFor()
  assert.equal(await page.getByText('unavailable-actor',{exact:false}).count(),0)
  for(const theme of ['mist','solid']) {
    await page.evaluate(value=>localStorage.setItem('jellyfish_appearance',value),theme)
    await page.reload()
    await nameLink.waitFor()
    for(const viewport of [{width:1440,height:900},{width:1366,height:768},{width:1024,height:440},{width:1023,height:768},{width:768,height:768},{width:767,height:768},{width:375,height:812}]) {
      await page.setViewportSize(viewport)
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true)
      assert.equal(await nameLink.getAttribute('title'),roleName)
      await page.screenshot({path:join(output,`roles-${theme}-${viewport.width}-${viewport.height}.png`),animations:'disabled'})
    }
  }
  await page.setViewportSize({width:1440,height:900})
  const preview=page.getByRole('button',{name:`预览${roleName}`,exact:true})
  await preview.press('Enter')
  const dialog=page.getByRole('dialog',{name:roleName,exact:true})
  await dialog.waitFor()
  await dialog.getByRole('button',{name:'Close'}).click({trial:true})
  await dialog.getByRole('button',{name:'Close'}).focus()
  await page.keyboard.press('Escape')
  await dialog.waitFor({state:'hidden'})
  await preview.and(page.locator(':focus')).waitFor()
  assert.equal(await page.getByRole('button',{name:'预览无图角色',exact:true}).count(),0)
  await page.getByText('图片加载失败',{exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'预览失败图片角色',exact:true}).count(),0)
  await page.getByRole('button',{name:`${roleName}更多操作`,exact:true}).press('Enter')
  await page.getByRole('menuitem',{name:'编辑',exact:true}).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('menuitem',{name:'编辑',exact:true}).waitFor({state:'hidden'})
  await page.getByRole('button',{name:`${roleName}更多操作`,exact:true}).click()
  await page.getByRole('menuitem',{name:'删除角色',exact:true}).click()
  const confirm=page.getByRole('dialog').filter({hasText:'不会删除关联演员或服装资产'})
  await confirm.waitFor()
  await page.getByRole('menuitem',{name:'删除角色',exact:true}).waitFor({state:'hidden'})
  await confirm.getByRole('button',{name:/取\s*消/}).click()
  assert.equal(attempts,0)
  await page.getByRole('button',{name:`${roleName}更多操作`,exact:true}).and(page.locator(':focus')).waitFor()
  await page.getByRole('button',{name:`${roleName}更多操作`,exact:true}).click()
  await page.getByRole('menuitem',{name:'删除角色',exact:true}).click()
  const deleting=page.waitForRequest(req=>req.method()==='DELETE')
  await confirm.getByRole('button',{name:'删除角色',exact:true}).click()
  await deleting
  assert.equal(await confirm.getByRole('button',{name:/删除角色/}).isDisabled(),true)
  assert.equal(attempts,1)
  await releaseDelete(true)
  await confirm.getByText('角色删除暂不可用',{exact:true}).waitFor()
  await nameLink.waitFor()
  const retry=page.waitForRequest(req=>req.method()==='DELETE')
  await confirm.getByRole('button',{name:'删除角色',exact:true}).click()
  await retry
  await releaseDelete(false)
  await confirm.waitFor({state:'hidden'})
  await nameLink.waitFor({state:'hidden'})
  assert.equal(attempts,2)
  await page.getByRole('button',{name:'新建角色',exact:true}).click()
  const create=page.getByRole('dialog',{name:'新建角色',exact:true})
  await create.getByRole('textbox',{name:'角色名称',exact:true}).fill('新角色')
  await create.getByRole('combobox',{name:'关联演员',exact:true}).click()
  await page.getByText('真实关联演员长名称应自然换行',{exact:true}).click()
  await create.getByRole('button',{name:/创\s*建/}).click()
  await create.waitFor({state:'hidden'})
  await page.getByRole('link',{name:'新角色',exact:true}).waitFor()
  assert.equal(creates[0].actor_id,'actor-one')
  assert.equal(creates[0].costume_id,null)
  roles.splice(0,roles.length)
  await page.reload()
  await page.getByText('暂无项目角色',{exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'新建角色',exact:true}).count(),1)
  assert.deepEqual(errors,[])
  console.log('PASS project roles card, associations, preview focus, deletion failure recovery and creation')
}finally{await cleanup()}
