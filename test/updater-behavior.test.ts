import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isNewer } from '../packages/dsh-px-updater/src/version'
import { checkLabel, requestJson, safeReleaseUrl } from '../packages/dsh-px-updater/src/client-data'

test('版本比较包含预发布段、数字顺序与正式版；忽略 build metadata，拒绝非法值', () => {
  for (const [candidate, current, expected] of [
    ['0.2.0-alpha.2', '0.2.0-alpha.1', true],
    ['0.2.0-alpha.10', '0.2.0-alpha.9', true],
    ['0.2.0', '0.2.0-alpha.5', true],
    ['0.2.0-alpha.5', '0.2.0', false],
    ['0.2.1-alpha.1', '0.2.0', true],
    ['1.0.0+new', '1.0.0+old', false],
    ['1.0.0broken', '0.1.0', false],
    ['1.0.0', '未知', false],
    [null, '0.1.0', false]
  ] as const)
    assert.equal(isNewer(candidate, current), expected, `${candidate} > ${current}`)
})

test('签名校验失败或未检查时不能显示已是最新', () => {
  const ok = { error: null, latest: { pack: '0.2.0-alpha.1' }, updateAvailable: false }
  assert.equal(checkLabel(ok, false), 'upToDate')
  assert.equal(checkLabel({ ...ok, updateAvailable: true }, false), 'available')
  assert.equal(checkLabel(ok, true), 'checkFailed')
  assert.equal(checkLabel(null, false), 'notChecked')
  assert.equal(checkLabel({ ...ok, error: '签名更新清单未通过校验' }, false), 'checkFailed')
  assert.equal(checkLabel({ ...ok, latest: { pack: null } }, false), 'checkFailed')
})

test('HTTP 拒绝显示服务器给出的具体原因', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response(JSON.stringify({ error: '签名更新清单未通过校验' }), { status: 502 })
  )
  await assert.rejects(requestJson('/check'), /签名更新清单未通过校验/)
})

test('release link is actionable only for this repository and a Pack release tag', () => {
  assert.equal(
    safeReleaseUrl('https://github.com/Palbudir/dsh-px/releases/tag/pack-v0.2.0-alpha.2', 'Palbudir/dsh-px'),
    true
  )
  for (const value of [
    'javascript:alert(1)',
    'https://evil.example/Palbudir/dsh-px/releases/tag/pack-v1',
    'https://github.com/other/repo/releases/tag/pack-v1',
    'https://github.com/Palbudir/dsh-px/releases/tag/v0.1.0-beta.re.0.11',
    'https://github.com/Palbudir/dsh-px/releases/latest',
    'https://user:secret@github.com/Palbudir/dsh-px/releases/tag/pack-v1'
  ])
    assert.equal(safeReleaseUrl(value, 'Palbudir/dsh-px'), false)
})
