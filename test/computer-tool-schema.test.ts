import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { assertSupportedJsonSchema, jsonSchemaToTs, renderToolsSdk } from '@deepseek-ai/dsh-tools'
import { DESKTOP_TOOLS } from '../packages/dsh-px-computer/src/desktop'
import { BROWSER_TOOLS } from '../packages/dsh-px-computer/src/browser'
import { TOOL_OUTPUT_SCHEMA } from '../packages/dsh-px-computer/src/runtime'
import { enforceToolBounds, nativeToolParameters } from '../packages/dsh-px-computer/src/tool-schema'

test('all computer and browser arguments remain discoverable through the pinned native PTC renderer', () => {
  const require = createRequire(import.meta.url)
  const native = JSON.parse(readFileSync(require.resolve('@deepseek-ai/dsh-tools/package.json'), 'utf8'))
  const pin = JSON.parse(readFileSync('config/native-pack.json', 'utf8'))
  assert.equal(native.version, pin.hostVersion)
  const schemas = [...DESKTOP_TOOLS, ...BROWSER_TOOLS].map((tool) => {
    const original = structuredClone(tool.parameters)
    const parameters = nativeToolParameters(tool.parameters)
    assertSupportedJsonSchema(parameters)
    assert.notEqual(jsonSchemaToTs(parameters), 'unknown', tool.name)
    assert.deepEqual(tool.parameters, original, 'upstream constraints must not be mutated')
    return { name: tool.name, description: tool.description, parameters, output: TOOL_OUTPUT_SCHEMA }
  })
  const sdk = renderToolsSdk(schemas as any)
  assert.match(sdk, /computer_bounded_input: \{/)
  assert.match(sdk, /dx\?: number/)
  assert.match(sdk, /dy\?: number/)
  assert.match(sdk, /duration_ms: number/)
  assert.match(sdk, /buttons\?:/)
  assert.match(sdk, /browser_navigate: \{/)
  assert.match(sdk, /minimum=10, maximum=10000/)
})

test('native schema adaptation retains numeric, array and text limits before execution', () => {
  const schema = (name: string) => DESKTOP_TOOLS.find((tool) => tool.name === name)!.parameters
  assert.throws(() => enforceToolBounds(schema('computer_bounded_input'), { dx: 2001 }), /dx.*maximum=2000/)
  assert.throws(
    () => enforceToolBounds(schema('computer_bounded_input'), { duration_ms: 10001 }),
    /maximum=10000/
  )
  assert.throws(
    () => enforceToolBounds(schema('computer_bounded_input'), { keys: Array(7).fill('w') }),
    /maxItems=6/
  )
  assert.throws(() => enforceToolBounds(schema('computer_hotkey'), { keys: ['ctrl'] }), /minItems=2/)
  assert.throws(() => enforceToolBounds(schema('computer_click'), { count: 4 }), /maximum=3/)
  assert.throws(
    () => enforceToolBounds(schema('computer_get_window_state'), { max_elements: 601 }),
    /maximum=600/
  )
  assert.throws(() => enforceToolBounds(schema('computer_scroll'), { amount: -1 }), /minimum=1/)
  assert.throws(
    () => enforceToolBounds(schema('computer_invoke_menu'), { path: Array(17).fill('x') }),
    /maxItems=16/
  )
  assert.doesNotThrow(() =>
    enforceToolBounds(schema('computer_bounded_input'), { dx: -2000, dy: 2000, duration_ms: 10000 })
  )
  const text = { type: 'object', properties: { action: { type: 'string', maxLength: 3 } } }
  assert.doesNotThrow(() => enforceToolBounds(text, { action: '😀中文' }))
  assert.throws(() => enforceToolBounds(text, { action: '😀中文长' }), /maxLength=3/)
})
