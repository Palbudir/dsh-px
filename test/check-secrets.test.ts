import { test } from 'node:test'
import assert from 'node:assert/strict'
import { maskSecrets, scanText } from '../scripts/check-secrets.mjs'

const rules = (text: string) => scanText('sample/file.ts', text).map((f: { rule: string }) => f.rule)
// Samples are assembled at runtime so this file itself never contains a matching literal.
const j = (...parts: string[]) => parts.join('')
const LONG = 'Zq8Lr2Vt9Wx4Yb6Nc1Md3Pf5Gh7Jk0Qs'

test('secret scan flags credential-shaped values in tests and examples too', () => {
  assert.deepEqual(rules(j('-----BEGIN ', 'PRIVATE KEY-----')), ['private-key'])
  assert.deepEqual(rules(j('const t = "gh', 'p_', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"')), ['github-token'])
  assert.deepEqual(rules(j("apiKey: '", LONG, "'")), ['assigned-secret'])
  assert.deepEqual(rules(j('path = "C:\\\\Users\\\\', 'alice', '\\\\AppData\\\\x"')), ['windows-user-path'])
  assert.deepEqual(rules(j('cd /home/', 'alice', '/project')), ['posix-home-path'])
})

test('unquoted, shell and PowerShell assignments are caught', () => {
  assert.deepEqual(rules(j('API_KEY=', LONG)), ['assigned-secret'])
  assert.deepEqual(rules(j('export DEEPSEEK_API_KEY=', LONG)), ['assigned-secret'])
  assert.deepEqual(rules(j("$env:X_API_KEY='", LONG, "'")), ['assigned-secret'])
  assert.deepEqual(rules(j('setx MY_TOKEN ', LONG)), ['assigned-secret'])
  assert.ok(rules(j('Authorization: token ', LONG)).includes('authorization-header'))
  assert.deepEqual(rules(j('Authorization: Bearer ', LONG)), ['authorization-header'])
})

test('non-ASCII and WSL user paths are caught', () => {
  assert.deepEqual(rules(j('C:\\Users\\', '张三', '\\Desktop\\a.txt')), ['windows-user-path'])
  assert.deepEqual(rules(j('/mnt/c/Users/', 'alice', '/repo')), ['windows-user-path'])
  assert.deepEqual(rules(j('cd /c/Users/', 'alice', '/repo')), ['windows-user-path'])
})

test('masking keeps length and line breaks and removes every match', () => {
  const sample = j('a\r\nkey = "C:\\\\Users\\\\', 'alice', '\\\\x"\nb')
  const masked = maskSecrets(sample)
  assert.equal(masked.length, sample.length)
  assert.ok(!masked.includes('alice') && masked.startsWith('a\r\n') && masked.endsWith('\nb'))
  assert.deepEqual(rules(masked), [])
  // Declared placeholders are left as they are.
  assert.equal(maskSecrets('C:\\Users\\Public\\x'), 'C:\\Users\\Public\\x')
})

test('nearby placeholder words no longer excuse a real-looking value', () => {
  assert.deepEqual(rules(j("apiKey: '", LONG, "' // fake")), ['assigned-secret'])
  assert.deepEqual(rules(j("apiKey: '", 'Zq8Lr2fake', "Vt9Wx4Yb6Nc1Md3Pf5Gh7Jk0Qs'")), ['assigned-secret'])
})

test('declared placeholders by value convention and generic paths are accepted', () => {
  assert.deepEqual(rules("token: 'fixture-token-value-for-tests-only-0001'"), [])
  assert.deepEqual(rules(j('const k = "s', 'k-fixture-secret-value-0123456789"')), [])
  assert.deepEqual(rules("password = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxx'"), [])
  assert.deepEqual(rules('C:\\\\Users\\\\PRIVATE_FIXTURE_USER\\\\AppData\\\\x'), [])
  assert.deepEqual(rules('%USERPROFILE%\\\\.dsh-px and C:\\\\Users\\\\<用户名>\\\\AppData'), [])
  assert.deepEqual(rules('C:\\Users\\Public\\Documents'), [])
  assert.deepEqual(rules('-----BEGIN PUBLIC KEY-----'), [])
  assert.deepEqual(rules('headers: { Authorization: `Bearer ${apiKey}` }'), [])
  // Code expressions and environment variable *names* are not credential values.
  assert.deepEqual(rules('const requestToken = quoteRequestTokensForSession()[id]?.token'), [])
  assert.deepEqual(rules("apiKeyEnv: 'DSHPX_REVIEW_FIXTURE_KEY_NAME'"), [])
})
