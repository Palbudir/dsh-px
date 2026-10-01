import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { isMap, isSeq, parseDocument } from 'yaml'
import { prepareNativeProfileDefaults, applyNativeDesktopPolicy } from '../src/main/native-profile-defaults'

const yamlOptions = { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }] }
const telemetryIds = ['desktop-product-telemetry', 'product-analytics', 'session-telemetry-otel']

/** Mirror of native writePluginEnabled (plugin-manager patch.ts): last non-insert row wins, else append. */
function nativeToggle(file: string, id: string, enabled: boolean): void {
  const document = parseDocument(readFileSync(file, 'utf8'), yamlOptions)
  if (!isSeq(document.contents)) throw new Error('fixture expects a sequence')
  const items = document.contents.items
  const target = items.findLast(
    (item, index) => isMap(item) && document.getIn([index, 'id']) === id && !item.has('insert')
  )
  if (target) document.setIn([items.indexOf(target), 'disabled'], !enabled)
  else document.add({ id, disabled: !enabled })
  writeFileSync(file, String(document))
}
/** Effective `disabled` per id under the native last-wins rule. */
function effective(file: string): Record<string, unknown> {
  const rows = parseDocument(readFileSync(file, 'utf8'), yamlOptions).toJS() as Record<string, unknown>[]
  const result: Record<string, unknown> = {}
  for (const row of rows) if (typeof row.id === 'string' && !('insert' in row)) result[row.id] = row.disabled
  return result
}
const count = (text: string, id: string) =>
  (parseDocument(text, yamlOptions).toJS() as Record<string, unknown>[]).filter((row) => row.id === id).length

test('native profile defaults provide a complete loopback config and isolated document path', () => {
  const profile = mkdtempSync(join(tmpdir(), 'px-native-defaults-'))
  try {
    const documents = join(profile, 'documents with spaces')
    assert.equal(prepareNativeProfileDefaults(profile, documents), true)
    const file = join(profile, 'cordis.patch.yml')
    const content = readFileSync(file, 'utf8')
    const rows = parseDocument(content).toJS()
    assert.deepEqual(rows, [
      { id: 'webserver', config: { host: '127.0.0.1', port: 0 } },
      { id: 'workspace-controller', config: { documentsDirectory: documents } }
    ])
    assert.equal(prepareNativeProfileDefaults(profile, join(profile, 'other')), false)
    assert.equal(readFileSync(file, 'utf8'), content)
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

test('native defaults fill only missing rows and keep user-owned values and comments', () => {
  const profile = mkdtempSync(join(tmpdir(), 'px-native-preserve-'))
  try {
    assert.throws(() => prepareNativeProfileDefaults(profile, 'relative'), /absolute/)
    const file = join(profile, 'cordis.patch.yml')
    const user = '# user-owned\n- id: webserver\n  config:\n    host: 0.0.0.0\n    port: 8080\n'
    writeFileSync(file, user)
    assert.equal(prepareNativeProfileDefaults(profile, join(profile, 'documents')), true)
    const result = readFileSync(file, 'utf8')
    assert.ok(result.startsWith(user))
    assert.equal(count(result, 'webserver'), 1)
    assert.match(result, /documentsDirectory:/)
    assert.equal(prepareNativeProfileDefaults(profile, join(profile, 'elsewhere')), false)
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

/** The native include merge (applyEntryPatches): each non-insert row assigns only the keys it sets. */
function merged(file: string): Record<string, Record<string, unknown>> {
  const rows = parseDocument(readFileSync(file, 'utf8'), yamlOptions).toJS() as Record<string, unknown>[]
  const result: Record<string, Record<string, unknown>> = {}
  for (const { id, insert, ...keys } of rows)
    if (typeof id === 'string' && insert === undefined) result[id] = { ...result[id], ...keys }
  return result
}

test('a user disable without config stays disabled after the default config row is appended', () => {
  const profile = mkdtempSync(join(tmpdir(), 'px-native-defaults-'))
  try {
    const file = join(profile, 'cordis.patch.yml')
    writeFileSync(file, '- id: webserver\n  disabled: true\n- id: workspace-controller\n  disabled: true\n')
    prepareNativeProfileDefaults(profile, join(profile, 'documents'))
    const result = merged(file)
    assert.equal(result.webserver.disabled, true)
    assert.equal(result['workspace-controller'].disabled, true)
    assert.deepEqual(result.webserver.config, { host: '127.0.0.1', port: 0 })
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

test('a user config in an earlier row is kept when a later row for the same id has no config', () => {
  const profile = mkdtempSync(join(tmpdir(), 'px-native-defaults-'))
  try {
    const file = join(profile, 'cordis.patch.yml')
    const original =
      '- id: webserver\n  config:\n    host: 0.0.0.0\n    port: 3080\n- id: webserver\n  disabled: false\n' +
      '- id: workspace-controller\n  config:\n    documentsDirectory: D:\\Docs\n- id: workspace-controller\n  disabled: false\n'
    writeFileSync(file, original)
    assert.equal(prepareNativeProfileDefaults(profile, join(profile, 'documents')), false)
    assert.equal(readFileSync(file, 'utf8'), original, 'the patch is not rewritten')
    const result = merged(file)
    assert.deepEqual(result.webserver.config, { host: '0.0.0.0', port: 3080 })
    assert.deepEqual(result['workspace-controller'].config, { documentsDirectory: 'D:\\Docs' })
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

test('defaults are restored after native disable-all recovery moved the patch away', () => {
  const profile = mkdtempSync(join(tmpdir(), 'px-native-recovery-'))
  try {
    writeFileSync(join(profile, 'package.json'), '{"private":true}')
    const documents = join(profile, 'documents')
    assert.equal(prepareNativeProfileDefaults(profile, documents), true)
    applyNativeDesktopPolicy(profile)
    const file = join(profile, 'cordis.patch.yml')
    // sanitizeProfile renames the patch to a .bak-<ms> sibling and keeps package.json.
    renameSync(file, `${file}.bak-1`)
    assert.equal(prepareNativeProfileDefaults(profile, documents), true)
    assert.equal(applyNativeDesktopPolicy(profile), true)
    const rows = effective(file)
    for (const id of telemetryIds) assert.equal(rows[id], true)
    assert.ok('webserver' in rows && 'workspace-controller' in rows)
    // Comment-only native template is treated as an empty sequence.
    writeFileSync(file, '# Your patch layer\n')
    assert.equal(prepareNativeProfileDefaults(profile, documents), true)
    assert.ok(readFileSync(file, 'utf8').includes('# Your patch layer'))
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

test('desktop telemetry policy preserves imported settings and disables all official telemetry rows', () => {
  const profile = mkdtempSync(join(tmpdir(), 'px-native-policy-'))
  try {
    const patch = join(profile, 'cordis.patch.yml')
    const imported =
      '# keep me\n- id: user-plugin\n  disabled: !!js "false"\n  config:\n    v: !!js process.env.X # trailing\n' +
      '- id: product-analytics\n  disabled: false\n'
    writeFileSync(patch, imported)
    assert.equal(applyNativeDesktopPolicy(profile), true)
    const result = readFileSync(patch, 'utf8')
    for (const kept of ['# keep me', '!!js "false"', '!!js process.env.X', '# trailing'])
      assert.ok(result.includes(kept))
    assert.equal(count(result, 'product-analytics'), 1, 'existing row is updated in place')
    const rows = effective(patch)
    for (const id of telemetryIds) assert.equal(rows[id], true)
    assert.equal(applyNativeDesktopPolicy(profile), false)
    assert.equal(readFileSync(patch, 'utf8'), result)
    assert.deepEqual(readdirSync(profile), ['cordis.patch.yml'], 'no temporary files remain')
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

test('telemetry policy stays idempotent across native toggles and repeated starts', () => {
  const profile = mkdtempSync(join(tmpdir(), 'px-policy-toggle-'))
  try {
    const patch = join(profile, 'cordis.patch.yml')
    writeFileSync(patch, '# Your patch layer\n[]\n')
    applyNativeDesktopPolicy(profile)
    const baseline = readFileSync(patch, 'utf8')
    for (let start = 0; start < 5; start++) {
      nativeToggle(patch, `plugin-${start}`, false)
      assert.equal(applyNativeDesktopPolicy(profile), false)
    }
    // User re-enables telemetry through the native UI: native writes the last row, next start reverts it.
    nativeToggle(patch, 'session-telemetry-otel', true)
    nativeToggle(patch, 'product-analytics', true)
    assert.equal(applyNativeDesktopPolicy(profile), true)
    for (let start = 0; start < 3; start++) assert.equal(applyNativeDesktopPolicy(profile), false)
    const result = readFileSync(patch, 'utf8')
    for (const id of telemetryIds) {
      assert.equal(count(result, id), 1)
      assert.equal(count(baseline, id), 1)
      assert.equal(effective(patch)[id], true)
    }
    assert.ok(result.includes('# Your patch layer'))
    for (let i = 0; i < 5; i++) assert.equal(effective(patch)[`plugin-${i}`], true)
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

test('telemetry policy honors native last-wins and ignores insert rows and mismatched names', () => {
  const profile = mkdtempSync(join(tmpdir(), 'px-policy-lastwins-'))
  try {
    const patch = join(profile, 'cordis.patch.yml')
    writeFileSync(
      patch,
      '- id: product-analytics\n  disabled: true\n- id: product-analytics\n  disabled: false\n' +
        '- insert:\n  - id: session-telemetry-otel\n    name: telemetry\n  id: session-telemetry-otel\n' +
        '- id: desktop-product-telemetry\n  name: other-module\n  disabled: true\n'
    )
    assert.equal(applyNativeDesktopPolicy(profile), true)
    const document = parseDocument(readFileSync(patch, 'utf8'), yamlOptions).toJS() as Record<
      string,
      unknown
    >[]
    assert.deepEqual(document[0], { id: 'product-analytics', disabled: true })
    assert.deepEqual(document[1], { id: 'product-analytics', disabled: true })
    assert.deepEqual(document.slice(-2), [
      { id: 'desktop-product-telemetry', disabled: true },
      { id: 'session-telemetry-otel', disabled: true }
    ])
    assert.equal(applyNativeDesktopPolicy(profile), false)
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

test('desktop telemetry policy handles native empty flow sequences and retains invalid input', () => {
  const profile = mkdtempSync(join(tmpdir(), 'px-policy-empty-'))
  try {
    const patch = join(profile, 'cordis.patch.yml')
    writeFileSync(patch, '[]\n')
    assert.equal(applyNativeDesktopPolicy(profile), true)
    assert.equal(applyNativeDesktopPolicy(profile), false)
    writeFileSync(patch, 'broken: [')
    assert.throws(() => applyNativeDesktopPolicy(profile))
    assert.equal(readFileSync(patch, 'utf8'), 'broken: [')
    writeFileSync(patch, 'key: value\n')
    assert.throws(() => applyNativeDesktopPolicy(profile), /sequence/)
    assert.deepEqual(readdirSync(profile), ['cordis.patch.yml'])
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})
