/**
 * 「内部 ID 不进主界面」的回归测试（第三部分要求四 + 验收第 6 条）。
 *
 * 普通界面只留用户要决定的内容；供应商名、内部 ID、file_id / storage_key 归「技术详情」。
 * 后端提示里常内嵌这些标识，页面必须先把它们换成指路文案。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { containsInternalId, maskInternalIds, INTERNAL_ID_PLACEHOLDER } from './maskInternalIds.ts'

test('UUID 被替换成指路文案（主界面不再刷内部 ID）', () => {
  const raw = 'character 5ffc6a12-d91e-415d-b56e-09e86b988774：对象存储读取失败'
  const masked = maskInternalIds(raw)
  assert.equal(masked.includes('5ffc6a12-d91e-415d-b56e-09e86b988774'), false)
  assert.ok(masked.includes(INTERNAL_ID_PLACEHOLDER))
  assert.ok(masked.includes('对象存储读取失败'), '人话部分要保留')
})

test('file_id / storage_key / key= 形态都屏蔽', () => {
  const raw = '声音「test_voice」（file_id=1ebace78-b083-49fe-a86b-d17c524e501d）：storage_key=files/test.mp3'
  const masked = maskInternalIds(raw)
  assert.equal(masked.includes('1ebace78-b083-49fe-a86b-d17c524e501d'), false)
  assert.equal(masked.includes('files/test.mp3'), false)
  assert.ok(masked.includes('test_voice'), '业务名称保留')
})

test('裸字段名也换成业务说法（后端提示常见写法）', () => {
  const raw = '该帧槽位没有 file_id：请先上传或生成该帧。'
  const masked = maskInternalIds(raw)
  assert.equal(masked.includes('file_id'), false)
  assert.ok(masked.includes('文件编号'))
  assert.ok(masked.includes('请先上传或生成该帧'), '人话部分保留')
})

test('不含内部标识的文案原样返回', () => {
  const raw = '本镜已具备生成条件：提示词与参考帧齐全'
  assert.equal(maskInternalIds(raw), raw)
  assert.equal(containsInternalId(raw), false)
})

/* ----------------------------------------------------------------------------------
 * 阶段 B 第 3 批按审计 §7.3 / §4.3 模式 2（R13）扩展：中文内部词汇与更多 key= 形态
 * ---------------------------------------------------------------------------------- */

test('审计 §7.3 / R13：中文内部词汇（槽位 / 接口 / 推荐接口）也要换业务说法', () => {
  const raw = '该帧槽位没有 file_id：请先上传或生成该帧。四类槽位的建议…推荐接口只读不写库。'
  const masked = maskInternalIds(raw)
  assert.equal(masked.includes('槽位'), false, '「槽位」是主区禁词，掩码后不许残留')
  assert.equal(masked.includes('接口'), false, '「接口」是主区禁词，掩码后不许残留')
  assert.ok(masked.includes('图片角度'), '槽位 → 图片角度')
  assert.ok(masked.includes('推荐结果'), '推荐接口 → 推荐结果（长词必须先命中）')
  assert.ok(masked.includes('文件编号'), 'file_id → 文件编号 的老口径要保住')
})

test('审计 §7.3：KEY_VALUE_RE 覆盖 service_task_id / source_task_id / video_task_id / provider_id', () => {
  const forms = [
    'service_task_id=svc-1',
    'source_task_id=src-1',
    'video_task_id=vt-1',
    'provider_id=prov-1',
    'asset_id=a-1',
    'shot_id=s-1',
    'chapter_id=c-1',
    'storage_key=files/a.png',
  ]
  const offenders = forms
    .map((form) => ({ form, masked: maskInternalIds(`生成失败（${form}）：请重试`) }))
    .filter((entry) => entry.masked.includes(entry.form.split('=')[1]!))
    .map((entry) => `${entry.form} → ${entry.masked}`)
  assert.deepEqual(offenders, [], `这些 key= 形态没被掩码：\n${offenders.join('\n')}`)
})

test('反向断言：不含内部标识与内部词汇的文案**原样返回**（防止过度屏蔽）', () => {
  const samples = [
    '本镜已具备生成条件：提示词与参考帧齐全',
    '画幅 16:9、时长 5 秒',
    '已绑定，但当前服务取不到这条声音',
    '这条基础提示词是怎么来的',
  ]
  const offenders = samples.filter((text) => maskInternalIds(text) !== text)
  assert.deepEqual(offenders, [], `这些文案不该被掩码：${offenders.join(' / ')}`)
})

test('containsInternalId 能识别需要屏蔽的文案', () => {
  assert.equal(containsInternalId('key=files/a.png'), true)
  assert.equal(containsInternalId('shot_id=abc123'), true)
  assert.equal(containsInternalId('画幅 16:9、时长 5 秒'), false)
})
