import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isNewer } from '../packages/dsh-px-updater/src/version'
import { checkLabel, requestJson } from '../packages/dsh-px-updater/src/client-data'

test('版本比较包含预发布段、数字顺序与正式版；忽略 build metadata，拒绝非法值', () => {
  for (const [candidate, current, expected] of [
    ['v0.1.0-beta.re.0.6', '0.1.0-beta.re.0.5', true],
    ['0.1.0-beta.re.0.10', '0.1.0-beta.re.0.9', true],
    ['0.1.0', '0.1.0-beta.re.0.5', true],
    ['0.1.0-beta.re.0.5', '0.1.0', false],
    ['0.1.0-beta-re.0.1', '0.1.0-beta.8', true],
    ['1.0.0+new', '1.0.0+old', false],
    ['1.0.0broken', '0.1.0', false],
    ['1.0.0', '未知', false],
    [null, '0.1.0', false]
  ] as const) assert.equal(isNewer(candidate, current), expected, `${candidate} > ${current}`)
})

test('查询不完整或失败不能显示已是最新', () => {
  const complete = { latest: { app: '1.0.0', dsh: '1.0.0' }, current: { app: '1.0.0', dsh: '1.0.0' },
    updateAvailable: { app: false, dsh: false }, errors: [] as string[] }
  assert.equal(checkLabel(complete, false), 'upToDate')
  assert.equal(checkLabel(complete, true), 'checkFailed')
  assert.equal(checkLabel({ ...complete, errors: ['offline'] }, false), 'checkIncomplete')
  assert.equal(checkLabel({ ...complete, current: { app: '未知', dsh: '1.0.0' } }, false), 'checkIncomplete')
  assert.equal(checkLabel({ ...complete, latest: { app: null, dsh: null } }, false), 'checkIncomplete')
  assert.equal(checkLabel({ ...complete, latest: { app: null, dsh: null }, errors: ['GitHub offline', 'npm offline'] }, false), 'checkFailed')
})

test('安装 HTTP 拒绝显示服务器原因；双源失败保留具体原因', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: '尚未下载完成' }), { status: 409 }))
  await assert.rejects(requestJson('/install', { method: 'POST' }), /尚未下载完成/)
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ errors: ['GitHub offline', 'npm offline'] }), { status: 502 }))
  const result = await requestJson<{ errors: string[] }>('/check', {}, true)
  assert.deepEqual(result.errors, ['GitHub offline', 'npm offline'])
})
