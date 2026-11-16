import assert from 'node:assert/strict'
import { join } from 'node:path'

export async function checkReferencePurposes(page, generation, output) {
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="navy"/></svg>'
  const handler=async route=>{
    const url=new URL(route.request().url()),match=url.pathname.match(/\/entities\/(actor|character|costume|prop)(?:\/(ref-[^/]+)(?:\/(images))?)?$/)
    if(!match)return route.fallback()
    const [,kind,id,images]=match
    const rows=Array.from({length:12},(_,i)=>({id:`ref-${kind}-${i}`,name:`参考${kind}-${i}`,description:'资源描述',origin:'created',thumbnail:'/api/cover'}))
    if(!id&&kind==='actor'&&url.searchParams.has('project_id'))return route.fulfill({json:{success:true,data:{items:[],pagination:{total:0}}}})
    const pictures=[{id:1,file_id:`${id}-main`,view_angle:'FRONT',is_primary:true},{id:2,file_id:`${id}-front`,view_angle:'FRONT',is_view_default:true},{id:3,file_id:`${id}-left`,view_angle:'LEFT',is_view_default:true}]
    const data=images?{items:pictures,pagination:{total:3}}:id?rows.find(row=>row.id===id):{items:rows,pagination:{total:12}}
    return route.fulfill({json:{success:true,data}})
  }
  await page.route('**/entities/**',handler)
  await page.route('**/files/ref-*/download',route=>route.fulfill({contentType:'image/svg+xml',body:svg}))
  assert.equal(await generation.getByRole('checkbox',{name:'正面',exact:true}).isDisabled(),true)
  assert.equal(await generation.getByRole('checkbox',{name:'正面',exact:true}).isChecked(),true)
  await generation.getByText('侧面',{exact:true}).click()
  await generation.getByText('背面',{exact:true}).click()
  await page.screenshot({path:join(output,'generation-angles-selected.png'),animations:'disabled'})
  assert.equal(await generation.getByRole('checkbox',{name:'侧面',exact:true}).isChecked(),true)
  let total=await generation.locator('.asset-reference-item').count()
  for(const [purpose,kind] of [['主体','actor'],['服装','costume'],['道具','prop']]) {
    const open=async()=>{await generation.getByRole('button',{name:'添加参考图片',exact:true}).click();await page.getByRole('menuitem',{name:`选择参考${purpose}`,exact:true}).click();return page.getByRole('dialog',{name:`选择${purpose}参考`,exact:true})}
    const picker=await open(),initial=purpose==='主体'?6:0
    await page.setViewportSize({width:375,height:768})
    const choose=async(type,index)=>{
      const card=picker.getByRole('button',{name:`选择参考资源 参考${type}-${index}`,exact:true})
      await card.click()
      await card.and(page.locator('[aria-pressed=true]')).waitFor()
    }
    await choose(kind,0)
    await choose(kind,1)
    await picker.getByText('项目资源',{exact:true}).click()
    if(purpose==='主体') {
      await choose('character',0)
      await picker.getByText('资产库',{exact:true}).first().click()
      await picker.getByRole('button',{name:'选择参考资源 参考actor-0',exact:true}).waitFor()
      await picker.getByText('项目资源',{exact:true}).click()
      await picker.getByRole('button',{name:'选择参考资源 参考character-0',exact:true}).waitFor()
    }
    await picker.getByRole('textbox',{name:'搜索参考对象'}).fill('参考')
    await picker.getByRole('textbox',{name:'搜索参考对象'}).press('Enter')
    await picker.getByRole('button',{name:'查看已选',exact:true}).click()
    const count=initial+(purpose==='主体'?9:6)
    await picker.getByRole('button',{name:'移除',exact:true}).first().waitFor()
    assert.equal(await picker.getByRole('button',{name:'移除',exact:true}).count(),count)
    assert.equal(await picker.locator(`img[src*="ref-${kind}-0-front"]`).count(),1)
    assert.equal(await picker.locator(`img[src*="ref-${kind}-0-left"]`).count(),1)
    assert.equal(await picker.locator(`img[src*="ref-${kind}-0-main"]`).count(),1)
    const picture=picker.locator('.reference-picture').filter({has:page.locator(`img[src*="ref-${kind}-0-front"]`)})
    await picture.getByRole('button',{name:'选择视角',exact:true}).click()
    await page.getByRole('menuitem',{name:'右侧',exact:true}).click()
    assert.equal(await picker.getByRole('button',{name:'移除',exact:true}).count(),count-1)
    const geometry=await picker.evaluate(node=>{
      const content=node.querySelector('.resource-reference-content'),toolbar=node.querySelector('.resource-reference-toolbar'),footer=node.querySelector('.resource-reference-actions')
      const top=toolbar.getBoundingClientRect().top,bottom=footer.getBoundingClientRect().bottom
      content.scrollTop=content.scrollHeight
      return {scroll:content.scrollTop,stable:top===toolbar.getBoundingClientRect().top&&bottom===footer.getBoundingClientRect().bottom,fit:node.querySelector('.ant-modal-body').scrollWidth<=node.querySelector('.ant-modal-body').clientWidth+1,page:document.documentElement.scrollHeight<=innerHeight+1}
    })
    assert.ok(geometry.scroll>0);assert.equal(geometry.stable,true);assert.equal(geometry.fit,true);assert.equal(geometry.page,true)
    await page.screenshot({path:join(output,`reference-${kind}-selected-mobile.png`),animations:'disabled'})
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
    total+=count-initial
    await generation.getByRole('button',{name:'添加参考图片',exact:true}).waitFor()
    assert.equal(await generation.locator('.asset-reference-item').count(),total)
    if(purpose==='主体') assert.equal(await generation.locator('img[src*="ref-character-0-front"]').count(),1)
    await page.unroute('**/files/upload',upload)
    await open()
    await picker.getByRole('button',{name:'查看已选',exact:true}).click()
    await picker.getByRole('button',{name:'移除',exact:true}).first().waitFor()
    assert.equal(await picker.getByRole('button',{name:'移除',exact:true}).count(),count)
    await picker.getByText(`${kind}.png`,{exact:true}).waitFor()
    await picker.getByRole('button',{name:'移除',exact:true}).first().click()
    await picker.getByRole('button',{name:'返回生成',exact:true}).click()
    assert.equal(await generation.locator('.asset-reference-item').count(),total)
    await page.setViewportSize({width:1440,height:900})
  }
  await generation.getByText('侧面',{exact:true}).click()
  await generation.getByText('背面',{exact:true}).click()
  await page.unroute('**/entities/**',handler)
}
