import test from 'node:test'
import assert from 'node:assert/strict'
import { experienceOutput } from '../packages/dsh-px-memory/src/experience-output'

test('native structured subset keeps evidence constraints while local bounds reject oversized output', () => {
  const output = experienceOutput({
    type: 'object',
    additionalProperties: false,
    required: ['name', 'refs', 'confidence'],
    properties: {
      name: { type: 'string', maxLength: 8, pattern: '^[a-z-]+$' },
      refs: { type: 'array', maxItems: 2, items: { type: 'integer', enum: [3, 5] } },
      confidence: { type: 'number', minimum: 0, maximum: 1 }
    }
  })
  assert.equal(output.schema.properties.name.maxLength, undefined)
  assert.deepEqual(output.schema.properties.refs.items.enum, [3, 5])
  assert.match(output.schema.properties.name.description, /maxLength: 8/)
  const valid = { name: 'checked', refs: [3], confidence: 0.8 }
  assert.deepEqual(output.parse(valid), valid)
  for (const change of [
    { name: 'too-long-name' },
    { name: 'BAD' },
    { refs: [3, 5, 3] },
    { refs: [9] },
    { confidence: 2 },
    { extra: true }
  ])
    assert.throws(() => output.parse({ ...valid, ...change }), /未保存/)
})
