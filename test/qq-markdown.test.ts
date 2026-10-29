import test from 'node:test'
import assert from 'node:assert/strict'
import { qqPlainText } from '../src/shared/qq-markdown'
const tick = String.fromCharCode(96)

test('QQ output preserves identifiers, inline code and literal fenced content', () => {
  assert.equal(qqPlainText('PRIVATE_RESULT_ONLY_1729'), 'PRIVATE_RESULT_ONLY_1729')
  assert.equal(qqPlainText(tick + '__init__(snake_case)' + tick), '__init__(snake_case)')
  const code = '  __init__ = "**literal**"\n  path = "C:\\work\\snake_case.py"\n\n  value = a * b'
  assert.equal(qqPlainText(tick.repeat(3) + 'python\n' + code + '\n' + tick.repeat(3)), code)
  assert.equal(qqPlainText('C:\\work\\snake_case.py'), 'C:\\work\\snake_case.py')
})

test('QQ renders actual emphasis, lists, links and tables without executing or fetching content', () => {
  assert.equal(qqPlainText('**加粗**、_强调_，普通文本'), '加粗、强调，普通文本')
  assert.equal(qqPlainText('[文档](https://example.com/a)'), '文档 (https://example.com/a)')
  assert.match(qqPlainText('- 第一项\n- 第二项'), /• 第一项\n• 第二项/)
  assert.match(qqPlainText('| 项 | 值 |\n| --- | --- |\n| snake_case | 17 |'), /snake_case \| 17/)
  assert.equal(qqPlainText('A &amp; B &lt; C'), 'A & B < C')
})
