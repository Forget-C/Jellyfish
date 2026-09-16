import assert from 'node:assert/strict'
import test from 'node:test'
import { loadSource } from './directing-fixtures.mjs'
const { createSourceResolver, sourceKey } = await loadSource('sourceResolver')
const source = reference => ({ kind: 'model', reference, version: '1' })
const row = source => ({ source, status: 'ready', label: 'AI建议', description: '生成上下文' })

test('source requests deduplicate complete identities and batch at most 100', async () => {
  const calls = []
  const resolve = createSourceResolver(async sources => { calls.push(sources); return sources.map(row) })
  const first = resolve(source('same'))
  assert.equal(resolve({ version: '1', reference: 'same', kind: 'model' }), first)
  await Promise.all([first, ...Array.from({ length: 201 }, (_, i) => resolve(source(String(i))))])
  assert.deepEqual(calls.map(batch => batch.length), [100, 100, 2])
  assert.equal(resolve(source('same')), first)
  assert.notEqual(sourceKey(source('same')), sourceKey({ ...source('same'), version: '2' }))
  assert.notEqual(sourceKey(source('same')), sourceKey({ ...source('same'), file_id: 'file' }))
})

test('failed or mismatched responses can be retried without caching another identity', async () => {
  let attempt = 0
  const resolve = createSourceResolver(async sources => { attempt++; if (attempt === 1) throw new Error('offline'); return attempt === 2 ? [row(source('other'))] : sources.map(row) })
  await assert.rejects(resolve(source('a')), /offline/)
  await assert.rejects(resolve(source('a')), /未返回可核对/)
  assert.equal((await resolve(source('a'))).source.reference, 'a')
  assert.equal(attempt, 3)
})
