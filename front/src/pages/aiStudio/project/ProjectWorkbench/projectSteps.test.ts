/**
 * 步骤判定的「全部资产都完成」口径（收口要求）。
 *
 * 关键：就绪判定必须覆盖范围内**每一个**资产 —— 一旦只检查前 24 个，
 * 第 25 个之后没定版的项目也会被判定为「资产准备已就绪」。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { resolveProjectStep } from './projectSteps.ts'

function baseInput(assetCount: number, primaryCount: number | null) {
  return {
    chapterCount: 1,
    chaptersWithTextCount: 1,
    shotCount: 3,
    assetCounts: { characters: assetCount, scenes: 0, props: 0 },
    assetImageCount: assetCount,
    assetsWithImagePromptCount: assetCount,
    assetsWithPrimaryCount: primaryCount,
    shotsWithVideoPromptCount: 3,
    shotsWithAssetLinkCount: 3,
  }
}

test('第 25 个资产没定版 → 仍停在「资产准备」', () => {
  const resolution = resolveProjectStep(baseInput(30, 24))
  assert.equal(resolution.step, 'image_prep')
  assert.match(resolution.missing.join('；'), /6 个资产没有设定版图/)
})

test('全部 30 个都定版 → 越过资产准备', () => {
  const resolution = resolveProjectStep(baseInput(30, 30))
  assert.notEqual(resolution.step, 'image_prep')
})

test('恰好差一个（第 25 个）也要拦住', () => {
  const resolution = resolveProjectStep(baseInput(25, 24))
  assert.equal(resolution.step, 'image_prep')
  assert.match(resolution.missing.join('；'), /1 个资产没有设定版图/)
})

test('定版状态无法判定时不阻塞（避免项目被永久钉住）', () => {
  const resolution = resolveProjectStep(baseInput(30, null))
  assert.notEqual(resolution.step, 'image_prep')
})

test('提示词起步的项目：不要求剧本/分镜，先落整集提示词', () => {
  const resolution = resolveProjectStep({
    startMode: 'prompts',
    chapterCount: 1,
    chaptersWithTextCount: 0,
    shotCount: 0,
    shotsWithVideoPromptCount: 0,
    assetCounts: { characters: 0, scenes: 0, props: 0 },
  })
  assert.equal(resolution.step, 'video_prompt')
})
