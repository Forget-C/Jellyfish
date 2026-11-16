import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveReferencePictures } from '../src/pages/aiStudio/assets/referenceSelection.ts'

const images=[
  {id:1,file_id:'main',view_angle:'FRONT',is_primary:true},
  {id:2,file_id:'front',view_angle:'FRONT',is_view_default:true},
  {id:3,file_id:'left',view_angle:'LEFT',is_view_default:true},
  {id:4,file_id:'other-left',view_angle:'LEFT'},
]
test('参考使用各角度默认图，缺失角度回退主图并去重',()=>{
  assert.deepEqual(resolveReferencePictures(images,['FRONT','LEFT','BACK','TOP']).map(image=>image.file_id),['front','left','main'])
})
test('无对应默认图也无主图时不采用任意图片',()=>{
  assert.deepEqual(resolveReferencePictures([{id:1,file_id:'arbitrary',view_angle:'LEFT'}],['LEFT']),[])
})
test('默认标记没有有效文件时回退有效主图',()=>{
  assert.deepEqual(resolveReferencePictures([...images,{id:5,view_angle:'BACK',is_view_default:true}],['BACK']).map(image=>image.file_id),['main'])
})
