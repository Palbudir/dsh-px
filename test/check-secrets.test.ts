import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RULES, maskSecrets, scanText } from '../scripts/check-secrets.mjs'

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

test('every character any rule matches on the original is masked, even across overlapping rules', () => {
  const marker = j('QZ9', 'RESIDUE', 'QZ9')
  const r = (n: number) => 'Kq7Pz3Xw9Lm2Rt5Vb8Nc4Hd6Jf1Gs0Ya'.repeat(3).slice(0, n)
  // A narrow rule covers only the head of the value; a wider rule covers the marker tail too.
  const credentials = [
    j('apikey = "', 'AI', 'za', r(35), marker, '"'),
    j('token = ', 's', 'k-', r(40), '.', marker),
    j('secret: ', 'np', 'm_', r(36), marker),
    j('Authorization: Bearer ', 'gh', 'p_', r(36), '.', marker)
  ]
  for (const sample of credentials) {
    const masked = maskSecrets(sample)
    assert.equal(masked.length, sample.length)
    assert.ok(!masked.includes(marker), 'no unmasked tail may survive')
    // Independent oracle: each rule's own value range on the original must be all `*`.
    for (const [id, rule, group] of RULES) {
      for (const m of sample.matchAll(new RegExp(rule.source, rule.flags.replace('g', '') + 'gd'))) {
        const range = (group ? m.indices![group] : undefined) ?? m.indices![0]
        const [s, e] = range!
        assert.ok(/^\*+$/.test(masked.slice(s, e)), `${id} range left unmasked`)
      }
    }
  }
  // For a personal path only the user name is the secret; the rest of the path stays readable.
  const path = j('password = C:/Users/', 'alice', '/', marker)
  assert.equal(maskSecrets(path), path.replace('alice', '*****'))
  // Masked text rescans clean for every path form, including POSIX home directories.
  for (const p of [j('C:\\Users\\', 'bob', '\\x'), j('/home/', 'bob', '/x'), j('/c/Users/', 'bob', '/x')])
    assert.deepEqual(rules(maskSecrets(p)), [])
})

test('a token glued to a fixed-length key is masked too, so masked text rescans clean', () => {
  const r = (n: number) => 'Kq7Pz3Xw9Lm2Rt5Vb8Nc4Hd6Jf1Gs0Ya'.repeat(3).slice(0, n)
  const tail = j('gh', 'p_', r(36))
  for (const head of [j('np', 'm_', r(36)), j('AI', 'za', r(35))]) {
    const sample = j('x = ', head, tail)
    const masked = maskSecrets(sample)
    assert.equal(masked.length, sample.length)
    assert.ok(!masked.includes(tail.slice(4)), 'the glued token must not survive')
    assert.deepEqual(rules(masked), [])
  }
})

test('masking a path keeps the surrounding syntax parseable', () => {
  const source = j('const p = "C:\\\\Users\\\\', 'alice', '\\\\x"\nexport {}')
  const masked = maskSecrets(source)
  assert.ok(!masked.includes('alice'))
  // Only the user name is replaced; quotes and escape sequences are unchanged.
  assert.equal(masked, source.replace('alice', '*****'))
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
