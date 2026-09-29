import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scanText } from '../scripts/check-secrets.mjs'

const rules = (text: string) => scanText('sample/file.ts', text).map((f: { rule: string }) => f.rule)

test('secret scan flags credential-shaped values in tests and examples too', () => {
  const key = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ')
  assert.deepEqual(rules(key), ['private-key'])
  assert.deepEqual(rules('const t = "ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"'), ['github-token'])
  assert.deepEqual(rules("apiKey: 'Zq8Lr2Vt9Wx4Yb6Nc1Md3Pf5Gh7Jk0Qs'"), ['assigned-secret'])
  assert.deepEqual(rules('path = "C:\\\\Users\\\\alice\\\\AppData\\\\x"'), ['windows-user-path'])
  assert.deepEqual(rules('cd /home/alice/project'), ['posix-home-path'])
})

test('secret scan accepts declared placeholders and generic paths', () => {
  assert.deepEqual(rules("token: 'fixture-token-value-for-tests-only-0001'"), [])
  assert.deepEqual(rules('C:\\\\Users\\\\PRIVATE_FIXTURE_USER\\\\AppData\\\\x'), [])
  assert.deepEqual(rules('%USERPROFILE%\\\\.dsh-px and C:\\\\Users\\\\<用户名>\\\\AppData'), [])
  assert.deepEqual(rules('-----BEGIN PUBLIC KEY-----'), [])
})
