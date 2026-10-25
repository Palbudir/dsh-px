import test from 'node:test'
import assert from 'node:assert/strict'
import { parse } from 'yaml'
import { skillDraftContent } from '../packages/dsh-px-memory/src/experience-format'

test('generated prose becomes valid Skill frontmatter while updates preserve user invocation settings', async () => {
  const value = {
    description: '处理引号、BOM 与验证输出',
    body: '# 适用范围\n只在需要 CSV 归一化时使用。\n\n```js\nconsole.log("verified")\n```'
  }
  const content = await skillDraftContent('csv-normalizer', value)
  const metadata = parse(/^---\n([\s\S]*?)\n---\n/.exec(content)![1])
  assert.equal(metadata.name, 'csv-normalizer')
  assert.equal(metadata['dsh-px-managed'], true)
  assert.ok(content.endsWith(value.body + '\n'))
  const updated = await skillDraftContent(
    'csv-normalizer',
    value,
    'name: csv-normalizer\ndescription: old\ndisable-model-invocation: true\nuser-invocable: false\ncustom: preserved'
  )
  const previous = parse(/^---\n([\s\S]*?)\n---\n/.exec(updated)![1])
  assert.equal(previous['disable-model-invocation'], true)
  assert.equal(previous['user-invocable'], false)
  assert.equal(previous.custom, 'preserved')
  assert.equal(previous['dsh-px-managed'], undefined)
  await assert.rejects(skillDraftContent('../escape', value))
  await assert.rejects(skillDraftContent('csv-normalizer', { ...value, description: ' ' }))
  await assert.rejects(skillDraftContent('csv-normalizer', value, '- unexpected list'))
})
