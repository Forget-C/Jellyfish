/**
 * 「下一步做什么」状态文案的回归测试（第三部分要求：删掉笼统的「待确认」）。
 *
 * 守两件事：
 * 1. 每个状态都说清下一步动作，不再出现「待确认」这种没有信息量的词；
 * 2. 「可生成」与「可导出」分开——缺帧时状态是「缺少首帧」，但 `canExport` 仍然是 true。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { frameTypeLabel, missingFrameLabel, resolveShotStatus } from './shotStatusText.ts'

const ready = { canGenerate: true, canExport: true, hasPrompt: true, hasBoundFiles: true }

test('有在飞任务 → 生成中（先看任务，不催用户改东西）', () => {
  const status = resolveShotStatus({ readiness: ready, generating: true })
  assert.equal(status.label, '生成中')
  assert.equal(status.tone, 'blue')
})

test('提取候选没确认 → 「待确认提取到的资产」（而不是笼统的「待确认」）', () => {
  const status = resolveShotStatus({ readiness: { ...ready, hasPrompt: false, canGenerate: false, canExport: false }, extractionPending: true })
  assert.equal(status.key, 'pending_candidate')
  assert.equal(status.label, '待确认提取到的资产')
  /* 第 3 批收尾（运行时复核发现的文案回归）：旧期望 `/确认待提取到的资产/` 是
     `472a2d3` 机械替换后的产物，多了一个「待」（读起来像"还没提取"，与 label 打架）。
     改成**更强**的一对：正确说法必须出现 + 读不通的那种必须消失 + 可操作尾巴留着。 */
  assert.match(status.nextAction, /去确认剧本里提取到的资产（关联已有资产或新建）/)
  assert.doesNotMatch(status.nextAction, /待提取/)
  assert.doesNotMatch(status.nextAction, /待确认待/)
  assert.ok(status.nextAction.trim().length > 0)
})

test('没有提示词 → 待保存视频提示词', () => {
  const status = resolveShotStatus({ readiness: { ...ready, hasPrompt: false, canGenerate: false, canExport: false } })
  assert.equal(status.key, 'prompt_todo')
  assert.equal(status.label, '待保存视频提示词')
})

test('有提示词但没绑定 → 待绑定素材', () => {
  const status = resolveShotStatus({ readiness: { ...ready, hasBoundFiles: false, canGenerate: false } })
  assert.equal(status.key, 'binding_todo')
  assert.equal(status.label, '待绑定素材')
})

test('缺首帧 → 状态就是「缺少首帧」，且可导出不受影响', () => {
  const status = resolveShotStatus({
    readiness: { canGenerate: false, canExport: true, hasPrompt: true, hasBoundFiles: true },
    missingFrames: ['first'],
  })
  assert.equal(status.key, 'missing_frame')
  assert.equal(status.label, '缺少首帧')
  assert.equal(status.canExport, true, '缺帧只挡生成，不挡导出')
  assert.equal(status.canGenerate, false)
})

test('缺多帧按「首帧 → 关键帧 → 尾帧」读起来像一句话', () => {
  assert.equal(missingFrameLabel(['last', 'first']), '缺少首帧、尾帧')
  assert.equal(missingFrameLabel(['key', 'first']), '缺少首帧、关键帧')
  assert.equal(missingFrameLabel([]), '')
  assert.equal(frameTypeLabel('key'), '关键帧')
})

test('帧已上传但当前服务取不到 → 单独文案，不与「没上传」混为一谈', () => {
  const status = resolveShotStatus({
    readiness: { canGenerate: false, canExport: true, hasPrompt: true, hasBoundFiles: true },
    blockedFrames: ['first'],
  })
  assert.equal(status.key, 'frame_unreachable')
  assert.equal(status.label, '首帧取不到')
  assert.match(status.nextAction, /公网/)
})

test('提示词 + 绑定 + 帧齐全 → 已具备生成条件（还没生成）', () => {
  const status = resolveShotStatus({ readiness: ready })
  assert.equal(status.key, 'ready_to_generate')
  assert.equal(status.label, '已具备生成条件')
  assert.equal(status.canGenerate, true)
  assert.equal(status.canExport, true)
})

test('生成过 → 已生成；这与「可导出」是两条独立判断', () => {
  const generated = resolveShotStatus({ readiness: ready, generated: true })
  assert.equal(generated.key, 'generated')
  assert.equal(generated.label, '已生成')
  assert.equal(generated.canExport, true)

  // 没生成过但提示词可导出：状态仍是「已具备生成条件」，可导出单独成立
  const notGenerated = resolveShotStatus({ readiness: { ...ready, canGenerate: false } })
  assert.equal(notGenerated.label, '还有前置条件未满足')
  assert.equal(notGenerated.canExport, true)
})

test('任何状态都不再是裸的「待确认」', () => {
  const inputs = [
    { readiness: ready, generating: true },
    { readiness: ready, extractionPending: true },
    { readiness: { ...ready, hasPrompt: false } },
    { readiness: { ...ready, hasBoundFiles: false } },
    { readiness: ready, missingFrames: ['first'] },
    { readiness: ready, blockedFrames: ['key'] },
    { readiness: ready },
    { readiness: ready, generated: true },
    { readiness: { ...ready, canGenerate: false } },
  ]
  for (const input of inputs) {
    const status = resolveShotStatus(input as Parameters<typeof resolveShotStatus>[0])
    assert.ok(status.label.trim().length > 0)
    // 「待确认提取到的资产」是允许的（带业务限定的中文）；不允许的是没有任何限定的「待确认」
    assert.notEqual(status.label.trim(), '待确认')
    assert.ok(status.nextAction.trim().length > 0, `状态「${status.label}」必须带下一步指引`)
  }
})
