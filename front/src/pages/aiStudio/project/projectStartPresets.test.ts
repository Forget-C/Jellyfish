/**
 * 「整体风格」预设与「起点」的回归测试。
 *
 * 重点：
 * 1. 五个预设（真人竖屏 / 真人横屏 / 2D / 3D / 其他自定义）各自映射到既有项目列；
 * 2. 竖屏预设必须写 9:16（短剧默认），横屏写 16:9；
 * 3. 自定义不覆盖任何字段；
 * 4. 起点决定新建后的落点（提示词起步直接进整集提示词看板）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  OVERALL_STYLE_PRESETS,
  START_MODE_OPTIONS,
  getOverallStylePreset,
  resolveLandingStep,
  resolveOverallStyleFields,
  resolveProjectVideoRatio,
} from './projectStartPresets.ts'

test('五个整体风格预设齐全（含其他自定义）', () => {
  assert.deepEqual(
    OVERALL_STYLE_PRESETS.map((preset) => preset.key),
    ['live_portrait', 'live_landscape', 'anime_2d', 'anime_3d', 'custom'],
  )
})

test('真人竖屏 → 现实 + 真人都市 + 9:16', () => {
  assert.deepEqual(resolveOverallStyleFields('live_portrait'), {
    visual_style: '现实',
    style: '真人都市',
    default_video_ratio: '9:16',
  })
})

test('真人横屏 → 现实 + 真人都市 + 16:9', () => {
  assert.deepEqual(resolveOverallStyleFields('live_landscape'), {
    visual_style: '现实',
    style: '真人都市',
    default_video_ratio: '16:9',
  })
})

test('2D → 动漫 + 国漫 + 16:9；3D → 动漫 + 动漫3D + 16:9', () => {
  assert.deepEqual(resolveOverallStyleFields('anime_2d'), {
    visual_style: '动漫',
    style: '国漫',
    default_video_ratio: '16:9',
  })
  assert.deepEqual(resolveOverallStyleFields('anime_3d'), {
    visual_style: '动漫',
    style: '动漫3D',
    default_video_ratio: '16:9',
  })
})

/* ------------------------------ 画幅取值（方案 B：手填优先） ------------------------------ */

test('画幅：手填的值优先于预设（真人竖屏也能改成 16:9）', () => {
  assert.equal(resolveProjectVideoRatio('live_portrait', '16:9'), '16:9')
  assert.equal(resolveProjectVideoRatio('anime_2d', '9:16'), '9:16')
})

test('画幅：输入框为空时回落到该风格的预设默认值', () => {
  assert.equal(resolveProjectVideoRatio('live_portrait', ''), '9:16')
  assert.equal(resolveProjectVideoRatio('live_portrait', '   '), '9:16')
  assert.equal(resolveProjectVideoRatio('anime_3d', null), '16:9')
  assert.equal(resolveProjectVideoRatio('live_landscape', undefined), '16:9')
})

test('画幅：其他自定义完全以用户填写为准（留空就是留空）', () => {
  assert.equal(resolveProjectVideoRatio('custom', '21:9'), '21:9')
  assert.equal(resolveProjectVideoRatio('custom', ''), null)
})

test('其他自定义不覆盖任何字段（由用户自己填）', () => {
  assert.equal(resolveOverallStyleFields('custom'), null)
})

test('未知 key 回退到第一个预设，不抛错', () => {
  assert.equal(getOverallStylePreset('not-a-key' as never).key, 'live_portrait')
})

test('起点决定落点：剧本起步 → 第 1 步；提示词起步 → 整集提示词看板', () => {
  assert.equal(resolveLandingStep('script'), 'script')
  assert.equal(resolveLandingStep('prompts'), 'video_prompt')
})

test('起点选项文案包含两种生产方式的关键差异', () => {
  assert.equal(START_MODE_OPTIONS.length, 2)
  assert.match(START_MODE_OPTIONS[1].description, /默认章节|看板/)
})

test('预设里凡带视觉风格的，必须同时有题材风格与画幅（避免写半截配置）', () => {
  for (const preset of OVERALL_STYLE_PRESETS) {
    if (preset.key === 'custom') continue
    assert.ok(preset.visualStyle, `${preset.key} 缺 visualStyle`)
    assert.ok(preset.style, `${preset.key} 缺 style`)
    assert.match(preset.defaultVideoRatio ?? '', /^\d+:\d+$/, `${preset.key} 画幅格式不对`)
  }
})
