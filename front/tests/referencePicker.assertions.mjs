import assert from 'node:assert/strict'
import { join } from 'node:path'

export async function checkReferencePurposes(page, generation, output) {
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="navy"/></svg>'
  const handler=async route=>{
    const path=new URL(route.request().url()).pathname
    const match=path.match(/\/entities\/(actor|costume|prop)(?:\/(ref-[^/]+)(?:\/(images))?)?$/)
    if(!match)return route.fallback()
    const [,kind,id,images]=match
    const rows=Array.from({length:12},(_,i)=>({id:`ref-${kind}-${i}`,name:`参考${kind}-${i}`,description:'资源描述',origin:'created',thumbnail:'/api/cover'}))
    const data=images?{items:Array.from({length:8},(_,i)=>({id:i+1,file_id:`${id}-${i}`,view_angle:i?'LEFT':'FRONT',is_primary:i===0})),pagination:{total:8}}:id?rows.find(row=>row.id===id):{items:rows,pagination:{total:12}}
    return route.fulfill({json:{success:true,data}})
  }
  await page.route('**/entities/**',handler)
  await page.route('**/files/ref-*/download',route=>route.fulfill({contentType:'image/svg+xml',body:svg}))
  let total=await generation.locator('.asset-reference-item').count()
  for(const [purpose,kind] of [['主体','actor'],['服装','costume'],['道具','prop']]) {
    const open=async()=>{await generation.getByRole('button',{name:'添加参考图片',exact:true}).click();await page.getByRole('menuitem',{name:`选择参考${purpose}`,exact:true}).click();return page.getByRole('dialog',{name:`选择${purpose}参考`,exact:true})}
    const picker=await open()
    const initial=purpose==='主体'?6:0
    await page.setViewportSize({width:375,height:768})
    const choose=async index=>{
      await picker.getByRole('button',{name:`浏览参考资源 参考${kind}-${index}`,exact:true}).click()
      await picker.getByRole('button',{name:'选择图片',exact:true}).first().waitFor()
    }
    await choose(0)
    assert.equal(await picker.getByRole('button',{name:'取消选择',exact:true}).count(),0)
    await picker.getByRole('button',{name:'选择图片',exact:true}).first().click()
    await picker.getByRole('button',{name:'取消选择',exact:true}).waitFor()
    const geometry=await picker.evaluate(node=>{
      const content=node.querySelector('.resource-reference-content'), toolbar=node.querySelector('.resource-reference-toolbar'), footer=node.querySelector('.resource-reference-actions')
      const top=toolbar.getBoundingClientRect().top,bottom=footer.getBoundingClientRect().bottom
      content.scrollTop=content.scrollHeight
      return {scroll:content.scrollTop,stable:top===toolbar.getBoundingClientRect().top&&bottom===footer.getBoundingClientRect().bottom,fit:node.querySelector('.ant-modal-body').scrollWidth<=node.querySelector('.ant-modal-body').clientWidth+1,page:document.documentElement.scrollHeight<=innerHeight+1}
    })
    assert.ok(geometry.scroll>0);assert.equal(geometry.stable,true);assert.equal(geometry.fit,true);assert.equal(geometry.page,true)
    await page.screenshot({path:join(output,`reference-${kind}-pictures-mobile.png`),animations:'disabled'})
    await picker.getByRole('button',{name:'返回资源列表',exact:true}).click()
    await choose(1)
    await picker.getByRole('button',{name:'选择图片',exact:true}).first().click()
    await picker.getByRole('button',{name:'取消选择',exact:true}).waitFor()
    await picker.getByRole('button',{name:'返回资源列表',exact:true}).click()
    await picker.getByText('项目资源',{exact:true}).click()
    await picker.getByRole('textbox',{name:'搜索参考对象'}).fill('参考')
    await picker.getByRole('textbox',{name:'搜索参考对象'}).press('Enter')
    await picker.getByRole('button',{name:'查看已选',exact:true}).click()
    await picker.getByRole('button',{name:'移除',exact:true}).first().waitFor()
    assert.equal(await picker.getByRole('button',{name:'移除',exact:true}).count(),initial+2)
    await picker.getByRole('button',{name:'返回资源列表',exact:true}).click()
    assert.equal(await picker.getByRole('textbox',{name:'搜索参考对象'}).inputValue(),'参考')
    let release
    const gate=new Promise(resolve=>{release=resolve})
    const upload=async route=>{await gate;await route.fulfill({json:{success:true,data:{id:`uploaded-${kind}`}}})}
    await page.route('**/files/upload',upload)
    await picker.locator('input[type=file]').setInputFiles({name:`${kind}.png`,mimeType:'image/png',buffer:Buffer.from(svg)})
    await picker.locator('button:disabled').filter({hasText:'应用参考'}).waitFor()
    await page.keyboard.press('Escape');assert.equal(await picker.isVisible(),true)
    release()
    await picker.locator('button:not(:disabled)').filter({hasText:'应用参考'}).waitFor()
    await picker.getByRole('button',{name:'应用参考',exact:true}).click()
    total+=3
    await generation.getByRole('button',{name:'添加参考图片',exact:true}).waitFor()
    assert.equal(await generation.locator('.asset-reference-item').count(),total)
    await page.unroute('**/files/upload',upload)
    await open()
    await picker.getByRole('button',{name:'查看已选',exact:true}).click()
    await picker.getByRole('button',{name:'移除',exact:true}).first().waitFor()
    assert.equal(await picker.getByRole('button',{name:'移除',exact:true}).count(),initial+3)
    await picker.getByText(`${kind}.png`,{exact:true}).waitFor()
    await picker.getByRole('button',{name:'移除',exact:true}).first().click()
    await picker.getByRole('button',{name:'返回生成',exact:true}).click()
    assert.equal(await generation.locator('.asset-reference-item').count(),total)
    await page.setViewportSize({width:1440,height:900})
  }
  await page.unroute('**/entities/**',handler)
}
