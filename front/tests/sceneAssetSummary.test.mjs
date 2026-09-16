import test from 'node:test'
import assert from 'node:assert/strict'
import { makeWorkspace, loadSource } from './directing-fixtures.mjs'
const { sceneAssetSummary } = await loadSource('sceneAssetSummary')

test('counts only resolvable project assets by kind and identity, not participant names or duplicate references', () => {
  const value = makeWorkspace().designs[0].content
  value.direction.location_asset_id = 'place'
  const person = value.participants[0]
  value.participants = [{ ...person, character_id: 'same', prop_id: 'prop' }, { ...person, id: 'second', character_id: 'same', prop_id: 'missing' }]
  const assets = [{ id: 'same', kind: 'character' }, { id: 'place', kind: 'scene' }, { id: 'prop', kind: 'prop' }, { id: 'missing', kind: 'character' }]
  const before = structuredClone(value)
  assert.deepEqual(sceneAssetSummary(value, assets), { counts: { character: 1, scene: 1, prop: 1 }, total: 3, invalid: 1, references: 4, verified: true })
  assert.deepEqual(value, before)
  value.participants[1].prop_id = 'prop'
  assert.equal(sceneAssetSummary(value, assets).invalid, 0)
  assert.equal(sceneAssetSummary(value, assets).total, 3)
})

test('loading and failed catalogs are unverified, not missing assets; names alone are not links', () => {
  const value = makeWorkspace().designs[0].content
  value.direction.location_asset_id = 'place'
  value.participants = []
  assert.equal(sceneAssetSummary(value).verified, false)
  assert.equal(sceneAssetSummary(value).invalid, 0)
  assert.equal(sceneAssetSummary(value, []).invalid, 1)
  value.direction.location_asset_id = null
  value.participants = [{ id: 'named', name: '张三', character_id: null, prop_id: null }]
  assert.equal(sceneAssetSummary(value, []).references, 0)
  assert.equal(sceneAssetSummary(value, []).total, 0)
})
