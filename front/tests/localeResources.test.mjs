import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import ts from 'typescript'

const src = fileURLToPath(new URL('../src/', import.meta.url))
const catalog = (locale, namespace) => JSON.parse(readFileSync(join(src, 'locales', locale, namespace), 'utf8'))
const displayAttributes = new Set(['title', 'label', 'labelPrefix', 'selectedLabel', 'productionLabel', 'caption', 'empty', 'placeholder', 'alt', 'aria-label', 'aria-description', 'aria-placeholder'])
const placeholders = value => [...new Set(value.match(/{{\s*\w+\s*}}/g) || [])].sort()

test('English UI messages cover literal calls and preserve interpolation parameters', () => {
  const english = catalog('en-US', 'ui.json')
  for (const [key, value] of Object.entries(english)) {
    assert.ok(value.trim(), key)
    assert.deepEqual(placeholders(value), placeholders(key), key)
  }
  const missing = new Set()
  for (const file of readdirSync(src, { recursive: true })) {
    if (!/\.tsx?$/.test(file) || file.startsWith('services/generated/') || file === 'components/workbench/WorkbenchExamples.tsx') continue
    const ast = ts.createSourceFile(file, readFileSync(join(src, file), 'utf8'), ts.ScriptTarget.Latest)
    function visit(node) {
      if (ts.isJsxAttribute(node) && displayAttributes.has(node.name.getText(ast)) && node.initializer && ts.isStringLiteral(node.initializer) &&
        /\p{Script=Han}/u.test(node.initializer.text)) missing.add(file + ' — ' + node.name.getText(ast) + '=' + node.initializer.text)
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'uiText') {
        const key = node.arguments[0]
        if (key && ts.isStringLiteralLike(key) && !Object.hasOwn(english, key.text)) missing.add(file + ' — ' + key.text)
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
  }
  assert.deepEqual([...missing], [])
})

test('Chinese and English keyed namespaces have matching leaves and placeholders', () => {
  function leaves(object, prefix = '') {
    return Object.fromEntries(Object.entries(object).flatMap(([key, value]) => {
      const path = prefix + key
      return typeof value === 'string' ? [[path, placeholders(value)]] : Object.entries(leaves(value, path + '.'))
    }))
  }
  for (const namespace of readdirSync(join(src, 'locales', 'zh-CN'))) {
    assert.deepEqual(leaves(catalog('en-US', namespace)), leaves(catalog('zh-CN', namespace)), namespace)
  }
})
